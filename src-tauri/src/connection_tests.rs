//! Cancellable connection tests for the add-account form (SPEC-204).
//!
//! An IPC call cannot be cancelled from the webview: dropping the promise does
//! nothing to the Rust future, and a silent or firewalled host holds a test for
//! its full ladder of timeouts (up to ~90 s for IMAP). So a test that carries a
//! `test_id` runs as its own task, its abort handle is kept here, and a second
//! command aborts it. Aborting drops every inner future — the socket closes
//! mid-handshake, which is what a timeout produces today.
//!
//! The registry holds abort handles only: never a config, host or password.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::task::AbortHandle;

/// How long a cancel-before-start tombstone is kept. A test that has not
/// started within this window after its cancel is not going to; the entry is
/// swept on the next registry write so the map cannot grow with junk ids.
const TOMBSTONE_TTL: Duration = Duration::from_secs(60);

enum Slot {
    /// A running test's abort handle, tagged so a displaced registration's
    /// cleanup cannot remove the entry that replaced it.
    Live { handle: AbortHandle, seq: u64 },
    /// A cancel that arrived before the test command registered (#68 review,
    /// Grok 1): the sync cancel command can be polled before the async test
    /// command's first poll. The test sees the tombstone and never spawns.
    Cancelled(Instant),
}

/// In-flight tests by the id the caller minted.
#[derive(Default)]
pub struct ConnectionTests {
    inner: Mutex<HashMap<u64, Slot>>,
}

impl ConnectionTests {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<u64, Slot>> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Remove `id` only if it still holds the registration tagged `seq`.
    fn remove_if(&self, id: u64, seq: u64) {
        let mut map = self.lock();
        if matches!(map.get(&id), Some(Slot::Live { seq: s, .. }) if *s == seq) {
            map.remove(&id);
        }
    }

    fn sweep(map: &mut HashMap<u64, Slot>, now: Instant) {
        map.retain(|_, slot| match slot {
            Slot::Live { .. } => true,
            Slot::Cancelled(at) => now.duration_since(*at) < TOMBSTONE_TTL,
        });
    }

    /// Cancel the test under `id`: abort it if it is running, or leave a
    /// tombstone so a test that has not registered yet never starts. `true`
    /// in both cases; `false` only for an id whose test already finished —
    /// there is nothing left to cancel and nothing left to prevent.
    pub fn cancel(&self, id: u64) -> bool {
        let mut map = self.lock();
        let now = Instant::now();
        Self::sweep(&mut map, now);
        match map.remove(&id) {
            Some(Slot::Live { handle, .. }) => {
                handle.abort();
                true
            }
            Some(Slot::Cancelled(at)) => {
                map.insert(id, Slot::Cancelled(at));
                true
            }
            None => {
                map.insert(id, Slot::Cancelled(now));
                true
            }
        }
    }

    #[cfg(test)]
    pub fn in_flight(&self) -> usize {
        self.lock().values().filter(|s| matches!(s, Slot::Live { .. })).count()
    }

    #[cfg(test)]
    pub fn entries(&self) -> usize {
        self.lock().len()
    }
}

/// Run `work` so that `cancel(id)` can stop it. Without an id the work runs
/// inline, exactly as the command did before this module existed.
///
/// The entry is removed on every exit path — result, cancellation, panic — so
/// the registry never grows past the number of tests in flight.
pub async fn run_cancellable<T, F>(
    tests: &ConnectionTests,
    id: Option<u64>,
    work: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: Future<Output = Result<T, String>> + Send + 'static,
{
    let Some(id) = id else {
        return work.await;
    };
    // Spawn and register under one lock: `spawn` only schedules the task, so a
    // cancel racing this call either finds the handle, or left its tombstone
    // first and the work never spawns (#68 review, Gemini N3 + Grok 1).
    let seq = NEXT_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let handle = {
        let mut map = tests.lock();
        let now = Instant::now();
        ConnectionTests::sweep(&mut map, now);
        if let Some(Slot::Cancelled(_)) = map.get(&id) {
            map.remove(&id);
            return Err("cancelled".to_string());
        }
        let handle = tokio::spawn(work);
        // A second test under the same id displaces the first: abort it rather
        // than orphan it (#68 review, Grok 6).
        let live = Slot::Live { handle: handle.abort_handle(), seq };
        if let Some(Slot::Live { handle: displaced, .. }) = map.insert(id, live) {
            displaced.abort();
        }
        handle
    };
    // Removes *this* registration on every exit — including this future being
    // dropped before the join (webview teardown), which also aborts the task
    // instead of detaching it (#68 review, Grok 5). Abort on a finished task is
    // a no-op; a displaced registration never removes the one that replaced it.
    let _registered = Registered { tests, id, seq, abort: handle.abort_handle() };
    match handle.await {
        Ok(result) => result,
        Err(join) if join.is_cancelled() => Err("cancelled".to_string()),
        Err(join) => {
            // The panic text stays in the log; the webview gets a fixed string.
            log::warn!("connection test task failed: {join}");
            Err("connection test failed unexpectedly".to_string())
        }
    }
}

/// Tags each registration so cleanup is scoped to its own entry.
static NEXT_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

struct Registered<'a> {
    tests: &'a ConnectionTests,
    id: u64,
    seq: u64,
    abort: AbortHandle,
}

