CHANGES REQUESTED

### Findings

#### H1: Unprotected UPDATE-then-INSERT race yields duplicate pending rows that the checker does not tolerate
- **Location:** `src/services/db/followUpReminders.ts:26-38` & `docs/briefs/2026-09-03-followup-reminder-upsert.md:58-62`
- **Quoted lines:**
  ```typescript
  +  const updated = await db.execute(
  +    `UPDATE follow_up_reminders
  +     SET message_id = $1, remind_at = $2
  +     WHERE account_id = $3 AND thread_id = $4 AND status = 'pending'`,
  +    [messageId, remindAt, accountId, threadId],
  +  );
  +  if (updated.rowsAffected > 0) return;
     const id = crypto.randomUUID();
     await db.execute(
       `INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status)
        VALUES ($1, $2, $3, $4, $5, 'pending')`,
       [id, accountId, threadId, messageId, remindAt],
     );
  ```
  ```markdown
  No transaction: the two statements run on the plugin's pool, and the worst interleaving (two sets of the same thread at once) yields two pending rows, which every reader tolerates (`LIMIT 1`, `COUNT(DISTINCT)` in #87).
  ```
- **Issue:** The brief's claim that "every reader tolerates" two pending rows is false. The background checker polls `status = 'pending'` without `LIMIT 1` to find due reminders. If two concurrent callers (e.g., `ActionBar.tsx` manual set and `autoReminders.ts` automated schedule) interleave across the connection pool, two pending rows are created. The checker will fire both, emitting duplicate notifications/triggers. When the first triggered row is marked `'triggered'`, the second remains `'pending'` as a ghost reminder that triggers again.
- **Concrete Change:** Wrap the UPDATE and INSERT inside `withTransaction` (from `@/services/db/connection`, already mocked in the test harness at line 17):
  ```typescript
  await withTransaction(async (tx) => {
    const updated = await tx.execute(
      `UPDATE follow_up_reminders
       SET message_id = $1, remind_at = $2
       WHERE account_id = $3 AND thread_id = $4 AND status = 'pending'`,
      [messageId, remindAt, accountId, threadId],
    );
    if (updated.rowsAffected > 0) return;
    const id = crypto.randomUUID();
    await tx.execute(
      `INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [id, accountId, threadId, messageId, remindAt],
    );
  });
  ```
  SQLite's write lock will serialize concurrent executions; the second execution will see the newly inserted row during its `UPDATE` and return rather than inserting a duplicate.

---

#### M1: Brief justifies avoiding a unique index using a false collision claim
- **Location:** `docs/briefs/2026-09-03-followup-reminder-upsert.md:10-12, 53-54`
- **Quoted lines:**
  ```markdown
  -(A unique index would be the other fix; it is a migration — Tier 2 — and it
  - would also have to reconcile the cancelled/triggered history rows that share a thread. Not
  - needed: the service can keep the invariant itself.)
  ...
  -## Not doing
  -- A unique index (migration; Tier 2; would collide with the history rows).
  ```
- **Issue:** A unique index does not collide with history rows if defined as a partial unique index: `CREATE UNIQUE INDEX idx_followup_pending ON follow_up_reminders(account_id, thread_id) WHERE status = 'pending';`. SQLite natively supports partial unique indexes as conflict targets (`ON CONFLICT(account_id, thread_id) WHERE status = 'pending' DO UPDATE ...`), which enforces "one pending per thread" atomically at the database engine level with zero history reconciliation needed. While avoiding a migration to stay within Tier 1 scope is acceptable, the technical rationale in the brief is inaccurate.
- **Concrete Change:** Correct the brief to acknowledge that a partial unique index (`WHERE status = 'pending'`) is the proper schema constraint and should be tracked as a Tier 2 follow-up migration to provide DB-level enforcement.

---

#### L1: Test replaces `selectFirstBy` with a hand-rolled stub
- **Location:** `src/services/db/followUpReminders.upsert.test.ts:18-22`
- **Quoted lines:**
  ```typescript
  +  // The real helper reaches for the real getDb; route it to the harness too.
  +  selectFirstBy: async (sql: string, params: unknown[] = []) => {
  +    const rows = await harnessRef.current!.db.select<unknown[]>(sql, params);
  +    return rows[0] ?? null;
  +  },
  ```
- **Issue:** Re-implementing `selectFirstBy` inside `vi.mock` circumvents the real helper in `@/services/db/connection`. If `selectFirstBy` has custom parameter mapping or behavior, the test will not catch regressions in it. Furthermore, line 17 stubs `withTransaction` even though the service code under test does not currently use it.
- **Concrete Change:** Have `@/services/db/connection` export a mechanism to set or bind the harness database for tests (or use `vi.importActual` where practical) so production helper functions run their real code against the harness rather than ad-hoc inline mocks.

---

#### N1: Audit codebase for other invalid `ON CONFLICT` clauses
- **Location:** `docs/briefs/2026-09-03-followup-reminder-upsert.md:28-32`
- **Quoted lines:**
  ```markdown
  - `src/services/db/followUpReminders.ts:14-29`: the upsert with `ON CONFLICT(account_id,
    thread_id)`. SQLite's rule: the conflict target must match a PRIMARY KEY or UNIQUE
    constraint, else the statement errors at prepare time.
  ```
- **Issue:** Because `ON CONFLICT` against a non-unique index fails silently at prepare time when caught by callers, other queries may have the same defect.
- **Concrete Change:** Run the following search across the repository:
  ```bash
  git grep -in "ON CONFLICT" src/
  ```
  Check each conflict target against `src/services/db/migrations.ts` to confirm an exact matching `PRIMARY KEY` or `UNIQUE` constraint/index exists.

---

### Analysis Notes

- **Diagnosis accuracy:** The diagnosis is 100% correct. Migration v6 created a plain index (`CREATE INDEX idx_followup_thread ON follow_up_reminders(account_id, thread_id)`). SQLite strictly requires an exact `UNIQUE` or `PRIMARY KEY` match for the conflict target; without one, SQLite rejects the statement at prepare time.
- **Triggered/cancelled rows followed by a new set:** Correct. Triggered and cancelled rows have `status != 'pending'`. The `UPDATE` matches 0 rows, falls through, and `INSERT` inserts a new pending row while preserving history rows untouched.
- **`rowsAffected` reliability on no-op UPDATEs:** Reliable. In SQLite, `sqlite3_changes()` returns the number of rows matching the `WHERE` clause regardless of whether the assigned column values match existing row values. `tauri-plugin-sql` (via `sqlx`) reflects `sqlite3_changes64()`, returning `rowsAffected = 1` even when values are unchanged.

---

### Brief Requirements Evaluation

- **REQ-1:** **MET.** When no pending row exists, the `UPDATE` affects 0 rows and a pending row is inserted.
- **REQ-2:** **MET.** When a pending row exists, the `UPDATE` updates `message_id` and `remind_at`, and returns without inserting.
- **REQ-3:** **MET.** Cancelled and triggered rows are ignored by `status = 'pending'`, remaining untouched as history.
- **REQ-4:** **MET.** The test runs against the SQLite harness with real migrations applied, ensuring statements are validated against SQLite's SQL parser and placeholder rules.
