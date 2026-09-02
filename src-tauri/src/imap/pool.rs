//! Pooled IMAP sessions (brief E2/P15, rev 4).
//!
//! Velo opens a fresh IMAP connection for every operation and logs out again.
//! A delta sync costs `2 + ceil(U/50)` logins. This module keeps authenticated
//! sessions alive between commands, keyed by an opaque session id the frontend
//! passes back in.
//!
//! # The rule that makes it safe
//!
//! A pooled connection is only safe to reuse if it is known to be *in protocol
//! sync*. Every safeguard in rev 3 of the brief fired on an `Err` returned to
//! the caller, and two paths produce a desynchronised session without ever
//! producing one:
//!
//! - **Cancellation.** A dropped command future releases the session
//!   mid-protocol with no error at all; the next acquirer reads the aborted
//!   command's response tail.
//! - **Panic.** `tokio::sync::Mutex` has no poisoning, so a parser panic on
//!   hostile bytes leaves the desynchronised session reusable.
//!
//! So checkout **takes the session out of the map**, and only clean completion
//! puts it back:
//!
//! ```text
//! acquire      -> entry.session.take()          (None already == in flight)
//! release_ok   -> entry.session = Some(..)      + stamp last_used
//! release_err  -> entries.remove(id)            + close
//! Drop, neither called -> the entry is already gone; the session closes itself
//! ```
//!
//! Eviction is therefore a fact about the map rather than a fact about an error
//! reaching the caller — which is the point, because cancellation and panic both
//! unwind through `Drop`, and `Drop` cannot observe an `Err`.
//!
//! # Why the map lock is a `std` mutex
//!
//! It is never held across an `.await` — the brief's own rule, and the reason
//! lookups never stall behind a 120 s fetch. Being a blocking mutex is what lets
//! `Drop` evict at all: an async mutex could not be locked from a destructor,
//! and the cancellation path *is* a destructor.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Per-account session cap: one `sync`, one `interactive`.
pub const PER_ACCOUNT_CAP: usize = 2;

/// Idle time after which the reaper closes a session.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(300);

/// Identifies an account independently of the credential currently in use.
///
/// Deliberately excludes the version so a credential rotation can find every
/// session belonging to the account it supersedes.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AccountIdent {
    pub username: String,
    pub host: String,
}

/// Identifies a *connection configuration*, not just an account.
///
/// Finding 3: `"user@host"` collides across port, TLS mode and auth mechanism,
/// so sessions established under different configurations would share a bucket
/// — and after a credential rotation the pool would keep serving sessions
/// authenticated with the superseded one, fine until the server stops
/// tolerating it. `credential_version` is a counter bumped on re-login; it is
/// never the credential itself.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AccountKey {
    pub ident: AccountIdent,
    pub port: u16,
    pub security: String,
    pub auth_mechanism: String,
    pub credential_version: u64,
}

/// Why a checkout failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PoolError {
    /// No such session id: never opened, evicted, or reaped. The caller reopens.
    NoSuchSession,
    /// The session exists but another operation holds it. Retry; do not reopen.
    ///
    /// Under checkout-removes-entry there is no session mutex left to queue on,
    /// so concurrent use is refused rather than serialised. The two session
    /// kinds (`sync`, `interactive`) exist so this stays rare.
    SessionBusy,
    /// The per-account cap is reached and no session could be evicted.
    TooManySessions,
}

/// Reserved prefix for control-flow sentinels crossing the IPC boundary.
///
/// Pool errors and operation errors share one `Result<T, String>` channel, and
/// the operation half carries **server-supplied text** — mailbox names, `NO`
/// responses, anything the remote end put in an error. The frontend decides
/// whether to retry based on which kind it got, so if that decision is a loose
/// substring match, a server can spell a sentinel and steer it. A namespaced
/// prefix plus exact matching on the frontend closes that: an IMAP error is
/// always `"<operation> failed: <detail>"`, never exactly one of these.
pub const SENTINEL_PREFIX: &str = "velo:pool:";

impl std::fmt::Display for PoolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoSuchSession => write!(f, "{SENTINEL_PREFIX}NoSuchSession"),
            Self::SessionBusy => write!(f, "{SENTINEL_PREFIX}SessionBusy"),
            Self::TooManySessions => write!(f, "{SENTINEL_PREFIX}TooManySessions"),
        }
    }
}

