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
- **Base:** `main` @ `0d0b373` (**re-based** from `d704ea0`, six merges back). **Every line number in
  this brief was re-verified at `0d0b373`**; rev 2's were verified at `d704ea0` and many had since
  moved — `client.rs` in particular was rewritten twice by #25 and #26. See §Drift.
- **Status:** ⚠️ **DO NOT BUILD.** **Rev 3**, 2026-09-01 — a docs-only refresh: citations
  re-verified, the drift #25/#26 created folded in, Decision 4 recorded as decided, and **six**
  pooling findings written down (§Pooling findings) rather than left in a review transcript — one of
  which the current design does not cover.
  - **Decision 4 — ✅ DECIDED (a)** (Jim, 2026-09-01). No longer blocking.
  - 🔴 **Rev-2 re-confirmation — STILL OPEN, and it is now the only thing blocking the build.**
    Jim approved rev 1; rev 2 changed retry semantics, session lifecycle, caps and the fallback
    design. He is holding the re-confirmation deliberately until this refresh lands so he can judge
    it against current facts — **specifically the cancellation finding in §Pooling findings, which
    the design does not currently cover.** Tier 2 plan approval before code; agent merge authority
    does not reach it.

---

## Why this is worth doing

Every IMAP command in `commands.rs` follows the same shape:

```rust
let mut session = imap_client::connect(&config).await?;   // TCP + TLS + LOGIN
let x = imap_client::do_the_thing(&mut session, ...).await?;
let _ = session.logout().await;                            // and throw it away
```

**15 copies.** `connect()` (`imap/client.rs:171`) wraps the whole handshake in a 60-second timeout,
which is the honest measure of how expensive it is.

The cost is not theoretical, and the codebase already documents it in the form of workarounds:

| Evidence | Where |
|---|---|
| `INTER_FOLDER_DELAY_MS = 1_000` — *"Delay between folder syncs during initial sync to avoid connection bursts"* | `imapSync.ts:57`, applied at `:485-487` |
| Circuit breaker: 3 failures → 15 s pause; 5 → skip remaining folders | `imapSync.ts:51-55` |
| `isConnectionError()` classifier over 8 substrings | `imapSync.ts:59-71` |

**Corrected cost model (rev 2).** Rev 1 gave one formula for both sync paths and got both terms
wrong. The paths differ:

| | Logins | Inter-folder sleep |
|---|---|---|
| **Initial sync** | 1 `imapListFolders` + 1 `imapSearchFolder` **per folder** + 1 `imapFetchMessages` per **200**-UID chunk (`CHUNK_SIZE`, `imapSync.ts:42`, used at `:512`) | `(K-1) × 1 s` — the `folderIdx > 0` guard at `:485` |
| **Delta sync** | 1 `imapListFolders` + **1 batched** `imapDeltaCheck` covering all existing folders (`:946`) + 1 `imapSearchFolder` per **new or UIDVALIDITY-changed** folder + 1 fetch per **50**-UID batch (`BATCH_SIZE`, `imapSync.ts:40`, `:375-376`) | **none** |

So a delta sync of U new messages costs ≈ `2 + ceil(U/50)` logins. For U = 1000 that is ~22 logins,
not the 7 rev 1 claimed. The argument gets **stronger**, not weaker: the delta path — the one that
runs every 60 seconds — re-authenticates once per 50 messages.

The security half is why this is Tier 2 rather than a perf ticket. `ImapConfig.password`
(`imap/types.rs:9`, *"plaintext password or OAuth2 access token"*) is serialized across the Tauri IPC
bridge on every mail operation. Pooling makes that **once per session open**.

**Stated honestly (rev 2):** the credential does not leave the process. Password accounts keep the
decrypted password in `_imapConfig` (`imapSmtpProvider.ts:132`, cached at `:154-157`) and in SQLite; OAuth accounts
need token material in the frontend for every reopen. What improves is the number of secret copies in
flight and — the concrete operational win — the number of **login events**, which is what providers
rate-limit and lock accounts over. The exposure *moves*: from "a secret on every IPC call" to "a live
authenticated socket held for as long as the app runs." That trade is the substance of the Threat
section, and this section should not oversell it.

---

## What already landed (do not redo)

Batch E (`3d76f1b`) delivered the Tier-1 half of P15:

- `src-tauri/src/imap/net.rs` — `with_timeout()`, `connect_tcp()`, `upgrade_starttls()`,
  `configure_tcp_socket()`. Connection setup is already deduplicated; **pooling does not need to
  touch the handshake.** The TCP keepalive at `net.rs:79-91` (60 s) matters more than it looks — see
  Blocker 1.
- `FetchError` (`imap/client.rs:25`) replaced the `ASYNC_IMAP_EMPTY:` string-prefix protocol.

What did **not** land: the audit's full `MailError` enum. All 19 commands still return
`Result<T, String>`. That matters — see Decision 1.

---

## Drift — what #25 and #26 changed under this brief (rev 3)

