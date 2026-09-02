//! Pooled IMAP sessions (brief E2/P15, rev 4; ownership per SPEC-E2-3).
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
//! # The pool owns its sessions (SPEC-E2-3)
//!
//! Because checkout takes the session out of the map, exactly one party can
//! hold it at a time. The reference-counted async mutex the first cut wrapped
//! it in never contended and never needed to be cloned; what it did do was make
//! ownership ambiguous, so the LOGOUT helper had to unwrap conditionally and
//! silently skip the LOGOUT whenever a second handle existed. Now the session is moved:
//! into the guard on checkout, back into the entry on a clean release, and
//! **out to the caller** on every path that removes a clean session from the
//! map — the reaper, the exit drain, an explicit close, a credential bump, the
//! per-account cap's eviction, and a clean release into an entry that vanished
//! meanwhile. The caller says LOGOUT; the pool never drops a clean session on
//! its own.
//!
//! The one deliberate exception: a session whose operation failed, panicked or
//! was cancelled is dropped *without* LOGOUT. Its protocol state is unknown, a
//! LOGOUT on it may never be answered, and the cancellation path is a
//! destructor that cannot await. Dropping the socket is the RFC-legal close.
//!
//! # Why the map lock is a `std` mutex
//!
//! It is never held across an `.await` — the brief's own rule, and the reason
//! lookups never stall behind a 120 s fetch. Being a blocking mutex is what lets
//! `Drop` evict at all: an async mutex could not be locked from a destructor,
//! and the cancellation path *is* a destructor.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Per-account session cap: one `sync`, one `interactive`.
pub const PER_ACCOUNT_CAP: usize = 2;

/// Idle time after which the reaper closes a session.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(300);

/// Length of a session id: 16 random bytes, hex-encoded.
pub const SESSION_ID_LEN: usize = 32;

/// Whether `id` has the shape of a session id this pool could have issued.
///
/// SPEC-E2-3 REQ-4: every `session_id` is a plain `invoke` argument, so any
/// JavaScript in a window can hand the pool any string. A malformed one is
/// refused *before* it is hashed into the map or cloned onto a guard, and it is
/// never logged. This narrows the accepted input; it is not an identity check
/// (ADR-003 §5 — possession of a well-formed id is still the authorization).
pub fn is_well_formed_id(id: &str) -> bool {
    id.len() == SESSION_ID_LEN && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

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

/// Why a checkout or an insert failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PoolError {
    /// No such session id: never opened, evicted, reaped, or malformed. The
    /// caller reopens.
    NoSuchSession,
    /// The session exists but another operation holds it. Retry; do not reopen.
    ///
    /// Under checkout-removes-entry there is no session mutex left to queue on,
    /// so concurrent use is refused rather than serialised. The two session
    /// kinds (`sync`, `interactive`) exist so this stays rare.
    SessionBusy,
    /// The per-account cap is reached and no session could be evicted.
    TooManySessions,
    /// The session was authenticated under a credential generation that is no
    /// longer the account's current one (SPEC-E2-3 REQ-2.1).
    ///
    /// `imap_session_open` reads the generation, then spends one network round
    /// trip connecting. If a credential bump lands inside that round trip, the
    /// session may have been authenticated with the *revoked* credential, and
    /// it must not enter the map. The caller LOGOUTs it and the frontend opens
    /// once more against the new generation.
    StaleCredential,
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
            Self::StaleCredential => write!(f, "{SENTINEL_PREFIX}StaleCredential"),
        }
    }
}

struct Entry<S> {
    /// `None` means checked out — an operation is in flight.
    session: Option<S>,
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

impl<S> PoolInner<S> {
    fn current_version(&self, ident: &AccountIdent) -> u64 {
        self.versions.get(ident).copied().unwrap_or(0)
    }
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
        self.lock().current_version(ident)
    }

