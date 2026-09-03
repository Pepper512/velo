### Verdict
CHANGES REQUESTED

---

### Findings

* **H1** — `src/services/followup/autoReminders.ts`, lines 28–32 & 45–52 (`domainOf` and `isExternalSend`):
  * **Code:**
    ```typescript
    function domainOf(address: string): string | null {
      const at = address.lastIndexOf("@");
      if (at < 0 || at === address.length - 1) return null;
      return address.slice(at + 1).trim().toLowerCase();
    }
    ...
      const own = new Set(input.ownAddresses.map((a) => a.trim().toLowerCase()));
      return input.recipients.some((r) => {
        const addr = r.trim().toLowerCase();
        if (own.has(addr)) return false;
        const domain = domainOf(addr);
        if (domain === null) return false;
        return domain !== fromDomain;
      });
    ```
  * **What is wrong:** `domainOf` fails on standard RFC 5322 formatted recipient strings containing display names or angle brackets (e.g., `"Alice <alice@acme.com>"` or `"<alice@acme.com>"`), returning `"acme.com>"`. Furthermore, `own.has(addr)` checks the raw string with display name against bare addresses.
  * **Why:** In email composers, recipient addresses in `to`, `cc`, and `bcc` commonly include display names and angle brackets. Comparing `fromDomain` (`"acme.com"`) to `domain` (`"acme.com>"`) causes `domain !== fromDomain` to evaluate to `true`, falsely classifying internal recipients as external sends (violating REQ-1.2). Similarly, sending to one's own alias formatted as `"My Name <me@acme.com>"` bypasses `own.has(addr)` and is treated as external.
  * **Concrete change:** Strip angle brackets / display names to isolate the bare email address before performing `own.has()` checks and domain extraction:
    ```typescript
    function extractEmailAddress(raw: string): string {
      const match = raw.match(/<([^>]+)>/);
      return (match ? match[1] : raw).trim().toLowerCase();
    }

    function domainOf(address: string): string | null {
      const clean = extractEmailAddress(address);
      const at = clean.lastIndexOf("@");
      if (at < 0 || at === clean.length - 1) return null;
      return clean.slice(at + 1);
    }
    ```
    In `isExternalSend`:
    ```typescript
    const own = new Set(input.ownAddresses.map((a) => extractEmailAddress(a)));
    return input.recipients.some((r) => {
      const addr = extractEmailAddress(r);
      if (own.has(addr)) return false;
      const domain = domainOf(addr);
      if (domain === null) return false;
      return domain !== fromDomain;
    });
    ```

* **H2** — `src/services/followup/autoReminders.ts`, lines 118–120 (`scheduleAutoReminder`):
  * **Code:**
    ```typescript
    const existing = await deps.getFollowUpForThread(input.accountId, input.threadId);
    if (existing) return { scheduled: false, reason: "existing" };
    ```
  * **What is wrong:** Checks `if (existing)` truthiness rather than inspecting if the existing reminder's status is `'pending'`.
  * **Why:** REQ-1.3 states: *"WHEN a pending follow-up reminder already exists for the thread THE SYSTEM SHALL leave it untouched"*. `follow_up_reminders` has `UNIQUE(account_id, thread_id)` where rows persist with statuses such as `'triggered'` or `'cancelled'`. If an earlier email on the thread had a reminder that already fired or was cancelled, `getFollowUpForThread` returns that historical row, causing `scheduleAutoReminder` to abort with `"existing"`. Subsequent external follow-ups on the same thread will never receive an automatic reminder.
  * **Concrete change:** Check specifically for a pending status:
    ```typescript
    const existing = await deps.getFollowUpForThread(input.accountId, input.threadId);
    if (existing && existing.status === "pending") {
      return { scheduled: false, reason: "existing" };
    }
    ```

