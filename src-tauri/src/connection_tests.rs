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
use tokio::task::AbortHandle;

/// In-flight tests by the id the caller minted.
#[derive(Default)]
pub struct ConnectionTests {
    inner: Mutex<HashMap<u64, AbortHandle>>,
}

impl ConnectionTests {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<u64, AbortHandle>> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn register(&self, id: u64, handle: AbortHandle) {
        self.lock().insert(id, handle);
    }

    fn remove(&self, id: u64) {
        self.lock().remove(&id);
    }

    /// Abort the test registered under `id`. `true` once; `false` for an
    /// unknown or already-finished id (nothing happens).
    pub fn cancel(&self, id: u64) -> bool {
        match self.lock().remove(&id) {
            Some(handle) => {
                handle.abort();
                true
            }
            None => false,
        }
    }

    pub fn in_flight(&self) -> usize {
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
    let handle = tokio::spawn(work);
    tests.register(id, handle.abort_handle());
    let outcome = match handle.await {
        Ok(result) => result,
        Err(join) if join.is_cancelled() => Err("cancelled".to_string()),
        Err(join) => Err(format!("connection test failed: {join}")),
    };
    tests.remove(id);
    outcome
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
    use std::time::{Duration, Instant};

    #[tokio::test]
    async fn without_an_id_the_work_runs_inline_and_registers_nothing() {
        let tests = ConnectionTests::new();
        let out = run_cancellable(&tests, None, async { Ok::<_, String>(7) }).await;
        assert_eq!(out, Ok(7));
        assert_eq!(tests.in_flight(), 0);
    }

    #[tokio::test]
    async fn a_finished_test_leaves_the_registry_and_cannot_be_cancelled_afterwards() {
        let tests = Arc::new(ConnectionTests::new());
        let out = run_cancellable(&tests, Some(1), async { Ok::<_, String>("done") }).await;
        assert_eq!(out, Ok("done"));
        assert_eq!(tests.in_flight(), 0);
        assert!(!tests.cancel(1), "a finished id is unknown");
        assert!(!tests.cancel(999), "an id that never existed is unknown");
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
        assert!(!tests.cancel(3), "cancel is true exactly once");
        let out = run.await.unwrap();
        assert_eq!(out, Err("cancelled".to_string()));
        assert_eq!(tests.in_flight(), 0);
    }

    /// SPEC-204 REQ-2.3 — the real IMAP test against a socket that accepts and
    /// never answers, cancelled after 100 ms: back well under a second, not
    /// after the 30 s greeting timeout.
    #[tokio::test]
    async fn a_real_imap_test_against_a_silent_server_is_cancelled_within_a_second() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            // Accept, then hold the socket open in silence for longer than the test.
            let (_stream, _) = listener.accept().unwrap();
            std::thread::sleep(Duration::from_secs(5));
        });
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
    }
}
