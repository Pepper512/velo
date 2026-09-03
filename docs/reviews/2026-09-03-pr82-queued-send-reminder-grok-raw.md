**APPROVE**

## Findings

- **L1.** `src/services/emailActions.ts` — `executeEmailAction` try (~396–399) and `executeQueuedAction` try (~461–467). REQ-2.2 is implemented only by the inner catch in `afterSuccessfulSend`. Both call sites put that helper in the **same** `try` as `executeViaProvider`:

```ts
const data = await executeViaProvider(accountId, action);
await afterSuccessfulSend(accountId, action, data);
return { success: true, data, nextThreadId };
```

```ts
const result = await executeViaProvider(accountId, action);
await afterSuccessfulSend(accountId, action, result);
```

If the helper wrap is later broken (or a throw is added after it), a reminder failure is classified as a provider failure: online → possible duplicate enqueue; queued → backoff/retry. Concrete change: run `afterSuccessfulSend` only after the provider `try` succeeds, in its own try, so F-4 / `classifyError` cannot see reminder errors.

- **L2.** `src/services/emailActions.ts` — `afterSuccessfulSend` result handling (~284–286). Spec/`types.ts` already have `{ id, threadId? }`; this reintroduces the composer’s old assertion:

```ts
const sent = result as { id?: string; threadId?: string } | undefined;
```

A wrapped return shape would skip the reminder (`!sent?.id`) with only a warn. Type `result` as the send result (or reuse the provider type) and stop asserting `unknown`.

- **N1.** Double reminders / retries (`afterSuccessfulSend` + scheduler guard, unchanged from #80). `afterSuccessfulSend` is not idempotent itself; it always tries to schedule when `autoReminderDays` is present and `result.id` exists.
  - Provider send succeeds, then `executeViaProvider` throws **before** `afterSuccessfulSend`: no reminder on that attempt; the processor retries the row; reminder is set once on a later success (`sentAt` = that attempt). Duplicate **mail** is pre-existing; not a second reminder.
  - Provider send succeeds, reminder insert succeeds, then the processor crashes **before** deleting the row: row is re-executed. Second `scheduleAutoReminder` is a no-op **only while a reminder on that thread is still pending**. That is all the existing-pending guard covers — not a completed/dismissed reminder, and not a first attempt whose insert was swallowed.
  - Lookup throw / insert failure after a successful queued send: helper catch (lookup) or scheduler (insert) → `executeQueuedAction` does not throw → row is deleted → **no** reminder retry. Matches SPEC-QSR “Not doing”.
  - Immediate + queued both firing: not in this diff. Online success never enqueues; enqueue paths never call `afterSuccessfulSend`. Composer’s scheduler block is gone, so no composer+layer double set.

- **N2.** `afterSuccessfulSend` is **invoked** for every successful online and queued action, not only `sendMessage`. The no-op is the guard:

```ts
if (action.type !== "sendMessage" || action.autoReminderDays === undefined) return;
```

Non-send actions cannot pick up a polluted `autoReminderDays` on rebuilt `{ type, ...params }`. Harmless extra `await` on archive/trash/move.

- **N3.** Composer send-failure reporting (`Composer.tsx` ~336–348). The removed `console.warn` was only the reminder/queued-id path, not UI send failure. `sendResult.success` was never used to report a failed send. `await sendEmail(...)` stays in the same `try`; a reminder error cannot fail the send (helper wrap). Queued-path warn retirement is REQ-1.4.

## Spec requirements

| ID | Status |
| --- | --- |
| **REQ-1.1** | **Met.** Composer passes `{ autoReminderDays }` when wanted; `sendEmail` copies it onto the action; `actionToParams` already serialises every field except `type`. Offline test shows the field on enqueue. Retryable-provider enqueue is the same `action` object (catch body not in this diff, but the field is already on `action`). |
| **REQ-1.2** | **Met.** Queued success calls `afterSuccessfulSend` with `sentAt: new Date()` (actual send, not enqueue time), `threadId: sent.threadId ?? action.threadId`, `days: action.autoReminderDays`, same `scheduleAutoReminder`. |
| **REQ-1.3** | **Met.** Provider throw happens before `afterSuccessfulSend`; test asserts no insert. |
| **REQ-1.4** | **Met** for the changed files. Immediate path uses the same scheduler args as #80; decision still in the composer; queued warn is gone. **Untestable from this diff:** that #80 tests are unchanged and green. |
| **REQ-2.1** | **Met** on the paths in the diff (composer no longer imports/calls the scheduler; both send paths go through `afterSuccessfulSend`). **Untestable from this diff:** that `emailActions.ts` is the only remaining caller repo-wide. |
| **REQ-2.2** | **Met** at the action layer: helper catch + early returns; `sendEmail` still `success: true` and `executeQueuedAction` resolves when lookup throws. **Untestable from this diff:** that the 30s processor still deletes the row iff `executeQueuedAction` does not throw (processor unchanged, not in the diff). |

Also untestable here: real SQLite JSON round-trip; `scheduleAutoReminder` pending/no-thread behaviour (not in the diff); other `sendEmail` callers.

## Tests in the diff do not cover

- **JSON round-trip:** `enqueue` → `JSON.stringify`/`parse` → `executeQueuedAction`. Tests pass a live JS number. Would miss `autoReminderDays` becoming a string (or dropping) in `params`.
- **REQ-1.1 retryable online failure:** only the offline enqueue is asserted; not “provider threw retryable → `params` still has `autoReminderDays`”.
- **Provider thread wins when both exist:** online test has provider thread and no action thread; fallback test has action thread and no provider thread. No case with both.
- **Stored delay:** `insertFollowUpReminder(..., expect.any(Number))` never checks that `days` 1 vs 7 changes the due timestamp (could pass a hardcoded `days` and still pass).
- **No thread id at all:** new/queued send, provider returns `{ id }` only, action has no `threadId` → scheduler warn, no row.
- **Existing pending reminder:** queued/online success must not insert a second row (guard lives in the scheduler; this helper is now the only caller).
- **`sentAt` is now, not enqueue/`created_at`:** no fake timers.
- **Composer:** `sendEmail` 4th arg present iff `autoReminderWanted`; omitted when unticked / feature off. Spec task 2 did not require this, but REQ-1.4/2.1 live in `Composer.tsx`.
- **Insert failure (vs lookup throw)** does not fail send or rethrow from `executeQueuedAction`.
- **Non-`sendMessage` queued/online actions** do not insert a reminder even if `params` contain `autoReminderDays`.
