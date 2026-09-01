# Brief — Batch E2 / P15: IMAP session pooling

- **Task:** Close the deferred half of audit item **P15** — `src-tauri/src/commands.rs` opens a fresh
  TCP + TLS + LOGIN connection for **every** IMAP operation (15 `connect()` / `logout()` pairs), and
  `ImapConfig.password` crosses the IPC bridge on **every one of those 17 calls**.
- **Tier:** **2** — credential lifecycle. The change moves an authenticated mailbox session into
  long-lived process state and replaces "prove who you are on every call" with a bearer handle.
  Blast radius is every mail operation; the failure mode is a wrong-account or hijacked session, not
  a crash. `02-work-loop.md` puts auth changes at Tier 2 at minimum.
- **Date / owner:** 2026-09-01 · agent drafts · **Jim approves before any code** · build seat
  **#8 Claude Opus 5**, review **#19 GPT-5.6 Sol + DeepSeek V4 Pro** (audit §Batches, row E2).
- **Source:** `docs/audits/2026-09-01-optimize-audit.md` §P15 and §Batches row **E2**.
- **Base:** `main` @ `13cb063` (last code-bearing commit `be2610b`).
- **Status:** ⚠️ **Not built.** Decisions 2 and 3 are settled (Jim, 2026-09-01); **Decision 1 and
  the Tier-2 plan approval are still open**, and no code may be written until they close.

---

## Why this is worth doing

Every IMAP command in `commands.rs` follows the same shape:

```rust
let mut session = imap_client::connect(&config).await?;   // TCP + TLS + LOGIN
let x = imap_client::do_the_thing(&mut session, ...).await?;
let _ = session.logout().await;                            // and throw it away
```

**15 copies.** `connect()` (`imap/client.rs:169`) wraps the whole handshake in a 60-second timeout,
which is the honest measure of how expensive it is.

The cost is not theoretical, and the codebase already documents it in the form of workarounds:

| Evidence | Where |
|---|---|
| `INTER_FOLDER_DELAY_MS = 1_000` — *"Delay between folder syncs during initial sync to avoid connection bursts"* | `src/services/imap/imapSync.ts:56` |
| Circuit breaker: 3 failures → 15 s pause; 5 → skip remaining folders | `imapSync.ts:50-54` |
| `isConnectionError()` classifier over 8 substrings, used to decide whether to keep syncing | `imapSync.ts:58-70` |

A delta sync of an account with **K** folders and **U** new messages costs
`2 + K + ceil(U / 200)` **full logins** today (`imapListFolders` + `imapDeltaCheck` + one
`imapSearchFolder` per folder + one `imapFetchMessages` per 200-UID chunk, `CHUNK_SIZE`
`imapSync.ts:41`) — plus **K seconds of deliberate sleep** that exists only to stop the burst
tripping the server. A 12-folder account pays ~14 handshakes and 12 s of idling before any user-
visible work. Providers also rate-limit *logins* far more aggressively than commands, so the burst is
the thing most likely to get an account temporarily locked out.

The security half is the reason this is Tier 2 rather than a perf ticket. `ImapConfig.password`
(`imap/types.rs:9`, *"plaintext password or OAuth2 access token"*) is serialized across the Tauri IPC
bridge on every single mail operation. Pooling makes that **once per session open** instead of once
per command. That is the actual P15 sentence: *"removes the password from the hot IPC path."*

---

## What already landed (do not redo)

Batch E (`3d76f1b`) delivered the Tier-1 half of P15:

- `src-tauri/src/imap/net.rs` — `with_timeout()`, `connect_tcp()`, `upgrade_starttls()`,
  `configure_tcp_socket()`. Connection setup is already deduplicated; **pooling does not need to
  touch the handshake.**
- `FetchError` (`imap/client.rs:23`) replaced the `ASYNC_IMAP_EMPTY:` string-prefix protocol.

What did **not** land: the audit's full `MailError` enum. All 19 commands still return
`Result<T, String>`. That matters — see Decision 1.

---

## Decisions needed before code