* **M1** — `src/components/composer/Composer.tsx`, line 353 (`Composer.handleSend`):
  * **Code:**
    ```typescript
    days: useUIStore.getState().autoRemindersDays,
    ```
  * **What is wrong:** `days` is read from `useUIStore.getState()` inside the deferred `setTimeout` callback when the message is dispatched, rather than when the user clicks Send.
  * **Why:** The composer promises the user "Remind me if no reply in N days" at Send time. Reading `autoRemindersDays` after the undo-send delay means a settings change during the undo window mutates the scheduled duration of an already-committed send.
  * **Concrete change:** Read and freeze `days` at Send time alongside `autoReminderWanted`:
    ```typescript
    const reminderDays = useUIStore.getState().autoRemindersDays;
    ```
    and pass `days: reminderDays` into `scheduleAutoReminder` inside the timer.

* **M2** — `src/services/followup/autoReminders.ts`, lines 62–66 (`autoReminderDueAt`):
  * **Code:**
    ```typescript
    due.setHours(DUE_HOUR, 0, 0, 0);
    const day = due.getDay(); // 0 = Sunday, 6 = Saturday
    if (day === 6) due.setDate(due.getDate() + 2);
    else if (day === 0) due.setDate(due.getDate() + 1);
    ```
  * **What is wrong:** Sets local hours to 09:00 *before* executing the weekend date roll (`setDate`).
  * **Why:** When Saturday is rolled to Monday across a daylight saving time transition on Sunday, applying `setDate(+2)` to an already-set time can cause hour shifts in timezones with ambiguous or non-standard transitions depending on engine date normalization.
  * **Concrete change:** Perform day adjustments first, and set hours last:
    ```typescript
    due.setDate(due.getDate() + normaliseAutoReminderDays(days));
    const day = due.getDay();
    if (day === 6) due.setDate(due.getDate() + 2);
    else if (day === 0) due.setDate(due.getDate() + 1);
    due.setHours(DUE_HOUR, 0, 0, 0);
    ```

* **M3** — `src/services/followup/autoReminders.ts`, lines 46–49 (`isExternalSend`):
  * **Code:**
    ```typescript
    const own = new Set(input.ownAddresses.map((a) => a.trim().toLowerCase()));
    return input.recipients.some((r) => {
      const addr = r.trim().toLowerCase();
      if (own.has(addr)) return false;
    ```
  * **What is wrong:** Does not normalize plus-addressing (e.g. `user+tag@domain.com`) when checking against `ownAddresses`.
  * **Why:** If an account has a secondary alias on an external domain `user@otherdomain.com`, sending to `user+filter@otherdomain.com` will fail `own.has(addr)` and be treated as an external recipient, setting an auto-reminder for an email sent to oneself.
  * **Concrete change:** Strip plus tags (`addr.replace(/\+[^@]*@/, "@")`) when building and checking `ownAddresses`.

* **L1** — `src/App.tsx`, lines 263–270:
  * **Code:**
    ```typescript
    const savedAutoReminders = await getSetting("auto_reminders_enabled");
    if (savedAutoReminders === "false") {
      ui.setAutoRemindersEnabled(false);
    }
    const savedAutoReminderDays = await getSetting("auto_reminders_days");
    if (savedAutoReminderDays !== null) {
      ui.setAutoRemindersDays(normaliseAutoReminderDays(savedAutoReminderDays));
    }
    ```
  * **What is wrong:** `ui.setAutoRemindersEnabled` and `ui.setAutoRemindersDays` call `setSetting` internally, writing back to SQLite during startup initialization the exact values just read from SQLite.
  * **Why:** Unnecessary SQLite write and disk I/O on application boot.
  * **Concrete change:** Either use `useUIStore.setState({ autoRemindersEnabled: false, ... })` during restore, or add non-persisting internal setters for boot restoration.

* **L2** — `src/stores/uiStore.ts`, lines 188–191 (`setAutoRemindersDays`):
  * **Code:**
    ```typescript
    setAutoRemindersDays: (autoRemindersDays) => {
      setSetting("auto_reminders_days", String(autoRemindersDays)).catch(() => {});
      set({ autoRemindersDays });
    },
    ```
  * **What is wrong:** Does not validate or normalize `autoRemindersDays` before writing to state and settings.
  * **Why:** If an invalid number is passed to `setAutoRemindersDays`, an unapproved choice is persisted to the database.
  * **Concrete change:** Wrap with `normaliseAutoReminderDays`:
    ```typescript
    setAutoRemindersDays: (days) => {
      const autoRemindersDays = normaliseAutoReminderDays(days);
      setSetting("auto_reminders_days", String(autoRemindersDays)).catch(() => {});
      set({ autoRemindersDays });
    },
    ```

