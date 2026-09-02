## Verdict

**CHANGES REQUESTED**

The TypeScript threading and IPC boundary validation are well-designed, but the change cannot be approved in its current state because the Rust implementation files (`src-tauri/src/db/mod.rs` and `src-tauri/src/db/tx.rs`) are missing from the diff, creating a compilation failure. Additionally, there is an unhandled deadlock condition for re-entrant transactions and a potential connection leak on failed commits.

---

## Numbered Findings

### 1. [HIGH] `src-tauri/src/lib.rs` / `src-tauri/src/db/tx.rs` — Missing Rust implementation files in diff
- **Concern:** The Rust module `mod db;`, the `TxManager` struct, and the five Tauri command handlers (`db_tx_begin`, `db_tx_execute`, `db_tx_select`, `db_tx_commit`, `db_tx_rollback`) are referenced in `src-tauri/src/lib.rs` but are not included in the diff.
- **Scenario:** Running `cargo check` or `cargo build` on this diff fails with `error[E0583]: file not found for module 'db'`.
- **Consequence:** The Rust backend will not compile, and the Rust-side connection pinning, watchdog reaping, and error handling cannot be executed or fully verified.
- **Fix:** Stage and commit `src-tauri/src/db/mod.rs` and `src-tauri/src/db/tx.rs`.

---

### 2. [HIGH] `src/services/db/connection.ts` (`withTransaction`) — Re-entrant / nested transaction causes unrecoverable JS deadlock
- **Concern:** `txQueue` serializes transactions by awaiting the previous promise (`await prev`). If a function inside `withTransaction` directly or indirectly invokes `withTransaction`, it will deadlock.
- **Scenario:** A caller executes `await withTransaction(async (tx) => { await someHelper(); })`, where `someHelper` internally calls `withTransaction`.
- **Consequence:** The inner `withTransaction` awaits `txQueue` (which is held by the outer transaction), and the outer transaction cannot complete until `someHelper` finishes. The entire application transaction queue hangs permanently.
- **Fix:** Guard against re-entrancy. Either maintain an execution context / active transaction flag and throw immediately if `withTransaction` is invoked while already in a transaction, or return the existing handle if re-entrancy is supported.

---

### 3. [MEDIUM] `src/services/db/connection.ts` (`withTransaction`) / `src-tauri/src/db/tx.rs` — Potential dirty connection return on `db_tx_commit` failure
- **Concern:** If `db_tx_commit` fails at the SQLite engine level (e.g., disk I/O failure, deferred foreign key violation, lock conflict), the transaction state on the connection may remain uncommitted when returned to the pool.
- **Scenario:** A transaction executes statements, then `db_tx_commit` is called. In Rust, if the transaction is removed from `TxManager` before `COMMIT` is executed and `COMMIT` fails, the subsequent `invoke("db_tx_rollback", { id })` in TypeScript's `catch` block will fail with `VELO_TX_UNKNOWN`. When `conn: PoolConnection<Sqlite>` drops without a successful `COMMIT` or `ROLLBACK`, sqlx returns the raw connection to the pool while still in an open SQLite transaction state.
- **Consequence:** Future queries drawn from the pool by non-transactional code (`getDb()`) receive a connection with an active transaction, causing `cannot start a transaction within a transaction` or reading dirty uncommitted state.
- **Fix:** In Rust, wrap the connection in `sqlx::Transaction` or an explicit RAII guard whose `Drop` implementation issues `ROLLBACK` on the underlying connection if it is dropped without a clean commit.

---

### 4. [MEDIUM] `src/services/db/connection.ts` (`withTransaction`) — Multi-window transactions fail fast with `VELO_TX_BUSY` instead of queuing
- **Concern:** `txQueue` is an in-memory JS promise queue private to each webview window. The threat model notes capability gating for `main` and `thread-*` windows.
- **Scenario:** A secondary window (e.g., `thread-*` popout) triggers a transaction (such as snoozing or moving a message) while the main window is performing an IMAP sync transaction. The secondary window's `txQueue` is idle, so it immediately calls `db_tx_begin`, hitting Rust's single-open-transaction rule.
- **Consequence:** The secondary window fails immediately with an unhandled `VELO_TX_BUSY` error rather than waiting for the main window's transaction to finish.
- **Fix:** Add a retry/backoff loop in `connection.ts` for `VELO_TX_BUSY` before rejecting, or ensure all database writes are routed exclusively through the main window.

