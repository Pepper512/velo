# Code Review: PR #73 Follow-up Commits (`6d4b49a..b10d912`)

## Overview

This review covers the two follow-up commits addressing findings from Gemini and Grok regarding IMAP session invalidation, cross-window synchronization, and session pooling.

While several improvements are solid (the `join_all` concurrent logouts, `BadId` preventing drops while holding the pool lock, and `spawn_logout` preventing caller stalls), the frontend synchronization logic contains critical race conditions and credential-staleness bugs in the retry path.

---

### Finding 1: Retry path reuses stale in-memory `DbAccount` snapshot without refreshing credentials
- **Severity**: HIGH
- **File**: `src/services/imap/sessionManager.ts`
- **Code**:
  ```typescript
  async function openAgainstCurrentCredential(
    accountId: string,
    account: DbAccount,
    attempt: number,
  ): Promise<SessionId> {
    const epoch = epochOf(accountId);

    const config = await buildImapConfigWithFreshToken(account);
    accountIdents.set(accountId, { username: config.username, host: config.host });

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
  When `epochOf(accountId) !== epoch` or `StaleCredential` triggers a retry, it means credentials were changed/invalidated (for instance, updated in the SQLite database by a Settings window or an OAuth token refresh flow).
  However, `openAgainstCurrentCredential` passes the exact same in-memory `account: DbAccount` object into the recursive call `openAgainstCurrentCredential(accountId, account, attempt + 1)`.
  In `buildImapConfig`, password-based accounts read directly from `account.imap_password`. Because `account` is never re-queried from `getAccount(accountId)`, the retry builds its config using the **old, retired password** from the initial snapshot. The retry will either fail against the server or re-authenticate with stale data.
- **Concrete Fix**:
  Re-fetch the account record from the database on each attempt:
  ```typescript
  async function openAgainstCurrentCredential(
    accountId: string,
    account: DbAccount,
    attempt: number,
  ): Promise<SessionId> {
    const currentAccount = attempt === 0 ? account : ((await getAccount(accountId)) ?? account);
    const epoch = epochOf(accountId);

    const config = await buildImapConfigWithFreshToken(currentAccount);
    ...
  ```

---

### Finding 2: Window of vulnerability on first open: `accountIdents` populated after `await buildImapConfigWithFreshToken`
- **Severity**: HIGH
- **File**: `src/services/imap/sessionManager.ts`
- **Code**:
  ```typescript
  async function openAgainstCurrentCredential(
    accountId: string,
    account: DbAccount,
    attempt: number,
  ): Promise<SessionId> {
    const epoch = epochOf(accountId);

    // Always through the fresh-token builder (Decision 3): a pooled session may
    // outlive the access token that opened it, but it must never be *opened*
    // with a stale one.
    const config = await buildImapConfigWithFreshToken(account);
    // Recorded before the open, so an invalidation event that lands while the
    // open is in flight can be mapped onto this account (review, Grok 1).
    accountIdents.set(accountId, { username: config.username, host: config.host });
  ```
- **Why it is wrong**:
  The stated intent of Grok 1 was to record the account identity *before* the open so that an invalidation event landing while an open is in flight can be matched.
  However, `accountIdents.set` is placed **after** `await buildImapConfigWithFreshToken(account)`.
  `buildImapConfigWithFreshToken` is an asynchronous operation involving keychain reads, decryption, or OAuth token refresh network requests. On a window's first-ever open (or after `closeAllSessions()`), `accountIdents` has no entry for `accountId`.
  If an invalidation event arrives from another window during `await buildImapConfigWithFreshToken`, `onSessionsInvalidated` loops over `accountIdents`, finds no matching account, and drops the event without bumping `invalidationEpochs`.
  Rust then tags the subsequent socket with the new credential generation, `epochOf(accountId)` remains unchanged, and the frontend caches a session opened with retired credentials.
- **Concrete Fix**:
  Use the new `imapIdentityOf(account)` helper to record the identity synchronously *before* awaiting config construction:
  ```typescript
  async function openAgainstCurrentCredential(
    accountId: string,
    account: DbAccount,
    attempt: number,
  ): Promise<SessionId> {
    const ident = imapIdentityOf(account);
    accountIdents.set(accountId, ident);
    const epoch = epochOf(accountId);

    const config = await buildImapConfigWithFreshToken(account);
  ```

---

### Finding 3: Blindly skipping own nonce in `onSessionsInvalidated` skips invalidation for other accounts sharing `{username, host}`
- **Severity**: MEDIUM
- **File**: `src/services/imap/sessionManager.ts`
- **Code**:
  ```typescript
  export function onSessionsInvalidated(payload: unknown): void {
    if (!isSessionsInvalidatedPayload(payload)) return;
    if (ownInvalidationNonces.delete(payload.nonce)) return;
    for (const [accountId, ident] of accountIdents) {
      if (ident.username === payload.username && ident.host === payload.host) {
        forgetAccount(accountId);
        bumpEpoch(accountId);
      }
    }
  }
  ```
- **Why it is wrong**:
  Rust pools and invalidates sessions by `AccountIdent { username, host }`, which affects all sessions sharing that IMAP identity.
  In `invalidateAccountCredentials(accountId)`, the frontend only calls `forgetAccount(accountId)` and `bumpEpoch(accountId)` for that specific single `accountId`.
  If the user has multiple accounts mapped to the same IMAP host and username (e.g. multiple personas, aliases, or shared mailboxes), and invalidates one of them, Rust evicts all sessions for `{username, host}` and broadcasts the event with `nonce`.
  When the emitting window receives the event, `ownInvalidationNonces.delete(payload.nonce)` returns `true` and returns early. The other local accounts sharing `{username, host}` are **never forgotten and their epochs are never bumped**. Their cached sessions remain in `sessions` until an operation fails with `NoSuchSession`.
- **Concrete Fix**:
  When invalidating credentials locally, either forget and bump all accounts matching the identity, or do not drop the broadcast early if other matching accounts exist in `accountIdents`:
  ```typescript
  export async function invalidateAccountCredentials(accountId: string): Promise<void> {
    let ident = accountIdents.get(accountId);
    if (!ident) {
      const account = await getAccount(accountId);
      if (!account || !account.imap_host) return;
      ident = imapIdentityOf(account);
    }
    for (const [id, accIdent] of accountIdents) {
      if (accIdent.username === ident.username && accIdent.host === ident.host) {
        forgetAccount(id);
        bumpEpoch(id);
      }
    }
    const nonce = newInvalidationNonce();
    ...
  ```

---

### Finding 4: Bounded wait budget (8s) allows an open to race ahead of an in-flight invalidation and ignore its delayed broadcast
- **Severity**: MEDIUM
- **File**: `src/services/imap/sessionManager.ts`
- **Code**:
  ```typescript
  const pending = pendingInvalidations.get(accountId);
  if (pending) {
    await Promise.race([pending.catch(() => undefined), delay(PENDING_INVALIDATION_BUDGET_MS)]);
  }
  ```
- **Why it is wrong**:
  If an invalidation takes longer than 8 seconds (e.g. stalled backend or slow network during LOGOUT), `openSession` stops waiting and calls `openAgainstCurrentCredential`.
  The open snapshots `epoch = epochOf(accountId)` (which was bumped at the start of the invalidation).
  Now, `imapSessionOpen` and the delayed `imap_sessions_invalidate` race in Rust:
  1. `imapSessionOpen` enters the pool under version $V_0$.
  2. `imap_sessions_invalidate` executes in Rust, bumps the pool to $V_1$, evicts the session just inserted, and emits `SESSIONS_INVALIDATED_EVENT` with `nonce`.
  3. The emitting window receives `SESSIONS_INVALIDATED_EVENT`. Because `payload.nonce` is in `ownInvalidationNonces`, it drops the event and **does not bump the epoch**.
  4. `openAgainstCurrentCredential` finishes. `epochOf(accountId) === epoch` evaluates to `true`.
  5. The frontend caches an ID that Rust has already evicted and closed.
- **Concrete Fix**:
  If the invalidation wait times out, remove the nonce from `ownInvalidationNonces` so that any subsequent event arriving from that slow invalidation will bump the epoch and clear any session opened in the interim:
  ```typescript
  const pending = pendingInvalidations.get(accountId);
  if (pending) {
    const timedOut = await Promise.race([
      pending.catch(() => undefined).then(() => false),
      delay(PENDING_INVALIDATION_BUDGET_MS).then(() => true),
    ]);
    if (timedOut) {
      // Invalidation is still running in background; ensure subsequent broadcast isn't skipped
      ownInvalidationNonces.clear(); // Or track nonces per pending invalidation
    }
  }
  ```

---

### Finding 5: `imapIdentityOf` throws an unhandled exception for accounts without an IMAP host
- **Severity**: LOW
- **File**: `src/services/imap/imapConfigBuilder.ts` & `src/services/imap/sessionManager.ts`
- **Code**:
  ```typescript
  export function imapIdentityOf(account: DbAccount): { username: string; host: string } {
    if (!account.imap_host) {
      throw new Error(`Account ${account.id} has no IMAP host configured`);
    }
    return { username: account.imap_username || account.email, host: account.imap_host };
  }
  ```
  in `sessionManager.ts`:
  ```typescript
  let ident = accountIdents.get(accountId);
  if (!ident) {
    const account = await getAccount(accountId);
    if (!account) return;
    ident = imapIdentityOf(account);
  }
  ```
- **Why it is wrong**:
  `invalidateAccountCredentials` is called whenever credentials change (e.g. password change in Settings).
  If an account in the database is non-IMAP (e.g. SMTP-only, draft/partially configured, or managed via an API integration without an IMAP host), calling `invalidateAccountCredentials` throws an unhandled `Error`, breaking the caller (such as a settings save handler). Previously, it returned early without throwing.
- **Concrete Fix**:
  Guard against missing `imap_host` in `sessionManager.ts` before calling `imapIdentityOf`:
  ```typescript
  if (!ident) {
    const account = await getAccount(accountId);
    if (!account || !account.imap_host) return;
    ident = imapIdentityOf(account);
  }
  ```

---

### Finding 6: Unhandled rejections leave orphaned nonces in `ownInvalidationNonces`
- **Severity**: LOW
- **File**: `src/services/imap/sessionManager.ts`
- **Code**:
  ```typescript
  const nonce = newInvalidationNonce();
  ownInvalidationNonces.add(nonce);
  const pending = imapSessionsInvalidate(ident.username, ident.host, nonce).finally(() => {
    if (pendingInvalidations.get(accountId) === pending) {
      pendingInvalidations.delete(accountId);
    }
  });
  ```
- **Why it is wrong**:
  If `imapSessionsInvalidate` rejects (IPC failure, Tauri command error, or nonce validation error in Rust), the broadcast never occurs. `nonce` remains in `ownInvalidationNonces` forever.
- **Concrete Fix**:
  Clean up the nonce if the command fails:
  ```typescript
  const nonce = newInvalidationNonce();
  ownInvalidationNonces.add(nonce);
  const pending = imapSessionsInvalidate(ident.username, ident.host, nonce)
    .catch((err) => {
      ownInvalidationNonces.delete(nonce);
      throw err;
    })
    .finally(() => {
      if (pendingInvalidations.get(accountId) === pending) {
        pendingInvalidations.delete(accountId);
      }
    });
  ```

---

### Finding 7: Unit tests pin mock mechanics rather than testing realistic async races
- **Severity**: NIT
- **File**: `src/services/imap/sessionManager.test.ts`
- **Code**:
  ```typescript
  it("closes and reopens once when the event lands while an open is in flight (Grok 1)", async () => {
    ...
    const opened = withSession("acc-1", "sync", {}, async (id) => id);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockOpen).toHaveBeenCalledTimes(1);

    deliver(fromOtherWindow("user@example.com"));
    finishFirstOpen("session-retired");
  ```
- **Why it is wrong**:
  `mockBuildConfig` is synchronous in the test mock, resolving instantly across three microtasks before `deliver` is invoked. Because `mockBuildConfig` resolved synchronously, `accountIdents.set` had already executed before `deliver` ran.
  This test completely misses Finding 2 (where `buildImapConfigWithFreshToken` takes real async time to refresh tokens and an event arrives before `accountIdents` is set).
- **Concrete Fix**:
  Add a test verifying an invalidation event delivered while `buildImapConfigWithFreshToken` is still pending:
  ```typescript
  it("catches invalidation arriving while token refresh / config build is in flight", async () => {
    let finishBuildConfig!: () => void;
    mockBuildConfig.mockImplementationOnce(() => new Promise((resolve) => {
      finishBuildConfig = () => resolve({ username: "user@example.com", host: "imap.example.com" });
    }));
    ...
  ```

---

## Verdict

**CHANGES REQUESTED**

Findings 1 and 2 represent high-severity race and correctness issues where sessions opened with stale or retired credentials will continue to be cached. These must be addressed before merging.