### Decision 1 — how a pooled command says "your session is gone"

A pooled session can die between calls (server idle-timeout, NAT drop, token expiry). The frontend
must be able to tell *"reopen and retry once"* from *"this genuinely failed"*. With
`Result<T, String>` the only options are a string prefix — the exact anti-pattern Batch E just
removed — or a typed error.

**Recommendation:** a minimal serializable error for the pooled commands only:

```rust
#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum MailError {
    NoSuchSession,          // unknown / already-closed handle
    SessionClosed,          // was live, connection is dead → caller may reopen once
    TooManySessions,        // pool cap hit
    Other(String),          // everything else, carrying today's message verbatim
}
```

`Other(String)` is load-bearing: it keeps `isConnectionError()` (`imapSync.ts:58`) working unchanged,
so this brief does **not** have to re-classify every IMAP failure in the codebase. Converting the
remaining error paths to typed variants is separate work.

### Decision 2 — one dependency question ✅ **DECIDED: `getrandom = "0.3"`** (Jim, 2026-09-01)

`SessionId` should be **unguessable**, not a counter. Reason: pop-out windows (`thread-*`,
`compose-*`) render untrusted email HTML and still hold the full IPC grant — **P11 is unresolved and
blocked on Jim**. With a counter, a sanitizer bypass guesses `1` and drives an authenticated mailbox.
With 128 random bits it cannot.

The crate has no direct randomness dependency. Options:

| Option | Cost | Note |
|---|---|---|
| **`getrandom = "0.3"`** *(recommended)* | one declaration | Already in `Cargo.lock` (0.2.17, 0.3.4 **and** 0.4.3 are all present transitively) — **no new transitive cost**, no new vendor. 16 bytes → hex. |
| `uuid = { version = "1", features = ["v4"] }` | one declaration | Also already in the lock (1.26.0). Bigger API surface than needed. |
| `AtomicU64` counter | zero | **Not recommended** — guessable, see above. |

**Settled: `getrandom`.** It is the only dependency this brief may add; anything further needs its
own ask.

### Decision 3 — a live OAuth bug sits directly under this work ✅ **DECIDED: (a) fix first** (Jim, 2026-09-01)

Found while reading the call sites. Not part of P15, but it must be settled first because pooling
either fixes it structurally or bakes it in permanently.

`imapSync.ts:400` and `imapSync.ts:833` build the sync config as `buildImapConfig(account)` — **with
no access token**. `imapConfigBuilder.ts:41-44` therefore falls back to `account.imap_password`. For
an OAuth IMAP account that column is **`NULL` by construction**: `insertOAuthImapAccount`
(`db/accounts.ts:331`) writes the literal `NULL` into `imap_password` and keeps the token in
`access_token`. So the sync path authenticates with `""`.

The chain is worse than it looks: `syncManager.ts:94` *does* call `await ensureFreshToken(account)`
before syncing — and discards the result. The refresh lands in `access_token` via
`updateAccountTokens`, which the sync path then never reads.

Meanwhile `imapSmtpProvider.getImapConfig()` (`imapSmtpProvider.ts:124-135`) **does** pass the token.
So an OAuth IMAP account can archive, flag and open mail — but its background sync never
authenticates. `imapConfigBuilder.test.ts:57` covers `buildImapConfig(account, token)`; nothing
covers the caller that omits it, which is why CI is green.

**I have not verified this against a live OAuth IMAP account** — the reading is from code and schema
only, so treat it as a strong hypothesis, not a confirmed field report. The regression test written
for the fix is what turns it from hypothesis into a settled fact. Jim's call, now made:

- **(a) ✅ CHOSEN.** Fix it first as its own Tier-1 bugfix with a regression test — it is a small
  change plus the test that is missing today, and it should not ride inside a Tier-2 credential
  refactor. **It ships ahead of this brief and is not part of this diff.**
- **(b)** fold it into this brief, since `sessionManager` (below) makes the correct path the only
  path; or
- **(c)** disagree with the reading — then say so and I will prove or drop it before anything else.

