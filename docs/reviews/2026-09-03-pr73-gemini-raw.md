# Independent Review: PR #73 ("E2 part 3: IMAP session-pool carry list")

## Summary & Architectural Assessment

The refactoring from `Arc<tokio::sync::Mutex<ImapSession>>` to owned `Option<S>` moved in and out of `SessionGuard` resolves the ambiguous ownership and silent logout skipping from PR #39. The higher-ranked trait bound `for<'a> FnOnce(&'a mut ImapSession) -> BoxFuture<'a, Result<T, String>>` correctly binds the future's lifetime to the exclusive borrow of the guard without letting the reference escape or violating `Send`. The 32-character lowercase hex session-id validation correctly restricts map access before touching internal state.

However, the review identified one **HIGH** severity issue where credential invalidation silently fails if triggered from a window that has not yet opened an IMAP session, along with listener error-recovery and latency issues on the retry paths.

---

## Findings

### 1. [HIGH] `invalidateAccountCredentials` silently skips backend invalidation when called in a window without active sessions
- **File:** `src/services/imap/sessionManager.ts`
- **Code:**
  ```ts
  export async function invalidateAccountCredentials(accountId: string): Promise<void> {
    const ident = accountIdents.get(accountId);
    forgetAccount(accountId);
    if (!ident) return;
    const pending = imapSessionsInvalidate(ident.username, ident.host).finally(() => {
      if (pendingInvalidations.get(accountId) === pending) {
        pendingInvalidations.delete(accountId);
      }
    });
    pendingInvalidations.set(accountId, pending);
    await pending;
  }
  ```
- **Why it is wrong:**
  `accountIdents` is an in-memory `Map` populated *only* when `openSession` succeeds in the local window (`accountIdents.set(accountId, ...)`). In a multi-window desktop application, credential rotation actions (e.g. password updates in Settings, account re-authentication dialogs, or OAuth refresh failures handled by background services) frequently execute in windows that have not opened an IMAP session or where `closeAllSessions()` was called.

  When `ident` is `undefined`, `invalidateAccountCredentials` silently returns. Consequently:
  1. Rust's `imap_sessions_invalidate` is never called.
  2. The account's `credential_version` is never bumped in Rust.
  3. Existing pool sessions authenticated under the revoked credential remain in the pool.
  4. The `velo-imap-sessions-invalidated` event is never broadcast to other windows.
  This breaks the core credential-revocation guarantee (SPEC-E2-3 REQ-2 & REQ-3). (Unit tests masked this because test fixtures explicitly invoked `withSession` prior to invalidation).
- **Concrete Fix:**
  Fall back to querying the account identity via `getAccount(accountId)` if `accountIdents` does not contain the entry:
  ```ts
  export async function invalidateAccountCredentials(accountId: string): Promise<void> {
    forgetAccount(accountId);
    let ident = accountIdents.get(accountId);
    if (!ident) {
      const account = await getAccount(accountId);
      if (!account) return;
      const config = await buildImapConfigWithFreshToken(account);
      ident = { username: config.username, host: config.host };
    }
    const pending = imapSessionsInvalidate(ident.username, ident.host).finally(() => {
      if (pendingInvalidations.get(accountId) === pending) {
        pendingInvalidations.delete(accountId);
      }
    });
    pendingInvalidations.set(accountId, pending);
    await pending;
  }
  ```

---

### 2. [MEDIUM] `ensureInvalidationListener` permanently locks out registration if `listen` fails once
- **File:** `src/services/imap/sessionManager.ts`
- **Code:**
  ```ts
  let invalidationListenerStarted = false;

  function ensureInvalidationListener(): void {
    if (invalidationListenerStarted) return;
    invalidationListenerStarted = true;
    listen<SessionsInvalidatedPayload>(SESSIONS_INVALIDATED_EVENT, (event) => {
      onSessionsInvalidated(event.payload);
    }).catch((err: unknown) => {
      // Without the listener a pop-out still self-heals through NoSuchSession;
      // it just pays one failed call first. Worth a line, not a failure.
      console.warn("[sessionManager] Could not listen for session invalidations:", err);
    });
  }
  ```
- **Why it is wrong:**
  `invalidationListenerStarted` is set to `true` synchronously before the async `listen()` promise completes. If `listen()` rejects (e.g. during early window initialization or IPC bridge startup), the `.catch` handler logs a warning but leaves `invalidationListenerStarted = true`. All subsequent calls to `withSession()` see `invalidationListenerStarted === true` and skip registration. The window permanently loses cross-window invalidation notifications for its entire lifetime.
- **Concrete Fix:**
  Reset the boolean flag in the `.catch` handler so future operations can retry:
  ```ts
  function ensureInvalidationListener(): void {
    if (invalidationListenerStarted) return;
    invalidationListenerStarted = true;
    listen<SessionsInvalidatedPayload>(SESSIONS_INVALIDATED_EVENT, (event) => {
      onSessionsInvalidated(event.payload);
    }).catch((err: unknown) => {
      invalidationListenerStarted = false;
      console.warn("[sessionManager] Could not listen for session invalidations:", err);
    });
  }
  ```

