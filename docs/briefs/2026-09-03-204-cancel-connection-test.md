# SPEC-204 — Cancel an in-flight connection test

- **Task:** Let the user cancel the add-account connection test (IMAP and SMTP) and have the
  Rust side actually stop the attempt, instead of the form sitting on "Testing..." for up to
  a minute and a half per server.
- **Tier:** **2** — new `#[tauri::command]`s on the Rust IMAP/SMTP client path (a named Tier-2
  area in `CLAUDE.md`), a new managed state, and the add-account form that carries
  credentials. Plan, threat pass and rollback in the PR before code; two review legs.
- **Base:** `main` @ the #233 merge (code pin advances with it). Citations grepped at `b1604d5`.
- **Status:** draft — branch `f204-cancel-connection-test` after #233 lands.
- **Source:** upstream avihaymenahem/velo#204 ("imap smtp account", goneo.de). Three
  complaints in one issue: `AUTHENTICATIONFAILED` that passed on the second try
  (provider-specific, not reproducible here), "database is locked" after the first sync
  (**closed by #240**, `b95468e`), and *"the testing loading validate a very long time, and i
  cannot break the progress"* — the residual the fork's 2026-09-01 triage kept: P3, S, Tier 1
  in the ledger, **raised to Tier 2 here because the fix reaches the Rust client**. Bug-fix
  queue item 12.
- **Effort:** S · ½ day.

## Outcome

While a connection test runs, the form shows a Cancel button. Pressing it returns both rows
to their idle state at once, the Rust attempt is aborted (socket dropped), and a result that
arrives late from an earlier attempt is ignored. Nothing else about the test changes: a
successful test still reads "Connected successfully. Found N folder(s)."

## What exists, verified in the fork

1. **The test cannot be interrupted, and it can take long.** `AddImapAccount.tsx:300-357`
   `testImapConnection`/`testSmtpConnection` `await invoke(...)` directly (the form bypasses
   `tauriCommands.ts`'s wrappers) and only set state on return; `testBothConnections`
   (`:354`) runs both under `Promise.all`. The test-step button is disabled while
   `state === "testing"` (`:908-916`) and the only Cancel on the page closes the whole modal
   (`:962-966`). On the Rust side `imap_test_connection` (`commands.rs:16`) →
   `client::test_connection` (`client.rs:1175`) → `connect` under a 60 s overall timeout
   (`OVERALL_CONNECT_TIMEOUT`, `:74`; TCP 30 s, TLS 30 s, auth 30 s inside it) then `LIST`
   under 30 s and a logout under 30 s: a silent or firewalled host holds the form for up to
   ~90 s. SMTP (`smtp/client.rs:290`) uses lettre's transport test with its default timeout.
2. **An IPC call cannot be cancelled from the webview.** Dropping the promise does nothing
   to the Rust future (SPEC-209 recorded the same for `ai_fetch`). Cancellation has to be a
   second command that aborts the first's task.
3. **Managed state is the pattern:** `lib.rs:200-201` registers `ImapPool` and `TxManager`
   with `.manage(...)`; commands take `tauri::State<'_, T>`. `tokio::spawn` is already used
   (`oauth.rs:281`); tokio has `rt` and `macros`.
4. **No component test exists for `AddImapAccount`** (only `AccountSwitcher` and
   `SetupClientId` under `components/accounts/`).

## Requirements

- **REQ-1** As a user I want to stop a test that is taking too long.
  - REQ-1.1 WHEN a test is running THE SYSTEM SHALL show a Cancel button beside "Testing...".
  - REQ-1.2 WHEN Cancel is pressed THE SYSTEM SHALL set both rows to idle immediately and
    SHALL invoke `connection_test_cancel` for every in-flight test of that run.
  - REQ-1.3 WHEN a result arrives for a run that is no longer current (cancelled or
    superseded by a re-test) THE SYSTEM SHALL ignore it.
- **REQ-2** As the machine's owner I want a cancelled attempt to actually stop.
  - REQ-2.1 `imap_test_connection` and `smtp_test_connection` SHALL accept an optional
    `testId`; when present the work runs as an abortable task registered under that id and
    is removed from the registry when it finishes, however it finishes.
  - REQ-2.2 `connection_test_cancel(testId)` SHALL abort the registered task and return
    `true`; for an unknown or already-finished id it SHALL return `false` and do nothing.
  - REQ-2.3 A cancelled test SHALL reject with the message `cancelled` within a second,
    not after its timeouts — proven against a socket that accepts and never answers.
  - REQ-2.4 A call without `testId` SHALL behave exactly as today (other callers, if any).
- **REQ-3** Credentials: the cancel command carries only the id; the registry holds only
  abort handles — never a config, host or password.

## Not doing

- The goneo `AUTHENTICATIONFAILED` on the first attempt — provider-specific, not
  reproducible; the reporter's second attempt passed.
- "database is locked" — #240.
- Cancelling other long IMAP operations (sync, fetch); this is the add-account test only.
- A component test that mounts the whole modal; the run/cancel logic is extracted to a
  small module and tested there (below).

## Design

- **Rust — `src-tauri/src/connection_tests.rs`** (new): `pub struct ConnectionTests {
  inner: Mutex<HashMap<u64, AbortHandle>> }` with `register(id, handle)`, `remove(id)`,
  `cancel(id) -> bool`; `pub async fn run_cancellable<T>(tests: &ConnectionTests, id:
  Option<u64>, work: impl Future<Output = Result<T, String>> + Send + 'static) -> Result<T,
  String>` — no id: await inline; id: `tokio::spawn`, register the `AbortHandle`, await the
  `JoinHandle`, map `is_cancelled()` to `Err("cancelled")` and a panic to its text, always
  `remove(id)` after. `#[tauri::command] connection_test_cancel(test_id: u64, tests:
  State<ConnectionTests>) -> bool`. `imap_test_connection`/`smtp_test_connection` gain
  `test_id: Option<u64>` and `tests: State<'_, ConnectionTests>` (Tauri fills a missing
  optional argument with `None`, so the wire shape is backward-compatible) and wrap their
  existing call in `run_cancellable`. Registered in both handler lists; `.manage(
  ConnectionTests::new())`.
- **TypeScript**
  - `tauriCommands.ts`: `imapTestConnection(config, testId?)`, `smtpTestConnection(config,
    testId?)`, `cancelConnectionTest(testId): Promise<boolean>`.
  - `src/components/accounts/connectionTestRun.ts` (new, pure): `createConnectionTestRun()`
    returns `{ start(imapConfig, smtpConfig, handlers), cancel() }`; each `start` mints two
    ids (random 53-bit integers from `crypto.getRandomValues`), bumps a generation, calls the
    two wrappers, and delivers results through `handlers` only while its generation is
    current; `cancel()` bumps the generation and invokes `cancelConnectionTest` for the ids
    still in flight.
  - `AddImapAccount.tsx`: the two test functions become one call to the run; a Cancel
    button while testing (REQ-1.1); the form's raw `invoke` calls go away.
- **Decision & alternatives** — (a) task abort in Rust with a registry, id minted by the
  caller (above). (b) UI-only cancel (drop the promise, ignore the late result): Tier 1, but
  the socket and the credential-carrying attempt keep running for up to 90 s — the very
  thing the reporter could not stop. (c) A `CancellationToken` threaded through `connect`:
  more invasive for the same result; abort at the task boundary drops every inner future.
  (a).
- **Data / schema** — none.
- **Failure modes** — a stale-id cancel is a no-op (`false`); a cancel racing completion
  loses harmlessly (the task is already gone); an aborted task drops its socket without
  LOGOUT — the same as a timeout today. If the registry leaked an entry, it would be one
  `AbortHandle` (a few bytes) per test; `remove` runs on every exit path.

## Tasks (risk-first)
- [ ] 1. Rust: registry unit tests (register/cancel true once/false after; remove) and the
  socket test — a `TcpListener` that accepts and never writes; `run_cancellable` over
  `imap_client::test_connection` with `security: "none"` pointed at it; cancel after 100 ms;
  `Err("cancelled")` well under a second. — REQ-2.1/2.2/2.3
- [ ] 2. Rust: the two commands take `test_id`; `connection_test_cancel`; registration. — REQ-2.4
- [ ] 3. TS: `connectionTestRun.test.ts` (invoke mocked): start invokes both tests with distinct
  ids; cancel invokes `connection_test_cancel` with both ids and stops delivery; a result for
  a superseded generation is ignored; a run that finished does not cancel anything. — REQ-1.2/1.3
- [ ] 4. Form wiring and the Cancel button. — REQ-1.1
- [ ] 5. LOG.md; vault row 12; `CLAUDE.md` command list; HANDOFF pin after merge.

## Done when
`cargo test --locked` and clippy green with the new module; `npm run test`, `tsc`,
`graph:check`, `docs:check` green; CI green on the merge commit. Manual, optional (needs the
running app): point the IMAP host at an unroutable address, press Test, press Cancel — both
rows go idle at once.

## Rollback
`git revert`; the optional `testId` disappears with the code, nothing persists.

## Threat pass (Tier 2)
- **Assets:** the credentials inside a test config; the machine's sockets.
- **Entry points:** the cancel command (any JavaScript in the webview can call it with any
  id); the two test commands (unchanged inputs plus an id).
- **What an attacker gains:** cancelling someone else's test — there is only one user and
  ids are per run; nothing is disclosed (`bool`). The registry never holds a config, so a
  cancel cannot read credentials. Aborting drops the socket mid-handshake; the server sees a
  disconnect, which is what a timeout produces today.
- **Mitigations:** ids are 53-bit random and the registry is keyed by them; abort handles
  only; the registry entry is removed on every exit path.
- **Residual:** none new.

## Review
Two legs on the PR: Gemini 3.7 via `agy`; Grok 4.6 via the `grok` CLI when its ~12 minutes
are affordable, else `gemini-3.8-flash-high` (Jim, 2026-09-02). Diffs from committed SHAs.

## Approval
Jim, 2026-09-03: *"#204 (cancel an in-flight connection test … Tier 2 if it reaches the Rust
IMAP/SMTP client: plan with threat pass and rollback before code)"*. The plan is this file,
committed before the code.