---

## Proposed change

### Rust — `src-tauri/src/imap/pool.rs` (new)

```rust
pub struct SessionPool {
    entries: tokio::sync::Mutex<HashMap<String, Entry>>,
}

struct Entry {
    session: Arc<tokio::sync::Mutex<ImapSession>>,
    last_used: Instant,
    label: String,   // "user@host" for logs. Never the id, never the password.
}
```

Registered as `tauri::State<SessionPool>` in `lib.rs` alongside the two existing `invoke_handler`
lists.

**The lock rule, which is the whole correctness argument.** The audit's phrasing — *"take the session
out of the map before `.await`"* — is right about the hazard and this brief tightens the mechanism:

```rust
// Map lock held only long enough to clone an Arc. Never across IMAP I/O.
let handle = {
    let map = pool.entries.lock().await;
    map.get(&session_id).map(|e| e.session.clone())
}.ok_or(MailError::NoSuchSession)?;

let mut session = handle.lock().await;   // per-session lock: serializes ops on ONE connection
```

Cloning an `Arc` rather than removing the entry keeps the map consistent when a command panics or is
cancelled mid-flight (a `remove`/re-insert pair leaks the session on either). The per-session mutex
*is* held across `.await` — deliberately, because one IMAP connection cannot interleave commands.
Clippy's `await_holding_lock` does not fire on `tokio::sync::Mutex`, so this is a review obligation,
not a lint: it needs a comment at the site and **a test that two operations on two different session
ids overlap in wall-clock time**, proving the map lock is not serializing the whole app.

**Lifecycle.** Reaper task spawned in `setup()`, runs every 60 s, closes sessions idle > 5 min
(comfortably under the ~30 min server-side idle timeouts, and it bounds how long an authenticated
socket outlives the work that needed it). Hard cap of 8 live sessions → `TooManySessions`; Dovecot's
default `mail_max_userip_connections` is 10 and Gmail allows 15, so the cap must sit below the
smallest of them. Best-effort `LOGOUT` for all sessions on app exit.

**No credentials in the pool.** The `Entry` holds a session and a display label — **not the
`ImapConfig`**. A dead session is not silently re-authenticated in Rust; it returns `SessionClosed`
and the frontend reopens with a freshly built config. That is what limits password lifetime in
process memory to the duration of `imap_session_open`, and it is the property the whole brief is for.

**One cheap hardening while we are here:** `ImapConfig` derives `Debug` (`imap/types.rs:3`), which
would print the password. Nothing `{:?}`-logs it today (checked), but the pool is new credential-
handling code, so replace the derive with a manual `Debug` that renders `password: "[redacted]"`.

### Rust — `commands.rs`

| Command | Change |
|---|---|
| `imap_session_open(config) -> String` | **new.** The only command that ever receives a password. |
| `imap_session_close(session_id)` | **new.** Idempotent. |
| The 15 operation commands | `config: ImapConfig` → `session_id: String`; the `connect()`/`logout()` pair disappears from each body. Validation stays where it is (`wire::build_flag_list`, `wire::validate_mailbox` still run **before** the session is touched — `commands.rs:120`, `:217`). |
| `imap_test_connection(config)` | **unchanged.** Account setup, runs before a session can exist. |
| `imap_raw_fetch_diagnostic(config)` | **unchanged.** Debug-only, one-shot, its own raw path. |
| `imap_fetch_messages`' `FetchError::AsyncImapEmpty` fallback | **unchanged in behaviour** — but `raw_fetch_messages` needs a config the command no longer has. It must take its own short-lived connection, meaning the fallback path still costs one login. Acceptable: it is the rare non-standard-server path. **Call this out in review.** |

### TypeScript — `src/services/imap/sessionManager.ts` (new)

```ts
withSession(accountId, kind: 'sync' | 'interactive', fn: (id: SessionId) => Promise<T>): Promise<T>
```

- Opens lazily; caches `sessionId` per `(accountId, kind)`.
- Builds the config in **one place**, always via `ensureFreshToken` — this is where Decision 3(b)
  would land.