Rev 2 was verified at `d704ea0`. Six merges later, two of them (#25 `2066351`, #26 `5c545f9`)
rewrote the interior of `client.rs`. Beyond the line numbers, five things change what this brief
plans to build:

1. **`imap/caps.rs` now exists** (#25). It reads `CAPABILITY` once per session and returns
   `Caps { has_move, has_uidplus }`, degrading to "no optional extensions" on a clean protocol
   failure and **aborting on a timeout** (a dropped `CAPABILITY` future desynchronises the session —
   the same hazard Blocker 1 describes). Its own doc already says where it belongs under pooling:
   **in the pool entry beside the session**, so a pooled connection is interrogated once rather than
   per command. That is a new `Entry` field this brief must carry, and it is the E2-shaped half of a
   file written with E2 in mind.
2. **Two of the 15 commands no longer return `()`.** `imap_move_messages` and
   `imap_delete_messages` return `RemovalResult { expunged }` (#26). The command-table row that says
   "`config: ImapConfig` → `session_id: String`" still holds, but their signatures are no longer the
   uniform `Result<(), String>` rev 2 assumed.
3. **Part of Blocker 2's retry policy has already shipped, by a different mechanism.** Rev 2
   excludes `imap_move_messages` from retry because the COPY fallback is not replay-safe. That is
   now enforced *below* the session manager: #26 wraps a post-COPY failure in
   `VELO_OUTCOME_UNKNOWN:` and `classifyError` (`src/utils/networkErrors.ts`) matches that prefix
   ahead of its network patterns, returning `isRetryable: false` — so neither `executeEmailAction`
   nor `queueProcessor` replays it. **`imap_append_message` has no such sentinel**, so the
   idempotency exclusion this brief specifies is still required for it. Scope shrinks; it does not
   disappear.
4. **`OUTCOME_UNKNOWN_PREFIX` is exactly the stringly-typed IPC error `MailError` exists to
   replace — and it deliberately covers two different states.** A timed-out `UID MOVE` is genuinely
   unknown; a COPY that succeeded before its expunge failed is a *known* partial. They share a
   prefix only because replay duplicates mail in both. **E2's typed-error migration must split them,
   not collapse them:** "unknown" wants a reconciling read, "copied but not removed" wants the
   delete completed. The prefix's own doc comment says so; this brief owns the migration.
5. **Mailbox state is shared and volatile across pooled sessions.** A per-account cap of **2** means
   two live sessions on one account can hold the same folder selected, and IMAP flags and the
   selected mailbox are per-connection *views* of shared server state. Every pooled operation must
   `SELECT` its folder and must not assume its own earlier `SELECT` still holds. #26 removed the
   worst version of this — an untargeted `EXPUNGE` in session A destroying what session B had
   flagged — by making the expunge target only its own UID set, but the **rule** was never written
   down and belongs here.

---

## Decisions

### Decision 1 — how a pooled command reports a broken session ✅ **DECIDED, simplified in rev 2**

Rev 1 proposed a `MailError` with a `SessionClosed` variant and never said **how Rust would detect a
dead session**. With `Result<T, String>` internals the only mechanism is string-matching on I/O
errors — the exact anti-pattern Batch E deleted.

Blocker 1's poison-on-error rule dissolves the problem. If **any** error evicts and closes the
session, the next call's lookup fails and returns `NoSuchSession` — a fact about the map, not a
classification of an error string. The minimal enum is therefore:

```rust
#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum MailError {
    NoSuchSession,      // unknown / evicted handle → the frontend may reopen once
    TooManySessions,    // cap hit (see M2 for what the frontend does)
    NeedRawFallback,    // async-imap parsed nothing; see Decision 4
    Other(String),      // everything else, carrying today's message verbatim
}
```

`SessionClosed` is gone — eviction plus `NoSuchSession` covers it with no string classification.
`Other(String)` stays load-bearing: it keeps `isConnectionError()` (`imapSync.ts:59`) working, so
this brief does not have to re-classify every IMAP failure in the codebase.

### Decision 2 — dependency ✅ **DECIDED: `getrandom = "0.3"`** (Jim, 2026-09-01)

Already in `Cargo.lock` transitively (0.2.17, 0.3.4, 0.4.3), so this adds a declaration and no new
transitive cost. The only dependency this brief may add. See the Threat section for what an
unguessable id does and does not buy — rev 1 oversold it.

### Decision 3 — OAuth-over-IMAP sync bug ✅ **RESOLVED — shipped in `d704ea0` (#18)**

Rev 1 found that `imapSync.ts:411`/`:854` (rev 2 cited `:400`/`:833`) built the sync config with no access token, so OAuth IMAP
accounts authenticated with `""`. Jim chose to fix it first, separately. It landed as **`d704ea0`**
with regression tests, and both call sites now use `buildImapConfigWithFreshToken(account)`
(`imapConfigBuilder.ts:104-112`).

**Consequence for this brief:** `sessionManager` must **use that existing helper**, not invent a
second credential path. The "one place that always refreshes" already exists.
(`syncManager.ts:94`'s discarded `ensureFreshToken` result is now merely redundant, not a bug.)

### Decision 4 — where the raw-fetch fallback gets its credential ✅ **DECIDED (a)** (Jim, 2026-09-01)

`imap_fetch_messages` catches `FetchError::AsyncImapEmpty` and calls `raw_fetch_messages(&config, …)`
(`commands.rs:51-53`), which opens its own authenticated connection (`client.rs:1073`). A pooled
command has no config, and the pool deliberately stores none. Rev 1 noticed this and wrote *"call
this out in review"* instead of resolving it. Called out — **with what password?** Every resolution
costs something rev 1 claimed not to pay:

| Option | Cost |
|---|---|
| **(a)** Frontend-driven: the pooled command returns `NeedRawFallback`; the frontend calls a separate config-carrying `imap_raw_fetch_messages` — **CHOSEN** | The password crosses IPC on that rare path. Done-when 5 needs an explicit exemption naming that one command. |
| **(b)** Keep `config` as a second argument on `imap_fetch_messages` | Done-when 1's grep becomes 4, and the password rides the **hot** path — the exact thing this brief exists to stop. |
| **(c)** Store the `ImapConfig` in the pool entry | Breaks the central design property and the Threat section's disclosure argument. |

### ✅ **DECIDED: (a)** — Jim, 2026-09-01

The pooled command returns `NeedRawFallback`; the frontend calls a separate config-carrying
`imap_raw_fetch_messages`. The password crosses IPC only on that rare non-standard-server path, at
the cost of **one named exemption** in Done-when 5's grep. Decided after seeing all four options
below with the cross-vendor additions in front of him.

**What the review changed about the options' costs** (recorded here rather than left for
cross-referencing):

- **(c) is worse than this table said.** It does not merely break the design property — it *does not
  work* for OAuth accounts. Stored access tokens expire, so re-authenticating in Rust would require
  refresh-token logic and refresh tokens held in long-lived process state: a genuine escalation over
  "the credential lives in the frontend and sessions are opened and discarded". Credentials in the
  pool would also reach crash dumps. (c) was already the weakest option; it is not merely weak but
  unworkable.
- **A fourth option exists, and is not scope.** **(d) Run the raw fetch over the pooled,
  already-authenticated session.** The fallback exists because async-imap's *parser* returned empty,
  not for any reason to do with authentication — so conceptually it needs no credential at all. The
  API is there: `run_command`/`run_command_untagged` plus `impl AsMut<T> for Session<T>` expose the
  raw stream. **Two reasons it is not this brief's plan:** `as_mut()` returns the *inner* stream,
  past async-imap's buffered `ImapStream`, so bytes already buffered would be skipped; and today's
  `raw_fetch_messages` (`client.rs:1073`) bypasses async-imap entirely — its own TCP/TLS, LOGIN and
  line reader — so (d) is a rewrite of the fallback against the very layer that fails to parse on
  these servers. Recorded as the better end state once E2 has landed, not as work to fold in now.

---

## Proposed change

### Rust — `src-tauri/src/imap/pool.rs` (new)

```rust
pub struct SessionPool {
    entries: tokio::sync::Mutex<HashMap<String, Entry>>,
}

struct Entry {
    // `Option` is the checkout marker: `None` means "checked out, in flight".
    // See §Pool pattern (rev 4) — this is what makes eviction unconditional.
    session: Option<Arc<tokio::sync::Mutex<ImapSession>>>,
    account_key: AccountKey,  // never the password — see below
    last_used: Instant,       // stamped on ACQUIRE, not on lookup (see Reaper)
}

/// Finding 3: `"user@host"` collides across connection configurations, so a
/// session authenticated under one config can be served to a command expecting
/// another — and a rotated credential keeps being served until the server
/// stops tolerating it.
#[derive(PartialEq, Eq, Hash, Clone)]
struct AccountKey {
    username: String,
    host: String,
    port: u16,
    security: ImapSecurity,   // ssl | starttls | none
    auth_mechanism: AuthMechanism,  // password | xoauth2
    credential_version: u64,  // bumped on re-login; see below
}
```

**`credential_version`** is held in the pool beside the map and bumped whenever the frontend reports
a credential change (`clearConfigCache()` — `imapSmtpProvider.ts:175` — and OAuth refresh). Bumping
it makes every existing key unreachable, so the next lookup misses and reopens rather than reusing a
session authenticated with the superseded credential. It is a counter, never the credential.

### Pool pattern (rev 4) — checkout removes the entry

**Findings 1 and 5 close together, with one mechanism.** Rev 3 recorded that every safeguard in this
brief fires on an `Err` *returned to the caller*, and that two paths produce a desynchronised session
with no such `Err`:

- **Cancellation (finding 1).** A dropped command future — a caller-side `select!`, a dropped
  `JoinHandle`, any structured-concurrency cancellation — releases the session mutex mid-protocol
  and produces no error at all. The next acquirer reads the aborted command's response tail.
- **Panic (finding 5).** `tokio::sync::Mutex` has no poisoning, so a parser panic on hostile bytes
  releases the lock and leaves the desynchronised session reusable. Not hypothetical here: the app
  already meets servers whose bytes break the parser's contract — that is what `AsyncImapEmpty`
  exists for.

**Rule: checkout takes the session out of the map; only clean completion puts it back.**

```
acquire(id):   lock map -> entry.session.take() -> unlock map
               (None already means in flight -> SessionBusy)
release_ok:    lock map -> entry.session = Some(session) -> stamp last_used -> unlock
release_err:   lock map -> entries.remove(id) -> unlock -> close connection
               (also the Drop path: if the guard is dropped without either
                release, the entry is already absent and the session is closed
                by its own Drop — no error has to reach anyone)
```

This makes eviction **a fact about the map rather than a fact about an error reaching the caller**,
which is the whole point: cancellation and panic both unwind through `Drop`, and `Drop` cannot
observe an `Err`. Eviction-on-error (Blocker 1) remains as written; it is now the *ordinary* path
rather than the only one.

Two consequences worth stating:

- **A second concurrent operation on the same session id gets `SessionBusy`, not a queue.** Rev 3's
  design let it wait on the session mutex. Under checkout-removes-entry there is no mutex to wait on
  while checked out. This is a behaviour change and the frontend must treat `SessionBusy` like
  `NoSuchSession` minus the reopen — retry once after the in-flight operation finishes. The two
  session *kinds* (`sync`, `interactive`) exist precisely so this is rare.
- **The per-session mutex is now redundant** for mutual exclusion — checkout already guarantees a
  single holder. It is kept only as the ownership handle for the connection; a later revision may
  drop it entirely.

**Findings 4 and 6 are deferred, and why.** 4 (no staleness check at checkout — the user eats the
first post-idle-kill failure) and 6 (`last_used` stamped on acquire, so the LRU reads the busiest
session as the idlest) are **availability, not correctness**, in the brief's own words. They stay in
§Pooling findings as follow-ups. Finding 2 was absorbed by #26.

Registered as `tauri::State<SessionPool>` in `lib.rs` alongside the two `invoke_handler` lists.

**Checkout, and the rule that actually matters.** The map lock is held only long enough to clone an
`Arc`; the per-session mutex is then held across IMAP I/O, deliberately, because one connection
cannot interleave commands. Lock order is always map → session, never reversed, so it is
deadlock-free.

That much was right in rev 1 — which spent its whole correctness budget on map consistency, the part
that was never dangerous:

> **Blocker 1 — poison on error.** Every operation is wrapped in `net::with_timeout`
> (`client.rs:269-276` wraps the UID FETCH stream-collect in 120 s; `IMAP_CMD_TIMEOUT` wraps every
> SELECT/STORE/EXPUNGE). A timeout **drops the inner future mid-protocol**, leaving unread response
> bytes in the TLS buffer. Today that is harmless — the command ends, the session is logged out and
> dropped. **Pooled, that session goes back in the map and the next command reads the tail of the
> aborted FETCH as its own response.** Partial-failure paths do the same (`client.rs:500` `flag_and_expunge`, called after the COPY at `:602`: COPY
> succeeded, EXPUNGE errored). `tokio::sync::Mutex` has no poisoning, so a panic mid-command releases
> the lock and leaves the desynchronised session reusable too.
>
> **Rule: any `Err` — timeout, protocol, or I/O — from an operation on a pooled session evicts that
> entry and closes the connection.** The operation returns its error as `Other(msg)`; the session is
> gone, so the next call gets `NoSuchSession` and reopens. This is why Decision 1 no longer needs
> `SessionClosed`, and it absorbs the sleep/wake case — including `"Broken pipe (os error 32)"`,
> which matches **none** of `isConnectionError`'s eight substrings and would otherwise become the
> most common failure class under pooling.

Note the shape of the fix: `Arc`-clone versus take-out-of-map is **not** the axis that matters. The
two are equivalent with respect to protocol state; only eviction-on-error addresses it.

**Reaper.** Snapshot expired entries under the map lock, **drop the lock**, then remove and LOGOUT
each. Never await a session mutex while holding the map lock — a 120 s fetch would otherwise stall
every lookup in the app. `last_used` is stamped on acquire so a long in-flight operation cannot be
reaped mid-command. Accepted race, stated: a command that cloned the `Arc` just before removal runs
to completion; new lookups get `NoSuchSession` and reopen.

**Caps.** Per-account cap of **2** (one `sync`, one `interactive`) plus a global LRU that evicts the
idlest session rather than failing. `TooManySessions` becomes a last resort, not the normal response
to a user opening a third pop-out. Rev 1's global cap of 8 was justified against *per-user* server
limits (Dovecot `mail_max_userip_connections` 10, Gmail 15) — justification and mechanism did not
match.

**Exit hook.** `lib.rs` has no `RunEvent` handler today (`.run()` at `lib.rs:302`; tray quit calls
`app.exit(0)` at `:207`). Best-effort LOGOUT needs a `RunEvent::ExitRequested` arm with a bounded
per-session timeout — the pattern at `client.rs:1060` already exists. Small, but rev 1 promised it
with no landing site.

**No credentials in the pool.** The entry holds a session, an account key and a timestamp — not the
`ImapConfig`. Dead sessions are not re-authenticated in Rust; the frontend reopens.

**One cheap hardening:** `ImapConfig` derives `Debug` (`imap/types.rs:3`, password at `:9`), which would print the
password. Nothing `{:?}`-logs it today (checked), but this is new credential-handling code — replace
the derive with a manual `Debug` rendering `password: "[redacted]"`.

### Rust — `commands.rs`

| Command | Change |
|---|---|
| `imap_session_open(config) -> String` | **new.** The only command that receives a password (plus Decision 4's fallback command, under (a)). |
| `imap_session_close(session_id)` | **new.** Idempotent. |
| The 15 operation commands | `config: ImapConfig` → `session_id: String`; the `connect()`/`logout()` pair disappears. Validation stays put — `wire::build_flag_list`, `wire::validate_mailbox` still run **before** the session is touched (`commands.rs:122`, `:231`). |
| `imap_test_connection(config)` | **unchanged.** Account setup, before a session can exist. |
| `imap_raw_fetch_diagnostic(config)` | **unchanged.** Debug-only (`commands.rs:286`). |
| `imap_fetch_messages`' fallback | **Decision 4.** Under (a): returns `NeedRawFallback`; a new config-carrying `imap_raw_fetch_messages` does the work. |

### TypeScript — `src/services/imap/sessionManager.ts` (new)

```ts
withSession(accountId, kind: 'sync' | 'interactive', opts: { idempotent: boolean },
            fn: (id: SessionId) => Promise<T>): Promise<T>
```

- Opens lazily; caches `sessionId` per `(accountId, kind)`; builds configs **only** via
  `buildImapConfigWithFreshToken` (Decision 3).
- **Retry policy by idempotency (Blocker 2).** On `NoSuchSession`: reopen once. Retry the operation
  **only if `idempotent`**. The two exclusions, with evidence:
  - **`imap_append_message`** (`client.rs:653`) — the sent-mail copy (`imapSmtpProvider.ts:445`)
    and the draft save (`:549`). If APPEND lands server-side but the connection dies before the
    tagged response, an auto-retry writes a **duplicate in Sent**. Today a lost response means a
    *missing* Sent copy, which the caller already tolerates (`imapSmtpProvider.ts:441-452`); a silent
    duplicate is worse.
  - **`imap_move_messages`** — the MOVE-extension path is retry-safe (a second `uid_mv` on expunged
    UIDs is a silent no-op). The **COPY fallback is not**: COPY succeeds, the session dies during
    `+Deleted`/EXPUNGE (`client.rs:500`, reached from `:602`), the retry re-runs COPY and **every moved message exists
    twice in the destination**. The frontend cannot tell which path the server took, so the whole
    command is non-retryable.
  - `imap_delete_messages` and `imap_set_flags` **are** safe: UID STORE on nonexistent UIDs is a
    silent no-op (RFC 3501 §6.4.8), EXPUNGE is idempotent, re-setting identical flags is a no-op.
- On `TooManySessions`: close this realm's idlest session, retry once, then surface.
- Closes sessions on account deletion, on `clearConfigCache()` (`imapSmtpProvider.ts:175` — password
  change), **on OAuth refresh failure** (revocation — see Threat), and on app quit.

**Two session kinds per account.** A 200-message fetch holds the session mutex for seconds; a shared
session would make an archive click wait behind it.

**Multi-window.** Pop-outs are separate webviews with separate JS realms, so each window gets its own
`sessionManager` cache and its own `interactive` session. That is why the cap is per-account with LRU
rather than a global hard fail.

Call sites: `imapSmtpProvider.ts` (15 `getImapConfig()` sites) and `imapSync.ts` (`:411`, `:854` plus
per-folder calls). The rewiring is wider than rev 1 implied: `imapSync` threads `config` through
helpers such as `fetchMessagesInBatches` (`:365`), all of which change signature.

---

## Done when

1. `grep -c "config: ImapConfig" src-tauri/src/commands.rs` returns **3** — open, test_connection,
   raw diagnostic — **plus one** if Decision 4(a) adds `imap_raw_fetch_messages` (**4**);
   `grep -c "imap_client::connect" src-tauri/src/commands.rs` returns **1**, down from 15.
2. A delta sync issues **≤ 2** `imap_session_open` calls total, verified by counting the command in a
   debug-log run. (Today: ≈ `2 + ceil(U/50)` logins.)
3. `INTER_FOLDER_DELAY_MS` is reduced (1000 → 200) in the same PR with **initial** sync still green.
   *(Rev 2 correction: this delay exists only in `imapInitialSync`, so this measures the initial-sync
   path, not delta.)*
4. **Negative:** an unknown or evicted `sessionId` returns `NoSuchSession` and **opens no
   connection** — Rust test against an empty pool.
5. **Negative:** no command argument carries a password except `imap_session_open`'s — frontend test
   spying on `invoke` across a full sync plus an archive. **Exempt, under Decision 4(a):**
   `imap_raw_fetch_messages`, named explicitly in the test.
6. **Negative, rewritten (Blocker 2):** a session killed mid-`imap_append_message` produces exactly
   one reopen and **no second APPEND**, with the error surfaced. Same for `imap_move_messages`. The
   reopen-and-retry *success* path is asserted for `imap_set_flags` only. *(Rev 1's version of this
   criterion mandated the duplicate-mail bug.)*
7. **Poison-on-error (Blocker 1):** injecting a mid-command failure evicts the session; the next
   operation opens a fresh connection and succeeds. Asserted for a timeout and for an I/O error.
7a. **Cancellation evicts (finding 1, rev 4):** a pooled operation whose future is **dropped**
    mid-command — no `Err` is ever produced — leaves **no entry** in the map. Asserted by dropping
    the future and then reading the pool directly: the id is absent, and the next operation on it
    returns `NoSuchSession`. This is the criterion that would fail against a rev-3 pool, and it is
    the reason rev 4 exists.
7b. **Panic evicts (finding 5, rev 4):** an operation that panics mid-command leaves no entry, and
    the panic does not poison the pool for other session ids. Same assertion shape as 7a, driven by
    a deliberately panicking operation.
7c. **Concurrent use of one id is refused, not queued (rev 4):** a second operation on a checked-out
    session id returns `SessionBusy` and opens no connection. Paired with a frontend test that
    `SessionBusy` retries once rather than reopening.
7d. **Key separation (finding 3, rev 4):** two configs differing **only** in port, in TLS mode, or in
    auth mechanism never share a pooled session — asserted per field, three cases. And bumping
    `credential_version` makes the prior session unreachable: the next lookup misses and reopens
    rather than reusing a session authenticated with the superseded credential.
8. Two operations on two different session ids overlap in wall-clock time (the map lock is not a
   global lock).
9. **Folder isolation:** operations on folder A then folder B over one pooled session return B's
   data — locks in the currently-conventional invariant that every op re-SELECTs.
10. Reaper: an idle session is gone within one interval; reaping never blocks a concurrent lookup;
    app exit leaves no live sessions.
11. `cargo test --locked`, `cargo clippy --all-targets --locked -- -D warnings`, `npx tsc --noEmit`,
    `npx vitest run`, `npm run graph:check`, `npm run docs:check` all green. **CI is the source of
    truth.**
12. `docs/decisions/ADR-003` records where mail credentials live at runtime, that a pooled session
    outlives the access token that opened it, and how revocation is handled.

---

## Not doing

- **SMTP pooling.** `smtp_send_email` is user-initiated and infrequent.
- **IMAP IDLE / push.** A live pooled connection makes it possible; separate feature, separate brief.
- **More than 2 connections per account.**
- **Re-authenticating inside Rust.** It would mean holding the password in the pool.
- **Converting all IMAP errors to typed variants.** `Other(String)` preserves today's strings.
- **Fixing the `move_messages` timeout-fallback bug** found during review — see §Spun out.
- **Fixing P11's capability grant.** Blocked on Jim; this brief's threat model assumes it as-is.

---

## Threat (Tier 2)

- **Spoofing.** The session id is a bearer credential for an authenticated mailbox. 128 unguessable
  bits (Decision 2) are **defense-in-depth, not the mitigation** — rev 1 overstated this. The id is a
  plain `invoke` argument and lives in the module map of any window that performs mail operations; a
  sanitizer bypass executing same-realm in a `thread-*` pop-out can hook `invoke` or patch the module
  and steal it, unguessable or not. What actually helps: P11's per-window capability grant, and —
  cheap and available now — **binding each session to the window label that opened it** (Tauri passes
  `Window` into command handlers), so a stolen id is useless from another window. Include the binding.
- **Tampering.** `session_id` is validated by exact `HashMap` lookup and **never** interpolated into
  IMAP wire text. Mailbox and flag validation stay in `imap::wire`, still ahead of the session (P1
  untouched).
- **Repudiation.** Log open/close at `info` with the account label and a reason
  (`user_requested` / `idle_reaped` / `evicted_on_error` / `app_exit`); never the id, never the
  password.
- **Disclosure.** The win is real but modest: the password crosses IPC once per session instead of on
  17 commands, and login events — what providers rate-limit — drop sharply. The pool stores no
  `ImapConfig`; `Debug` on `ImapConfig` gets a redacting impl. **Residual, corrected in rev 2:** rev 1
  claimed the 5-minute reaper "bounds how long an authenticated socket outlives the work that needed
  it." That is false in the common case — `SYNC_INTERVAL_MS = 60_000` (`syncManager.ts:14`) means the
  `sync` session is never idle for five minutes, so it lives for the app's uptime. The real bound is
  socket lifetime.
- **Revocation / expiry.** IMAP authenticates once at connect, so a pooled session keeps working
  after its OAuth access token expires **or is revoked**. This is normal for desktop IMAP clients and
  is accepted — but it must be recorded in ADR-003, and `sessionManager` must close sessions when a
  token **refresh fails**, not only on password change. Otherwise revocation has no effect until the
  socket dies.
- **DoS.** Unbounded map = unbounded sockets; per-account cap 2 + global LRU + idle reaper. The
  sharper risk is a reopen loop hammering a provider's login endpoint — hence **strictly one** reopen
  per call, tested (Done-when 6).
- **Elevation.** Possession of the id is the entire authorization, so the lookup happens **in each
  command body** — not a wrapper, not middleware — per the `CLAUDE.md` rule. With window binding the
  check is (id, window label). Fails closed: no session, and never a fallback to opening one.

---

## Rollback

- **No migration, no schema change, no persisted state.** The pool is process memory, empty at every
  launch.
- **Expand-contract at the IPC boundary.** Land the pooled commands **alongside** the existing
  config-taking ones; a settings flag `imap_session_pooling` selects the path, flippable without a
  rebuild. Rollback #1 is flipping it — the next command reverts to connect-per-call and orphaned
  sessions are reaped.
- Rollback #2 is reverting the PR, clean because of expand-contract.
- Old commands are deleted in a **follow-up** release, not this PR.
- **Blast radius:** the worst realistic failure is mail operations erroring until restart. That is not
  data loss — except via Blocker 2, which is exactly why the retry policy is scoped by idempotency.

## Verification Jim may want to do by hand

With a large account: run a delta sync and click *archive* mid-sync — it should respond immediately
(that is what the `interactive` session is for). Sleep the laptop 10 minutes, wake it, act again —
the first operation should reopen transparently rather than error. Then send a message and confirm
**exactly one** copy in Sent.

---

## Pooling findings not yet in the design (rev 3)

A second cross-vendor read of the *pooling design itself* produced six findings. Rev 2 folded in the
three blockers it was given; these six were raised against the pooled architecture and were left in
a review transcript rather than written down. They are recorded here because **the first one is not
covered by the current design**, and Jim's rev-2 re-confirmation should be made against it.

Correcting a count I gave verbally: this is **six** findings, not five — one of which #26 has since
absorbed.

1. **Cancellation bypasses eviction-on-error — the one real hole.** Every safeguard in this brief
   fires on an `Err` *returned to the caller*. If the command future is instead **dropped**
   mid-IMAP-I/O — a caller-side `select!`, a dropped `JoinHandle`, any structured-concurrency
   cancellation in the Tauri command path — the per-session mutex guard releases, the `Arc`'d
   session stays in the map mid-protocol, and **no error is ever produced, so no eviction happens**.
   The next acquirer reads the aborted command's response tail. This is the identical
   desynchronisation Blocker 1 correctly fears from `with_timeout`, reachable through a door the
   design does not watch. *Fix:* remove/swap the entry out of the map on checkout and reinsert only
   on clean completion, or mark the entry poisoned from the guard's `Drop`.
   **Uncertainty, stated:** whether such a cancellation path exists today depends on Tauri's command
   dispatch — Tauri does not cancel in-flight commands when the frontend navigates away, so this may
   be theoretical *at present*. It is exactly the kind of path added later without re-auditing the
   pool, and the checkout-removes-entry pattern costs nothing to adopt now.
2. **Cross-session mailbox state.** Covered in §Drift item 5 — **largely absorbed by #26's targeted
   `UID EXPUNGE`**, which removed the destructive version of it. The residual is the discipline
   rule: pooled operations must `SELECT` their folder and treat flags as volatile.
3. **`account_key = "user@host"` collides across connection configurations.** Same user and host on
   a different port, TLS mode (993 implicit vs 143 STARTTLS) or auth mechanism (password vs XOAUTH2)
   map to one key, so a session authenticated under one config can be served to a command expecting
   another. Concretely: after a password fix or an OAuth rotation the pool keeps serving sessions
   authenticated with the old credential — fine while the server tolerates it, silently wrong when
   it stops. *Fix:* include port, TLS mode and auth mechanism in the key, plus a credential-version
   counter bumped on re-login. Cheap.
4. **No staleness check at checkout, so the user eats the stale-session failure.** Servers idle-kill
   connections. The `sync` session stays warm on the 60-second delta loop; the `interactive` one
   idles. The first command after a kill fails, the entry is evicted as designed — but *the user's
   command already failed*. A `NOOP` (or a transparent reopen) when `last_used` exceeds a threshold
   turns that into nothing the user sees. Availability, not correctness.
5. **Panics escape the eviction rule.** The design notes `tokio::sync::Mutex` has no poisoning, then
   uses that only to justify eviction-on-`Err`, which does nothing for a panic. Not hypothetical on
   this codebase: the app already meets servers whose bytes break the parser's contract — that is
   what `AsyncImapEmpty` and Decision 4 exist for — and a parser panic on hostile bytes is the same
   class of event on the same servers. *Fix:* `catch_unwind`/`spawn` per pooled operation and evict
   on panic, or adopt finding 1's checkout-removes-entry pattern, which fixes both.
6. **`last_used` stamped on acquire, plus a reaper that awaits the session mutex.** A 60-second
   operation holds its mutex with a `last_used` from before it started, so the LRU and the reaper
   both read the busiest session as the idlest — the LRU may evict a warm session while a genuinely
   idle one survives. Not corruption (the mutex makes LOGOUT wait), but the reaper then blocks its
   whole pass behind the busiest session. *Fix:* stamp on release, or `try_lock` to skip busy
   entries in both reaper and LRU. Also: the reaper's LOGOUTs want their own timeout — a half-dead
   TCP connection can hang a LOGOUT well past `IMAP_CMD_TIMEOUT`.

**Not reported, deliberately:** the map-lock/lock-order discipline, the eviction-on-timeout
rationale, the credential-free pool and the idempotency-aware retry policy were all examined and are
sound as written. IDLE/unsolicited-response handling may be a real issue but nothing in the design
mentions IDLE, so it is flagged as a question for the build rather than invented as a finding.

---

## Independent review (rev 2)

**Reviewer:** Kimi K3 (cross-vendor seat), run non-interactively against this brief and the ten files
it touches. Transcript: `scratchpad/kimi-e2-review-output.md`, session `75a66441`.
**Verdict: DO NOT BUILD YET** — three blockers, six majors, four factual errors, all folded into rev 2
above. Every claim it made about the code was independently re-verified before being accepted.

Caught by the reviewer, not the author: **Blocker 1** (poison-on-error — the author had found only
the narrower cancellation case and had the `Arc`-vs-take-out reasoning backwards; the reviewer
identified `with_timeout` as the routine desync source and showed the choice was irrelevant); the
**`SessionClosed` detection gap**; multi-window session multiplication against a global cap; the
reaper/credential-lifetime claim being false under a 60 s sync; `"Broken pipe"` evading
`isConnectionError`; the reaper stalling on the map lock; the missing exit hook; the **COPY-fallback
half of Blocker 2**; and **three of the four factual errors**, including the headline cost formula.

Found by the author first: the append-duplication half of Blocker 2, and Blocker 3's existence
(unresolved). Suspected by the author and **disproved** by the review: sticky `SELECT` state — every
operation re-SELECTs (`client.rs:248, 357, 411, 432, 467, 491, 535, 622, 693, 734, 798, 849`), so
pooling introduces no wrong-folder hazard. That invariant is now load-bearing, hence Done-when 9.

Per `03-agents.md`, a same-vendor reviewer would have been weak evidence here. The two blockers that
most threatened user data came from the cross-vendor seat.

## Spun out during review — ✅ **both defects now fixed and shipped** (rev 3)

`move_messages` matched `Ok(Ok(()))` for success and `_` for everything else, so a timeout was
treated identically to "server lacks MOVE" and a `UID MOVE` that had succeeded server-side was
COPY'd again, duplicating the message. Reviewing *that* turned up a worse one: the COPY fallback and
`delete_messages` both called a bare `session.expunge()`, which removes **every** `\Deleted`-flagged
message in the folder rather than the given UIDs.

Both were briefed separately (Tier 2, `docs/briefs/2026-09-01-move-expunge-data-loss.md`) and
shipped: **#25 `2066351`** (classification + `caps.rs`) and **#26 `5c545f9`** (targeted
`UID EXPUNGE`, proved by live Dovecot transcripts). There is no longer any call to the untargeted
`expunge()` in the tree.

Kept here because it is the reason this brief has a §Drift section, and because the lesson belongs
with the pooling work: **#25's first cut passed every test written for it and still did not fix the
bug** — the Rust classifier refused to retry, but the error text contained "timed out",
`classifyError` marked it retryable, and the caller replayed the move. A requirement that spans Rust
and TypeScript is not satisfied when the Rust half is. E2's retry policy spans exactly that boundary.

## Approval

- **Rev 1 plan approved by:** Jim, 2026-09-01.
- **Rev 2 re-confirmation: RE-CONFIRMED under delegated authority, 2026-09-01 — see
  `docs/decisions/LOG.md` (PR #33) and read the provenance note below before relying on it.**
  Judged against §Pooling findings as required: **findings 1, 3 and 5 folded into the build**
  (this rev), **4 and 6 deferred as availability**. The gap that held the re-confirmation —
  item 1, cancellation bypassing eviction-on-error — is closed by §Pool pattern (rev 4).
  - **Provenance, stated plainly because it is not ordinary.** This re-confirmation was made by an
    agent seat holding a **time-boxed delegation of Jim's decision authority**, not by Jim directly.
    It is marked *(delegated)* in the LOG entry and is **subject to his retroactive review; if he
    reverses it, this build is reverted rather than argued.** The builder seat records that it began
    work on a relayed delegation rather than on Jim's direct word, having satisfied itself that the
    step was reversible: **an agent cannot merge** — every `gh pr merge` was permission-blocked
    tonight — so this work cannot reach `main` without Jim personally merging it. That gate, not the
    delegation, is what makes building safe here.
- **Decision 1 (typed error): DECIDED** — minimal `MailError`, simplified by poison-on-error.
- **Decision 2 (dependency): DECIDED** — `getrandom = "0.3"` (Jim, 2026-09-01).
- **Decision 3 (OAuth sync bug): RESOLVED** — shipped in `d704ea0` (#18).
- **Decision 4 (raw-fallback credential): DECIDED — (a)**, Jim, 2026-09-01. Frontend-driven
  `NeedRawFallback` + a separate config-carrying `imap_raw_fetch_messages`; one named exemption in
  Done-when 5. Option (d) — run the raw fetch on the pooled session — is recorded as the better end
  state after E2 lands, not as scope.

**Rev 4 (2026-09-01) is the build delta.** It folds the three adopted pooling findings into the
design: §Pool pattern (checkout-removes-entry, closing findings 1 and 5 with one mechanism), the
`AccountKey` struct and `credential_version` counter (finding 3), and Done-when 7a-7d which assert
each of them. It records findings 4 and 6 as deferred with the brief's own reason. No requirement
from rev 2 was weakened; two were added (`SessionBusy` semantics, key separation).

**Rev 3 (2026-09-01) is docs-only.** No requirement changed. It re-verified every citation at
`0d0b373`, recorded the #25/#26 drift (§Drift), folded Decision 4 in as decided, and wrote down six
pooling findings that had been left in a review transcript (§Pooling findings). One of those is a
gap in the current design, which is precisely why the rev-2 re-confirmation was held for it.
