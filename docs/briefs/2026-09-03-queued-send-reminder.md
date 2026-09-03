# SPEC-QSR — Auto Reminders on queued offline sends

- **Task:** When a send is queued because the app is offline (or the provider call failed
  with a retryable error) and the user wanted an automatic follow-up reminder, carry that
  wish on the queued operation and create the reminder when the queue processor's send
  succeeds. SPEC-AR (#80) set the reminder only on an immediate successful send and
  warned on the queued path; that warn retires.
- **Tier:** **1** — frontend feature on existing tables and the existing queue; no schema,
  no Rust, no dependency, no auth or secret handling. Same blast radius as SPEC-AR.
- **Base:** `main` @ `b8d0237` (code pin `a7058cb`, #80). Citations grepped at `b8d0237`.
- **Status:** approved (Jim, 2026-09-03: "Reminder on queued offline sends: YES. After
  PR 80 merges, write a brief and build it as its own Tier 1 PR — carry the wants-reminder
  flag and frozen delay on the queued op, create the reminder when the queue processor's
  send succeeds, retire the PR 80 warn for that path.") — branch `queued-send-reminder`,
  PR opened with this file before any code; tests first.
- **Source:** Grok M2 on #80 (its other half, recorded as Jim's call in `LOG.md`,
  2026-09-03 PR #80 review entry); Jim's decision above.
- **Effort:** S · 0.5 day.

## Outcome

A user who writes to someone outside their company while offline gets the same reminder
they would have got online: N days after the message actually leaves, at 09:00 local,
rolled past a weekend. Nothing changes for a send that goes out immediately, for a send
the user unticked, or for users with the feature off.

## What exists, verified at `b8d0237`

- **The send path.** `Composer.handleSend` (`src/components/composer/Composer.tsx`) decides
  `autoReminderWanted` and freezes `autoReminderDaysAtSend` before the undo timer, then
  calls `sendEmail(activeAccountId, raw, state.threadId ?? undefined)`. After it, if the
  result carries a message id it calls `scheduleAutoReminder(...)`; otherwise it warns
  `"No sent message id (send failed or was queued); no reminder set"`.
- **The queue.** `executeEmailAction` (`src/services/emailActions.ts:344-371`) enqueues
  the action when `isOnline` is false, or when the provider call throws a retryable error,
  with `actionToParams(action)` — every field of the action except `type` — as the JSON
  `params` of a `pending_operations` row. The processor (`queueProcessor.ts:19-71`) runs
  `executeQueuedAction(op.account_id, op.operation_type, params)` every 30 s, deletes the
  row on success and backs off on a retryable failure. `executeQueuedAction` rebuilds the
  action as `{ type, ...params }`, calls `executeViaProvider` and **discards its result**
  (`emailActions.ts:410-437`).
- **The provider result.** `provider.sendMessage` returns `{ id, threadId? }` since #80
  (`src/services/email/types.ts`), Gmail from the API, IMAP from the thread the Sent copy
  was saved under.
- **The scheduler.** `scheduleAutoReminder(deps, { accountId, threadId, messageId, sentAt,
  days })` (`src/services/followup/autoReminders.ts`) never overwrites a pending reminder,
  warns and sets nothing without a thread id, and reports an insert failure without
  throwing.
- **Compaction.** `compactQueue` (`src/services/db/pendingOperations.ts:158`) touches
  toggles, labels, moves and reconcile ops; `sendMessage` rows are never merged or dropped.

## Requirements

- **REQ-1** As a user I want the reminder I asked for even when the message goes out later.
  - **1.1** WHEN a send is queued (offline, or a retryable provider failure) and the user
    wanted an automatic reminder THE SYSTEM SHALL store that wish and the delay frozen at
    Send on the queued operation.
  - **1.2** WHEN the queue processor's send succeeds for such an operation THE SYSTEM SHALL
    set the reminder from the **actual send time** with the stored delay, on the thread the
    provider reports (falling back to the thread the message was a reply to), through the
    same scheduler as an immediate send (never overwriting a pending reminder; no thread →
    warn, no row).
  - **1.3** WHEN the queued send fails permanently THE SYSTEM SHALL set no reminder.
  - **1.4** WHEN the send goes out immediately THE SYSTEM SHALL behave exactly as after #80.
    The reminder decision is still taken in the composer at Send; the composer's queued-path
    warn retires because the path now does the work.
- **REQ-2** Reminder creation lives in one place.
  - **2.1** THE SYSTEM SHALL set the reminder from the email-action layer for both paths, so
    the composer no longer schedules it itself; the composer passes the wish and the delay.
  - **2.2** THE SYSTEM SHALL keep the send outcome independent of the reminder: a reminder
    failure is logged, never surfaced as a send failure, never retried by the queue.

## Not doing

- **Scheduled sends** (`handleSchedule` → `scheduled_emails`) — a different table and
  checker; still a non-goal, as in SPEC-AR.
- **Changing the queue's retry, compaction or backoff** — `sendMessage` rows already
  survive compaction untouched.
- **A migration** — the wish rides in the existing JSON `params` column.
- **Retrying reminder creation** — if the scheduler fails after a successful queued send,
  the op is still deleted (the mail is out); the failure is logged.

## Design

- **`EmailAction` `sendMessage`** gains an optional `autoReminderDays?: number` (the frozen
  delay; presence means "wanted"). `actionToParams` already serialises every field, so the
  queued row carries it with no schema change; `executeQueuedAction` rebuilds the action
  with it.
- **`emailActions.ts`:** a small `afterSuccessfulSend(accountId, action, result)` helper:
  if `action.autoReminderDays` is set, `scheduleAutoReminder({ getFollowUpForThread,
  insertFollowUpReminder }, { accountId, threadId: result.threadId ?? action.threadId,
  messageId: result.id, sentAt: new Date(), days })`, wrapped so nothing propagates. Called
  from the online path of `executeEmailAction` after `executeViaProvider` and from
  `executeQueuedAction` after a successful `sendMessage`. `sendEmail(accountId, raw,
  threadId, opts?: { autoReminderDays?: number })` passes it through.
- **`Composer.tsx`:** passes `{ autoReminderDays: autoReminderDaysAtSend }` when
  `autoReminderWanted`; its post-send scheduling block and the queued-path warn go. A failed
  send is already reported by the existing error handling.
- **Decision & alternatives** — (a) do the work in the action layer for both paths (chosen:
  one code path, the queued path needs it there anyway); (b) keep the composer's block and
  add a second one in the processor — two copies of the same logic; (c) a separate
  `pending_operations` type "scheduleReminder" enqueued after the send op — ordering between
  two rows is not guaranteed and the message id is unknown until the send runs.
- **Data / schema** — none. `params` gains one optional number for `sendMessage` rows; old
  rows without it behave as before (no reminder).
- **Failure modes** — provider returns no `threadId` and the action has none (new message on
  a provider that cannot report it): scheduler warns, no row. Scheduler throws (DB error on
  the lookup): caught and logged; the send stands. A queued row from before this change:
  no `autoReminderDays`, no reminder.

## Tasks (risk-first)

1. Brief committed; PR opened.
2. Tests first in `src/services/emailActions.test.ts`: online send with `autoReminderDays`
   creates a reminder on the provider's thread; online send without it creates none;
   offline send enqueues the field in `params` and creates no reminder; `executeQueuedAction`
   for `sendMessage` with the field creates the reminder after the provider succeeds, with
   the provider's thread id (falling back to the action's), and none when the provider
   throws; a scheduler failure does not fail the action.
3. `emailActions.ts`: the action field, the helper, both call sites, the `sendEmail` option.
4. `Composer.tsx`: pass the option; remove the scheduling block and the queued-path warn.
5. Gates: `tsc`, full suite, `graph:check`, `docs:check`; LOG entry; two review legs;
   merge on green.

## Done when

- The six cases in Task 2 are green; the #80 tests are unchanged and green.
- The composer no longer imports the scheduler; `emailActions.ts` is the only caller.
- A queued send row in `pending_operations` carries `autoReminderDays` when the user wanted
  a reminder, and not otherwise.

## Rollback

Revert the squash commit. No schema; queued rows carrying the extra field are still valid
`sendMessage` params for the old code, which ignores unknown fields.

## Review

Two cross-vendor legs on the diff from committed SHAs (Gemini 3.8 Flash High, Grok 4.6);
every finding verified against source before adoption.

## Approval

- Brief approved by: Jim, 2026-09-03 (decision 5 in the approved next-session prompt).