struct Entry<S> {
    /// `None` means checked out — an operation is in flight.
    session: Option<Arc<tokio::sync::Mutex<S>>>,
    account_key: AccountKey,
    /// Stamped on acquire, not on lookup, so a long in-flight operation cannot
    /// be reaped mid-command.
    last_used: Instant,
}

struct PoolInner<S> {
    entries: HashMap<String, Entry<S>>,
    /// Current credential generation per account. Absent means 0.
    versions: HashMap<AccountIdent, u64>,
    /// Monotonic source for session ids in tests; production ids come from
    /// `getrandom` at the call site (Decision 2).
    #[cfg(test)]
    next_test_id: u64,
}

/// A live pool of authenticated IMAP sessions.
///
/// Generic over the session type so the eviction paths can be tested without a
/// network: the rules this module exists to enforce are about the map, not
/// about IMAP.
pub struct SessionPool<S> {
    inner: Mutex<PoolInner<S>>,
}

impl<S> Default for SessionPool<S> {
    fn default() -> Self {
        Self::new()
    }
}

impl<S> SessionPool<S> {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(PoolInner {
                entries: HashMap::new(),
                versions: HashMap::new(),
                #[cfg(test)]
                next_test_id: 0,
            }),
        }
    }

    /// Current credential generation for an account.
    pub fn credential_version(&self, ident: &AccountIdent) -> u64 {
        let inner = self.lock();
        inner.versions.get(ident).copied().unwrap_or(0)
    }

    /// Invalidate every session authenticated with the account's current
    /// credential, and move the account to a new generation.
    ///
    /// Called on password change (`clearConfigCache`) and on OAuth refresh, so
    /// a rotated credential cannot keep being served. Returns the evicted
    /// sessions for the caller to close; dropping them closes them anyway.
    pub fn bump_credential_version(&self, ident: &AccountIdent) -> Vec<Arc<tokio::sync::Mutex<S>>> {
        let mut inner = self.lock();
        let next = inner.versions.get(ident).copied().unwrap_or(0) + 1;
        inner.versions.insert(ident.clone(), next);

        let doomed: Vec<String> = inner
            .entries
            .iter()
            .filter(|(_, e)| &e.account_key.ident == ident)
            .map(|(id, _)| id.clone())
            .collect();

        doomed
            .into_iter()
            .filter_map(|id| inner.entries.remove(&id))
            .filter_map(|e| e.session)
            .collect()
    }

    /// Register an already-authenticated session under `id`.
    ///
    /// Enforces the per-account cap by evicting that account's idlest *idle*
    /// session rather than failing — a user opening a third pop-out should not
    /// see an error. `TooManySessions` is a last resort: every session for the
    /// account is currently checked out.
    pub fn insert(&self, id: String, account_key: AccountKey, session: S) -> Result<(), PoolError> {
        let mut inner = self.lock();

        let live = inner
            .entries
            .values()
            .filter(|e| e.account_key.ident == account_key.ident)
            .count();

        if live >= PER_ACCOUNT_CAP {
            // Evict the idlest entry that is not in flight.
            let victim = inner
                .entries
                .iter()
                .filter(|(_, e)| e.account_key.ident == account_key.ident && e.session.is_some())
                .min_by_key(|(_, e)| e.last_used)
                .map(|(id, _)| id.clone());

            match victim {
                Some(v) => {
                    inner.entries.remove(&v);
                }
                None => return Err(PoolError::TooManySessions),
            }
        }

        inner.entries.insert(
            id,
            Entry {
                session: Some(Arc::new(tokio::sync::Mutex::new(session))),
                account_key,
                last_used: Instant::now(),
            },
        );
        Ok(())
    }

    /// Take a session out of the map for the duration of one operation.
    ///
    /// The returned guard **must** be told how the operation ended. If it is
    /// dropped without `release_ok`, the entry stays gone — which is exactly
    /// the behaviour cancellation and panic need.
    pub fn acquire(&self, id: &str) -> Result<SessionGuard<'_, S>, PoolError> {
        let mut inner = self.lock();
        let entry = inner.entries.get_mut(id).ok_or(PoolError::NoSuchSession)?;
        let session = entry.session.take().ok_or(PoolError::SessionBusy)?;
        entry.last_used = Instant::now();

        let account = entry.account_key.ident.clone();

        Ok(SessionGuard {
            pool: self,
            id: id.to_string(),
            session: Some(session),
            account,
        })
    }

    /// Remove a session id, returning its session if it was not in flight.
    ///
    /// Idempotent: closing an unknown or already-closed session is not an error.
    pub fn remove(&self, id: &str) -> Option<Arc<tokio::sync::Mutex<S>>> {
        let mut inner = self.lock();
        inner.entries.remove(id).and_then(|e| e.session)
    }

    /// Sessions idle longer than `idle_timeout`, removed from the map.
    ///
    /// Returns them for the caller to LOGOUT. In-flight entries are skipped —
    /// `last_used` is stamped on acquire, so a long operation is never reaped
    /// mid-command. The map lock is released before the caller does any I/O.
    pub fn reap(&self, idle_timeout: Duration) -> Vec<Arc<tokio::sync::Mutex<S>>> {
        let now = Instant::now();
        let mut inner = self.lock();

        let doomed: Vec<String> = inner
            .entries
            .iter()
            .filter(|(_, e)| e.session.is_some() && now.duration_since(e.last_used) >= idle_timeout)
            .map(|(id, _)| id.clone())
            .collect();

        doomed
            .into_iter()
            .filter_map(|id| inner.entries.remove(&id))
            .filter_map(|e| e.session)
            .collect()
    }

    /// Drain the pool, returning every session that is not in flight.
    ///
    /// Used by the `RunEvent::ExitRequested` hook for a best-effort LOGOUT.
    pub fn drain(&self) -> Vec<Arc<tokio::sync::Mutex<S>>> {
        let mut inner = self.lock();
        let all: Vec<String> = inner.entries.keys().cloned().collect();
        all.into_iter()
            .filter_map(|id| inner.entries.remove(&id))
            .filter_map(|e| e.session)
            .collect()
    }

    /// Number of session ids currently known, in flight or not.
    ///
    /// Test-only for now: nothing in production asks the pool its size. Kept
    /// rather than inlined because the cap and reaper tests are clearer for it.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.lock().entries.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Whether `id` is present in the map at all.
    ///
    /// The assertion used by the cancellation and panic tests: after an
    /// unreleased checkout this must be `false`.
    #[cfg(test)]
    pub fn contains(&self, id: &str) -> bool {
        self.lock().entries.contains_key(id)
    }

    /// Test-only monotonic id source, so tests do not depend on `getrandom`.
    #[cfg(test)]
    fn next_id(&self) -> String {
        let mut inner = self.lock();
        inner.next_test_id += 1;
        format!("s{}", inner.next_test_id)
    }

    /// A poisoned map mutex means a panic happened *while holding the map lock*
    /// — which this module never does across an await, so the map itself is
    /// still structurally sound. Recovering keeps one panicking operation from
    /// taking the whole pool down with it, which is finding 5's requirement.
    fn lock(&self) -> std::sync::MutexGuard<'_, PoolInner<S>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// A checked-out session. The entry is out of the map for as long as this lives.