* **N1** — `src/services/followup/autoReminders.ts`, line 51 (`isExternalSend`): Exact domain comparison means subdomains (e.g. `alice@eng.acme.com` vs `bob@acme.com`) are treated as external. This strictly matches the literal text of REQ-1.2 ("domain differs, case-insensitively"), but users in multi-subdomain organizations will need to use the composer uncheck override.
* **N2** — `src/components/composer/Composer.tsx`, lines 341–343: For queued/offline sends, `sendEmail` returns no `id` (`sent?.id` is undefined), correctly bypassing `scheduleAutoReminder` without error as specified in *Not doing*.

---

### Specification Requirements Assessment

* **REQ-1:** **UNMET**.
  * REQ-1.1 is compromised by H2 (reminders fail to insert if a completed/cancelled reminder exists for the thread).
  * REQ-1.2 is unmet due to H1 (fails to correctly classify recipients when formatted with display names or angle brackets).
  * REQ-1.3 is unmet due to H2 (`scheduleAutoReminder` does not restrict its check to `pending` reminders).
  * REQ-1.4 is met (logs `warn` and returns cleanly when send fails or provider returns no thread ID).
* **REQ-2:** **MET**. Due-time calculation lands on send time + N days at 09:00 local, and Saturday/Sunday correctly roll to Monday (subject to DST polish in M2).
* **REQ-3:** **MET (partially untestable from diff alone)**. The footer control is hidden when `autoRemindersEnabled` is false (REQ-3.2) and overrides default state when clicked (REQ-3.1). However, the reactive interaction in the React tree is untestable without component tests.
* **REQ-4:** **MET**. Settings keys added, UI controls added to Settings → Sending, defaulted to on and 3 days, and restored on startup.
* **REQ-5:** **MET**. Both `GmailApiProvider` and `ImapSmtpProvider` return `{ id, threadId? }`, surfacing Gmail's `resp.threadId` and IMAP's `effectiveThreadId`.

---

### Test Coverage Gaps

1. **Display name & angle bracket parsing in `isExternalSend`:**
   * Case: `isExternalSend({ from: "me@acme.com", recipients: ["Alice <alice@acme.com>"], ownAddresses: ["me@acme.com"] })`. Currently fails and returns `true`.
   * Case: `isExternalSend({ from: "Me <me@acme.com>", recipients: ["colleague@acme.com"], ownAddresses: ["me@acme.com"] })`.
2. **Existing reminder status in `scheduleAutoReminder`:**
   * Case: Thread has an existing reminder with `status: "triggered"` or `status: "cancelled"`. Must verify that `scheduleAutoReminder` proceeds with the insert and does not exit with `reason: "existing"`.
3. **DST transition boundary in `autoReminderDueAt`:**
   * Case: Send on Friday before a daylight saving time transition (spring forward / fall back). Verify that Monday due time is exactly 09:00:00 local time and not 08:00 or 10:00.
4. **Sending on Friday with 3 days delay:**
   * Case: Friday send with `days = 3` (e.g., Friday 2026-09-11 15:00 → Monday 2026-09-14 09:00).
5. **Month/year rollover in `autoReminderDueAt`:**
   * Case: Send on Dec 31 with `days = 3` or Feb 28 on a non-leap year.
6. **Own address plus-addressing in `isExternalSend`:**
   * Case: Recipient is `me+test@own-alias-domain.com` matching an own address alias.
7. **Composer React component integration tests:**
   * Case: Checkbox visibility when `autoRemindersEnabled` toggles.
   * Case: Checkbox auto-checks when external recipient is entered, and unchecks when replaced with an internal recipient.
   * Case: User manual toggle persists even when recipients are added or removed.
8. **Settings restore on app boot in `App.test.tsx`:**
   * Case: Setting `auto_reminders_enabled` is `"false"` in SQLite; app boots with `autoRemindersEnabled === false`.
   * Case: Setting `auto_reminders_days` is invalid/null in SQLite; app boots with `autoRemindersDays === 3`.
