# SPEC-SA — Share Availability: pick free slots from your calendar, insert them into the email

- **Task:** A button in the composer footer opens a panel showing the next working days; the
  user clicks the free slots they want to offer and Velo inserts them into the message as
  formatted text.
- **Tier:** **1** — frontend feature over data the app already stores; no schema, no Rust, no
  capability, no dependency. **But see *The correctness problem* — one decision in it is
  yours, not mine.**
- **Base:** `main` @ `987f8c7` (code pin `ca4ba28`, #92). Citations grepped at that SHA.
- **Status:** brief for approval; branch `share-availability`, PR opened with this file before
  any code.
- **Source:** ROADMAP §4 wave 2, item 1 (P1, 4 days); the vault's parity note — "Share
  Availability from the composer (`⌘⇧A`) — week strip, click slots, insert in user's style;
  calendar data already local; no public link needed for v1".
- **Effort:** M · 4 days as scoped below.

## Outcome

I am writing "when are you free?" and I press the button. A panel shows the next five working
days with my meetings blocked out. I click three open slots, press Insert, and the message now
reads:

> - Thursday 4 September, 10:00–10:30
> - Thursday 4 September, 14:00–15:00
> - Friday 5 September, 09:30–10:00
>
> (times in British Summer Time)

I send it. **Every slot I offered is genuinely free.**

## The correctness problem — read this before approving

This feature makes a **claim to a third party** about my time. A wrong slot is not a cosmetic
bug: it double-books me with someone I just invited. Three findings from the survey make that
a real risk today, and the first one is serious.

1. **CalDAV recurring events are never expanded.** `parseVEvent`
   (`icalHelper.ts:56-122`) handles UID/SUMMARY/DTSTART/DTEND/STATUS/ORGANIZER/ATTENDEE and
   **no `RRULE`, `RDATE`, `EXDATE` or `RECURRENCE-ID`**. A weekly standup on iCloud or Fastmail
   is stored as a single event at its *first* occurrence. Availability computed from that data
   would show every later standup slot as **free**. Google is unaffected — the provider asks
   for `singleEvents=true` (`googleCalendarProvider.ts:75`), so the server expands them.
2. **Calendar data is only fetched when the user visits the Calendar page.** There is no
   background calendar sync: `loadEvents` runs from `CalendarPage`'s effect
   (`CalendarPage.tsx:159-163`) and nothing in `App.tsx`'s checker list touches the calendar.
   A composer panel reading the local cache alone can find it empty or weeks stale.
3. **`status` is not filtered.** Cancelled and tentative events are upserted and rendered like
   any other (`CalendarPage.tsx:389`); only Google's delta path treats `cancelled` specially
   (`googleCalendarProvider.ts:195-196`). A cancelled meeting would block a slot that is
   actually free — the harmless direction, but still wrong.

(2) and (3) I will fix inside this brief: the panel fetches fresh from the provider before it
computes anything, and the slot rule ignores non-confirmed events. **(1) is a scoping
decision I want from you**, because the three honest answers cost very different amounts:

- **(a) Ship for Google-backed calendars; tell CalDAV users why not.** The button is present
  but disabled for an account whose calendar provider is CalDAV, with the reason in its
  tooltip. Smallest, honest, no false claims. Costs: CalDAV users get nothing.
- **(b) Ship for everyone with a visible caveat.** The panel warns "recurring events from this
  calendar may not be shown" for CalDAV accounts and offers the slots anyway. Cheap, but it
  puts the burden on the user to remember their own recurring meetings at the moment they are
  least likely to — and the email still goes out.
- **(c) Expand recurrence for CalDAV first, then ship for everyone.** Correct for all users,
  but `RRULE` expansion with `EXDATE`, `RECURRENCE-ID` overrides, `UNTIL`/`COUNT`, and
  timezone-aware `BYDAY` is a feature in its own right — comfortably larger than this one, and
  it should be its own brief with its own tests.

**I recommend (a) for this PR and (c) as the next calendar brief.** Offering someone a time
you are not free is worse than not offering at all, and (b) is the option that ships a known
wrong answer. Tell me which you want; I have not written code either way.

## What exists, verified at `987f8c7`

- **Events:** `calendar_events` (migration 18, `migrations.ts:297-315`; CalDAV columns in 19,
  `:704-708`), held as `DbCalendarEvent` (`calendarEvents.ts:3-22`) with `start_time` /
  `end_time` as **Unix seconds** and `is_all_day` as 0/1. `idx_cal_events_time` covers
  `(account_id, start_time, end_time)`.
- **The query is already there:** `getCalendarEventsInRangeMulti(accountId, calendarIds, start,
  end)` with overlap semantics (`calendarEvents.ts:76-92`), plus `getVisibleCalendars`
  (`calendars.ts:51-57`) for the calendars the user has ticked.
- **Providers:** Google over REST and CalDAV over `tsdav`, behind
  `getCalendarProvider(accountId)` and `hasCalendarSupport(accountId)`
  (`providerFactory.ts:22-55`). `CalendarPage` shows the cache-then-refresh pattern to copy
  (`CalendarPage.tsx:73-157`).
- **The composer slot:** the footer's left cluster, beside `<SignatureSelector />` and
  `<TemplatePicker editor={editor} />` (`Composer.tsx:640-662`).
- **The picker precedent:** `TemplatePicker.tsx` (81 lines) — a footer button, an
  `absolute bottom-full` popover, outside-click close via a local `mousedown` effect (`:25-34`),
  and the result inserted with `editor.commands.insertContent(html)` (`:45`).
- **Units:** mail dates are milliseconds (`utils/date.ts:4`); calendar, snooze and schedule are
  **seconds** (`utils/timestamp.ts`). Every calendar view converts at the boundary
  (`EventCard.tsx:10`, `EventDetailModal.tsx:24`).
- **Local-time date maths precedent:** `autoReminderDueAt` (`autoReminders.ts:62-72`) — move
  the date first, set the hours last, return seconds. DST-safe by construction.
- **No range formatter exists.** The only human date-range text is `formatTitle` in
  `CalendarToolbar.tsx:93-109`.

## Design

- **`src/services/calendar/availability.ts`** (new, pure — the whole feature's logic):
  - `freeSlots(input): Slot[]` where `input` is `{ busy: {start: number; end: number}[]; days:
    Date[]; workingHours: {start: number; end: number}; slotMinutes: number; minimumMinutes:
    number; now: Date }`. Busy intervals are merged, then each day's working window minus the
    merged busy time is cut into slots. All arithmetic in **seconds**, all day boundaries built
    with local `Date` mutation and hours set last (the `autoReminderDueAt` rule).
  - `busyIntervals(events)`: drops `status !== 'confirmed'`, drops all-day events (they are a
    label on a day, not a block — every view already treats them separately,
    `DayView.tsx:23-25`), and returns `{start, end}` in seconds.
  - `formatSlots(slots, locale, timeZoneLabel)`: the inserted text. One `<ul>` of
    `<li>Thursday 4 September, 10:00–10:30</li>`, then a line naming the zone from
    `Intl.DateTimeFormat().resolvedOptions().timeZone` — the recipient needs it and nothing in
    the app writes it today.
- **`src/components/composer/AvailabilityPicker.tsx`** (new): the `TemplatePicker` shape —
  footer button, `absolute bottom-full` popover, outside-click close. On open it calls
  `hasCalendarSupport`, then **fetches fresh** through the provider for the window it shows
  (the `CalendarPage.tsx:73-157` sequence) before computing, so it never offers slots from a
  stale cache; on a fetch failure it says so and offers nothing rather than offering wrong
  slots. Multi-select with checkboxes, an Insert button, and `editor.commands.insertContent`.
- **Settings** (`Settings → Composing → Sending`, the `ToggleRow`/`SettingRow` idiom at
  `SettingsPage.tsx:771-849`): working hours start and end, slot length (15/30/60), and how
  many days ahead to offer. Keys in `settingsKeys.ts`, store fields in `uiStore` with the
  `setX` persists / `restoreX` does not convention, restored in `App.tsx` **and**
  `ComposerWindow.tsx:28-44` (the pop-out composer restores only theme/font/colour today).
- **No keyboard shortcut in this PR.** The vault proposes `⌘⇧A`, but `Ctrl+Shift+A` is already
  `action.selectFromHere` (`shortcuts.ts:48`) and Ctrl combos fire even while typing in the
  composer (`useKeyboardShortcuts.ts:116-124`). Rebinding a shipped shortcut, or adding a
  composer-scoped handler where none exists today (`Composer.tsx` registers no `keydown`), is
  its own small decision — recorded, not smuggled in.

## Not doing

- **No public booking link, no "hold" events, no writing to the calendar.** v1 inserts text.
- **No free/busy lookup for the recipient**, no team availability.
- **No recurrence expansion** — that is option (c) above and its own brief.
- **No AI phrasing** ("written in your style" from the vault). The inserted block is
  deterministic; an LLM on the send path is the fork's standing boundary.
- **No change to `CalendarPage`, the views, or the modals.**

## Tasks (risk-first; after the scoping answer)

- [ ] 1. `availability.test.ts` → `availability.ts`: merged overlapping busy intervals; a slot
  that only partly fits is dropped; working-hours edges; a fully booked day yields nothing;
  all-day events do not block; cancelled and tentative events do not block; slots never start
  in the past (`now`); a day whose DST shift changes its length still produces correct local
  times; seconds in, seconds out.
- [ ] 2. `formatSlots` tests: the list shape, the zone line, an empty selection.
- [ ] 3. `AvailabilityPicker` render tests: fetch-then-compute on open, the failure path offers
  nothing and says why, multi-select, insert calls the editor. **No test in the repo mounts a
  TipTap editor** — the editor is passed as a prop, so it is stubbed as
  `{ commands: { insertContent: vi.fn() } }` rather than instantiated.
- [ ] 4. Settings, store fields, boot restore in both windows.
- [ ] 5. Composer footer wiring; help card in the `composing` category
  (`helpContent.ts:298-439`, the `templates` card at `:393-407` is the analogue); `CLAUDE.md`
  counts; LOG.md.

## Done when

`npx vitest run` green with the new tests, `tsc`, `graph:check`, `docs:check` green; CI green
on the merge commit. **Manual (Jim, open):** open the composer on an account with a calendar,
press the button, confirm the blocked-out times match what the Calendar page shows for those
days, insert two slots and see them in the message.

## Rollback

`git revert` — no schema, no persisted state beyond four settings keys that are ignored when
the code is gone.

## Review

Two legs on the PR: Gemini 3.8 Flash High via `agy`; Grok 4.6 via the `grok` CLI; a follow-up
pass on the fix delta. Verify every finding against source before adopting.

## Approval

Jim, 2026-09-03, by the wave-2 instruction — **except** the CalDAV recurrence scope, which is
the open question above and blocks task 1.
