**CHANGES REQUESTED**

### Findings

**M1.** `insertFollowUpReminder` — UPDATE and INSERT are separate auto-commits on the plugin pool; a concurrent pair both sees `rowsAffected = 0` and both insert.

```ts
  const updated = await db.execute(
    `UPDATE follow_up_reminders
     SET message_id = $1, remind_at = $2
     WHERE account_id = $3 AND thread_id = $4 AND status = 'pending'`,
    [messageId, remindAt, accountId, threadId],
  );
  if (updated.rowsAffected > 0) return;
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')`,
```

JS async interleaving is enough (manual ActionBar + auto `#80`/`#82` on the same send). SQLite will serialize each statement, not the pair.

The brief’s “every reader tolerates two pending” is only true for `getFollowUpForThread` (`LIMIT 1`) and `#87` (`COUNT(DISTINCT)`). It is false for `getPendingFollowUpReminders` / the checker (both due rows fire) and only accidentally true for cancel (it updates every pending row). The UPDATE itself has no `LIMIT`, so a later set writes the new time onto **every** leftover pending row and the checker can still fire twice.

`withTransaction` / `DbExecutor` is already the sticky-connection write lock; the test even stubs `withTransaction`. Wrap the two statements in it. Under SQLite’s single writer, the second caller’s UPDATE then hits the row the first inserted and REQ-2 holds. Do not rely on `LIMIT 1` to paper over two pending rows.

**L1.** `followUpReminders.upsert.test.ts` — REQ-3 names cancelled **and** triggered; only cancelled is pinned.

```ts
  it("a cancelled reminder stays as history and a new one can be set beside it", async () => {
    await insertFollowUpReminder(ACC, "t1", "m1", 1000);
    await cancelFollowUpForThread(ACC, "t1");
    await insertFollowUpReminder(ACC, "t1", "m2", 2000);
```

Add the sibling: insert pending, `UPDATE … SET status = 'triggered'` (same write the checker does), set again, assert the triggered row is unchanged and a new pending sits beside it.

**L2.** Same hunk as M1: `if (updated.rowsAffected > 0) return;` treats “rows changed” as “a pending row existed.”

Harness and production are different drivers (better-sqlite3 vs tauri-plugin-sql/sqlx). SQLite’s `sqlite3_changes` usually counts WHERE matches even when `message_id`/`remind_at` are unchanged; if this plugin build reports `0` for a no-op SET, a second set of the same tuple inserts another pending row and REQ-2 fails only in production. Concrete change: inside the transaction, `SELECT id … WHERE … status = 'pending' LIMIT 1` then UPDATE-by-id or INSERT — existence does not depend on `rowsAffected`. At minimum, add a same-`message_id`/same-`remind_at` re-set case so a harness that returned `0` would fail here.

**N1.** Brief “Not doing / unique index would collide with history” — true only for a non-partial UNIQUE on `(account_id, thread_id)`. `CREATE UNIQUE INDEX … ON follow_up_reminders(account_id, thread_id) WHERE status = 'pending'` would not collide, would close the race at the schema, and would have no backfill (no row has ever been inserted). Still a migration / Tier 2; valid to defer for wave-1. Do not treat that deferral as “unique is worse.”

**N2.** Cannot see the rest of the tree. Grep `ON CONFLICT` under `src/` and `src-tauri/`; for each hit, check the conflict target against every `PRIMARY KEY` / `UNIQUE` / `CREATE UNIQUE INDEX` in `migrations.ts` (all versions). Also grep `CREATE INDEX` without `UNIQUE` on the same column lists. This exact prepare-time failure will recur on any other upsert aimed at a plain index.

`selectFirstBy` mock: it is a call-time redirect onto the harness (`rows[0] ?? null`), not a `vi.hoisted` read at factory time, so it is fine for these tests. It will not throw if two pending rows exist; production `selectFirstBy` might. That is another reason to close M1 rather than a separate mock bug.

Diagnosis is right: quoted DDL is `id PRIMARY KEY` plus plain `idx_followup_thread`; SQLite will not take `ON CONFLICT(account_id, thread_id)` from a non-unique index. Placeholder reuse is a second reason the old statement could not run on the harness; production was already dead at prepare.

### Requirements

- **REQ-1:** met
- **REQ-2:** met sequentially on the harness; unmet if two calls interleave (M1); plugin `rowsAffected` vs harness not verifiable from this diff (L2)
- **REQ-3:** met in the `status = 'pending'` predicate; triggered half untested (L1)
- **REQ-4:** met