impl Drop for Registered<'_> {
    fn drop(&mut self) {
        self.abort.abort();
        self.tests.remove_if(self.id, self.seq);
    }
}

/// The IPC command: abort the test registered under `test_id`.
#[tauri::command]
pub fn connection_test_cancel(test_id: u64, tests: tauri::State<'_, ConnectionTests>) -> bool {
    tests.cancel(test_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imap::client as imap_client;
    use crate::imap::types::ImapConfig;
    use std::net::TcpListener;
    use std::sync::Arc;

    #[tokio::test]
    async fn without_an_id_the_work_runs_inline_and_registers_nothing() {
        let tests = ConnectionTests::new();
        let out = run_cancellable(&tests, None, async { Ok::<_, String>(7) }).await;
        assert_eq!(out, Ok(7));
        assert_eq!(tests.in_flight(), 0);
    }

    #[tokio::test]
    async fn a_finished_test_leaves_the_registry() {
        let tests = Arc::new(ConnectionTests::new());
        let out = run_cancellable(&tests, Some(1), async { Ok::<_, String>("done") }).await;
        assert_eq!(out, Ok("done"));
        assert_eq!(tests.in_flight(), 0);
        assert_eq!(tests.entries(), 0);
    }

    /// #68 review, Grok 1 — the cancel command can be polled before the test
    /// command registers. The cancel leaves a tombstone; the test never spawns.
    #[tokio::test]
    async fn a_cancel_that_arrives_before_the_test_registers_prevents_it_from_starting() {
        let tests = ConnectionTests::new();
        assert!(tests.cancel(7), "a cancel for an id not seen yet is kept as a tombstone");
        assert_eq!(tests.entries(), 1);
        assert_eq!(tests.in_flight(), 0);

        let polled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = Arc::clone(&polled);
        let out = run_cancellable::<(), _>(&tests, Some(7), async move {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        })
        .await;

        assert_eq!(out, Err("cancelled".to_string()));
        assert!(!polled.load(std::sync::atomic::Ordering::SeqCst), "the work must never run");
        assert_eq!(tests.entries(), 0, "the tombstone is consumed");
    }

    #[test]
    fn tombstones_are_swept_after_their_ttl_and_a_repeat_cancel_is_idempotent() {
        let tests = ConnectionTests::new();
        assert!(tests.cancel(8));
        assert!(tests.cancel(8), "repeat cancel keeps the tombstone");
        assert_eq!(tests.entries(), 1);
        // Age the tombstone past the TTL and touch the registry.
        {
            let mut map = tests.lock();
            map.insert(8, Slot::Cancelled(Instant::now() - TOMBSTONE_TTL - Duration::from_secs(1)));
        }
        assert!(tests.cancel(9)); // any write sweeps
        assert_eq!(tests.entries(), 1, "only the fresh tombstone remains");
    }

    #[tokio::test]
    async fn an_error_from_the_work_is_relayed_and_the_entry_removed() {
        let tests = ConnectionTests::new();
        let out = run_cancellable::<(), _>(&tests, Some(2), async { Err("LIST failed".to_string()) }).await;
        assert_eq!(out, Err("LIST failed".to_string()));
        assert_eq!(tests.in_flight(), 0);
    }

    #[tokio::test]
    async fn cancel_aborts_a_pending_test_at_once() {
        let tests = Arc::new(ConnectionTests::new());
        let runner = Arc::clone(&tests);
        let run = tokio::spawn(async move {
            run_cancellable::<(), _>(&runner, Some(3), async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(())
            })
            .await
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(tests.in_flight(), 1);
        assert!(tests.cancel(3));
        let out = run.await.unwrap();
        assert_eq!(out, Err("cancelled".to_string()));
        assert_eq!(tests.in_flight(), 0);
    }

    #[tokio::test]
    async fn a_panicking_test_is_reported_and_its_entry_removed() {
        let tests = ConnectionTests::new();
        let out = run_cancellable::<(), _>(&tests, Some(5), async {
            panic!("boom");
        })
        .await;
        let err = out.unwrap_err();
        assert_eq!(err, "connection test failed unexpectedly", "a fixed string, never the panic text");
        assert_eq!(tests.in_flight(), 0);
    }

    /// #68 review, Grok 5 — the command future itself dropped mid-flight
    /// (webview teardown): the entry goes and the task is aborted, not detached.
    #[tokio::test]
    async fn dropping_the_command_future_removes_the_entry_and_aborts_the_task() {
        let tests = ConnectionTests::new();
        let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = Arc::clone(&finished);
        let run = run_cancellable::<(), _>(&tests, Some(10), async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        });
        assert!(tokio::time::timeout(Duration::from_millis(50), run).await.is_err(), "the outer future was dropped");
        assert_eq!(tests.entries(), 0);
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert!(!finished.load(std::sync::atomic::Ordering::SeqCst), "the task was aborted, not detached");
    }

    /// #68 review, Grok 6 — a second test under the same id displaces the first,
    /// which must be aborted rather than orphaned.
    #[tokio::test]
    async fn a_duplicate_id_aborts_the_displaced_test() {
        let tests = Arc::new(ConnectionTests::new());
        let a = Arc::clone(&tests);
        let first = tokio::spawn(async move {
            run_cancellable::<(), _>(&a, Some(11), async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(())
            })
            .await
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let b = Arc::clone(&tests);
        let second = tokio::spawn(async move {
            run_cancellable::<(), _>(&b, Some(11), async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(())
            })
            .await
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(first.await.unwrap(), Err("cancelled".to_string()), "the displaced first test was aborted");
        assert_eq!(tests.in_flight(), 1);
        assert!(tests.cancel(11));
        assert_eq!(second.await.unwrap(), Err("cancelled".to_string()));
        assert_eq!(tests.entries(), 0);
    }

    /// A socket that accepts, says nothing, and reports what its first read
    /// returned — `Ok(0)` means the client closed it (#68 review, Gemini 3.8 L4).
    fn silent_server() -> (u16, std::sync::mpsc::Receiver<std::io::Result<usize>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            // Never answer; swallow whatever the client sends (a plaintext IMAP
            // client sends LOGIN at once) and report only the end: `Ok(0)` when
            // the client closed, or the error/timeout that ended the read.
            let mut buf = [0u8; 64];
            let outcome = loop {
                match std::io::Read::read(&mut stream, &mut buf) {
                    Ok(0) => break Ok(0),
                    Ok(_) => continue,
                    Err(e) => break Err(e),
                }
            };
            let _ = tx.send(outcome);
        });
        (port, rx)
    }

    fn assert_socket_closed(rx: &std::sync::mpsc::Receiver<std::io::Result<usize>>) {
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(0)) => {}
            other => panic!("the server should have seen EOF from the aborted client, got {other:?}"),
        }
    }

    /// SPEC-204 REQ-2.3 — the real SMTP test against a silent socket, same
    /// shape as the IMAP one (#68 review, Gemini N4).
    #[tokio::test]
    async fn a_real_smtp_test_against_a_silent_server_is_cancelled_within_a_second() {
        use crate::smtp::client as smtp_client;
        use crate::smtp::types::SmtpConfig;
        let (port, rx) = silent_server();
        let config = SmtpConfig {
            host: "127.0.0.1".to_string(),
            port,
            security: "none".to_string(),
            username: "someone".to_string(),
            password: "not-a-real-secret".to_string(),
            auth_method: "password".to_string(),
            accept_invalid_certs: false,
        };
        let tests = Arc::new(ConnectionTests::new());
        let runner = Arc::clone(&tests);
        let started = Instant::now();
        let run = tokio::spawn(async move {
            run_cancellable(&runner, Some(6), async move { smtp_client::test_connection(&config).await }).await
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(tests.cancel(6));

        let out = run.await.unwrap();
        assert_eq!(out.unwrap_err(), "cancelled");
        assert!(started.elapsed() < Duration::from_secs(1), "took {:?}", started.elapsed());
        assert_eq!(tests.in_flight(), 0);
        assert_socket_closed(&rx);
    }

    /// SPEC-204 REQ-2.3 — the real IMAP test against a socket that accepts and
    /// never answers, cancelled after 100 ms: back well under a second, not
    /// after the 30 s greeting timeout.
    #[tokio::test]
    async fn a_real_imap_test_against_a_silent_server_is_cancelled_within_a_second() {
        let (port, rx) = silent_server();
        let config = ImapConfig {
            host: "127.0.0.1".to_string(),
            port,
            security: "none".to_string(),
            username: "someone".to_string(),
            password: "not-a-real-secret".to_string(),
            auth_method: "password".to_string(),
            accept_invalid_certs: false,
        };

        let tests = Arc::new(ConnectionTests::new());
        let runner = Arc::clone(&tests);
        let started = Instant::now();
        let run = tokio::spawn(async move {
            run_cancellable(&runner, Some(4), async move { imap_client::test_connection(&config).await }).await
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(tests.cancel(4));

        let out = run.await.unwrap();
        assert_eq!(out, Err("cancelled".to_string()));
        assert!(started.elapsed() < Duration::from_secs(1), "took {:?}", started.elapsed());
        assert_eq!(tests.in_flight(), 0);
        assert_socket_closed(&rx);
    }
}
