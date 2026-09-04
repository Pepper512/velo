# SPEC-FUI — A partial unique index so "one pending reminder per thread" is the database's rule, not just the code's

- **Task:** Add migration 29: `CREATE UNIQUE INDEX idx_followup_pending_unique ON
  follow_up_reminders(account_id, thread_id) WHERE status = 'pending'`, with a
  non-destructive step ahead of it that makes the creation total on any database.
- **Tier:** **2** — a schema migration. Blast radius: every user's local mail database.
  Reversibility: **the index is not removed by reverting the app** (`04-gates.md:94-98`: app
  rollback never rolls back applied migrations), so the rollback story has to be the N−1 app
  running green against the expanded schema, not "revert the deploy".
- **Date / owner:** 2026-09-03 · agent drafts; **Jim approves this plan before any code.**
- **Base:** `main` @ `987f8c7` (code pin `ca4ba28`, #92). Citations grepped at that SHA.
- **Status:** **PLAN ONLY — no code will be written until the Approval line below is filled
  in.** Branch `followup-index`, PR opened with this file alone.
- **Source:** the #88 brief's recorded follow-up
  (`docs/briefs/2026-09-03-followup-reminder-upsert.md:10-16, 59`); ROADMAP §4's next item.
- **Effort:** S · 0.5 day.

## Outcome

A second pending follow-up reminder for the same thread is impossible: SQLite refuses it. The
invariant #88 holds inside one transaction is also held by the schema, so a future caller that
writes `follow_up_reminders` without that transaction cannot silently create the duplicate that
would notify the user twice. Nothing a user can see changes.

## Why this is worth doing, stated honestly

**It fixes no live bug.** #88 already holds the invariant: the only INSERT
(`followUpReminders.ts:33-52`) runs select-then-update-or-insert inside `withTransaction`
(`BEGIN IMMEDIATE` on one pinned connection, SPEC-240), so two concurrent sets of the same
thread serialise. The index earns its place as a **backstop**: it makes the invariant survive a
future caller that forgets the transaction, and it restores `ON CONFLICT(account_id, thread_id)
WHERE status = 'pending'` as a legal upsert target if anyone wants that form back. If that is
not worth a migration to you, the right answer is to close this and delete the follow-up from
the #88 brief — that is a real option and I would not argue against it.

## What exists, verified at `987f8c7`

1. **The table and its indexes** (migration 6, `migrations.ts:339-350`):
   ```sql
   CREATE TABLE IF NOT EXISTS follow_up_reminders (
     id TEXT PRIMARY KEY,
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     thread_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     remind_at INTEGER NOT NULL,
     status TEXT DEFAULT 'pending',
     created_at INTEGER DEFAULT (unixepoch()),
     FOREIGN KEY (account_id, thread_id) REFERENCES threads(account_id, id) ON DELETE CASCADE
   );
   CREATE INDEX idx_followup_status ON follow_up_reminders(status, remind_at);
   CREATE INDEX idx_followup_thread ON follow_up_reminders(account_id, thread_id);
   ```
   `idx_followup_thread` is the **plain** index whose non-uniqueness made upstream's
   `ON CONFLICT(account_id, thread_id)` invalid at prepare time — the #88 defect. `status` is
   **nullable and unconstrained**: no `NOT NULL`, no `CHECK`.
2. **Every code path that touches the table** (grepped, no test files): the single INSERT and
   the select/update in `followUpReminders.ts:33-52`; status updates at `:80` and `:91`;
   reads at `:59`, `:69`, `:104`; a `message_id` rewrite on move at `messages.ts:291`; and two
   read-only joins (`threads.ts:132`, `splitTabCounts.ts:74`). **One writer of the index
   columns, and it is the transactional one.** Nothing writes `status` as NULL.
3. **Migrations are versioned, transactional and fail closed.** `_migrations` ledger, 28
   applied, house shape is `{ version, description, sql }` with a comment naming the expand
   step and the (unrun) contract step — see 27 and 28 (`migrations.ts:856-895`). A migration
   that throws rolls back whole and leaves no ledger row, so it is retried next launch
   (proven by `migrations.test.ts:233-290`).
4. **A failed migration is silent to the user.** `runMigrations()` is step 1 of `App.tsx`'s
   init (`:198`), whose `catch` (`:389-394`) surfaces a banner only for credential errors and
   then calls `setInitialized(true)` and closes the splash. So a migration that can throw does
   not crash the app: it leaves the database un-migrated, every later migration unapplied, and
   nothing on screen to say so. **This is the reason the index creation must be total.**
5. **Real-SQLite migration tests exist** (`migrations.test.ts:112-290`): `createSqliteHarness`
   drives production `runMigrations` on better-sqlite3, with a per-migration test (28) and an
   atomicity test for the one destructive migration (24) as precedent.

## Can a real database already hold duplicate pending rows?

This decides whether the migration needs a data step, so it is reasoned explicitly.

- The table arrived in migration 6 **with** the broken upsert as its only writer, so there was
  never a working insert path before #88.
- That statement named a conflict target SQLite rejects **at prepare time**, so it never
  executed and never wrote a row. Both callers caught and logged (the #88 brief; reproduced
  there with better-sqlite3 on the migration's exact DDL).
- Since #88 the only INSERT is inside the pinned transaction, which cannot produce a second
  pending row for a thread.

**Conclusion: duplicates should be impossible.** I am nonetheless *not* willing to ship a
migration whose success depends on that reasoning being right, because being wrong means every
later migration silently stops applying for that user (point 4 above).

## Design

**Migration 29, two statements, in the existing transactional runner:**

```sql
-- 1. Make the creation total without deleting anything: demote any older
--    pending duplicate to 'cancelled', keeping the most recently created row
--    for each (account_id, thread_id). Expected to affect zero rows.
UPDATE follow_up_reminders
   SET status = 'cancelled'
 WHERE status = 'pending'
   AND id NOT IN (
     SELECT id FROM (
       SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY account_id, thread_id
                ORDER BY created_at DESC, rowid DESC
              ) AS rn
         FROM follow_up_reminders
        WHERE status = 'pending'
     ) WHERE rn = 1
   );

-- 2. The invariant, in the schema.
CREATE UNIQUE INDEX IF NOT EXISTS idx_followup_pending_unique
  ON follow_up_reminders(account_id, thread_id)
  WHERE status = 'pending';
```

- **Nothing is deleted.** `'cancelled'` is the vocabulary the code already uses for a reminder
  that is history (`followUpReminders.ts:91`, `followupManager.ts` on a reply), every reader
  filters on `status = 'pending'`, and a cancelled row is exactly what the checker and the
  Reminders tab already ignore. A demoted row remains inspectable in the database.
- `IF NOT EXISTS` on the index so a re-run after a partial failure is clean.
- The rows the demotion would touch **cannot exist** by the reasoning above; it is there so the
  migration is total even if that reasoning is wrong.

**Measured, not assumed.** Both statements were run against real SQLite (better-sqlite3 3.53.4,
the version the test harness uses) on the exact v6 DDL above, seeded with the forbidden state
(two pending rows plus one cancelled row for one thread):

| Step | Result |
|---|---|
| `CREATE UNIQUE INDEX …` with duplicates present | refused: `UNIQUE constraint failed: follow_up_reminders.account_id, follow_up_reminders.thread_id` |
| the demotion | newest pending kept `'pending'`, older one → `'cancelled'`, the pre-existing cancelled row untouched |
| the index, after the demotion | created |
| a second pending row for the thread, after | refused with the same UNIQUE error |
| a second **cancelled** row for the thread | allowed — history is not constrained |
| #88's `SELECT … WHERE status='pending' LIMIT 1` | still finds the surviving row |
| the pre-#88 `ON CONFLICT(account_id, thread_id)` | still invalid ("does not match any PRIMARY KEY or UNIQUE constraint") — a *partial* index is not a target unless the conflict clause repeats the `WHERE`, which is why rolling back past #88 is no worse than today |
| a `status IS NULL` row | allowed, outside the index |

`ROW_NUMBER() OVER` runs on that engine, so the window function needs no fallback.

**Residual, named:** the index constrains rows whose status is exactly `'pending'`. A row with
`status IS NULL` is outside it — and outside every reader too (`= 'pending'` never matches
NULL), so the two agree. Making `status` `NOT NULL` with a `CHECK` is a bigger, separate
migration and is **not** in this one.

## The one existing test this breaks, and what to do about it

`src/services/db/threads.splitTabs.test.ts:135-148` deliberately seeds **two pending rows for
one thread** to prove the readers count that thread once (`threads.ts:130-140` groups by thread
and takes `MIN(remind_at)`; `splitTabCounts.ts:70-77` uses `COUNT(DISTINCT t.id)`). Its
`beforeEach` runs `runMigrations()`, so once migration 29 exists the seed itself throws and the
test fails at setup.

That test is not wrong — it pins deliberate defensive behaviour in the readers. The migration
makes the state it seeds unreachable, which is the whole point. This is a judgement call I
would rather you saw here than discovered in a diff. The two honest options:

1. **Re-frame the test** as "the readers count a thread once" using a single pending row and
   drop the duplicate seed, adding a comment that the duplicate case is now prevented by
   migration 29 and pointing at the new migration test. The reader SQL is unchanged and still
   correct; what is lost is a regression test for a state the schema now forbids.
2. **Keep the duplicate seed** by inserting it *before* migrations run, or by dropping the
   index inside that one test. This keeps the coverage but asserts behaviour on a database
   shape that can no longer occur in the field.

**I recommend (1)** — a test for an impossible state is a test that will one day be "fixed" by
someone who does not know why it exists — but (2) is defensible and I will do it if you prefer.
Either way the change is named here, in the plan, before any code.

## Not doing

- **No `NOT NULL` / `CHECK` on `status`**, no rewrite of the existing indexes, no dropping of
  `idx_followup_thread` (it still serves the `(account_id, thread_id)` lookups at `:69` and
  `:104`).
- **No change to any query.** `ON CONFLICT` is *not* reintroduced; #88's select-then-update-or-
  insert stays exactly as it is. The index is a backstop, and this PR proves it changes no
  behaviour.
- **No contract step.** Per the pairing gate, the paired `DROP INDEX idx_followup_pending_unique`
  is recorded in the migration's comment and not run.
- **No dedupe by deletion.** Considered and rejected: a `DELETE` here would destroy a user's
  reminder on a hypothesis, and the demotion achieves the same totality with a status change.

## Threat (Tier 2)

- **Spoofing** — none. No identity is asserted; the database is local to the user and single-
  tenant.
- **Tampering** — the migration's only input is rows already in the user's own database. Fixed
  SQL, no interpolation, no parameters from outside; nothing crosses a trust boundary.
- **Repudiation** — nothing to audit. The one thing that must be visible is *failure*: see
  *Failure modes*, and the console error `runMigrations` already logs.
- **Disclosure** — none. The index materialises `account_id` and `thread_id`, both already
  columns of the same table; nothing new is stored and nothing leaves the machine.
- **DoS** — the demotion scans `follow_up_reminders` once; the table holds at most a few rows
  per account (one pending per thread, plus history). Bounded, one-off, at start-up.
- **Elevation** — no authz decision is near this path. The `ON DELETE CASCADE` foreign keys are
  untouched, so account deletion still removes the rows.

## Failure modes

| If | Then |
|---|---|
| The demotion is wrong and duplicates survive | `CREATE UNIQUE INDEX` throws, migration 29 rolls back whole, no ledger row, retried next launch — and **29 blocks every later migration for that user**, invisibly (App init swallows it). Task 2's negative test exists to make this impossible to ship. |
| A future caller inserts a second pending row | SQLite raises `UNIQUE constraint failed`. Both current callers already catch and log (`ActionBar.tsx`, the auto-reminder path), so the user sees no crash — and the reminder they asked for is the one already set. That is the intended behaviour of a backstop. |
| A user's database has `status IS NULL` rows | Outside the index and outside every reader; unchanged. |
| The migration runs on a database where `follow_up_reminders` is empty (the expected case) | Both statements are no-ops beyond creating the index. |
| Two windows race a "remind me" on the same thread | `withTransaction`'s mutex is per-webview (`connection.ts:65,122-143`), so today the loser could in principle write a second pending row; with the index it gets a UNIQUE error inside its own transaction instead. That error lands in the same swallowing catches (`ActionBar.tsx:191-196` logs; `autoReminders.ts:120-129` returns `reason: "failed"`), so the user's reminder is simply the one already set. **This is the case the index exists for.** |
| The follow-up checker hits it | It only UPDATEs `status`, so it cannot violate the index. (Worth knowing anyway: `followupManager.ts:20-47` has no per-item catch, so one failing statement would end that tick's loop; `backgroundCheckers.ts:17-23` keeps the interval alive.) |

## Tasks (risk-first; **none of these start before approval**)

- [ ] 1. `migrations.test.ts`, on the real-SQLite harness: bring the database to the state just
  before 29 (the `DELETE FROM _migrations WHERE version = …` pattern the v24 test already uses,
  `migrations.test.ts:236-237`), seed **two pending rows for one thread** by direct SQL, run
  `runMigrations`, and assert the older is `'cancelled'`, the newest still `'pending'`, the
  pre-existing cancelled row untouched, and the index present in `sqlite_master`. Red before
  the migration exists, green after.
- [ ] 2. The negative test: after migration, a direct `INSERT` of a second pending row for a
  thread **rejects** with a UNIQUE constraint error, and a second `'cancelled'` row for the
  same thread is still allowed (history is not constrained). No existing test asserts a
  constraint violation, so this is the first.
- [ ] 3. Migration 29 itself, in house style, with the contract step named in its comment.
- [ ] 4. `threads.splitTabs.test.ts` per whichever option you pick above — the only existing
  test the migration breaks.
- [ ] 5. `followUpReminders.upsert.test.ts` re-run unchanged: #88's behaviour must be identical
  with the index in place (this is the "changes no behaviour" claim). Note its harness mock's
  `withTransaction` does not issue a real BEGIN/COMMIT (`upsert.test.ts:14-23`), so it proves
  the statements, not the isolation; `migrations.test.ts:87-107` is the mock that does.
- [ ] 6. `CLAUDE.md` migration count (28 → 29) and the table note; LOG.md; HANDOFF after merge;
  the #88 brief's follow-up line marked done.

## Done when

`npx vitest run` green including the three new cases, `tsc`, `graph:check`, `docs:check` green;
CI green on the merge commit. The migration applies to a fresh database and to one seeded with
the forbidden duplicate. **No behaviour change is observable in the app.**

## Rollback (Tier 2)

- **Reverting the app does not remove the index** — that is the point of the pairing gate. So
  the rollback that matters is: **does the N−1 app run green against the expanded schema?**
  N−1 is the app immediately before this PR, i.e. post-#88 code, whose insert is
  select-then-update-or-insert and never writes a second pending row per thread. It therefore
  cannot violate the index. **Yes.**
- Pre-#88 code is already broken in this area (its `ON CONFLICT` target was invalid before the
  index existed and remains invalid with a *partial* index, whose conflict target must repeat
  the `WHERE`), so rolling back that far is neither better nor worse than today.
- If the index itself must go: a **new** migration 30 running `DROP INDEX
  idx_followup_pending_unique`. Recorded here as the contract step; not written now.
- The demotion is not reversible by a down-migration (a demoted row's previous status is not
  stored). It is expected to touch zero rows; if that is not acceptable to you, say so and I
  will make task 1 assert zero rows demoted on any real database shape instead.

## Review

Two legs on the PR once code exists: Gemini 3.8 Flash High via `agy`; Grok 4.6 via the `grok`
CLI; a follow-up pass on the fix delta (on #92 five rounds each found a real defect in the
previous round's fix). Tier 2 also wants **your** review of the full diff, not just the plan.

## Approval

- Plan approved by: __________ date: ______  ← **Tier 2: no code until this is filled in.**