- On `NoSuchSession` / `SessionClosed`: drop the cached id, reopen **once**, retry **once**. A second
  failure propagates. The bounded retry is a hard requirement — an unbounded reopen loop against a
  provider that is rate-limiting logins is how an account gets locked.
- Closes on account deletion, on `clearConfigCache()` (`imapSmtpProvider.ts:152` — the password-change
  hook), and on app quit.

**Two session kinds per account, not one.** A 200-message `imapFetchMessages` holds the session
mutex for seconds. If a user clicks *archive* during a sync, a single shared session makes that click
wait behind the fetch — a regression users would feel immediately. `'sync'` and `'interactive'` keep
worst-case connections per account at 2, well under every provider cap.

Call sites to rewire: `imapSmtpProvider.ts` (15 `getImapConfig()` call sites) and `imapSync.ts`
(`:400`, `:833` plus the per-folder calls). `tauriCommands.ts` signatures change from
`config: ImapConfig` to `sessionId: string`; `imapTestConnection` and `smtp*` keep `config`.

---

## Done when

1. `grep -c "config: ImapConfig" src-tauri/src/commands.rs` returns **3** (open, test_connection,
   raw diagnostic) — down from **17**; `grep -c "imap_client::connect" src-tauri/src/commands.rs`
   returns **1**, down from 15.
2. A delta sync of an account with K folders issues **≤ 2** `imap_session_open` calls total, verified
   by counting the command in a debug-log run. (Today: `2 + K + ceil(U/200)` logins.)
3. `INTER_FOLDER_DELAY_MS` is reduced (1000 → 200) **in the same PR**, with the sync still green —
   the delay exists to avoid connection bursts, and if pooling did not remove the bursts, this brief
   did not work.
4. **Negative:** an unknown or already-closed `sessionId` returns `NoSuchSession` and **opens no
   connection** — asserted by a Rust test against an empty pool.
5. **Negative:** no command argument other than `imap_session_open`'s carries a password — asserted by
   a frontend test that spies on `invoke` across a full sync + an archive and fails if any payload
   contains the password fixture.
6. **Negative:** killing a pooled session mid-run surfaces exactly **one** reopen, then succeeds; a
   second consecutive failure reaches the user and does **not** loop — one test each.
7. Two operations on two different session ids overlap in time (the map lock is not a global lock).
8. A session idle past the reaper interval is gone from the pool; app exit leaves no live sessions.
9. `cargo test --locked` and `cargo clippy --all-targets --locked -- -D warnings` green; `npx tsc
   --noEmit`, `npx vitest run`, `npm run graph:check`, `npm run docs:check` green. **CI is the source
   of truth for all of these** — the agent reports what it ran, CI decides.
10. `docs/decisions/ADR-003` records where mail credentials live at runtime and why the pool holds no
    config. `CLAUDE.md` names auth/identity architecture as ADR-required, and this is that.

---

## Not doing

- **SMTP pooling.** `smtp_send_email` is user-initiated and infrequent; the connection burst problem
  does not exist there. It keeps taking a config.
- **IMAP IDLE / push.** A live pooled connection makes IDLE *possible*; it is a separate feature with
  its own reconnect semantics and its own brief.
- **More than 2 connections per account.** No parallel folder fetching in this brief — that changes
  sync ordering and rate-limit exposure at the same time as the credential model.
- **Re-authenticating inside Rust.** Deliberate: it would mean holding the password in the pool and
  would undo the point of the change.
- **Converting all IMAP errors to `MailError` variants.** `Other(String)` preserves today's strings
  and `isConnectionError`. Full typing is the remainder of P15's Tier-1 half.
- **Touching the raw-TCP fallback path** (`raw_fetch_messages`, `raw_fetch_diagnostic`) beyond what
  the signature change forces.
- **Fixing P11's capability grant.** Blocked on Jim, and this brief's threat model assumes it stays
  as it is today (which is why the session id must be unguessable).

---

## Threat (Tier 2)