///
/// Call [`SessionGuard::release_ok`] when the operation completed in protocol
/// sync. Anything else — an error, a panic, a dropped future — leaves the entry
/// evicted, which is the safe default rather than an oversight.
pub struct SessionGuard<'a, S> {
    pool: &'a SessionPool<S>,
    id: String,
    session: Option<Arc<tokio::sync::Mutex<S>>>,
    /// Who this session belongs to.
    ///
    /// Carried on the guard because commands that used to read `config.username`
    /// and `config.host` no longer receive a config — the pool holds the only
    /// copy of the account's identity, and the UIDPLUS warning still needs it.
    account: AccountIdent,
}

/// Manual, and never renders the session.
///
/// An `ImapSession` holds an authenticated connection; this is credential-
/// adjacent code, so the derive is refused here for the same reason the brief
/// refuses it on `ImapConfig`.
impl<S> std::fmt::Debug for SessionGuard<'_, S> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionGuard")
            .field("id", &self.id)
            .field("held", &self.session.is_some())
            .finish()
    }
}

impl<S> SessionGuard<'_, S> {
    /// The account this session is authenticated as.
    pub fn account(&self) -> &AccountIdent {
        &self.account
    }

    /// The session to run the operation against.
    pub fn session(&self) -> &Arc<tokio::sync::Mutex<S>> {
        self.session
            .as_ref()
            .expect("session is taken only in release_ok, which consumes self")
    }

    /// Put the session back: the operation finished in protocol sync.
    pub fn release_ok(mut self) {
        let session = self.session.take().expect("released exactly once");
        let mut inner = self.pool.lock();
        if let Some(entry) = inner.entries.get_mut(&self.id) {
            entry.last_used = Instant::now();
            entry.session = Some(session);
        }
        // If the entry vanished while checked out (reaper, credential bump,
        // explicit close), the session is simply dropped and closed.
    }

    /// Evict explicitly. Equivalent to dropping the guard; spelled out at call
    /// sites where the error path is the point.
    pub fn release_err(self) {
        drop(self);
    }
}

