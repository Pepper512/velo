# SPEC-FUR — Follow-up reminders cannot be inserted: the upsert has no unique target

- **Task:** Make `insertFollowUpReminder` work. Its `INSERT … ON CONFLICT(account_id,
  thread_id) DO UPDATE` fails on the production schema with *"ON CONFLICT clause does not
  match any PRIMARY KEY or UNIQUE constraint"*, because migration v6 (upstream, 2026-02-12)
  created a plain index on those columns, not a unique one. Every follow-up reminder — the
  manual one from the thread action bar and the automatic ones from #80 and #82 — has been
  failing silently: both callers catch and log.
- **Tier:** **1** — one query in one service file, no schema change, no migration, no
  dependency. (The schema-level fix is a **partial unique index**, `CREATE UNIQUE INDEX …
  ON follow_up_reminders(account_id, thread_id) WHERE status = 'pending'`, which SQLite
  accepts as an `ON CONFLICT … WHERE status = 'pending'` target and which leaves the
  cancelled/triggered history rows alone. It is a migration — Tier 2 — so it is a recorded
  follow-up, not this PR; the service keeps the invariant itself meanwhile, inside one
  transaction. Corrected after Gemini M1 on #88: an ordinary unique index would collide with
  the history rows, a partial one would not.)
- **Base:** `main` after #87. Found while verifying Gemini H1 on #87 against real SQLite;
  reproduced with `better-sqlite3` on the migration's exact DDL.
- **Status:** approved (bug fix under the standing wave-1 instruction, one PR) — branch
  `followup-upsert-fix`, PR opened with this file and the failing test before the fix.
- **Effort:** XS · 0.25 day.

## Outcome

Setting a follow-up reminder — by hand, or automatically on an external send — creates a
pending row; setting it again replaces that row's time and message; a cancelled or triggered
reminder stays as history beside a new pending one; the Reminders split-inbox tab (#87) has
something to show.

## What exists, verified

- `src/services/db/migrations.ts:339-350`: `follow_up_reminders(id PRIMARY KEY, account_id,
  thread_id, message_id, remind_at, status, created_at)` with `idx_followup_thread` a
  **plain** index on `(account_id, thread_id)`.
- `src/services/db/followUpReminders.ts:14-29`: the upsert with `ON CONFLICT(account_id,
  thread_id)`. SQLite's rule: the conflict target must match a PRIMARY KEY or UNIQUE
  constraint, else the statement errors at prepare time.
- Callers: `ActionBar.tsx:188` (manual, catches and `console.error`s),
  `followup/autoReminders.ts:134` via `scheduleAutoReminder` (catches, reports `failed`).
- `getFollowUpForThread` and the checker read `status = 'pending'` only; `cancelFollowUpForThread`
  sets pending rows to `cancelled`; the checker sets `triggered`. So "one pending per thread"
  is the invariant the readers assume, and history rows per thread are expected.
- The SQLite test harness runs the real migrations; its placeholder rule (each `$n` once, in
  order) is why the original statement could not even be exercised there.

## Requirements

- **REQ-1** WHEN a reminder is set for a thread with no pending reminder THE SYSTEM SHALL
  insert one pending row.
- **REQ-2** WHEN a reminder is set for a thread that already has a pending one THE SYSTEM SHALL
  update that row's `message_id` and `remind_at` and insert nothing.
- **REQ-3** Cancelled and triggered rows SHALL be left untouched; a new pending row may sit
  beside them.
- **REQ-4** The test SHALL run on the SQLite harness against the real migrations, so the
  statement that ships is the statement that is tested.

## Not doing

- The partial unique index (a migration; Tier 2; recorded as a follow-up).
- Changing the callers, the checker, or the readers.

## Design

Inside one pinned transaction (`withTransaction`, SPEC-240: `BEGIN IMMEDIATE` on one
connection): `UPDATE … WHERE account_id = $3 AND thread_id = $4 AND status = 'pending'`; if
`rowsAffected = 0`, `INSERT` a pending row. The transaction is what makes "one pending per
thread" hold under two concurrent sets of the same thread — the checker fires *every* due
pending row (`getPendingFollowUpReminders` has no `LIMIT`), so a duplicate would notify
twice and the survivor would fire again later (Gemini H1 on #88; the earlier draft of this
brief wrongly claimed every reader tolerated a duplicate).

## Done when

`followUpReminders.upsert.test.ts` — red on the old statement, green on the new — covers
REQ-1 to REQ-3; the suite is green; CI green.

## Rollback

Revert the squash commit; nothing persisted changes shape.

## Review

Two cross-vendor legs on the diff from committed SHAs; findings verified against source.

## Approval

- Standing instruction (wave 1, one PR per item); a live defect in a shipped feature.
