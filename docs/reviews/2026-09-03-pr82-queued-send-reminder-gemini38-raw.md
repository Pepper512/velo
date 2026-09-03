### 1. Verdict
**APPROVE**

---

### 2. Findings

* **L1**: `src/services/emailActions.ts`, lines 399 and 467 (`executeEmailAction` and `executeQueuedAction`)
  * **Code**:
    ```ts
    await afterSuccessfulSend(accountId, action, data);
    ```
    and
    ```ts
    await afterSuccessfulSend(accountId, action, result);
    ```
  * **Problem**: `afterSuccessfulSend` is called unconditionally after every action type (e.g., `archiveThread`, `trashThread`, `moveThread`), not solely `sendMessage`. The spec (`Design` section) explicitly called for it to be run: *"from executeQueuedAction after a successful sendMessage"*.
  * **Impact**: While `afterSuccessfulSend` guards itself on its first line (`if (action.type !== "sendMessage" || action.autoReminderDays === undefined) return;`), invoking a send-specific hook on archive, trash, or label operations is misleading to readers and incurs an unnecessary async microtask turn for every routine operation in the app.
  * **Change**: Guard the invocation at both call sites:
    ```ts
    if (action.type === "sendMessage") {
      await afterSuccessfulSend(accountId, action, result);
    }
    ```

* **L2**: `src/services/emailActions.ts`, line 283 (`afterSuccessfulSend`)
  * **Code**:
    ```ts
    threadId: sent.threadId ?? action.threadId,
    ```
  * **Problem**: Nullish coalescing (`??`) does not fall back if `sent.threadId` is an empty string (`""`).
  * **Impact**: If a provider returns `{ id: "msg-1", threadId: "" }` instead of omitting the field or returning `undefined`, `"" ?? action.threadId` evaluates to `""`, failing to fall back to the reply thread in `action.threadId`.
  * **Change**: Use `sent.threadId || action.threadId`.

* **N1**: `src/components/composer/Composer.tsx`, lines 340–345
  * **Code**:
    ```ts
    await sendEmail(
      activeAccountId,
      raw,
      state.threadId ?? undefined,
      autoReminderWanted ? { autoReminderDays: autoReminderDaysAtSend } : undefined,
    );
    ```
  * **Problem / Observation**: The composer previously read `const sendResult = await sendEmail(...)` solely to check whether it could schedule an immediate reminder or log `[autoReminders] No sent message id (send failed or was queued); no reminder set`. Retiring that block and discarding the return value of `sendEmail` does not compromise composer error handling: that warning was purely an auto-reminder diagnostic, and send errors continue to be caught by the surrounding `try/catch` and action layer.

* **N2**: `src/services/emailActions.ts`, lines 280–296 (`afterSuccessfulSend`)
  * **Code**:
    ```ts
    try {
      await scheduleAutoReminder(
        { getFollowUpForThread, insertFollowUpReminder },
        {
          accountId,
          threadId: sent.threadId ?? action.threadId,
          messageId: sent.id,
          sentAt: new Date(),
          days: action.autoReminderDays,
        },
      );
    } catch (err) {
      console.warn("[emailActions] Could not set the automatic reminder:", err);
    }
    ```
  * **Problem / Observation**: Double-reminder evaluation:
    1. Because `afterSuccessfulSend` catches all errors from `scheduleAutoReminder` and logs via `console.warn`, reminder failures cannot cause `executeQueuedAction` to throw. A queued send that succeeds at the provider will never back off or be re-executed because of a reminder error.
    2. If an external crash (e.g. queue processor killed before deleting the `pending_operations` row) causes the row to re-execute, `scheduleAutoReminder` checks `getFollowUpForThread(threadId)`. The scheduler's existing-pending guard detects the pending reminder from the first run and prevents a duplicate row on that thread.
    3. The guard protects against double reminders on the *same* thread. If a re-executed send is a new conversation and the provider creates two distinct threads, each thread receives a reminder (an unavoidable artifact of at-least-once message delivery).

* **N3**: `src/services/emailActions.ts`, lines 285, 45–54, 608–616
  * **Code**:
    ```ts
    sentAt: new Date(),
    ```
    and
    ```ts
    opts?: {
      /** SPEC-AR/QSR: set a follow-up reminder this many days after the send. */
      autoReminderDays?: number;
    },
    ```
  * **Problem / Observation**:
    1. Using `sentAt: new Date()` inside `afterSuccessfulSend` ensures queued sends date the reminder from the time the message leaves the queue processor rather than the offline draft time, adhering to REQ-1.2.
    2. `opts?: { autoReminderDays?: number }` on `sendEmail` cleanly encapsulates optional parameters.
    3. JSON round-trip: `autoReminderDays` serializes cleanly into `pending_operations.params` as a JSON number and deserializes as `number`. Legacy queued rows lacking this field deserialize to `undefined` and are safely skipped by `afterSuccessfulSend`.

---

### 3. Spec Requirements Matrix

| Requirement | Status | Notes |
| :--- | :--- | :--- |
| **REQ-1.1** (Store wish & frozen delay on queued op) | **Met** | `sendEmail` passes `autoReminderDays` into `EmailAction`; `actionToParams` retains it in `pending_operations.params`. |
| **REQ-1.2** (Queue send sets reminder from actual send time on provider/reply thread) | **Met** | `executeQueuedAction` runs `afterSuccessfulSend` with `sentAt: new Date()` and `threadId: sent.threadId ?? action.threadId`. |
| **REQ-1.3** (No reminder on permanent failure) | **Met** | When provider throws, `executeQueuedAction` fails before calling `afterSuccessfulSend`. |
| **REQ-1.4** (Immediate send behaves as before; composer warn retired) | **Met** | Online `executeEmailAction` calls `afterSuccessfulSend`; composer warn removed. |
| **REQ-2.1** (Reminder logic centralized in action layer) | **Met** | Scheduling logic and imports removed from `Composer.tsx`; centralized in `emailActions.ts`. |
| **REQ-2.2** (Send outcome decoupled from reminder failure) | **Met** | `afterSuccessfulSend` wraps scheduling in `try/catch` and swallows errors; send outcome is unaffected. |

---

### 4. Untested Cases in the Diff

1. **Online send with retryable provider failure (REQ-1.1)**: The test suite verifies offline queueing (`isOnline: false`), but does not test an online send that encounters a retryable network error to confirm `enqueuePendingOperation` receives `autoReminderDays` in `params`.
2. **Provider returns without message ID**: No test verifies that if `provider.sendMessage` resolves with `{ id: undefined }`, `afterSuccessfulSend` logs `"[emailActions] Send reported no message id; no auto reminder set"` and avoids calling `scheduleAutoReminder`.
3. **No thread ID on both provider and action**: No test covers a send where both `sent.threadId` and `action.threadId` are `undefined` (new message on a provider without thread tracking), verifying that `scheduleAutoReminder` receives `undefined` and exits cleanly.
4. **Existing pending reminder on retried thread**: No test verifies that when `getFollowUpForThread` returns an existing pending reminder, `insertFollowUpReminder` is not called a second time.
5. **Composer component parameter passthrough**: `Composer.tsx` was modified, but the diff contains no test asserting that `Composer` passes `{ autoReminderDays }` when `autoReminderWanted` is true and `undefined` when false.
6. **Non-`sendMessage` queued actions**: No test asserts that queued operations like `archiveThread` or `moveThread` bypass `scheduleAutoReminder`.