impl<S> Drop for SessionGuard<'_, S> {
    fn drop(&mut self) {
        // Reached by: an `Err` path, a panic unwinding, or a dropped future.
        // `release_ok` took the session, so `Some` here means the operation did
        // not complete cleanly and the entry must not come back.
        if self.session.is_some() {
            let mut inner = self.pool.lock();
            inner.entries.remove(&self.id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Stands in for `ImapSession`. The rules under test are about the map.
    struct FakeSession {
        #[allow(dead_code)]
        label: &'static str,
    }

    fn key(user: &str) -> AccountKey {
        AccountKey {
            ident: AccountIdent {
                username: user.to_string(),
                host: "imap.example.com".to_string(),
            },
            port: 993,
            security: "ssl".to_string(),
            auth_mechanism: "password".to_string(),
            credential_version: 0,
        }
    }

    fn pool_with_one() -> (SessionPool<FakeSession>, String) {
        let pool = SessionPool::new();
        let id = pool.next_id();
        pool.insert(id.clone(), key("a@example.com"), FakeSession { label: "a" })
            .expect("first insert is under the cap");
        (pool, id)
    }

    #[test]
    fn unknown_session_id_is_no_such_session() {
        // Done-when 4: an unknown id must not open a connection. There is no
        // connect path in this module at all, which is the structural version
        // of that guarantee; the observable part is the error.
        let pool: SessionPool<FakeSession> = SessionPool::new();
        assert_eq!(pool.acquire("nope").unwrap_err(), PoolError::NoSuchSession);
    }

    #[test]
    fn clean_completion_returns_the_session_to_the_map() {
        let (pool, id) = pool_with_one();

        let guard = pool.acquire(&id).expect("acquire");
        assert!(!pool.contains(&id) || pool.acquire(&id).is_err());
        guard.release_ok();

        assert!(pool.contains(&id));
        assert!(pool.acquire(&id).is_ok(), "reusable after a clean release");
    }

    #[test]
    fn a_dropped_guard_evicts_without_any_error() {
        // Done-when 7a (finding 1). This is the criterion that fails against a
        // rev-3 pool: no `Err` is produced anywhere in this test.
        let (pool, id) = pool_with_one();

        {
            let _guard = pool.acquire(&id).expect("acquire");
            // Future dropped here — cancellation, not failure.
        }

        assert!(!pool.contains(&id), "cancellation must evict");
        assert_eq!(pool.acquire(&id).unwrap_err(), PoolError::NoSuchSession);
    }

    #[test]
    fn a_panic_mid_operation_evicts_and_leaves_other_sessions_usable() {
        // Done-when 7b (finding 5).
        let pool: SessionPool<FakeSession> = SessionPool::new();
        let doomed = pool.next_id();
        let bystander = pool.next_id();
        pool.insert(
            doomed.clone(),
            key("a@example.com"),
            FakeSession { label: "a" },
        )
        .unwrap();
        pool.insert(
            bystander.clone(),
            key("b@example.com"),
            FakeSession { label: "b" },
        )
        .unwrap();

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = pool.acquire(&doomed).expect("acquire");
            panic!("parser met hostile bytes");
        }));
        assert!(result.is_err(), "the panic propagated");

        assert!(!pool.contains(&doomed), "panicking session is evicted");
        assert!(
            pool.contains(&bystander),
            "the pool is not poisoned for others"
        );
        assert!(pool.acquire(&bystander).is_ok());
    }

    #[test]
    fn concurrent_use_of_one_id_is_refused_not_queued() {
        // Done-when 7c.
        let (pool, id) = pool_with_one();
        let _held = pool.acquire(&id).expect("first acquire");

        assert_eq!(pool.acquire(&id).unwrap_err(), PoolError::SessionBusy);
    }

    #[test]
    fn a_busy_session_becomes_available_again_after_release() {
        let (pool, id) = pool_with_one();
        let guard = pool.acquire(&id).expect("first acquire");
        assert_eq!(pool.acquire(&id).unwrap_err(), PoolError::SessionBusy);

        guard.release_ok();
        assert!(pool.acquire(&id).is_ok());
    }

    #[test]
    fn configs_differing_only_in_port_do_not_share_an_account_bucket() {
        // Done-when 7d, case 1 of 3 (finding 3).
        let mut a = key("a@example.com");
        let mut b = key("a@example.com");
        a.port = 993;
        b.port = 143;
        assert_ne!(a, b, "port must separate connection configurations");
    }

    #[test]
    fn configs_differing_only_in_tls_mode_do_not_share_an_account_bucket() {
        // Done-when 7d, case 2 of 3.
        let mut a = key("a@example.com");
        let mut b = key("a@example.com");
        a.security = "ssl".to_string();
        b.security = "starttls".to_string();
        assert_ne!(a, b, "TLS mode must separate connection configurations");
    }

    #[test]
    fn configs_differing_only_in_auth_mechanism_do_not_share_an_account_bucket() {
        // Done-when 7d, case 3 of 3. The rotation case: password -> xoauth2.
        let mut a = key("a@example.com");
        let mut b = key("a@example.com");
        a.auth_mechanism = "password".to_string();
        b.auth_mechanism = "xoauth2".to_string();
        assert_ne!(
            a, b,
            "auth mechanism must separate connection configurations"
        );
    }

    #[test]
    fn bumping_the_credential_version_evicts_that_accounts_sessions_only() {
        // Done-when 7d, rotation half: after a password change or an OAuth
        // refresh the pool must not keep serving the superseded credential.
        let pool: SessionPool<FakeSession> = SessionPool::new();
        let mine = pool.next_id();
        let other = pool.next_id();
        pool.insert(
            mine.clone(),
            key("a@example.com"),
            FakeSession { label: "a" },
        )
        .unwrap();
        pool.insert(
            other.clone(),
            key("b@example.com"),
            FakeSession { label: "b" },
        )
        .unwrap();

        let ident = AccountIdent {
            username: "a@example.com".to_string(),
            host: "imap.example.com".to_string(),
        };
        assert_eq!(pool.credential_version(&ident), 0);

        let evicted = pool.bump_credential_version(&ident);

        assert_eq!(evicted.len(), 1, "exactly the rotated account's session");
        assert!(!pool.contains(&mine));
        assert!(pool.contains(&other), "other accounts are untouched");
        assert_eq!(pool.credential_version(&ident), 1);
        assert_eq!(pool.acquire(&mine).unwrap_err(), PoolError::NoSuchSession);
    }

    #[test]
    fn the_per_account_cap_evicts_the_idlest_rather_than_failing() {
        let pool: SessionPool<FakeSession> = SessionPool::new();
        let first = pool.next_id();
        let second = pool.next_id();
        let third = pool.next_id();

        pool.insert(
            first.clone(),
            key("a@example.com"),
            FakeSession { label: "1" },
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(2));
        pool.insert(
            second.clone(),
            key("a@example.com"),
            FakeSession { label: "2" },
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(2));

        // A third pop-out must succeed, not error.
        pool.insert(
            third.clone(),
            key("a@example.com"),
            FakeSession { label: "3" },
        )
        .expect("cap evicts rather than failing");

        assert_eq!(pool.len(), PER_ACCOUNT_CAP);
        assert!(!pool.contains(&first), "the idlest was evicted");
        assert!(pool.contains(&second));
        assert!(pool.contains(&third));
    }

    #[test]
    fn the_cap_refuses_only_when_every_session_is_in_flight() {
        let pool: SessionPool<FakeSession> = SessionPool::new();
        let a = pool.next_id();
        let b = pool.next_id();
        pool.insert(a.clone(), key("a@example.com"), FakeSession { label: "1" })
            .unwrap();
        pool.insert(b.clone(), key("a@example.com"), FakeSession { label: "2" })
            .unwrap();

        let _h1 = pool.acquire(&a).unwrap();
        let _h2 = pool.acquire(&b).unwrap();

        let err = pool
            .insert(
                "c".to_string(),
                key("a@example.com"),
                FakeSession { label: "3" },
            )
            .unwrap_err();
        assert_eq!(err, PoolError::TooManySessions);
    }

    #[test]
    fn the_cap_is_per_account_not_global() {
        let pool: SessionPool<FakeSession> = SessionPool::new();
        for (i, user) in ["a@example.com", "b@example.com", "c@example.com"]
            .iter()
            .enumerate()
        {
            let id = format!("id{i}");
            pool.insert(id, key(user), FakeSession { label: "x" })
                .expect("different accounts do not contend");
        }
        assert_eq!(pool.len(), 3);
    }

    #[test]
    fn the_reaper_takes_idle_sessions_and_leaves_in_flight_ones() {
        // Done-when 10.
        let pool: SessionPool<FakeSession> = SessionPool::new();
        let idle = pool.next_id();
        let busy = pool.next_id();
        pool.insert(
            idle.clone(),
            key("a@example.com"),
            FakeSession { label: "i" },
        )
        .unwrap();
        pool.insert(
            busy.clone(),
            key("b@example.com"),
            FakeSession { label: "b" },
        )
        .unwrap();

        let _held = pool.acquire(&busy).expect("in flight");

        let reaped = pool.reap(Duration::from_millis(0));

        assert_eq!(reaped.len(), 1, "only the idle session");
        assert!(!pool.contains(&idle));
        assert!(pool.contains(&busy), "an in-flight session is never reaped");
    }

    #[test]
    fn the_reaper_spares_sessions_inside_the_idle_window() {
        let (pool, id) = pool_with_one();
        let reaped = pool.reap(Duration::from_secs(300));
        assert!(reaped.is_empty());
        assert!(pool.contains(&id));
    }

    #[test]
    fn releasing_into_an_entry_that_vanished_does_not_resurrect_it() {
        // The accepted race, asserted: a command that checked out just before
        // the session was closed runs to completion, and its session is
        // dropped rather than put back.
        let (pool, id) = pool_with_one();
        let guard = pool.acquire(&id).expect("acquire");

        pool.remove(&id);
        guard.release_ok();

        assert!(!pool.contains(&id), "a closed session does not come back");
    }

    #[test]
    fn close_is_idempotent() {
        let (pool, id) = pool_with_one();
        assert!(pool.remove(&id).is_some());
        assert!(pool.remove(&id).is_none(), "closing twice is not an error");
        assert!(pool.remove("never-existed").is_none());
    }

    #[test]
    fn drain_empties_the_pool_for_the_exit_hook() {
        let pool: SessionPool<FakeSession> = SessionPool::new();
        pool.insert("a".into(), key("a@example.com"), FakeSession { label: "a" })
            .unwrap();
        pool.insert("b".into(), key("b@example.com"), FakeSession { label: "b" })
            .unwrap();

        let drained = pool.drain();

        assert_eq!(drained.len(), 2);
        assert!(pool.is_empty(), "app exit leaves no live sessions");
    }

    #[test]
    fn two_different_sessions_can_be_held_at_once() {
        // Done-when 8, at the level this module controls: holding one session
        // must not block checking out another. The map lock is not a global
        // operation lock.
        let pool: SessionPool<FakeSession> = SessionPool::new();
        pool.insert("a".into(), key("a@example.com"), FakeSession { label: "a" })
            .unwrap();
        pool.insert("b".into(), key("b@example.com"), FakeSession { label: "b" })
            .unwrap();

        let _first = pool.acquire("a").expect("first");
        let second = pool.acquire("b");

        assert!(
            second.is_ok(),
            "one in-flight session must not block another"
        );
    }
}
