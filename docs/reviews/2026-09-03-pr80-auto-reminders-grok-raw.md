The review needs the complete spec and diff from the offloaded prompt; I'll read that file only so the findings can cite exact hunks.The prompt file may continue past the last hunk I have; I'll read the remainder so the review covers the whole diff.CHANGES REQUESTED

- **H1** `src/services/followup/autoReminders.ts` (`scheduleAutoReminder`, `if (existing)`). REQ-1.3 only protects a **pending** row; the guard skips on any row. `insertFollowUpReminder` upserts on `UNIQUE(account_id, thread_id)`, and a reply already cancels in place, so a cancelled/triggered row will still be returned. A later external send on that thread then never gets a new auto reminder (the common “they replied, I sent again” path). Test only feeds `{ status: "pending" }`. Quote: `if (existing) return { scheduled: false, reason: "existing" };` Change: `if (existing?.status === "pending") return { scheduled: false, reason: "existing" };` and add cases for `cancelled` and `triggered` that **do** insert.

- **M1** `src/services/followup/autoReminders.ts` (`domainOf` / `isExternalSend`). The domain rule is a raw `lastIndexOf("@")` plus an exact-string own-address set. `"Jane <peer@acme.com>"` → domain `"acme.com>"` (≠ `"acme.com"`); that colleague looks external. `"Jane <alias@acme.com>"` does not match `own` (`"alias@acme.com"`), so an alias can look external too. `"foo@  "` survives the `at === length - 1` check, trims to `""`, and `"" !== fromDomain` is true. Quote: `return address.slice(at + 1).trim().toLowerCase();` and `if (own.has(addr)) return false;`. Change: parse the addr-spec (angle-bracket payload, ignore empty domain: `const d = ...trim().toLowerCase(); return d || null`), and match `own` on the extracted address.

- **M2** `src/components/composer/Composer.tsx` (post-`sendEmail` block). A successful send with no `data.id` (offline / queued) is a silent no-op: no `scheduleAutoReminder`, no `warn`. REQ-1.1 applies to a send that is not `handleSchedule`; REQ-1.4 requires a `warn` when there is nothing to hang a reminder on. The queue processor is untouched, so the reminder is not created when the queue later sends either. Quote: `if (sent?.id) {` … `await scheduleAutoReminder(...)` with the comment “A queued (offline) send has no message id yet”. Change: if `autoReminderWanted` and (`!sendResult.success` or missing `id`/`threadId`), `console.warn` why; for queued sends, persist the already-computed `autoReminderWanted` + `days` and run `scheduleAutoReminder` in the queue processor at real send time (same hook the brief already assigned to scheduled sends).

- **L1** `src/constants/helpContent.ts`. Automatic tip hardcodes “3 days later at 9:00” even though N is a setting. Quote: `a reminder is set for you — 3 days later at 9:00`. Change: “the delay you chose under Settings → Sending, at 9:00”.

- **L2** `src/components/composer/Composer.tsx`. Outer `try/catch` around `scheduleAutoReminder` is dead: that function already swallows errors and returns `{ scheduled: false, reason: "failed" }`. Quote: `} catch (err) { console.warn("[autoReminders] Could not set the automatic reminder:", err); }`. Change: drop the extra catch, or log/use the returned `reason`.

- **L3** `src/stores/uiStore.ts` (`setAutoRemindersDays`) and `SettingsPage.tsx` (`Number(e.target.value)`). Setter persists whatever number it is given; only boot restore and `autoReminderDueAt` normalise. A corrupt/NaN value can show in the composer label while due-time silently becomes 3. Quote: `setSetting("auto_reminders_days", String(autoRemindersDays)); set({ autoRemindersDays });`. Change: `setAutoRemindersDays` should store `normaliseAutoReminderDays(days)`.

- **N1** Subdomains (`mail.acme.com` vs `acme.com`) and plus-addresses (`a+tag@acme.com`) follow the spec’s whole-domain, case-insensitive compare: different host → external; same host → internal. Two Gmail users stay internal, as the brief recorded.

