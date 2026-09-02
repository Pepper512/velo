## Verdict

**CHANGES REQUESTED**

The core connection-pinning architecture, lifetime management via `detach()` + `close()`, and helper parameter threading are well-designed and solve upstream #240. However, a high-severity value-binding omission (`boolean` values are bound as JSON strings rather than SQLite integer/boolean values) will corrupt boolean column writes (such as `attachments.is_inline`), and idle watchdog tracking counts query execution time against the idle budget.

---

## Findings

### 1. [HIGH] Boolean parameters are omitted in `bind_all` and bind as JSON text
- **File & Function:** `src-tauri/src/db/tx.rs` — `bind_all`
- **Concern:** `bind_all` tests `is_null()`, `as_str()`, and `as_f64()`, but does not test `as_bool()`.
- **Exact Scenario:** Any query passing a boolean parameter across IPC (e.g. `upsertAttachment` passing `att.isInline` at `src/services/db/attachments.ts:27`) falls through to the `else { query.bind(value) }` fallback. With sqlx's `json` feature active, `serde_json::Value::Bool` is encoded as the JSON string `"true"` or `"false"`.
- **Consequence:** SQLite receives a `TEXT` value (`"true"` / `"false"`) instead of `INTEGER` (`1` / `0`). In SQLite, `"true" != 1`, so boolean equality filters fail and `decode()` fails when reading back into `try_decode::<bool>()`.
- **Fix:** Add `else if let Some(b) = value.as_bool() { query.bind(b) }` prior to the JSON fallback branch in `bind_all`.

---

### 2. [MEDIUM] Query execution time counts toward the 30 s idle watchdog timeout
- **File & Function:** `src-tauri/src/db/tx.rs` — `execute`, `select`
- **Concern:** `last_used` is updated in `check()` at the *start* of statement dispatch, but is not refreshed when `.execute().await` or `.fetch_all().await` completes.
- **Exact Scenario:** A heavy statement takes 25 s to execute on disk. It finishes and returns to TypeScript. TypeScript does 6 s of non-DB async work (e.g. IMAP fetch/parsing) before sending the next statement. Total idle time between queries was only 6 s, but `last_used.elapsed()` is 31 s. The watchdog wakes at T=30 s and reaps the transaction.
- **Consequence:** Active, non-stuck transactions running legitimate multi-second queries can be killed prematurely with `VELO_TX_EXPIRED`.
- **Fix:** In `execute` and `select`, update `tx.last_used = Instant::now()` immediately after the database query `.await` resolves before returning.

---

### 3. [MEDIUM] Spurious `console.warn` on rollback after failed commit
- **File & Function:** `src/services/db/connection.ts` — `withTransaction`; `src-tauri/src/db/tx.rs` — `finish`
- **Concern:** When `commit` fails in Rust, `finish` takes `tx` out of `inner.current` and calls `release()`, which closes and drops the connection on failure. When TypeScript catches the commit error and runs `invoke("db_tx_rollback", { id })`, `check()` finds no open transaction and returns `VELO_TX_UNKNOWN`.
- **Exact Scenario:** `invoke("db_tx_commit", { id })` throws (e.g., deferred constraint violation or disk I/O error). TypeScript enters `catch`, runs `invoke("db_tx_rollback", { id })`, which rejects with `VELO_TX_UNKNOWN`.
- **Consequence:** TypeScript logs a spurious warning (`[db] ROLLBACK failed after a transaction error: VELO_TX_UNKNOWN...`) even though the connection was already detached and closed cleanly by Rust.
- **Fix:** Either do not issue `db_tx_rollback` if the caught error originated from `db_tx_commit`, or add `TX_UNKNOWN` to the ignored error check alongside `TX_EXPIRED` in `withTransaction`.

---