- **Spoofing.** The session id **is** a bearer credential for an authenticated mailbox — anything that
  can call `invoke` with a valid id operates the mailbox. Mitigation: 128 unguessable bits
  (Decision 2); never logged; never persisted to disk or `localStorage`; held only in the module-scope
  map in `sessionManager.ts`. The realistic attacker is script in a `thread-*` pop-out rendering
  untrusted email HTML, and P11 means that context still has the full IPC grant.
- **Tampering.** `session_id` crosses the IPC boundary and is validated by exact `HashMap` lookup
  only — it is **never** interpolated into IMAP wire text. Mailbox and flag validation stay in
  `imap::wire` and still run before the session is touched (P1's fix is untouched).
- **Repudiation.** Log open and close at `info` with the account label and a reason
  (`user_requested` / `idle_reaped` / `dead_connection` / `app_exit`); never the id, never the
  password. Enough to reconstruct "which account had a live session when."
- **Disclosure.** This is the intended win: the password crosses IPC once per session rather than on
  all 17 commands. Counter-risks handled: the pool stores no `ImapConfig`; `Debug` on `ImapConfig`
  gets a redacting manual impl; the reaper bounds how long an authenticated socket outlives its work.
  Residual, stated plainly: a **live authenticated socket now exists in process memory between
  operations**, where before it did not. That is the trade — a shorter credential path in exchange
  for a longer-lived session. Anything that can already read process memory wins either way.
- **DoS.** An unbounded map is unbounded sockets and memory; capped at 8 with `TooManySessions` plus
  the idle reaper. The sharper risk is a reopen loop hammering a provider's login endpoint and getting
  the account locked — hence the **strictly one** reopen-and-retry, tested (Done-when 6).
- **Elevation.** There is no user model here; possession of the id is the entire authorization. The
  lookup therefore happens **in each command body** — not in a wrapper, not in shared middleware —
  matching the `CLAUDE.md` rule that authz lives in the request handler. If the check were skipped,
  the command would have no session to operate on and must fail closed rather than fall back to
  opening one.

---

## Rollback

- **No database migration, no schema change, no persisted state.** The pool is process memory; it is
  empty at every launch. Nothing to migrate back.
- **Expand-contract at the IPC boundary.** Land the pooled commands **alongside** the existing
  config-taking ones (Tauri accepts both; they are separate names). A settings flag
  `imap_session_pooling` selects which path `sessionManager` uses, defaulting **on** after Jim's QA
  and flippable to **off** without a rebuild. Rollback #1 is flipping it: the next command reverts to
  connect-per-call, and orphaned sessions are reaped within 5 minutes.
- Rollback #2 is reverting the PR — clean, because of expand-contract: a downgraded frontend still
  finds the commands it expects.
- The old commands are deleted in a **follow-up** release once the flag has been on through one
  release cycle, not in this PR.
- **Blast-radius note:** the worst realistic failure is mail operations erroring until restart (an
  empty pool after a bad reap). It is not data loss — no rollback path here touches stored mail.

## Verification Jim may want to do by hand

Automated coverage above is real but cannot see a *slow* client. Worth one manual pass: with a large
account, run a delta sync and click *archive* on a message mid-sync — it should respond immediately
(that is what the `interactive` session is for). Then leave the app idle 10 minutes and act again —
it should reopen transparently, not error.

## Approval

- Plan approved by: __________ date: ______ ← **Tier 2: required before ANY code**
- **Decision 1 (typed error): open** — recommendation above (`MailError` with `Other(String)`) stands
  until Jim rules.
- **Decision 2 (dependency): DECIDED — `getrandom = "0.3"`.** Jim, 2026-09-01. Declared direct; it is
  already in `Cargo.lock` transitively, so this adds a declaration and no new transitive cost. This is
  the *only* dependency this brief may add; anything else needs its own ask.
- **Decision 3 (OAuth sync bug): DECIDED — fix first, as its own Tier-1 change.** Jim, 2026-09-01.
  It ships ahead of pooling with the regression test that is missing today, and is **not** part of
  this brief's diff.
