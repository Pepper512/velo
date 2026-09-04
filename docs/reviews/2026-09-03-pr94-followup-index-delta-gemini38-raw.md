### 1. Verdict
**CHANGES REQUESTED**

---

### 2. Findings

- **[M] SEC-FUI-03 — `src/services/db/migrations.test.ts`**
  In Test 1 (`migrations.test.ts:264-270`), the newly added "prove uniqueness by its effect" block asserts `expect(() => harness.raw.exec(...)).toThrow(/UNIQUE constraint failed/)` without column qualification. Round 1 explicitly flagged finding (3) because an unqualified `/UNIQUE constraint failed/` matches any unique constraint violation. While the author fixed this in Test 3 (`:313`) by anchoring to `/UNIQUE constraint failed: follow_up_reminders\.account_id, follow_up_reminders\.thread_id/`, they reintroduced the exact same flaw into Test 1. A plausible broken implementation—such as an index omitting `account_id` (`CREATE UNIQUE INDEX ... ON follow_up_reminders(thread_id) WHERE status = 'pending'`), an index omitting `WHERE status = 'pending'`, or an accidental collision on another unique column like `message_id`—will still satisfy this assertion and pass for the wrong reason.

- **[M] SEC-FUI-04 — `src/services/db/migrations.test.ts`**
  In Test 2 (`migrations.test.ts:275-288`), the test claims in its title and comment to verify that the migration "survives a NULL id" without poisoning the predicate (`Gemini SEC-FUI-01`). However, the test places `NULL` on the oldest row `('m1', created_at: 77)`, which is assigned `rn = 3` and demoted; the survivor row with `rn = 1` is `'last'`. In SQL three-valued logic, `col NOT IN (subquery)` becomes `UNKNOWN` for *every* row in the table specifically when the subquery evaluates to `NULL` (i.e. when a survivor row has `id IS NULL`). Because Test 2 makes `'last'` the survivor, the subquery never produces `NULL`. The test merely verifies that a demoted row with a `NULL` id gets updated, but fails to test the critical SEC-FUI-01 failure mode where the candidate row surviving the partition has `id IS NULL`. The test should include a thread where the surviving row has `id = NULL` and assert `expect(pending).toEqual([{ id: null }])`.

- **[L] SEC-FUI-05 — `src/services/db/migrations.test.ts`**
  In `seedBefore29()` (`migrations.test.ts:220, 224`), the delta adds `INSERT INTO accounts ... VALUES ('acct-b', ...)` and `INSERT INTO threads (id, account_id) VALUES ('t1', 'acct-b')` to establish two threads sharing the ID `'t1'` across accounts. This claim depends on code outside the delta: if the `threads` table defines `id TEXT PRIMARY KEY` (as is standard across other single-column tables in this schema like `accounts` and `follow_up_reminders`) rather than a composite `PRIMARY KEY (account_id, id)`, SQLite will immediately throw `UNIQUE constraint failed: threads.id` when seeding `'acct-b'`, crashing test setup before migration 29 is ever exercised.

- **[N] SEC-FUI-06 — `src/services/db/migrations.test.ts`**
  In Test 2 (`migrations.test.ts:271-272`), the test executes `await runMigrations(); seedBefore29();` at the start of the block. If the test harness runs each test with a freshly migrated database in `beforeEach`, calling `await runMigrations()` here is redundant dead code. Conversely, if the harness shares the in-memory database across tests, `seedBefore29()` fails to truncate `accounts`, `threads`, or `follow_up_reminders`, which would cause Test 2's `COUNT(*) = 2` and `pending` assertions to fail due to lingering rows from Test 1.

---

### 3. Verified-Correct List

- **`rowid`-keyed demotion semantics (`src/services/db/migrations.ts:931-945`)**: Replacing `id` with `rowid` eliminates the three-valued logic hazard because SQLite 64-bit integer rowids are strictly non-null. The demotion query is unaffected by `WITHOUT ROWID` (the table allows `NULL` through `TEXT PRIMARY KEY`, proving it is a standard rowid table). `UPDATE` does not reallocate `rowid` values, rowids remain immutable across `status` changes, and VACUUM cannot run within the migration transaction.
- **Cross-account isolation & NULL status in Test 1 (`src/services/db/migrations.test.ts:254-259`)**: The assertion verifying `{ id: "r-cross", status: "pending" }` and `{ id: "r-null", status: null }` has real teeth: an index or demotion query that dropped `account_id` from the partition would demote `r-cross` or `r-new`, failing the assertion.
- **State isolation of the effect assertion (`src/services/db/migrations.test.ts:264-270`)**: The attempted insert of `'r-again'` in Test 1 is aborted by SQLite upon triggering the unique constraint. In SQLite, a statement-level constraint violation rolls back the statement; no row is persisted, and no lingering state leaks into later assertions or subsequent test blocks.
- **Deterministic tie-breaking (`src/services/db/migrations.ts:941`)**: Ordering by `created_at DESC, rowid DESC` provides a fully deterministic order for the window function partition, guaranteeing the latest inserted row survives even when `created_at` timestamps collide.
- **Parity between better-sqlite3 and Tauri SQL plugin (production)**: Both run SQLite versions well above 3.25.0 (window function support). The error string format emitted by SQLite's C core (`UNIQUE constraint failed: follow_up_reminders.account_id, follow_up_reminders.thread_id`) is identical across both runtimes.
