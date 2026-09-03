# SPEC-AR — Auto Reminders: a follow-up reminder by default on every external send, skipping weekends

- **Task:** When a message is sent to someone outside the sender's own domain, set a
  follow-up reminder automatically (default: 3 days, at 9:00 local, never on a weekend), with a
  per-message control in the composer to drop it and a setting to turn the whole thing off.
  The existing follow-up machinery does the rest: it already auto-cancels when a reply arrives
  and notifies when the reminder is due.
- **Tier:** **1** — frontend feature on existing data and existing tables; no schema, no Rust,
  no dependency, no capability, no CSP. Brief in the PR before code; one PR; two review legs
  (Jim's 2026-09-03 instruction for wave 1).
- **Base:** `main` @ `40fc817` (code pin `e05f6cd`, #75). Citations grepped at `40fc817`.
- **Status:** approved (brief) — branch `auto-reminders`, PR opened with this file before any
  code. Jim, 2026-09-03: *"take enhancement wave 1 from docs/ROADMAP.md §4 in order, briefs
  first (Tier 1: Auto Reminders on external sends; …), one PR per item."*
- **Source:** ROADMAP §4 wave 1, item 1 (P1, 1.5 days); the vault's
  `2026-09-01_Velo_Superhuman-Parity_Enhancements.md` ("Auto Reminders: default follow-up on
  every external send, skip weekends, auto-cancel on reply, paired with auto-draft" — the
  auto-draft half is out, see *Not doing*; its note: "`followupManager.ts` fires + auto-cancels;
  add a send-time default + external-domain test"); the vault queue
  `Build Queue/20-Enhancements/_queue-enhancements.md` row 1.
- **Effort:** S–M · 1.5 days.

## Outcome

I send a message to someone outside my company. Three days later, if nobody has replied, Velo
reminds me — and if the third day is a Saturday, it waits until Monday morning. I never had to
think about it; the composer showed me "Remind me if no reply in 3 days" before I pressed Send,
and I could have unticked it. Replies to colleagues get no reminder unless I ask. A reply
cancels the reminder, as it does today.

## What exists, verified at `40fc817`

1. **Follow-up reminders are manual and thread-scoped.** `follow_up_reminders(id, account_id,
   thread_id, message_id, remind_at, status)` with `UNIQUE(account_id, thread_id)`
   (`migrations.ts:339-350`); `insertFollowUpReminder` **upserts** on that key
   (`followUpReminders.ts:14-28`), so a second insert for a thread silently replaces the first;
   `getFollowUpForThread` (`:40`), `cancelFollowUpForThread` (`:61`). The only writer is the
   thread action bar (`ActionBar.tsx:183-191`, after `FollowUpDialog`'s presets of 1/2/3 days or
   1 week at 09:00 local, `FollowUpDialog.tsx:9-38`).
2. **The checker already does the hard parts.** `followupManager.ts:14-49` runs every 60 s:
   for each due reminder it counts messages in the thread dated after the tracked message and
   not from the account's address — a reply cancels the reminder, otherwise it becomes
   `triggered` and `notifyFollowUpDue` fires. Nothing in this brief changes it; the auto
   reminder is just another row.
3. **The send path knows the recipients but throws away the ids.** `Composer.handleSend`
   (`Composer.tsx:273-338`) builds the raw message from `state.to/cc/bcc`, `state.fromEmail ??
   activeAccount.email`, waits out the undo-send delay, then `sendEmail(accountId, raw,
   state.threadId)`. `sendEmail` → `executeEmailAction` returns `{ success, data }` with
   `data` = the provider's result (`emailActions.ts:358`). **Both providers return only
   `{ id }`** (`gmailProvider.ts:214-220`, `imapSmtpProvider.ts:452-484`) — yet Gmail's API
   response carries `threadId` (`GmailMessage`, `gmail/client.ts:353-356`) and the IMAP provider
   computes `effectiveThreadId = threadId ?? messageId` when it saves the sent copy locally
   (`imapSmtpProvider.ts:512`). A reminder row needs a `thread_id`; a reply has one in
   `state.threadId`, a new message does not until the provider says so.
4. **"My own addresses" are known.** `accounts.email` and the send-as aliases
   (`sendAsAliases.ts:45 getAliasesForAccount`); `state.fromEmail` is the alias in use.
5. **Settings pattern to mirror:** `send_and_archive` — a `SETTING_KEYS` entry
   (`settingsKeys.ts:61`), a `uiStore` field with a setter that persists (`uiStore.ts:59,115,
   172-174`), restored at start-up (`App.tsx:255-258`), a `ToggleRow` in Settings → Sending
   (`SettingsPage.tsx:770-775`). The composer already reads `useUIStore.getState().sendAndArchive`
   inside the send timer (`Composer.tsx:314`).
6. **The composer footer** has room beside Discard/Send (`Composer.tsx:626-650`); the composer
   store is reset on open and close (`composerStore.ts:95-135`), so a per-message flag lives
   there naturally.
7. **Tests:** no test for `followupManager`, `FollowUpDialog` or the action bar's insert;
   provider `sendMessage` tests exist (`gmailProvider.test.ts:276`,
   `imapSmtpProvider.test.ts:630`); the SQLite harness runs real migrations
   (`snoozeSync.test.ts:63-70` is the pattern).
8. **Help** has a "Follow-up reminders" entry (`helpContent.ts:712-724`) that says reminders are
   set from the action bar — to be extended, not duplicated.

## Requirements

- **REQ-1** As a user I want a reminder set for me when I write to someone outside my company.
  - REQ-1.1 WHEN a message is sent (not scheduled — see *Not doing*) AND auto reminders are
    on AND the message's effective flag is on THE SYSTEM SHALL insert a pending follow-up
    reminder for the sent message's thread, due at the computed time (REQ-2).
  - REQ-1.2 The effective flag defaults to **on** when the send is *external*: at least one
    recipient (To, Cc or Bcc) whose domain differs, case-insensitively, from the sending
    address's domain, and who is not one of the account's own addresses (the account email
    and its send-as aliases). Otherwise it defaults to **off**.
  - REQ-1.3 WHEN a pending follow-up reminder already exists for the thread THE SYSTEM SHALL
    leave it untouched (a manual reminder is never overwritten by an automatic one).
  - REQ-1.4 WHEN the send fails, or the provider returns no thread id THE SYSTEM SHALL set
    no reminder and log why at `warn`; the send's own outcome is unaffected.
- **REQ-2** As a user I want the reminder to land on a working morning.
  - REQ-2.1 The due time SHALL be *send time + N days* at **09:00 local**, N from the setting
    (default 3; choices 1, 2, 3, 7).
  - REQ-2.2 WHEN that falls on a Saturday or Sunday THE SYSTEM SHALL move it to the following
    Monday 09:00 local.
- **REQ-3** As a user I want to see and change it before sending.
  - REQ-3.1 The composer SHALL show a control "Remind me if no reply in N days" whenever auto
    reminders are on, checked or unchecked per REQ-1.2, recomputed as recipients change until
    the user touches it, after which the user's choice holds for that message.
  - REQ-3.2 The control SHALL be absent when auto reminders are off (the manual action-bar
    reminder is unchanged either way).
- **REQ-4** As a user I want to turn it off, or change the delay, in Settings.
  - REQ-4.1 Settings → Sending SHALL have "Auto reminders on external sends" (toggle, **on by
    default** — the roadmap item is "default on external sends") and "Remind after" (1, 2, 3, 7
    days), persisted as `auto_reminders_enabled` and `auto_reminders_days`, restored at start-up.
- **REQ-5** Providers report the thread the sent message belongs to.
  - REQ-5.1 `EmailProvider.sendMessage` SHALL return `{ id, threadId? }`: Gmail from the API
    response's `threadId`; IMAP the `effectiveThreadId` it saved the sent copy under. Existing
    callers that use only `id` are unaffected.

## Not doing

- **Auto-drafting the follow-up** — LLM output on the send path is the fork's boundary (vault:
  "Draft, never send"); a separate brief if ever.
- **Scheduled sends** (`handleSchedule`, the queue path) — the send happens later, out of the
  composer's hands; recorded as the follow-up, with the same rule applied at send time by the
  queue processor.
- **The Reminders split-inbox tab** — wave 1 item 2, its own brief.
- **Domain allow/deny lists, per-contact rules, a consumer-domain exception** — the
  per-message control covers the odd case (two Gmail users count as "internal" by the domain
  rule; the user ticks the box). Recorded.
- **Changing the checker** (`followupManager.ts`) — it is correct as it is.

## Design

- **`src/services/followup/autoReminders.ts`** (new, pure): `isExternalSend({ from,
  recipients, ownAddresses })` per REQ-1.2 (domains lower-cased; a recipient without `@` is
  ignored); `autoReminderDueAt(sentAt: Date, days: number): number` per REQ-2 (unix seconds,
  local time, the Saturday/Sunday roll); `effectiveAutoReminder({ enabled, override,
  external })` per REQ-3.1; and `scheduleAutoReminder(deps, { accountId, threadId, messageId,
  sentAt, days })` per REQ-1.1/1.3/1.4 — `deps` is `{ getFollowUpForThread,
  insertFollowUpReminder }` so the function is tested with fakes and the composer passes the
  real ones. `days` is validated to the four choices; anything else falls back to 3.
- **`types.ts` / providers:** `sendMessage(...): Promise<{ id: string; threadId?: string }>`;
  `gmailProvider` returns `resp.threadId`; `imapSmtpProvider` returns its `effectiveThreadId`
  (the value it already computes at `:512`, surfaced from `saveSentMessageLocally`).
- **`Composer.tsx`:** after a successful `sendEmail`, `threadId = data.threadId ?? state.threadId`;
  if the message's effective flag is on, `scheduleAutoReminder(...)`. The control (REQ-3) sits
  in the footer beside Discard, reading `useUIStore` for the setting and `useComposerStore`
  for `autoReminderOverride: boolean | null` (new field, reset on open/close); its label shows
  the configured N; `ownAddresses` = `activeAccount.email` plus the aliases already loaded for
  the From selector.
- **`uiStore`:** `autoRemindersEnabled` (default `true`), `autoRemindersDays` (default 3), with
  persisting setters; `App.tsx` restores both (`"false"` turns it off; the absence of a stored
  value means the default, so existing users get the feature on — this is the one behaviour
  change for them, and it is the feature).
- **`settingsKeys.ts`:** `auto_reminders_enabled`, `auto_reminders_days`.
- **`SettingsPage.tsx`:** the toggle and the select under Sending, after "Send and archive".
- **Help:** the "Follow-up reminders" entry gains the automatic behaviour, the Settings
  location and the composer control; the "set from the action bar" tip stays.
- **Decision & alternatives** — (a) the rule in a pure module with the composer as the only
  caller (chosen; testable without React, and the scheduled-send path can reuse it later).
  (b) Hook inside `emailActions.sendEmail`: the service would need recipients and the user's
  per-message choice it does not have — wrong layer. (c) Insert the reminder before the send
  and cancel on failure: a window in which a reminder exists for a message that never went.
  (d) "External" = not my own address (no domain rule): every colleague reply gets a reminder;
  the roadmap and Superhuman both say *external*, and the per-message control handles the
  consumer-domain case.
- **Data / schema** — none; the existing table and its unique key.
- **Failure modes** — provider returns no `threadId` (a future provider, or a Gmail response
  without one): no reminder, one `warn`; the reminder row exists but the sent message's local
  row does not yet (Gmail, before the next sync): the checker's date subquery is `NULL`, so a
  reply in that window is not seen as one — the same as a manual reminder set in that window
  today, and bounded by the 60 s sync; the user unticks and the setting is on: no row, nothing
  else; a Bcc-only external send: still external (Bcc counts).

## Tasks (risk-first)
- [ ] 1. `autoReminders.test.ts` then `autoReminders.ts`: external rule (same domain, other
  domain, own alias, mixed case, Bcc-only, no `@`), due-time math (weekday, Friday + 1 →
  Monday, Saturday send, Sunday send, 7 days across a weekend, DST-neutral by using local
  `setHours`), effective flag (override wins; off when disabled), scheduling (inserts;
  respects an existing pending reminder; no thread id → no insert and a warning; days
  outside the set → 3). — REQ-1, REQ-2, REQ-3.1
- [ ] 2. Provider tests then the `threadId` return in both providers and the interface. — REQ-5
- [ ] 3. Store fields, settings keys, App restore, Settings rows. — REQ-4
- [ ] 4. Composer: the control and the post-send call. — REQ-1.1, REQ-3
- [ ] 5. Help entry; LOG.md; `CLAUDE.md` feature list if it names follow-ups; HANDOFF after
  merge; the vault queue row.

## Done when
`npx vitest run` green with the new tests, `tsc`, `graph:check`, `docs:check` green; CI green on
the merge commit; the composer shows the control only when the setting is on, defaulting per
the rule. **Manual (Jim, open):** send to an external address with the delay set to 1 day on a
Friday, see the reminder appear on the thread (action bar shows it set) for Monday 09:00; reply
from the other side, see it cancel.

## Rollback
`git revert`; turning the setting off is the runtime rollback; rows already inserted are
ordinary follow-up reminders and can be cancelled from the action bar as today.

## Review
Two legs on the PR: Gemini 3.8 Flash High via `agy`; Grok 4.6 via the `grok` CLI. Diffs from
committed SHAs; findings verified against source before adoption; dispositions on the PR and in
LOG.md.

## Approval
Jim, 2026-09-03, by the wave-1 instruction quoted under *Status*. The brief is this file,
committed before the code.
