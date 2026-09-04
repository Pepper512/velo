### 1. Verdict

**APPROVE**

The migration is safe, idempotent, non-destructive, and correctly enforces the single-pending-reminder invariant at the database level. Demotion via `ROW_NUMBER() OVER (PARTITION BY account_id, thread_id ORDER BY created_at DESC, rowid DESC)` guarantees deterministic tie-breaking without data deletion. The two statements split cleanly at depth 0, the migration runs atomically inside a single pinned transaction, and the N−1 application runs 100% green against the expanded schema (satisfying Tier 2 rollback requirements). The test adjustments correctly align with Option 1 approved by Jim.

---

### 2. Findings

- **[L] SEC-FUI-01 — `src/services/db/migrations.ts`**  
  In lines 925–939, the demotion query relies on `AND id NOT IN (SELECT id FROM (...) WHERE rn = 1)`. In SQLite, `id TEXT PRIMARY KEY` (defined in migration 6, outside this diff) does not enforce `NOT NULL` at the storage engine level unless declared `INTEGER PRIMARY KEY` or created under a `WITHOUT ROWID` clause. If any pending row possessed a `NULL` `id`, SQL three-valued logic would cause `id NOT IN (..., NULL)` to evaluate to `UNKNOWN` for every row, updating zero rows and allowing duplicate pending rows to survive into `CREATE UNIQUE INDEX`, which would throw and abort migration. While production writers (e.g., `followUpReminders.ts:33-52`, outside this diff) generate non-null string identifiers, filtering with `WHERE rowid NOT IN (SELECT rowid FROM (...) WHERE rn = 1)` or filtering `WHERE rn > 1` directly would eliminate reliance on `id` column non-nullability.

- **[L] SEC-FUI-02 — `src/services/db/migrations.test.ts`**  
  In lines 231–235, `seedBefore29()` seeds `'r-old'` first (`rowid = 1`, `created_at = 10`) and `'r-new'` second (`rowid = 2`, `created_at = 20`). Because timestamp order and insertion order (`rowid`) are identical, this test passes even if `created_at DESC` were omitted or inverted to `ASC` with `rowid DESC` taking precedence. Furthermore, the test suite does not exercise true timestamp collisions (`created_at` ties), which is the exact scenario produced by the default `(unixepoch())` expression within the same second and the sole operational justification for specifying `rowid DESC` in the window definition.

- **[N] SEC-FUI-03 — `src/services/db/threads.splitTabs.test.ts`**  
  In lines 143–156, the seed replaces the second pending reminder with one `'cancelled'` and one `'triggered'` reminder. Because reader queries (`splitTabCounts.ts:74` and `threads.ts:132`, outside this diff) strictly filter `WHERE status = 'pending'`, only `'fu-a'` matches the join. Consequently, `COUNT(DISTINCT t.id)` evaluates to 1 even if `DISTINCT` or `GROUP BY` were omitted entirely from the query. While this implementation fulfills Option 1 approved by Jim to prevent setup failures against the migrated schema and verifies that history rows do not pollute counts, the test is no longer capable of verifying the reader's defensive de-duplication logic.

- **[N] SEC-FUI-04 — `src/services/db/migrations.test.ts`**  
  In line 271, `expect(() => harness.raw.exec(...)).toThrow(/UNIQUE constraint failed/)` matches the generic SQLite constraint error without asserting the target index name or columns (`follow_up_reminders.account_id, follow_up_reminders.thread_id`). Although `follow_up_reminders` carries no other compound unique constraints, matching the qualified constraint failure ensures the test cannot pass due to an accidental collision on another column.

---

### 3. Verified-Correct List

1. **Demotion Determinism & Tie-Breaking:** `ORDER BY created_at DESC, rowid DESC` provides a strict total ordering. Because `rowid` is unique and non-null for all rows in a standard SQLite table, `ROW_NUMBER()` guarantees exactly one row with `rn = 1` per `(account_id, thread_id)` partition. Duplicate pending rows are deterministically demoted to `'cancelled'`, and no row is deleted.
2. **Nullable `status` Handling:** Rows with `status IS NULL` are excluded by `WHERE status = 'pending'` in the demotion subquery and outer query, and are excluded by `WHERE status = 'pending'` in the partial index definition. They do not conflict with the partial unique index.
3. **Partition Boundary Integrity:** `PARTITION BY account_id, thread_id` guarantees that multiple accounts sharing identical `thread_id` values, or multiple threads within a single account, are isolated into independent ranking partitions.
4. **Foreign Key Independence:** The demotion query and index creation operate solely on `follow_up_reminders` without joining `threads` or `accounts`. Orphaned rows resulting from past deletions without cascaded cleanup are handled deterministically without foreign key check failures.
5. **Statement Splitting Safety:** The SQL string contains exactly one semicolon terminating the `UPDATE` and one terminating `CREATE UNIQUE INDEX`. Neither statement contains embedded semicolons in string literals, window definitions, or triggers; BEGIN...END depth remains 0 throughout, splitting cleanly into two distinct statements.
6. **Execution Atomicity & Idempotence:** Both statements execute within the single pinned transaction managed by `runMigrations()`. `IF NOT EXISTS` on the index prevents errors on repeated runs, and running the demotion against zero duplicates is a safe no-op.
7. **N−1 Application Rollback Safety:** Reverting application binaries does not drop applied migrations. The N−1 application (#88 select-then-update-or-insert within `withTransaction`) never inserts a second pending row for a thread, and reader queries filter on `status = 'pending'`, meaning N−1 runs completely green against the expanded schema.
8. **Pre-#88 Compatibility Invariant:** Pre-#88 code relied on `ON CONFLICT(account_id, thread_id)` without a predicate, which SQLite rejects against a partial index (`WHERE status = 'pending'`). Pre-#88 code fails identically to its behavior before migration 29 without introducing new failure modes.