---

### 5. [LOW] `src/services/snooze/snoozeSync.ts` (`clearSnoozeForNewExternalMessages`) — Incomplete verification of write path on `hasNewExternal`
- **Concern:** `clearSnoozeForNewExternalMessages` receives `executor?: DbExecutor` and passes it to `getExistingMessageIds(..., db)`, but the subsequent write operations when `hasNewExternal === true` are not visible in the diff hunk.
- **Scenario:** When an incoming message arrives for a snoozed thread and `hasNewExternal` is true, the snooze is cleared via a database update.
- **Consequence:** If the write statement inside `clearSnoozeForNewExternalMessages` uses `getDb()` directly instead of the local `db` executor, the write will escape the pinned transaction connection.
- **Fix:** Ensure all SQL statements executed within `clearSnoozeForNewExternalMessages` use `db.execute(...)`.

---

### 6. [NIT] `src/services/db/connection.ts` (`withTransaction`) — Discards callback return value
- **Concern:** `withTransaction` is typed as `(fn: (db: DbExecutor) => Promise<void>) => Promise<void>` and does not return the result of `await fn(handle)`.
- **Scenario:** A caller wants to return data created inside a transaction (e.g., an inserted row ID or calculated summary).
- **Consequence:** Callers are forced to use outer variable assignment closures rather than returning values directly.
- **Fix:** Update the signature to `export async function withTransaction<T>(fn: (db: DbExecutor) => Promise<T>): Promise<T>` and return `await fn(handle)`.

---

## Questions

1. **Rust Expired-ID Memory Bounding:** In `src-tauri/src/db/tx.rs`, how is the expired transaction ID set bounded (e.g., fixed-capacity LRU, ring buffer, or timestamp eviction) to prevent unbounded memory growth over long application uptimes?
2. **Watchdog Cancellation on App Exit:** Does `spawn_watchdog` abort cleanly when the Tauri app lifecycle shuts down, or does it hold any background resources?

---

## What Is Good

1. **Accurate Root-Cause Fix:** Pinning a single connection from `DbInstances` via Rust completely solves the connection pool interleaving defect (upstream #240) without needing a risky custom database abstraction.
2. **Clean TypeScript Helper Parameter Threading:** The trailing optional `db?: DbExecutor` pattern with default fallback (`executor ?? await getDb()`) maintains full backwards compatibility with existing standalone callers while allowing sync callbacks to thread `tx` down seamlessly.
3. **Robust IPC Boundary Validation:** `expectTxId`, `expectExecuteResult`, and `expectRows` in `connection.ts` enforce strict runtime type safety at the Tauri IPC boundary (ADR-000 compliance).
4. **Atomic Migrations:** Moving `runMigrations()` onto `withTransaction` ensures migration steps and `_migrations` table updates are strictly atomic per version while preserving duplicate-column tolerance.
5. **Opus HIGH 2 Proof:** The updated `moveHygiene.test.ts` explicitly verifies that `rekeyMovedMessages` executes all PRAGMAs, savepoints, and rewrites on the transaction handle without touching `getDb()`.

---

## Test Coverage Gaps

1. **Re-entrant Transaction Test:** A test in `connection.test.ts` asserting how the system behaves if `withTransaction` is invoked inside another `withTransaction` callback.
2. **Watchdog Expiration During Query Execution:** A test in `connection.test.ts` where `tx.execute` or `tx.select` receives `VELO_TX_EXPIRED` from Rust mid-transaction, verifying that the error is propagated and the subsequent rollback is silenced.
3. **Helper Fallback & Routing Unit Tests:** Dedicated unit tests for `upsertMessage`, `upsertThread`, `setThreadLabels`, and `snoozeSync` verifying that when `executor` is passed, `getDb()` is never invoked, and when omitted, `getDb()` is invoked.
4. **Chunked Helper Execution on Handle:** A test for `updateMessageThreadIds` and `getExistingMessageIds` with >500 IDs verifying that all chunk iterations execute on the provided `executor`.
5. **Multi-Window `VELO_TX_BUSY` Handling:** An integration test verifying behavior when a secondary window attempts a transaction while the main window is mid-transaction.
