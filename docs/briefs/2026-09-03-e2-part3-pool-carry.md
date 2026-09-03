# SPEC-E2-3 — IMAP session pool: the carry list from PR #39

- **Task:** Close the five code items PR #39 (E2 part 2) carried to "part 3": the redundant
  `Arc<Mutex>` around a pooled session together with `logout_arc`'s `try_unwrap` (which
  silently skips LOGOUT when a second clone exists), evictions that drop a connection without
  LOGOUT, `bump_credential_version` evicting by identity regardless of version, the
  cross-window invalidation race, and the unvalidated session-id wrapper. Done-when 9 and
  the live halves of 2 and 10 become ignored Rust tests against the Dovecot harness where a
  unit test cannot prove them; Done-when 2's app-level count stays manual.
- **Tier:** **2** — `src-tauri/src/imap/pool.rs` and `commands.rs` are the Rust IMAP client
  path (a named Tier-2 area). Plan, threat pass and rollback in the PR before code; two
  review legs. No dependency, no capability, no schema.
- **Base:** `main` @ `5ae7a7c` (code pin `1b18160`, #71). Citations grepped at `5ae7a7c`.
- **Status:** landed `1116348` (#73, 2026-09-03) — four review passes, dispositions in
  LOG.md; the two live Dovecot tests compile but were not run (Docker down).
- **Source:** PR #39's "Scope — what this does NOT close" (quoted below), its review thread
  (finding 3), ADR-003, the E2 brief `docs/briefs/2026-09-01-e2-p15-session-pooling.md`,
  and HANDOFF's carry list. Jim's 2026-09-03 instruction: *"Then E2 part 3 … Tier 2 (Rust
  IMAP pool) — plan with threat pass and rollback before code."*
- **Effort:** M · 1 day.

## The carry list, verbatim from #39

> - The redundant `Arc<tokio::Mutex>` — **and it should be removed together with `logout_arc`'s
>   `try_unwrap`**, which silently skips the LOGOUT when a second clone exists. That is closer
>   to a defect than a nit.
> - Evictions dropped without a LOGOUT.
> - `bump_credential_version` evicts by ident regardless of version, so under fire-and-forget
>   invalidation a session opened on the *new* credential can be evicted by the bump that
>   preceded it. Self-healing, one wasted login.
> - The unvalidated session-id wrapper.
> - **Done-when 9** (folder isolation) and the live-server halves of 2 and 10 — those need
>   the Dovecot harness, not another unit test.
>
> A *narrower* race is real: another window's module cache still holds an id whose eviction
> is in flight. It self-heals into `NoSuchSession` and a reopen. Noted for part 3.

## Outcome

Every pooled connection that leaves the pool in protocol sync says LOGOUT to its server, on
every path; a session cannot be silently dropped because a second handle to it happened to
exist. A credential rotation can no longer leave a session authenticated with the superseded
credential in the pool, and it no longer costs the user a wasted login. A session id of the
wrong shape is refused before it touches the map. Nothing user-visible changes.

## What exists, verified in the fork

1. **The `Arc<Mutex>` is redundant by construction.** `Entry.session:
   Option<Arc<tokio::sync::Mutex<S>>>` (`pool.rs:117`); `acquire` *takes* the session out of
   the entry (`pool.rs:243`), so exactly one operation can hold it — the mutex never contends.
   `with_pooled_session` clones the `Arc` (`commands.rs:138`), moves the clone into `op`, and
   the guard keeps the original; `release_ok` puts it back (`pool.rs:381-390`).
2. **`logout_arc` skips LOGOUT whenever it is not the sole owner.** `commands.rs:112-117`:
   `if let Ok(mutex) = Arc::try_unwrap(session) { … logout() }` — a second clone means a
   silent drop. Today the clone count is one on every path that reaches it (`remove`, `reap`,
   `drain`, `bump_credential_version` all return sessions that were *not* checked out), so
   the skip is latent; it is the design that is wrong, and any future path that hands a
   clone to a background task would turn it into a real leak.
3. **Three evictions drop a clean session without LOGOUT.** (a) The per-account cap in
   `insert` removes the idlest idle entry and drops it inside the map lock (`pool.rs:218`)
   — returned to nobody. (b) `release_ok` into an entry that vanished while checked out
   (closed, reaped or bumped meanwhile) drops the session (`pool.rs:389`, test
   `releasing_into_an_entry_that_vanished_does_not_resurrect_it`). (c) The error, panic and
   cancellation paths drop through `SessionGuard::drop` (`pool.rs:403`) — **those are by
   design** (protocol state unknown; a destructor cannot await) and stay that way.
   Separately, `imap_session_close` and `imap_sessions_invalidate` await `logout_arc` with
   **no timeout** (`commands.rs:87,103`) while the reaper and the exit hook bound theirs
   (`lib.rs:74,65`): a server that will not answer LOGOUT can hang a close IPC call for as
   long as the socket lives.
4. **Invalidation is version-blind, and a stale generation can be inserted after a bump.**
   `bump_credential_version` evicts every entry whose `ident` matches (`pool.rs:173-186`).
   `imap_session_open` reads the generation *before* `connect` (`commands.rs:70`) and inserts
   after it (`commands.rs:75`) with the value it read. Between the two is one network
   round trip. If the bump runs inside that window, the insert lands an entry tagged with the
   superseded generation — authenticated with whichever credential the frontend had built,
   which may be the revoked one — and **it survives until the next bump or reap**. The
   "wasted login" #39 described is the other interleaving (insert first, bump second: the
   new session is evicted). Both are the same missing rule: an entry must not enter the map
   at a generation that is not current. On the frontend, `clearConfigCache` fires the
   invalidation and does not wait for it (`imapSmtpProvider.ts:202`), and `openSession`
   never waits for a pending invalidation (`sessionManager.ts:103-115`), so the same window
   can open before its own bump has run.