---

### 3. [LOW] Synchronous `logout(session).await` in `imap_session_open` error path blocks client-side `StaleCredential` recovery
- **File:** `src-tauri/src/commands.rs`
- **Code:**
  ```rust
        Err((err, session)) => {
            // `StaleCredential`: a credential bump landed during the round trip
            // above, so this session may be authenticated with the revoked
            // credential and must not enter the map (SPEC-E2-3 REQ-2.1). The
            // frontend reopens once against the new generation.
            // `TooManySessions`: every session for the account is in flight.
            // Either way the fresh session is ours to LOGOUT, and it is awaited
            // here because the caller is already on the error path.
            logout(session).await;
            Err(err.to_string())
        }
  ```
- **Why it is wrong:**
  When `pool.insert` returns `Err((PoolError::StaleCredential, session))`, the frontend is designed to immediately catch the sentinel, rebuild its config with fresh credentials, and retry the open. Awaiting `logout(session)` synchronously on this thread means a slow or hanging IMAP server blocks the IPC error response for up to `LOGOUT_TIMEOUT` (3 seconds). The cap eviction path in `Ok(Some(victim))` uses `spawn_logout(victim)` specifically so slow servers do not block callers. The discarded stale session is detached from the pool and should not stall the client's recovery loop.
- **Concrete Fix:**
  Spawn the logout on a background task instead of awaiting it on the command thread:
  ```rust
        Err((err, session)) => {
            spawn_logout(session);
            Err(err.to_string())
        }
  ```

---

### 4. [LOW] Sequential `logout.await` in `imap_sessions_invalidate` compounds logout delays
- **File:** `src-tauri/src/commands.rs`
- **Code:**
  ```rust
    let ident = AccountIdent { username, host };
    for session in pool.bump_credential_version(&ident) {
        logout(session).await;
    }
    let _ = app.emit(
  ```
- **Why it is wrong:**
  `bump_credential_version` can return up to `PER_ACCOUNT_CAP` (2) idle sessions. Awaiting each `logout(session)` sequentially means that if servers are slow or unresponsive, `imap_sessions_invalidate` blocks for up to `2 * LOGOUT_TIMEOUT` (6 seconds) before emitting `SESSIONS_INVALIDATED_EVENT` to other windows. At app exit (`lib.rs`), logouts are executed concurrently.
- **Concrete Fix:**
  Perform logouts concurrently with `join_all`:
  ```rust
    let ident = AccountIdent { username, host };
    let sessions = pool.bump_credential_version(&ident);
    futures::future::join_all(sessions.into_iter().map(logout)).await;
    let _ = app.emit(
  ```

---

### 5. [NIT] Documentation discrepancy in `SessionGuard::drop`
- **File:** `src-tauri/src/imap/pool.rs`
- **Code:**
  ```rust
  impl<S> Drop for SessionGuard<'_, S> {
      fn drop(&mut self) {
          // Reached by: an `Err` path, a panic unwinding, or a dropped future.
          // `release_ok` took the session, so `Some` here means the operation did
          // not complete cleanly and the entry must not come back.
  ```
- **Why it is wrong:**
  The comment states "`release_ok` took the session...", but `release_err` also consumes `self` without taking `self.session` (intentionally letting `Drop` observe `Some` and evict).
- **Concrete Fix:**
  Update the comment to: "`release_ok` takes `self.session` (`None`), so `Some` here means the guard was dropped via `release_err`, cancellation, or panic unwinding, and the entry must be evicted."

---

## Threat & Verification Matrix Check

| Attack / Hazard Surface | Status | Verification Detail |
| :--- | :--- | :--- |
| **Double-LOGOUT / Use-after-move** | **PASS** | Session ownership transferred by value (`Option<S>::take`). No shared references. |
| **Cancellation Safety** | **PASS** | `SessionGuard` is held across the `.await`; dropping the future executes `Drop`, evicting the entry without hanging on LOGOUT. |
| **`StaleCredential` Interleaving** | **PASS** | `insert` strictly checks `account_key.credential_version == inner.current_version`. Any bump occurring during network connect rejects the session. |
| **Reopen / Infinite Loop Hazard** | **PASS** | Frontend catches `STALE_CREDENTIAL` and reopens exactly once with a rebuilt config; second failures re-throw. |
| **ID Validator Invariants** | **PASS** | `is_well_formed_id` strictly requires 32 lowercase hex characters (`[0-9a-f]`); matches `new_session_id`. |
| **Window Event Payload Disclosure**| **PASS** | Event payload contains only `{ username, host }`, zero credentials or session tokens. |

---

## Verdict

**CHANGES REQUESTED**

*(Fix Finding 1 to prevent silent credential invalidation skips across windows, and address Finding 2 to ensure resilient event listener recovery.)*