### 4. [LOW] Strict type name matching in `decode` rejects standard SQLite column type aliases
- **File & Function:** `src-tauri/src/db/tx.rs` — `decode`
- **Concern:** `decode()` matches string equality on `v.type_info().name()` for a fixed list (`"TEXT"`, `"INTEGER"`, `"REAL"`, `"NUMERIC"`, `"BOOLEAN"`, `"BLOB"`, `"NULL"`) and errors on `other`.
- **Exact Scenario:** A query selects a column or expression declared with common SQL aliases (e.g., `INT`, `BIGINT`, `VARCHAR`, `FLOAT`, `DOUBLE`, `JSON`) or computed expressions where SQLite reports type names differently than the canonical forms.
- **Consequence:** The query returns `Err("Unsupported SQLite datatype in a transaction result: ...")` whereas `tauri-plugin-sql` would decode it.
- **Fix:** Broaden the match arms in `decode` to include common aliases (e.g. `"INT" | "BIGINT" | "TINYINT" | "INT2" | "INT8"` for integers, `"VARCHAR" | "CHAR" | "CLOB"` for text, `"DOUBLE" | "FLOAT"` for real).

---

### 5. [NIT] `Inner.expired` is never cleared and only retains the single most recent ID
- **File & Function:** `src-tauri/src/db/tx.rs` — `Inner`, `begin`
- **Concern:** `inner.expired` is set on reap, but is never cleared when a new transaction begins or commits.
- **Exact Scenario:** A reaped transaction ID remains in `inner.expired` indefinitely. If an invalid call with that old ID arrives hours later, it still reports `VELO_TX_EXPIRED` rather than `VELO_TX_UNKNOWN`.
- **Consequence:** Minor diagnostic ambiguity.
- **Fix:** Clear `inner.expired = None` inside `begin()`, or use a small bounded FIFO / TTL map for reaped IDs.

---

## Test Coverage Gaps

1. **Boolean parameter binding parity:**
   - *Scenario:* Call `TxManager::execute` with boolean values (`vec![json!(true), json!(false)]`) inserting into a table with boolean/integer columns, then select back with `WHERE col = 1` and verify roundtrip decoding.
2. **Watchdog active-query execution window:**
   - *Scenario:* Execute a statement whose execution duration spans across the watchdog interval (e.g. simulated via a busy loop or sleep), verify that the transaction is not reaped immediately upon completion while the client is still active.
3. **Multi-window retry limit exhaustion:**
   - *Scenario:* In TypeScript `connection.test.ts`, mock `db_tx_begin` to continuously reject with `VELO_TX_BUSY` beyond `BUSY_RETRY_LIMIT` (50 attempts) and assert that `withTransaction` properly propagates `VELO_TX_BUSY`.
4. **IMAP delta-sync and batch thread store handle propagation:**
   - *Scenario:* In `imapSync.test.ts`, write unit tests for the delta sync chunk store (`imapSync.ts:645`) and the initial sync thread batch store (`imapSync.ts:812`) asserting that `upsertThread`, `upsertMessage`, and `updateMessageThreadIds` receive and invoke the `DbExecutor` handle without calling `getDb()`.

---

## Questions

1. In `src/services/db/connection.ts`, `BUSY_RETRY_LIMIT = 50` with `BUSY_RETRY_DELAY_MS = 100` gives a 5-second timeout for pop-out windows waiting on the main window's sync transaction. Is 5 s sufficient if initial sync runs large batches, or should this match SQLite's 5 s `busy_timeout` plus jitter?

---

## What Is Good

1. **Connection cleanup on failure:** Using `tx.conn.detach()` and explicit `raw.close().await` inside `release()` prevents dirty or failed transactions from leaking back into the pool.
2. **Locking order & `BEGIN IMMEDIATE`:** Taking the write lock up front on a single dedicated connection eliminates the classic SQLite upgrade deadlock (`SQLITE_BUSY`).
3. **Clean helper threading:** The optional trailing `executor?: DbExecutor` with fallback `executor ?? (await getDb())` cleanly threads the handle through all 9 helper functions without breaking call sites outside transactions.
4. **IPC boundary validation:** Strict type assertions (`expectTxId`, `expectExecuteResult`, `expectRows`) in `connection.ts` satisfy boundary defense without trusting IPC payloads implicitly.
