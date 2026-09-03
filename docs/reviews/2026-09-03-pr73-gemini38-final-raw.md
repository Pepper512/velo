### Findings

---

#### 1. [HIGH] Panic in `SessionPool::reap` on Monotonic Clock Inversion (`Instant::duration_since`)

- **File**: [`src-tauri/src/imap/pool.rs`](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src-tauri/src/imap/pool.rs#L365-L375)
- **Code**:
  ```rust
  pub fn reap(&self, idle_timeout: Duration) -> Vec<S> {
      let now = Instant::now();
      let mut inner = self.lock();

      let expired: Vec<String> = inner
          .entries
          .iter()
          .filter(|(_, e)| e.session.is_some() && now.duration_since(e.last_used) >= idle_timeout)
          .map(|(id, _)| id.clone())
          .collect();
  ```
- **Why it is wrong**:
  `now` is sampled on line 366 *before* acquiring `self.lock()`. If a worker thread finishes an operation and calls `guard.release_ok()` (or `pool.acquire()`) between lines 366 and 367, that worker updates `entry.last_used = Instant::now()`, stamping an instant strictly greater than `now` (`e.last_used > now`).
  In the Rust standard library, calling `now.duration_since(e.last_used)` where `e.last_used > now` panics (`"supplied instant is later than self"`). Because `reap` is called in the background task loop in [`src-tauri/src/lib.rs`](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src-tauri/src/lib.rs#L216-L226), this panic kills the reaper task permanently. Subsequent idle sessions will never be reaped for the remainder of the application's lifetime.
- **Fix**:
  Sample `now` after taking the lock, or use `now.checked_duration_since(e.last_used).unwrap_or_default() >= idle_timeout`, or simply use `e.last_used.elapsed() >= idle_timeout`:
  ```rust
  pub fn reap(&self, idle_timeout: Duration) -> Vec<S> {
      let mut inner = self.lock();
      let now = Instant::now();

      let expired: Vec<String> = inner
          .entries
          .iter()
          .filter(|(_, e)| {
              e.session.is_some()
                  && now.checked_duration_since(e.last_used).unwrap_or_default() >= idle_timeout
          })
          .map(|(id, _)| id.clone())
          .collect();
  ```

---

#### 2. [MEDIUM] Stale Account Row and Overwritten Identity on Retry in `openAgainstCurrentCredential`

- **File**: [`src/services/imap/sessionManager.ts`](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src/services/imap/sessionManager.ts#L195-L228)
- **Code**:
  ```ts
  async function openAgainstCurrentCredential(
    accountId: string,
    account: DbAccount,
    attempt: number,
  ): Promise<SessionId> {
    accountIdents.set(accountId, imapIdentityOf(account));
    const epoch = epochOf(accountId);
    const record = (await getAccount(accountId)) ?? account;

    const config = await buildImapConfigWithFreshToken(record);

    let id: SessionId;
    try {
      id = await imapSessionOpen(config);
    } catch (err) {
      if (!isPoolError(err, STALE_CREDENTIAL) || attempt > 0) throw err;
      return openAgainstCurrentCredential(accountId, account, attempt + 1);
    }

    if (epochOf(accountId) !== epoch) {
      void imapSessionClose(id).catch(() => undefined);
      if (attempt > 0) throw new Error(STALE_CREDENTIAL);
      return openAgainstCurrentCredential(accountId, account, attempt + 1);
    }

    return id;
  }
  ```
- **Why it is wrong**:
  There are two interacting defects:
  1. `accountIdents.set(accountId, imapIdentityOf(account))` runs synchronously using `account` before reading `record = (await getAccount(accountId)) ?? account`. If `record` has updated account credentials or fields (e.g. `imap_username`, `email`, or `imap_host`), `accountIdents` is never updated with `record`.
  2. When retrying (on `StaleCredential` or when the epoch moves), the function recurses with `openAgainstCurrentCredential(accountId, account, attempt + 1)` passing the stale `account` object rather than `record`. At the start of the retry attempt, `accountIdents.set(accountId, imapIdentityOf(account))` explicitly clobbers `accountIdents` back to the initial, stale identity.
  Consequently, subsequent calls to [`invalidateAccountCredentials`](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src/services/imap/sessionManager.ts#L425-L440) look up `accountIdents` and emit/invalidate against the obsolete identity instead of the active one.
- **Fix**:
  Pass `record` to recursive calls, and update `accountIdents` with `record` once fetched:
  ```ts
  async function openAgainstCurrentCredential(
    accountId: string,
    account: DbAccount,
    attempt: number,
  ): Promise<SessionId> {
    accountIdents.set(accountId, imapIdentityOf(account));
    const epoch = epochOf(accountId);
    const record = (await getAccount(accountId)) ?? account;
    accountIdents.set(accountId, imapIdentityOf(record));

    const config = await buildImapConfigWithFreshToken(record);

    let id: SessionId;
    try {
      id = await imapSessionOpen(config);
    } catch (err) {
      if (!isPoolError(err, STALE_CREDENTIAL) || attempt > 0) throw err;
      return openAgainstCurrentCredential(accountId, record, attempt + 1);
    }

    if (epochOf(accountId) !== epoch) {
      void imapSessionClose(id).catch(() => undefined);
      if (attempt > 0) throw new Error(STALE_CREDENTIAL);
      return openAgainstCurrentCredential(accountId, record, attempt + 1);
    }

    return id;
  }
  ```

---

#### 3. [MEDIUM] `pendingInvalidations` Keyed by Account ID Rather than Identity Bypasses Wait for Colocated Accounts

- **File**: [`src/services/imap/sessionManager.ts`](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src/services/imap/sessionManager.ts#L147-L180)
- **Code**:
  ```ts
  const pendingInvalidations = new Map<string, { promise: Promise<void>; nonce: string }>();
  ...
  async function openSession(accountId: string, kind: SessionKind): Promise<SessionId> {
    await ensureInvalidationListener();

    const pending = pendingInvalidations.get(accountId);
    if (pending) {
      ...
    }
  ```
- **Why it is wrong**:
  Sessions in the Rust pool are partitioned and invalidated by `AccountIdent { username, host }`, not by `accountId`. Multiple local accounts can share the same IMAP identity (recognized in Gemini 3.8 F3 via `forgetIdentity`).
  When `invalidateAccountCredentials("acc-1")` runs, it records `pendingInvalidations` under key `"acc-1"`. If `"acc-2"` (which shares the same IMAP identity) invokes `openSession("acc-2")` concurrently:
  - `pendingInvalidations.get("acc-2")` returns `undefined`. `"acc-2"` does not wait on the in-flight invalidation.
  - If `"acc-2"`'s open finishes right before Rust runs `pool.bump_credential_version`, Rust evicts `"acc-2"`'s newly opened session and broadcasts `SESSIONS_INVALIDATED_EVENT` with `nonce`.
  - When the broadcast arrives at this window, `onSessionsInvalidated` matches `nonce` in `ownInvalidationNonces` and ignores the event.
  - As a result, `"acc-2"`'s epoch is never bumped, and `openAgainstCurrentCredential("acc-2")` caches a session in `sessions` that was already evicted and dead in Rust.
- **Fix**:
  Key `pendingInvalidations` by the IMAP identity key (e.g. `${ident.username}::${ident.host}`), or have `openSession` check if any pending invalidation matches the account's identity.

---

#### 4. [LOW] Contract Contradiction Between Rust Invalidation Broadcast Timing and TypeScript Timeout

- **File**: [`src-tauri/src/commands.rs`](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src-tauri/src/commands.rs#L135-L165) and [`src/services/imap/sessionManager.ts`](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src/services/imap/sessionManager.ts#L170-L182)
- **Code**:
  In `commands.rs`:
  ```rust
  /// Invalidate every session for an account after a credential change.
  /// ...
  /// Emits [`SESSIONS_INVALIDATED_EVENT`] to every window once the LOGOUTs are done.
  #[tauri::command]
  pub async fn imap_sessions_invalidate(
  ...
      let evicted = pool.bump_credential_version(&ident);

      if let Err(err) = app.emit(
          SESSIONS_INVALIDATED_EVENT,
          SessionsInvalidated { ... },
      ) { ... }

      futures::future::join_all(evicted.into_iter().map(logout)).await;
      Ok(())
  ```
  In `sessionManager.ts`:
  ```ts
  if (timedOut) {
    // Still running in Rust. Its broadcast, when it finally comes, must
    // count as foreign, so the epoch moves and an open that raced it is
    // redone rather than cached dead (review, Gemini 3.8 F4).
    ownInvalidationNonces.delete(pending.nonce);
  }
  ```
- **Why it is wrong**:
  1. The doc comment on `imap_sessions_invalidate` explicitly states that it emits the event *"once the LOGOUTs are done"*, but line 157 emits the event *before* `futures::future::join_all(evicted.into_iter().map(logout)).await`.
  2. Because Rust broadcasts before awaiting the LOGOUTs, the window that initiated the invalidation receives the echo within milliseconds, matching and removing `nonce` from `ownInvalidationNonces` at $t \approx 0$.
  3. If `join_all` stalls and causes `openSession` to time out after 8 seconds, `ownInvalidationNonces.delete(pending.nonce)` is a no-op because `pending.nonce` was already consumed 8 seconds prior. The premise in `sessionManager.ts` that a "broadcast will finally come" is impossible under Rust's actual execution order. The test `treats a late echo as foreign once the wait on it gave up` only passed because it artificially mocked `mockInvalidate` as non-emitting and manually delivered a synthetic event after 8 seconds.
- **Fix**:
  Update the doc comment in `commands.rs` to document that `app.emit` occurs immediately after eviction and before the LOGOUT drain. Remove or correct the misleading "late broadcast" comment and timeout handling in `sessionManager.ts`.

---

#### 5. [NIT] Case-Sensitive Hostname Comparison in Identity Matching

- **File**: [`src/services/imap/imapConfigBuilder.ts`](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src/services/imap/imapConfigBuilder.ts#L34-L40), [`src/services/imap/sessionManager.ts`](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src/services/imap/sessionManager.ts#L318-L326), and [`src-tauri/src/imap/pool.rs`](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src-tauri/src/imap/pool.rs#L85-L95)
- **Code**:
  ```ts
  export function imapIdentityOf(account: DbAccount): { username: string; host: string } {
    if (!account.imap_host) {
      throw new Error(`Account ${account.id} has no IMAP host configured`);
    }
    return { username: account.imap_username || account.email, host: account.imap_host };
  }
  ```
  ```ts
  function forgetIdentity(target: { username: string; host: string }): void {
    for (const [accountId, ident] of accountIdents) {
      if (ident.username === target.username && ident.host === target.host) {
  ```
- **Why it is wrong**:
  DNS hostnames are case-insensitive (RFC 4343). If one window or account record stores `IMAP.example.com` and another stores `imap.example.com`, `ident.host === target.host` fails in TypeScript, and in Rust `AccountIdent` hashes and equates them as distinct entries. Sessions are not shared and invalidations are bypassed.
- **Fix**:
  Normalize `host` to lowercase in `imapIdentityOf` (`host: account.imap_host.trim().toLowerCase()`) and ensure Rust normalizes hostname strings upon ingest.

---

### Verdict

CHANGES REQUESTED