    /// Invalidate every session authenticated under a superseded credential
    /// generation, and move the account to a new generation.
    ///
    /// Called on password change (`clearConfigCache`) and on OAuth refresh
    /// failure, so a rotated credential cannot keep being served. Returns the
    /// evicted sessions **for the caller to LOGOUT** — the pool never drops a
    /// clean session itself. Only entries *below* the new generation are
    /// evicted; with `insert` refusing any generation that is not current, that
    /// is every entry of the account, and the filter states the invariant
    /// rather than relying on it (SPEC-E2-3 REQ-2.3).
    pub fn bump_credential_version(&self, ident: &AccountIdent) -> Vec<S> {
        let mut inner = self.lock();
        let next = inner.current_version(ident) + 1;
        inner.versions.insert(ident.clone(), next);

        let doomed: Vec<String> = inner
            .entries
            .iter()
            .filter(|(_, e)| {
                &e.account_key.ident == ident && e.account_key.credential_version < next
            })
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
    /// see an error. The victim is returned as `Ok(Some(_))` **for the caller
    /// to LOGOUT**. `TooManySessions` is a last resort: every session for the
    /// account is currently checked out.
    ///
    /// Refuses a session whose `credential_version` is not the account's
    /// current generation (`StaleCredential`, SPEC-E2-3 REQ-2.1). On either
    /// refusal the session is handed back with the error, so the caller can
    /// LOGOUT it — an `Err` that swallowed it would be the very bug REQ-1 is
    /// about, in a new coat.
    pub fn insert(
        &self,
        id: String,
        account_key: AccountKey,
        session: S,
    ) -> Result<Option<S>, (PoolError, S)> {
        debug_assert!(
            is_well_formed_id(&id),
            "the pool only issues well-formed ids"
        );
        let mut inner = self.lock();

        if account_key.credential_version != inner.current_version(&account_key.ident) {
            return Err((PoolError::StaleCredential, session));
        }

        let live = inner
            .entries
            .values()
            .filter(|e| e.account_key.ident == account_key.ident)
            .count();

        let mut evicted = None;
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
                    evicted = inner.entries.remove(&v).and_then(|e| e.session);
                }
                None => return Err((PoolError::TooManySessions, session)),
            }
        }

        inner.entries.insert(
            id,
            Entry {
                session: Some(session),
                account_key,
                last_used: Instant::now(),
            },
        );
        Ok(evicted)
    }

    /// Take a session out of the map for the duration of one operation.
    ///
    /// The returned guard **must** be told how the operation ended. If it is
    /// dropped without `release_ok`, the entry stays gone — which is exactly
    /// the behaviour cancellation and panic need.
    ///
    /// A malformed id is `NoSuchSession` before the map is touched.
    pub fn acquire(&self, id: &str) -> Result<SessionGuard<'_, S>, PoolError> {
        if !is_well_formed_id(id) {
            return Err(PoolError::NoSuchSession);
        }
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

    /// Remove a session id, returning its session **for the caller to LOGOUT**
    /// if it was not in flight.
    ///
    /// Idempotent: closing an unknown, malformed or already-closed session is
    /// not an error.
    pub fn remove(&self, id: &str) -> Option<S> {
        if !is_well_formed_id(id) {
            return None;
        }
        let mut inner = self.lock();
        inner.entries.remove(id).and_then(|e| e.session)
    }

    /// Sessions idle longer than `idle_timeout`, removed from the map.
    ///
    /// Returns them for the caller to LOGOUT. In-flight entries are skipped —
    /// `last_used` is stamped on acquire, so a long operation is never reaped
    /// mid-command. The map lock is released before the caller does any I/O.
    pub fn reap(&self, idle_timeout: Duration) -> Vec<S> {
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
    pub fn drain(&self) -> Vec<S> {
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
    /// Well-formed, because `acquire` refuses anything else.
    #[cfg(test)]
    fn next_id(&self) -> String {
        let mut inner = self.lock();
        inner.next_test_id += 1;
        format!("{:032x}", inner.next_test_id)
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
    session: Option<S>,
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

    /// The session to run the operation against. Exclusive by construction:
    /// the guard is the only holder while the entry is checked out.
    pub fn session_mut(&mut self) -> &mut S {
        self.session
            .as_mut()
            .expect("session is taken only in release_ok, which consumes self")
    }

    /// Put the session back: the operation finished in protocol sync.
    ///
    /// Returns `Some(session)` when the entry vanished while checked out (the
    /// reaper, a credential bump, an explicit close). That session is in
    /// protocol sync and belongs to nobody — **the caller must LOGOUT it**
    /// (SPEC-E2-3 REQ-1.2). `None` means it went back into its entry.
    #[must_use = "an orphaned session must be logged out by the caller"]
    pub fn release_ok(mut self) -> Option<S> {
        let session = self.session.take().expect("released exactly once");
        let mut inner = self.pool.lock();
        match inner.entries.get_mut(&self.id) {
            // `session.is_none()` is the checkout marker we set; a `Some` here
            // would be a different session under a reissued id, which 128
            // random bits make unreachable — but an orphan is the safe answer.
            Some(entry) if entry.session.is_none() => {
                entry.last_used = Instant::now();
                entry.session = Some(session);
                None
            }
            _ => Some(session),
        }
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
        // not complete cleanly and the entry must not come back. The session is
        // dropped without LOGOUT on purpose — see the module doc.
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
    #[derive(Debug, PartialEq, Eq)]
    struct FakeSession {
        label: &'static str,
        /// Mutated through `session_mut` to show the same value comes back.
        ops: u32,
    }

    fn fake(label: &'static str) -> FakeSession {
        FakeSession { label, ops: 0 }
    }

    fn ident(user: &str) -> AccountIdent {
        AccountIdent {
            username: user.to_string(),
            host: "imap.example.com".to_string(),
        }
    }

    fn key(user: &str) -> AccountKey {
        key_at(user, 0)
    }

    fn key_at(user: &str, credential_version: u64) -> AccountKey {
        AccountKey {
            ident: ident(user),
            port: 993,
            security: "ssl".to_string(),
            auth_mechanism: "password".to_string(),
            credential_version,
        }
    }

    fn pool_with_one() -> (SessionPool<FakeSession>, String) {
        let pool = SessionPool::new();
        let id = pool.next_id();
        pool.insert(id.clone(), key("a@example.com"), fake("a"))
            .expect("first insert is under the cap");
        (pool, id)
    }

    // ---------- ownership: the session is moved, never shared (REQ-1.1) ----------

    #[test]
    fn the_same_session_comes_back_after_a_clean_release() {
        let (pool, id) = pool_with_one();

        let mut guard = pool.acquire(&id).expect("acquire");
        guard.session_mut().ops += 1;
        let orphan = guard.release_ok();
        assert!(orphan.is_none(), "the entry was there; nothing is orphaned");

        let mut again = pool.acquire(&id).expect("reusable after a clean release");
        assert_eq!(
            again.session_mut().ops,
            1,
            "it is the same session, not a copy"
        );
        let _ = again.release_ok();
    }

    #[test]
    fn a_clean_release_into_a_vanished_entry_hands_the_session_back_for_logout() {
        // REQ-1.2. Previously this session was dropped silently inside
        // `release_ok`; the caller is now made to deal with it.
        let (pool, id) = pool_with_one();
        let guard = pool.acquire(&id).expect("acquire");

        let closed = pool.remove(&id);
        assert!(
            closed.is_none(),
            "in flight, so close had nothing to return"
        );

        let orphan = guard.release_ok();
        assert_eq!(
            orphan,
            Some(fake("a")),
            "the caller gets it and must LOGOUT"
        );
        assert!(!pool.contains(&id), "a closed session does not come back");
    }

    #[test]
    fn the_cap_hands_the_evicted_session_back_for_logout() {
        // REQ-1.3. The idlest idle session used to be dropped inside the map
        // lock; it is a clean session and deserves a LOGOUT.
        let pool: SessionPool<FakeSession> = SessionPool::new();
        let first = pool.next_id();
        let second = pool.next_id();
        let third = pool.next_id();

        assert_eq!(
            pool.insert(first.clone(), key("a@example.com"), fake("1")),
            Ok(None)
        );
        std::thread::sleep(Duration::from_millis(2));
        assert_eq!(
            pool.insert(second.clone(), key("a@example.com"), fake("2")),
            Ok(None)
        );
        std::thread::sleep(Duration::from_millis(2));

        let evicted = pool
            .insert(third.clone(), key("a@example.com"), fake("3"))
            .expect("cap evicts rather than failing");

        assert_eq!(evicted, Some(fake("1")), "the idlest, returned for LOGOUT");
        assert_eq!(pool.len(), PER_ACCOUNT_CAP);
        assert!(!pool.contains(&first));
        assert!(pool.contains(&second));
        assert!(pool.contains(&third));
    }

    // ---------- credential generations (REQ-2) ----------

    #[test]
    fn an_insert_at_a_superseded_generation_is_refused_and_the_session_handed_back() {
        // REQ-2.1: the bump landed during `imap_session_open`'s round trip.
        let pool: SessionPool<FakeSession> = SessionPool::new();
        let id = pool.next_id();
        let ident = ident("a@example.com");
        assert_eq!(pool.bump_credential_version(&ident).len(), 0);
        assert_eq!(pool.credential_version(&ident), 1);

        let refused = pool.insert(id.clone(), key_at("a@example.com", 0), fake("old"));

        assert_eq!(refused, Err((PoolError::StaleCredential, fake("old"))));
        assert!(!pool.contains(&id), "nothing entered the map");
    }

    #[test]
    fn an_insert_at_the_current_generation_is_accepted_after_a_bump() {
        let pool: SessionPool<FakeSession> = SessionPool::new();
        let ident = ident("a@example.com");
        pool.bump_credential_version(&ident);

        let id = pool.next_id();
        assert_eq!(
            pool.insert(id.clone(), key_at("a@example.com", 1), fake("new")),
            Ok(None)
        );
        assert!(pool.contains(&id));
    }

    #[test]
    fn an_insert_ahead_of_the_current_generation_is_refused_too() {
        // "Not current" in both directions: a version the pool never issued is
        // not a session the pool can vouch for.
        let pool: SessionPool<FakeSession> = SessionPool::new();
        let id = pool.next_id();
        let refused = pool.insert(id, key_at("a@example.com", 7), fake("future"));
        assert!(matches!(refused, Err((PoolError::StaleCredential, _))));
    }

    #[test]
    fn a_bump_evicts_only_the_generations_it_supersedes() {
        // REQ-2.3, across two rotations: each bump takes exactly the sessions of
        // the generation it retires and nothing from other accounts.
        let pool: SessionPool<FakeSession> = SessionPool::new();
        let ident = ident("a@example.com");
        let other = pool.next_id();
        pool.insert(other.clone(), key("b@example.com"), fake("b"))
            .unwrap();

        let gen0 = pool.next_id();
        pool.insert(gen0.clone(), key_at("a@example.com", 0), fake("g0"))
            .unwrap();
        let evicted = pool.bump_credential_version(&ident);
        assert_eq!(evicted, vec![fake("g0")]);

        let gen1 = pool.next_id();
        pool.insert(gen1.clone(), key_at("a@example.com", 1), fake("g1"))
            .unwrap();
        let evicted = pool.bump_credential_version(&ident);
        assert_eq!(evicted, vec![fake("g1")]);
        assert_eq!(pool.credential_version(&ident), 2);

        assert!(
            pool.contains(&other),
            "other accounts are untouched by either bump"
        );
        assert!(!pool.contains(&gen0));
        assert!(!pool.contains(&gen1));
    }

    #[test]
    fn a_bump_returns_sessions_for_logout_not_dropping_them() {
        let (pool, id) = pool_with_one();
        let evicted = pool.bump_credential_version(&ident("a@example.com"));
        assert_eq!(evicted, vec![fake("a")]);
        assert!(!pool.contains(&id));
    }

    #[test]
    fn a_bump_does_not_return_an_in_flight_session() {
        // The checked-out session belongs to its guard; the guard's release
        // will find the entry gone and hand the orphan back (REQ-1.2).
        let (pool, id) = pool_with_one();
        let guard = pool.acquire(&id).unwrap();

        let evicted = pool.bump_credential_version(&ident("a@example.com"));

        assert!(evicted.is_empty());
        assert_eq!(guard.release_ok(), Some(fake("a")));
    }

    // ---------- session-id shape (REQ-4) ----------

    #[test]
    fn well_formed_ids_are_exactly_32_lowercase_hex_characters() {
        assert!(is_well_formed_id("0123456789abcdef0123456789abcdef"));
        assert!(!is_well_formed_id(""));
        assert!(!is_well_formed_id("0123456789abcdef0123456789abcde"), "31");
        assert!(
            !is_well_formed_id("0123456789abcdef0123456789abcdef0"),
            "33"
        );
        assert!(
            !is_well_formed_id("0123456789ABCDEF0123456789ABCDEF"),
            "upper-case"
        );
        assert!(
            !is_well_formed_id("0123456789abcdef0123456789abcdeg"),
            "non-hex"
        );
        assert!(
            !is_well_formed_id("0123456789abcdef0123456789abcde\n"),
            "control"
        );
        assert!(
            !is_well_formed_id("0123456789abcdef0123456789abcdé"),
            "non-ASCII, same char count"
        );
        assert!(
            !is_well_formed_id(&"a".repeat(10 * 1024 * 1024)),
            "a very long string"
        );
    }

    #[test]
    fn a_malformed_id_is_no_such_session_and_leaves_the_map_alone() {
        let (pool, id) = pool_with_one();

        for bad in [
            "",
            "nope",
            "0123456789ABCDEF0123456789ABCDEF",
            "../etc/passwd",
        ] {
            assert_eq!(
                pool.acquire(bad).unwrap_err(),
                PoolError::NoSuchSession,
                "{bad:?}"
            );
            assert!(pool.remove(bad).is_none(), "{bad:?}");
        }

        assert_eq!(pool.len(), 1);
        assert!(pool.contains(&id), "the real session is untouched");
    }

    #[test]
    fn test_ids_are_well_formed() {
        let pool: SessionPool<FakeSession> = SessionPool::new();
        assert!(is_well_formed_id(&pool.next_id()));
    }

    // ---------- the E2 rev-4 rules, unchanged ----------

    #[test]
    fn unknown_session_id_is_no_such_session() {
        // Done-when 4: an unknown id must not open a connection. There is no
        // connect path in this module at all, which is the structural version
        // of that guarantee; the observable part is the error.
        let pool: SessionPool<FakeSession> = SessionPool::new();
        assert_eq!(
            pool.acquire("0123456789abcdef0123456789abcdef")
                .unwrap_err(),
            PoolError::NoSuchSession
        );
    }

    #[test]
    fn clean_completion_returns_the_session_to_the_map() {
        let (pool, id) = pool_with_one();

        let guard = pool.acquire(&id).expect("acquire");
        assert!(!pool.contains(&id) || pool.acquire(&id).is_err());
        let _ = guard.release_ok();

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
        pool.insert(doomed.clone(), key("a@example.com"), fake("a"))
            .unwrap();
        pool.insert(bystander.clone(), key("b@example.com"), fake("b"))
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

        let _ = guard.release_ok();
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
        pool.insert(mine.clone(), key("a@example.com"), fake("a"))
            .unwrap();
        pool.insert(other.clone(), key("b@example.com"), fake("b"))
            .unwrap();

        let ident = ident("a@example.com");
        assert_eq!(pool.credential_version(&ident), 0);

        let evicted = pool.bump_credential_version(&ident);

        assert_eq!(evicted.len(), 1, "exactly the rotated account's session");
        assert!(!pool.contains(&mine));
        assert!(pool.contains(&other), "other accounts are untouched");
        assert_eq!(pool.credential_version(&ident), 1);
        assert_eq!(pool.acquire(&mine).unwrap_err(), PoolError::NoSuchSession);
    }

    #[test]
    fn the_cap_refuses_only_when_every_session_is_in_flight() {
        let pool: SessionPool<FakeSession> = SessionPool::new();
        let a = pool.next_id();
        let b = pool.next_id();
        pool.insert(a.clone(), key("a@example.com"), fake("1"))
            .unwrap();
        pool.insert(b.clone(), key("a@example.com"), fake("2"))
            .unwrap();

        let _h1 = pool.acquire(&a).unwrap();
        let _h2 = pool.acquire(&b).unwrap();

        let refused = pool
            .insert(pool.next_id(), key("a@example.com"), fake("3"))
            .unwrap_err();
        assert_eq!(
            refused,
            (PoolError::TooManySessions, fake("3")),
            "handed back for LOGOUT"
        );
    }

    #[test]
    fn the_cap_is_per_account_not_global() {
        let pool: SessionPool<FakeSession> = SessionPool::new();
        for user in ["a@example.com", "b@example.com", "c@example.com"] {
            pool.insert(pool.next_id(), key(user), fake("x"))
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
        pool.insert(idle.clone(), key("a@example.com"), fake("i"))
            .unwrap();
        pool.insert(busy.clone(), key("b@example.com"), fake("b"))
            .unwrap();

        let _held = pool.acquire(&busy).expect("in flight");

        let reaped = pool.reap(Duration::from_millis(0));

        assert_eq!(reaped, vec![fake("i")], "only the idle session, for LOGOUT");
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
    fn close_is_idempotent() {
        let (pool, id) = pool_with_one();
        assert_eq!(pool.remove(&id), Some(fake("a")), "returned for LOGOUT");
        assert!(pool.remove(&id).is_none(), "closing twice is not an error");
        assert!(pool.remove("00000000000000000000000000000000").is_none());
    }

    #[test]
    fn drain_empties_the_pool_for_the_exit_hook() {
        let pool: SessionPool<FakeSession> = SessionPool::new();
        pool.insert(pool.next_id(), key("a@example.com"), fake("a"))
            .unwrap();
        pool.insert(pool.next_id(), key("b@example.com"), fake("b"))
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
        let a = pool.next_id();
        let b = pool.next_id();
        pool.insert(a.clone(), key("a@example.com"), fake("a"))
            .unwrap();
        pool.insert(b.clone(), key("b@example.com"), fake("b"))
            .unwrap();

        let _first = pool.acquire(&a).expect("first");
        let second = pool.acquire(&b);

        assert!(
            second.is_ok(),
            "one in-flight session must not block another"
        );
    }
}