- **N2** Due-time math (`setDate` then `setHours(9,0,0,0)`, Sat +2 / Sun +1) is calendar-local, not business-day add, and N ≥ 1 so a send after 09:00 cannot land on the same morning. Friday + 3 → Monday 09:00 with no extra roll. DST inside the window is handled by setting local 09:00. Fine.

- **N3** Decision is captured at Send (`autoReminderWanted` before the undo timer); `sentAt` is taken after the timer. `closeComposer` clearing `autoReminderOverride` does not affect that closure. Feature-off: `effectiveAutoReminder` is false, the checkbox is unmounted, action bar / checker / schema are untouched. Default-on for users with no stored key is the briefed behaviour change.

## REQ-1 … REQ-5

| ID | Verdict |
|---|---|
| **REQ-1.1** | **Unmet** for a later send on a thread that already has a non-pending row (H1). Met for the first pending insert on an immediate successful send with an id. Queued/offline send: **unmet** in this diff (M2). Scheduled: out of scope. |
| **REQ-1.2** | **Met** for bare `local@domain` (case, own aliases, Bcc-merged list, no `@`). **Unmet** for display-name / angle-bracket / empty-domain forms (M1). IDN punycode vs Unicode: **untestable** (no normalisation in the diff). |
| **REQ-1.3** | **Unmet** as specified: code leaves *any* existing row, not only pending (H1). Pending-row non-overwrite is met. |
| **REQ-1.4** | **Met** for missing `threadId` inside `scheduleAutoReminder` (`warn` + no insert). **Unmet** for send failure and for success-without-`id` (no warn) (M2). Send outcome is not coupled to reminder failure: met. IMAP save-fail on a **new** message: no thread id → no reminder: met. IMAP save-fail on a **reply**: `_threadId` is still returned, reminder can be set: met (same “row without local message” window the brief accepted). |
| **REQ-2.1 / 2.2** | **Met** from the diff (local 09:00, weekend roll, days normalised to 1/2/3/7). Month/year overflow relies on `Date` (sound, not shown in tests). |
| **REQ-3.1** | **Met** in the diff: checkbox bound to `override ?? external`, override sticky, reset on open/close, label uses N, send-time uses the same `effectiveAutoReminder`. Composer behaviour **untestable** (no component test). |
| **REQ-3.2** | **Met** in the diff (`autoRemindersEnabled &&`). Untestable without a composer render test. |
| **REQ-4.1** | **Met**: keys, default on / 3 days, Sending toggle + select, persist, boot restore (`"false"` off; missing key stays on; days normalised). |
| **REQ-5.1** | **Met**: interface `{ id, threadId? }`; Gmail `resp.threadId`; IMAP `effectiveThreadId` from save, else input `_threadId`. Callers using only `id` unchanged. |

## Tests in the diff that are missing

- **`scheduleAutoReminder`**: existing row `status: "cancelled"` and `"triggered"` must insert; only pending must skip (H1).
- **`isExternalSend`**: `"Name <user@ex.com>"`; own alias in that form; `"foo@"` vs `"foo@ "` (empty domain); plus-address on the same domain; subdomain vs registrable domain (document the spec’s whole-label rule).
- **`autoReminderDueAt`**: Friday + 3 → Monday 09:00 (the manual “done when” case); month/year boundary (e.g. 31 Jan + 1, 30 Dec + 3); a DST spring-forward Saturday→Monday window; Sunday send + 1.
- **Composer**: control absent when the setting is off; default check flips as To/Cc/Bcc change until tick; after tick, recipient edits must not reset; post-send calls `scheduleAutoReminder` with `data.threadId ?? state.threadId`; send failure / queued result with no `id` does not insert and should warn.
- **IMAP `sendMessage`**: local save throws — reply still returns the input thread id; new message omits `threadId`.
- **Boot restore**: missing `auto_reminders_enabled` stays on; `"false"` turns off; garbage `auto_reminders_days` becomes 3.