5. **Cross-window race, as #39's review recorded it.** Each window has its own module
   cache in `sessionManager.ts` (`sessions`, line 94). `invalidateAccountCredentials`
   forgets *this* window's ids synchronously; another window keeps its id, its next call
   gets `NoSuchSession` and reopens. Self-healing, one failed IPC round trip, and a caller
   with `retrySafe: false` sees the error. Rust already emits window events with
   `tauri::Emitter` (`lib.rs:186,278`); `core:event:allow-listen` is granted
   (`capabilities/default.json:26`); `listen` is already used from TypeScript
   (`deepLinkHandler.ts:2`).
6. **A session id is any string.** Every command takes `session_id: String`; `acquire`,
   `remove` hash it straight into the map (`pool.rs:240,259`), and the guard clones it
   (`pool.rs:250`). Real ids are 32 lowercase hex characters (`commands.rs:38-42`,
   16 bytes from `getrandom`). Nothing refuses a 10 MiB string or one with control
   characters before it is hashed and cloned; nothing logs it either, so the exposure is
   cost and shape, not disclosure.
7. **Live proofs exist as a pattern.** `copyuid.rs:366` is an `#[ignore]` tokio test that
   drives the real client against the Dovecot harness (`docs/testing/dovecot/README.md`
   §F-5). Done-when 9 and the live half of 10 fit the same shape. Done-when 2 ("a delta
   sync issues ≤ 2 `imap_session_open` calls") is an app-level count and needs the
   running app. Docker is not running on this machine at writing.

## Requirements

- **REQ-1** As the machine's owner I want every pooled connection that leaves the pool in
  sync to be logged out, so servers do not accumulate half-open sessions in my name.
  - REQ-1.1 THE POOL SHALL own each session directly (`Option<S>`, no `Arc`, no async
    mutex); a checkout SHALL move the session into the guard and a clean release SHALL move
    it back.
  - REQ-1.2 WHEN a clean release finds its entry gone THE POOL SHALL return the orphaned
    session to the caller, and the caller SHALL LOGOUT it (bounded).
  - REQ-1.3 WHEN the per-account cap evicts an idle session THE POOL SHALL return it to the
    caller, and the caller SHALL LOGOUT it (bounded) without delaying the open.
  - REQ-1.4 THE SYSTEM SHALL have one logout helper that takes the session by value and
    always issues LOGOUT under a 3 s budget; `logout_arc` and its `try_unwrap` SHALL be
    gone. `imap_session_close` and `imap_sessions_invalidate` SHALL use it, so neither can
    hang on a silent server.
  - REQ-1.5 An error, a panic or a cancellation SHALL still drop the session without
    LOGOUT (unchanged, and the reason stays in the code).
- **REQ-2** As a user who changed a password or had a token revoked I want the old credential
  to stop being served at once, and I do not want to pay an extra login for it.
  - REQ-2.1 WHEN `insert` is offered a session whose `credential_version` is not the
    account's current generation THE POOL SHALL refuse it with `StaleCredential` and hand
    the session back for LOGOUT.
  - REQ-2.2 WHEN `imap_session_open` is refused with `StaleCredential` THE SYSTEM SHALL
    LOGOUT the fresh session and return the `velo:pool:StaleCredential` sentinel; the
    frontend SHALL rebuild the config and open once more (never a loop).
  - REQ-2.3 `bump_credential_version` SHALL evict only entries below the new generation
    (with REQ-2.1 that is every entry of the account — the invariant is now stated by the
    code and tested, not implied).
  - REQ-2.4 WHEN a window has an invalidation in flight for an account THE FRONTEND SHALL
    wait for it before opening a session for that account, so the same window never opens
    against a generation it is about to retire.
- **REQ-3** As a user with pop-out windows I want a credential change in one window to reach
  the others without a failed call first.
  - REQ-3.1 WHEN `imap_sessions_invalidate` has evicted THE SYSTEM SHALL emit
    `velo-imap-sessions-invalidated` `{ username, host }` to every window.
  - REQ-3.2 WHEN a window receives that event THE FRONTEND SHALL forget every cached id
    whose account identity matches; the next call opens fresh. Receiving it for an unknown
    identity is a no-op.
- **REQ-4** As the machine's owner I want a malformed session id refused before it costs
  anything.
  - REQ-4.1 THE POOL SHALL accept for lookup only ids of exactly 32 lowercase hex
    characters; anything else SHALL be `NoSuchSession` without touching the map or being
    cloned, and SHALL never be logged.
  - REQ-4.2 `new_session_id` output SHALL pass that validator (tested).
- **REQ-5** Live proofs from the E2 brief.
  - REQ-5.1 Done-when 9: an ignored test lists folder A then folder B over one pooled
    session and gets B's data.
  - REQ-5.2 Done-when 10, live half: an ignored test reaps an idle session and the LOGOUT
    completes against the real server within the reaper's budget.
  - REQ-5.3 Done-when 2 stays manual and recorded as such.

## Not doing

- **Per-window session binding and P11's capability grant** — ADR-003 records the gap;
  P11 is the next item in the roadmap and has its own brief.
- **LOGOUT on the error / panic / cancellation path** — a desynchronised session cannot be
  logged out reliably and a destructor cannot await; dropping the socket is the RFC-legal
  close. Recorded in the pool's module doc.
- **A retry loop on `StaleCredential`** — one reopen, like `TooManySessions`.
- **The logging pass** (#39 finding 5, folder names at INFO) — a logging brief.
- **SMTP pooling, IDLE, more than two sessions per account** — unchanged from E2.
- **Migrating the raw-fetch fallback onto the pooled session** (E2 option (d)) — separate.

## Design

- **Rust — `src-tauri/src/imap/pool.rs`**
  - `Entry.session: Option<S>`. `SessionGuard { session: Option<S>, … }` gains
    `session_mut(&mut self) -> &mut S`; `session()` (the `Arc` accessor) goes away.
    `release_ok(self) -> Option<S>`: `None` when the session went back into its entry,
    `Some(orphan)` when the entry had vanished. `Drop` is unchanged (evict if still held).
  - `insert(...) -> Result<Option<S>, PoolError>`: `Ok(Some(victim))` when the cap evicted
    an idle session; `Err(StaleCredential)` when `account_key.credential_version` is not
    the ident's current generation — the pool does not take ownership in that case, so the
    caller still holds the session to LOGOUT. `PoolError::StaleCredential` displays as
    `velo:pool:StaleCredential`.
  - `bump_credential_version` filters `credential_version < next` explicitly.
  - `SessionId` validation: `pub fn is_well_formed(id: &str) -> bool` (32 × `[0-9a-f]`);
    `acquire` and `remove` return `NoSuchSession` / `None` early for anything else.
  - `reap`, `drain`, `remove`, `bump_credential_version` return `Vec<S>` / `Option<S>`.
- **Rust — `src-tauri/src/commands.rs`**
  - `pub async fn logout(session: ImapSession)`: `tokio::time::timeout(LOGOUT_TIMEOUT,
    session.logout())`, result ignored; `LOGOUT_TIMEOUT = 3 s` (the reaper's constant moves
    here and the reaper uses the helper). No `try_unwrap`.
  - `with_pooled_session` takes `op: F where F: for<'a> FnOnce(&'a mut ImapSession) ->
    BoxFuture<'a, Result<T, String>>` (`futures::future::BoxFuture`, already a dependency).
    Call sites become `|session| async move { imap_client::x(session, …).await }.boxed()`
    and the `let mut session = session.lock().await;` line disappears from all fourteen.
    The guard is still held across the await — cancellation still evicts. On `Ok`, an
    orphan from `release_ok` is logged out on a spawned task (`tauri::async_runtime::spawn`)
    so the command's own result is not delayed by a stranger's server.
  - `imap_session_open`: `match pool.insert(...)`: `Ok(None)` → id; `Ok(Some(victim))` →
    spawn `logout(victim)`, id; `Err(StaleCredential)` → `logout(session).await`, then the
    sentinel (the `session` is still owned here because `insert` gave it back — see the
    signature note under Failure modes).
  - `imap_sessions_invalidate` gains `app: tauri::AppHandle` and emits
    `velo-imap-sessions-invalidated` with `{ username, host }` after the LOGOUTs.
- **Rust — `src-tauri/src/lib.rs`**: reaper and exit hook call `commands::logout`; the exit
  sweep keeps its total budget.
- **TypeScript — `src/services/imap/sessionManager.ts`**
  - `pendingInvalidations: Map<accountId, Promise<void>>`; `invalidateAccountCredentials`
    stores its promise (cleared in `finally`); `openSession` awaits it first.
  - `openSession` catches `velo:pool:StaleCredential` once and re-runs the open (config
    rebuilt through the fresh-token builder). `withSession` needs no change: the stale
    sentinel is handled inside the open.
  - `ensureInvalidationListener()`: registers `listen("velo-imap-sessions-invalidated", …)`
    once per window, lazily on first `withSession`; the handler forgets both kinds for every
    account whose recorded ident matches. `tauriCommands.ts` stays the only `invoke` site.
- **Decision & alternatives**
  - Owned session + `BoxFuture` HRTB (chosen) vs. keeping `Arc<Mutex>` and only removing
    `try_unwrap` (would keep a lock that never contends and the ownership ambiguity the
    carry item is about) vs. passing the session by value into `op` and returning it (no
    box, but fourteen call sites must return a tuple and a forgotten return silently
    evicts). One heap allocation per command is nothing beside the network round trip.
  - Refuse a stale generation at `insert` (chosen) vs. re-reading the generation after
    `connect` and tagging with it (would let a session authenticated with a revoked
    credential survive under the new generation — the opposite of the goal).
  - Rust-side emit (chosen) vs. the invalidating window emitting from JavaScript: the Rust
    command is the single place that knows the eviction happened, and it already has
    `Emitter`.
- **Data / schema** — none.
- **Failure modes** — `insert`'s refusal path must return the session, so the signature is
  `insert(&self, id, key, session: S) -> Result<Option<S>, (PoolError, S)>`; a plain
  `Err(PoolError)` would drop the session inside the pool, which is REQ-1's bug in a new
  coat. The frontend treats an unknown sentinel as an ordinary error (surfaces once, no
  retry) — so an old frontend against a new Rust fails visibly rather than loops. A spawned
  LOGOUT that never completes is bounded by the 3 s budget. If the event listener never
  registers (pop-out without the permission), behaviour is exactly today's: `NoSuchSession`
  and a reopen.

## Tasks (risk-first)
- [ ] 1. `pool.rs` tests first: owned session round trip; orphan returned on a vanished
  entry; cap eviction returns the victim; stale generation refused and the session handed
  back; bump evicts only below the new generation and a fresh-generation insert succeeds
  afterwards; malformed ids (empty, 31 chars, 33 chars, upper-case, non-hex, a long string)
  are `NoSuchSession` and leave the map untouched; `new_session_id` is well-formed. Then
  the implementation. — REQ-1.1/1.2/1.3, 2.1, 2.3, 4.1/4.2
- [ ] 2. `commands.rs`: `logout`, `LOGOUT_TIMEOUT`, `with_pooled_session` /
  `_for` over `&mut ImapSession`, the fourteen call sites, `imap_session_open`'s three
  outcomes, `imap_session_close` / `imap_sessions_invalidate` bounded, the event emit.
  `lib.rs` reaper and exit hook on the helper. — REQ-1.4/1.5, 2.2, 3.1
- [ ] 3. `sessionManager.test.ts` then `sessionManager.ts`: open waits for a pending
  invalidation; a stale-credential open reopens exactly once and surfaces a second refusal;
  the invalidation event forgets matching accounts only; listener registered once.
  — REQ-2.2/2.4, 3.2
- [ ] 4. Ignored live tests beside `copyuid.rs`'s: folder isolation over one session; reap
  then LOGOUT against the harness. README section. Not runnable here (Docker down) —
  recorded, not claimed. — REQ-5
- [ ] 5. LOG.md; HANDOFF pin; vault queue line.

## Done when
`cargo test --locked` (pool tests grow from 19) and clippy green; `npm run test`, `tsc`,
`graph:check`, `docs:check` green; `grep -c try_unwrap src-tauri/src/commands.rs` → 0;
`grep -c 'Arc<tokio::sync::Mutex' src-tauri/src/imap/pool.rs src-tauri/src/commands.rs`
→ 0; `poolBoundary.test.ts` still passes unchanged (the credential boundary is untouched);
CI green on the merge commit. Live: the two ignored tests pass against the harness when it
is up (not run in this session; say so in the PR).

## Rollback
`git revert` of the squash commit. No schema, no persisted state, no capability change; the
new sentinel and event are additive and disappear with the code.

## Threat pass (Tier 2)
- **Assets:** authenticated IMAP sessions; the credential generation counter; the session
  ids in each window's module map.
- **Entry points:** every `session_id` argument (any JavaScript in a window can call the
  commands with any string); `imap_sessions_invalidate` (username/host, any caller); the
  new window event (any window can *listen*; only Rust emits it).
- **Spoofing:** unchanged — possession of a well-formed id is the authorization; the
  validator narrows the accepted input, it does not add an identity check (ADR-003 §5).
- **Tampering:** the id is validated by shape then exact map lookup, still never
  interpolated into wire text; the event payload is username + host, which the listener
  uses only as a map key into its own cache.
- **Repudiation:** no new logging; ids and credentials are not logged.
- **Disclosure:** the event carries an account username and host to sibling windows of the
  same app, which already hold that account's config; nothing crosses to another origin.
  The stale-generation rule closes a narrow window in which a session authenticated with a
  revoked credential could outlive the revocation.
- **DoS:** a malformed id is rejected before hashing or cloning; an attacker who can call
  `imap_sessions_invalidate` can force reopen logins (as today), bounded by one open per
  call and the per-account cap; every LOGOUT is bounded at 3 s so no close or invalidate
  IPC call can hang.
- **Elevation:** the lookup stays in each command body (through the helper it calls), not
  in middleware; a skipped check is a compile error because the session only exists inside
  the guard.
- **Residual:** per-window binding (ADR-003, P11). **Added after review:**
  - *In-flight operations are not revoked* (Grok 8). `bump_credential_version` skips a
    checked-out entry; the operation completes against the socket the invalidation meant
    to kill, then `release_ok` returns the orphan and it is logged out. Accepted: cancelling
    a `&mut` session from another task is not protocol-safe, and reporting the completed
    operation as a failure would mislead the frontend about a side effect that happened.
    Revocation is immediate for every *next* command, not for the one already on the wire.
  - *Spawned LOGOUTs are best-effort* (Grok 5). The cap's victim, a `release_ok` orphan and
    a refused open are logged out on a background task that the exit drain cannot see; a
    task still running at runtime shutdown is dropped with its socket. Bounded by 3 s.
  - *Any window can emit the invalidation event* (Grok 7). It carries no secret and grants
    nothing: the worst a rogue renderer can do with it is make every window drop its
    cached ids and pay a reopen, bounded by the per-account cap. The listener drops a
    payload that is not `{username, host, nonce}` strings, and ignores its own nonce.
  - *The dual race* (Grok 1) — a config built before another window's bump whose Rust
    command starts after it, so `insert` sees the current generation while the socket
    was authenticated with the retired credential — is closed on the frontend: each
    account keeps an invalidation epoch, bumped by a local invalidation and by another
    window's event; an open that returns into a changed epoch is closed (Rust logs it out)
    and retried once with a rebuilt config. Rust's generation check remains the backstop
    for the interleaving it can see.

## Review
Two legs on the PR: Gemini 3.7 via `agy`; Grok 4.6 via the `grok` CLI when its ~12 minutes
are affordable, else `gemini-3.8-flash-high` (Jim, 2026-09-02). Diffs from committed SHAs.
Dispositions on the PR and in LOG.md.

## Approval
Jim, 2026-09-03 (ROADMAP §The prompt for the next session, and "go" on 2026-09-03): *"Take
E2 part 3 … Tier 2 (Rust IMAP pool): finish the spec from the vault template, plan with
threat pass and rollback before code, TDD on the pool's generic session type (no network)
…"*. The plan is this file, committed before the code.
