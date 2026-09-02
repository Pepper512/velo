# SPEC-240 — SQLite transactions must run on one connection (draft, plan before code)

- **Task:** Make every `withTransaction` (and the migration runner) execute `BEGIN`, its
  statements, and `COMMIT`/`ROLLBACK` on **one** SQLite connection owned by Rust, instead of
  three-plus separate IPC calls that each borrow whatever connection the plugin's pool hands out.
- **Tier:** **2** — touches `services/db/migrations.ts` and the transaction path under
  `services/db/*` (both named Tier 2 in `CLAUDE.md`), adds Rust commands and capability entries,
  and — the reason this is a plan and not a PR — **needs a dependency decision** (§Decision). Plan
  approved before code; threat pass and rollback below; both cross-vendor legs.
- **Base:** `main` @ `e6f3eb9` (code pin `9bec56a`; will be re-pinned after #297 lands). Every
  citation below was grepped at that pin or in the vendored crate sources named.
- **Status:** **draft — awaiting Jim's approval and the `sqlx` dependency decision.** Nothing
  built.
- **Source:** upstream avihaymenahem/velo#240 (with #264 duplicate, #192/#186/#196 symptoms;
  the ledger says it closes #204 and re-tests #205 — re-verify those two before claiming them);
  the fork's 2026-09-01 triage ranked it **P0**; **Opus 5's HIGH 2 on #43**: F-5's identity re-key
  (`rekeyMovedMessages`, `db/messages.ts:216`) is a destructive multi-statement rewrite that
  depends on per-connection state (`PRAGMA defer_foreign_keys`, `SAVEPOINT`) — over an unpinned
  pool that guarantee is hollow. Bug-fix queue item 4, the biggest single fix (7 days in the
  effort model; this plan's own estimate is at the end).
- **Effort:** L · 3–4 build-days for the recommended option (Rust module + tests ≈ 1.5, TypeScript
  seam + helper threading ≈ 1, migrations + harness + live check ≈ 1). The model's 7 is the
  ceiling if the helper audit (§Task 0) turns up more call sites than counted here.

## Outcome

Initial and delta IMAP sync stop failing with `database is locked` / `cannot commit — no
transaction is active`, and every transaction in Velo — sync batches, snooze wake-ups, F-4
reconciliation, F-5's re-key, migrations — is actually atomic, because its statements can no
longer land on different connections.

## The defect, verified

1. **The plugin pools connections.** `tauri-plugin-sql` 2.4.1 opens the database with
   `Pool::connect(conn_url)` (`wrapper.rs:91`), i.e. sqlx's default pool: **`max_connections: 10`**
   (`sqlx-core-0.8.6/src/pool/options.rs:151`). Every `execute`/`select` IPC call does
   `pool.execute(query)` (`wrapper.rs:~165`) — *any* idle connection.
2. **Velo's transaction is three IPC calls.** `withTransaction` (`db/connection.ts:48-80`) sends
   `BEGIN TRANSACTION`, then whatever `fn` sends, then `COMMIT` — each a separate `db.execute`,
   each free to take a different pooled connection. It mostly works because, with no concurrent
   query, the pool holds one connection and keeps returning it; the moment a UI read runs during
   sync a second connection is opened and statements interleave across the two. That is the
   reporter's symptom and its real cause (the reporter's own diagnosis blames "queries outside
   the mutex", which is the trigger, not the mechanism).
3. **The reporter's fix is already the default.** sqlx's SQLite connection options set a
   **5 s `busy_timeout`** by default (`sqlx-sqlite-0.8.6/src/options/mod.rs:201`) and WAL journal
   mode (sqlx's documented default — verify in the same file before citing). Upstream PR #274
   drops transactions instead. Neither pins a connection; neither is the fix.
4. **The plugin cannot be configured around it.** `path_mapper` (`wrapper.rs:319`) appends the
   URL tail to the app-config path, so `sqlite:velo.db?…` options would become part of the file
   name; there is no pool-size knob. The plugin's `execute` is `pub(crate)`.
5. **What *is* public:** `DbInstances(pub RwLock<HashMap<String, DbPool>>)` is managed state
   (`lib.rs:44`) and `pub enum DbPool { Sqlite(Pool<Sqlite>), … }` (`wrapper.rs:25`, re-exported
   `lib.rs:27`). The app can reach the plugin's own pool and **`acquire()` a connection it then
   holds for the length of a transaction.** Holding it requires naming sqlx's types in our own
   state — hence the dependency question.
6. **Callbacks bypass the handle today.** Of the ten `withTransaction` callers, the three in
   `imapSync.ts` (`:268`, `:645`, `:812`) ignore the `db` argument and call helpers that call
   `getDb()` themselves — so even a pinned handle would not reach their statements without
   threading it through (§Task 0). The other seven (`reconcile.ts:118/192/321`,
   `reconcilePass.ts:403`, `messages.ts:216`, `snoozeManager.ts:60/98`) use the handle.
7. **Migrations** (`migrations.ts:969-990`) issue `BEGIN`/`COMMIT` the same three-call way.

## Requirements

- **REQ-1** As the app I want a transaction to be one unit of work on one connection.
  - REQ-1.1 WHEN `withTransaction(fn)` runs THE SYSTEM SHALL execute `BEGIN`, every statement
    `fn` issues through its handle, and the final `COMMIT` or `ROLLBACK` on the same SQLite
    connection.
  - REQ-1.2 WHEN `fn` throws THE SYSTEM SHALL roll back on that connection, release it, and
    rethrow.
  - REQ-1.3 WHEN a transaction has issued no statement for **30 s** THE SYSTEM SHALL roll it
    back and release the connection, and every later call with that transaction id SHALL fail
    with a named error (`VELO_TX_EXPIRED`) — a stuck callback must not hold the write lock
    forever.
  - REQ-1.4 WHEN a second `BEGIN` arrives while one transaction is open THE SYSTEM SHALL refuse
    it with a named error (`VELO_TX_BUSY`) rather than queue or deadlock; the TypeScript mutex
    keeps serialising callers as today, so the refusal is a backstop, not the scheduler.
  - REQ-1.5 THE SYSTEM SHALL open transactions with `BEGIN IMMEDIATE`, taking the write lock up
    front, so a transaction never has to upgrade a read lock mid-way (the classic SQLite BUSY
    deadlock) — the busy timeout then applies once, at the start.
- **REQ-2** As a user I want the UI to keep reading while sync writes.
  - REQ-2.1 THE SYSTEM SHALL keep every non-transactional `getDb().select/execute` on the plugin
    pool, untouched, so reads proceed under WAL while a transaction holds the writer.
- **REQ-3** Migrations use the same pinned mechanism.
  - REQ-3.1 WHEN a migration runs THE SYSTEM SHALL execute its statements and the `_migrations`
    insert inside one pinned transaction, with the existing duplicate-column tolerance kept.
- **REQ-4** Statements inside a transaction go through its handle.
  - REQ-4.1 THE SYSTEM SHALL route every statement the three `imapSync.ts` callbacks issue
    through the transaction handle (helper functions gain an optional `db` parameter that
    defaults to `getDb()` — the pattern `reconcile.ts` and `messages.ts` already use with
    `Pick<Database, "execute">`).
- **NFR-1** Value binding and row decoding through the new commands behave exactly like the
  plugin's (`wrapper.rs:145-160`: null → NULL, string → TEXT, **number → f64**, anything else →
  JSON), so no query changes meaning when it moves onto the handle. The number-as-f64 quirk is
  the plugin's; it is kept for parity and noted, not fixed here.
- **NFR-2** No change to the SQLite harness contract: `sqliteHarness.ts` tests keep mocking
  `withTransaction` with a real `BEGIN`/`COMMIT` on better-sqlite3.

## Not doing

- Replacing `tauri-plugin-sql` with an in-house sqlx wrapper. It would fix the same thing at ten
  times the blast radius (44 files call `getDb()`).
- WAL/`busy_timeout` pragmas — already the defaults (item 3).
- Upstream PR #274's approach (drop transactions).
- QRESYNC, connection pooling changes on the IMAP side — unrelated.

## Design

- **Rust — `src-tauri/src/db/tx.rs`, managed state `TxState { current: Mutex<Option<OpenTx>> }`**,
  `OpenTx { id: String, conn: PoolConnection<Sqlite>, last_used: Instant }`.
  - `db_tx_begin() -> String`: take the plugin's pool from `DbInstances` under the key the app
    loads (`"sqlite:velo.db"`), `acquire()`, run `BEGIN IMMEDIATE`, store, return a fresh UUID.
    Refuse with `VELO_TX_BUSY` if one is open (REQ-1.4).
  - `db_tx_execute(id, sql, values) -> (rows_affected, last_insert_rowid)` and
    `db_tx_select(id, sql, values) -> Vec<Map<String, Value>>`: check `id` against the open
    transaction, bind exactly as the plugin does (NFR-1), touch `last_used`.
  - `db_tx_commit(id)` / `db_tx_rollback(id)`: run it, drop the connection (returns to the pool).
  - **Watchdog**: a task spawned at setup checks every 5 s; an open transaction idle > 30 s is
    rolled back and dropped; its id is remembered as expired so the next call gets
    `VELO_TX_EXPIRED` (REQ-1.3). Idle, not total, so a long sync batch that keeps issuing
    statements is never cut.
  - Every `#[tauri::command]` validates its input: `id` is compared for equality only; `sql` is a
    string our own TypeScript wrote (the commands are capability-gated to the app's windows and
    reachable only from the webview); parameters are bound, never interpolated.
  - Five commands added to `src-tauri/capabilities/default.json` (Tier 2 file — listed in the
    PR's diff summary explicitly).
- **TypeScript — `db/connection.ts`**: `withTransaction(fn)` keeps its mutex; inside, `begin` →
  build a handle `{ execute, select }` whose methods `invoke` the tx commands with the id →
  `fn(handle)` → `commit`, or `rollback` + rethrow. The handle type is the existing
  `Pick<Database, "execute" | "select">` shape callers already accept. `invoke()` results are
  validated at the boundary (the row arrays, the affected-row tuple) as `tauriCommands.ts` does
  for IMAP. `migrations.ts` uses the same `withTransaction`.
- **Decision & alternatives.**
  - **(A) Hold a pinned connection from the plugin's own pool — recommended.** Smallest change
    that actually fixes the mechanism; the plugin keeps owning the file, the pool and the
    non-transactional path. **Cost: `sqlx` becomes a direct dependency** (`sqlx = { version =
    "0.8", default-features = false, features = ["sqlite", "runtime-tokio"] }`) purely to name
    `PoolConnection<Sqlite>` in our state. It is already compiled into the app via the plugin at
    0.8.6, so no new code enters the build graph and the lockfile does not change; the version
    must track the plugin's (a `cargo tree -d` check in CI would catch a split). **Jim decides.**
  - (B) A second, app-owned `SqliteConnection` opened directly on the same file for transactions.
    Same dependency, plus a second writer handle to the same file and two sets of pragmas to keep
    aligned. No.
  - (C) Send a whole transaction as one batch command (`Vec<{sql, values}>`). No dependency
    question, but no reads inside a transaction — `rekeyMovedMessages`, `applySearchAll`,
    `finishReconcilePass` and the snooze wake-up all read mid-transaction. No.
  - (D) A pool of size one, via the plugin. Not configurable (item 4). No.
- **Data / schema** — none.
- **Failure modes** — the Rust side refuses rather than guesses: unknown id, second BEGIN, expired
  transaction all return named errors that `withTransaction` surfaces. A crash between `BEGIN`
  and `COMMIT` drops the connection, and SQLite rolls the journal back on the next open. If the
  watchdog fires under a legitimately slow statement (> 30 s on one statement), that transaction
  fails loudly and the sync retries next tick — recorded as the tunable.

## Tasks (risk-first)
- [ ] 0. **Audit:** list every helper the three `imapSync.ts` callbacks call, and every helper
  *they* call, down to `getDb()`; thread the optional `db` parameter (REQ-4.1). Sizes the PR.
- [ ] 1. Rust `tx.rs` with tests on an in-memory sqlx pool: begin/execute/commit visible to a
  second pool connection; rollback invisible; wrong id refused; second BEGIN refused; expiry
  after idle rolls back and the id is dead; binding parity with the plugin for null/string/
  number/object. — REQ-1.1–1.5, NFR-1
- [ ] 2. Capability entries; commands registered in both handler lists in `lib.rs`.
- [ ] 3. `withTransaction` on the handle; boundary validation of `invoke` results; tests with a
  mocked `invoke` proving the sequence begin → statements-with-id → commit, and rollback on
  throw. — REQ-1.1, 1.2
- [ ] 4. `migrations.ts` on `withTransaction`; harness run of all 27 migrations up, idempotent
  re-run. — REQ-3.1
- [ ] 5. The Opus HIGH 2 proof: a harness-level test that `rekeyMovedMessages`' `PRAGMA
  defer_foreign_keys` and `SAVEPOINT` are issued through the handle, never `getDb()`.
- [ ] 6. Manual: initial IMAP sync against the Dovecot harness with the UI open and a folder
  being browsed — no `database is locked`; note the run in the Dovecot README.
- [ ] 7. LOG.md, ROADMAP, vault row; close-out notes for #264/#204/#205 after re-verifying them.

## Done when
`cargo test --locked` and clippy clean with the tests above; vitest green; migrations run on a
fresh database and on an existing one; the manual sync in Task 6 recorded; CI green on the merge
commit; the dependency named and justified in the PR (need, blast radius, transitive cost = zero).

## Rollback
`git revert` of the squash commit restores the three-call transaction and removes the commands
and capability entries; no data or schema. A database left mid-transaction by a crash during
the new path recovers through SQLite's journal, same as today.

## Threat pass (Tier 2)
- **Assets:** the local mail database's integrity; the writer lock (availability).
- **Entry points:** five new Tauri commands, capability-gated to `main`/`thread-*`, callable only
  from Velo's own webview code; SQL text comes from Velo's TypeScript, parameters are bound.
- **What an attacker gains:** a page that could already execute JavaScript in the webview could
  already run arbitrary SQL through the plugin's own `execute` — the new commands add no
  capability beyond pinning. A stuck or hostile callback could hold the writer: bounded by the
  30 s idle watchdog (REQ-1.3).
- **Mitigations in this change:** id equality check, single open transaction, watchdog, no
  string interpolation, boundary validation of results, `BEGIN IMMEDIATE` so lock acquisition
  is explicit and time-bounded by the busy timeout.
- **Residual:** the number-as-f64 binding parity (NFR-1) is inherited, not introduced.

## Review
To be run on the PR: Gemini 3.7 via `agy` and Grok 4.6 via `grok` CLI (ADR-004), diffs only.
This plan itself gets an opposite-line read before code (as F-4's did) if Jim wants one.

## Approval
Blank — needs Jim: (1) the plan, (2) the `sqlx` direct dependency (option A), (3) the 30 s idle
watchdog value.
