# SPEC-SIT — Custom split-inbox tabs: from smart labels, a Reminders tab, hide-empty

- **Task:** Let the user choose what the split inbox's tabs are. Today the strip is the five
  fixed AI categories. After this, a tab can be one of those categories, **any user label**
  (a smart label — a label with an AI rule — is the case the roadmap names), or **Reminders**
  (threads with a pending follow-up reminder); tabs can be reordered and removed; a tab can
  hide itself when it has nothing in it.
- **Tier:** **1** — frontend feature on existing tables; no schema (the configuration is one
  JSON setting), no Rust, no dependency, no auth or secret handling.
- **Base:** `main` @ `3296cf1` (code pin `ea18efc`, #85). Citations grepped at `3296cf1`.
- **Status:** approved (brief) — branch `split-inbox-tabs`, PR opened with this file before any
  code; tests first.
- **Source:** ROADMAP §4 wave 1, item 2 (P1, 3 days); the vault's Superhuman-parity ranking
  (memory `velo-superhuman-parity`: "custom split-inbox tabs from smart labels + Reminders tab
  + hide-empty"); SPEC-AR's *Not doing* ("the Reminders split-inbox tab — wave 1 item 2").
- **Effort:** M · 3 days on the roadmap; expected less because every query pattern exists.

## Outcome

A user with a smart label "Invoices" and the auto reminders from #80 can make the split inbox
read *Primary · Invoices · Reminders · Updates*, in that order, with Promotions gone and
Newsletters shown only when something is in it — and `g p` still goes to Primary.

## What exists, verified at `3296cf1`

- **The strip.** `src/components/email/CategoryTabs.tsx` renders `ALL_CATEGORIES` (the five
  `ThreadCategory` names, `src/services/db/threadCategories.ts:3-11`) with an icon per name and
  an unread pill; it takes `activeCategory`, `onCategoryChange`, `unreadCounts`.
- **The list.** `src/components/layout/EmailList.tsx`: in split mode the active tab is the
  router's `category` search param (`useActiveCategory`, `navigateToLabel("inbox", { category })`,
  `src/router/navigate.ts:15,60`); `"All"` means unified. Loading branches on
  `activeLabel === "inbox" && activeCategory !== "All"` → `getThreadsForCategory(accountId,
  category, PAGE_SIZE, offset)` (`src/services/db/threads.ts:58-93`: INBOX ∩ category, Primary
  including uncategorised), else `getThreadsForAccount(accountId, labelId, …)`. Counts:
  `getCategoryUnreadCounts` (`threadCategories.ts:121-140`, INBOX ∩ unread, grouped by category,
  NULL → Primary). Bundles and held threads are filtered only in the `"All"` view.
- **The mode.** `uiStore.inboxViewMode: "unified" | "split"`, persisted as `inbox_view_mode`;
  Settings → General → "Inbox view mode" (`SettingsPage.tsx:528-539`); the sidebar's toggle
  icon next to Inbox.
- **Shortcuts.** `g p/u/o/c/n` → `navigateToLabel("inbox", { category: "Primary" | … })`
  (`src/hooks/useKeyboardShortcuts.ts:240-…`).
- **Smart labels.** `smart_label_rules` rows point at a `label_id` (`src/services/db/
  smartLabelRules.ts:4-13`); the label itself is an ordinary row in `labels` with
  `type = "user"` (`src/stores/labelStore.ts:7-15`); membership is `thread_labels`.
- **Reminders.** `follow_up_reminders(account_id, thread_id, status)`; the list already looks
  up pending reminders for the visible threads (`getActiveFollowUpThreadIds`,
  `followUpReminders.ts:72-84`) to draw the indicator.
- **Settings store.** `settings` is a key-value table read with `getSetting`/`setSetting`;
  other structured settings are stored as JSON or comma lists and validated on restore
  (`sidebar_nav_config`, `auto_archive_categories`).
- **Zod** is in `package.json` (approved for boundary validation) and used at the settings
  boundary elsewhere; the configuration JSON here is parsed with it.

## Requirements

- **REQ-1** As a user I want to choose my split-inbox tabs.
  - **1.1** THE SYSTEM SHALL store an ordered list of tabs in one setting, `split_inbox_tabs`
    (JSON). Each tab is one of: a **category** (`Primary`, `Updates`, `Promotions`, `Social`,
    `Newsletters`); a **label** (a `labels.id`, shown under the label's current name); or
    **Reminders**. Each tab has `hideWhenEmpty: boolean`.
  - **1.2** WHEN the setting is absent or fails validation THE SYSTEM SHALL use the default —
    the five categories in today's order, `hideWhenEmpty: false` — so nothing changes for an
    existing user until they edit the tabs.
  - **1.3** THE SYSTEM SHALL validate the stored JSON at the boundary (shape, kinds, no
    duplicate tab ids, at least one tab); an invalid value is replaced by the default and the
    failure logged.
- **REQ-2** As a user I want the tabs to show what I chose.
  - **2.1** A **category** tab SHALL list INBOX threads of that category, exactly as today
    (Primary includes uncategorised threads).
  - **2.2** A **label** tab SHALL list INBOX threads carrying that label, newest first, pinned
    first, paged like the others.
  - **2.3** The **Reminders** tab SHALL list every thread of the account with a pending
    follow-up reminder — inbox or not, because a reminder usually hangs on a sent thread —
    ordered by the reminder's due time, soonest first.
  - **2.4** Each tab SHALL show its unread count: category tabs as today; a label tab the unread
    INBOX threads with the label; Reminders the unread threads among those with a pending
    reminder.
  - **2.5** A label tab whose label no longer exists for the active account SHALL not be shown
    (and stays in the setting, so switching accounts back restores it).
- **REQ-3** As a user I want empty tabs out of the way.
  - **3.1** WHEN a tab has `hideWhenEmpty` and its thread count (not unread — total threads the
    tab would list) is zero THE SYSTEM SHALL not render it.
  - **3.2** WHEN the active tab becomes hidden (or invalid) THE SYSTEM SHALL fall back to the
    first visible tab.
  - **3.3** At least one tab SHALL always be visible: if every tab would hide, the first
    configured tab is shown regardless.
- **REQ-4** As a user I want to edit the tabs in Settings.
  - **4.1** Settings → General, under "Inbox view mode" (enabled in split mode): the ordered
    list of tabs with move up / move down / remove and a "hide when empty" toggle per tab; an
    "Add tab" control offering the categories not yet present, the active account's user
    labels not yet present (smart-labelled ones marked), and Reminders if not present.
  - **4.2** Changes SHALL persist immediately and the inbox SHALL reflect them on the next
    render (the store is the source; the list reads it).
- **REQ-5** Keyboard and help.
  - **5.1** `g p/u/o/c/n` SHALL keep navigating to their category; if that category is not a
    configured tab, the shortcut SHALL do nothing (no phantom tab).
  - **5.2** The "Split inbox" help card SHALL describe custom tabs, the Reminders tab and
    hide-when-empty.

## Not doing

- **Per-account tab sets** — one global list; label tabs are per account by construction
  (REQ-2.5). If two accounts share a label *name*, each has its own label id; a later brief
  can key tabs by name.
- **A "Reminders" category for notifications/auto-archive** — those settings stay on the five
  categories.
- **Drag-and-drop reordering** — up/down buttons, like the sidebar editor.
- **Counting label tabs in the sidebar's unread pills** — SPEC-243's separate item.
- **Tab icons for labels** beyond the label's colour dot.

## Design

- **`src/services/inbox/splitTabs.ts`** (new, pure): `SplitTab = { id, kind: "category" |
  "label" | "reminders", labelId?, category?, hideWhenEmpty }` with ids `"Primary"` … (the
  category name, so the router param and the shortcuts are unchanged), `"label:<labelId>"`,
  `"reminders"`; `DEFAULT_SPLIT_TABS`; a Zod schema; `parseSplitTabs(json: string | null):
  SplitTab[]` (default on any failure); `serializeSplitTabs`; `visibleSplitTabs(tabs, {
  labelsById, totalCounts })` applying REQ-2.5, 3.1 and 3.3; `resolveActiveTab(visible,
  requested)` (REQ-3.2); `addTab`, `removeTab`, `moveTab`, `setHideWhenEmpty` helpers.
- **`src/services/db/threads.ts`:** `getInboxThreadsForLabel(accountId, labelId, limit,
  offset)` (INBOX ∩ label, same ORDER BY as the category query) and
  `getThreadsWithPendingReminders(accountId, limit, offset)` (JOIN `follow_up_reminders`,
  `status = 'pending'`, ORDER BY `remind_at`).
- **`src/services/db/threadCategories.ts` (or a new `splitTabCounts.ts`):**
  `getSplitTabCounts(accountId, tabs)` returning per tab `{ total, unread }` — categories from
  one grouped query (extending today's to count total and unread), label tabs from one grouped
  query over `thread_labels`, Reminders from one query.
- **`uiStore`:** `splitInboxTabs: SplitTab[]` + `setSplitInboxTabs` (persists JSON); restored in
  `App.tsx` through `parseSplitTabs`.
- **`CategoryTabs.tsx`:** takes `tabs: { id, name, kind, unread, color? }[]` instead of
  `ALL_CATEGORIES`; icon by kind for category/reminders, a colour dot for labels.
- **`EmailList.tsx`:** builds the visible tabs from the store, the label store and the counts;
  branches loading on the active tab's kind; `"All"` unchanged; the bundle/held filter stays
  `"All"`-only.
- **`SettingsPage.tsx`:** the editor under "Inbox view mode".
- **`useKeyboardShortcuts.ts`:** the five `g` shortcuts check the configured tabs (REQ-5.1).
- **Decision & alternatives** — (a) category-name ids for category tabs (chosen: no migration
  of URLs, shortcuts, or the `thread_categories` table); (b) a new `inbox_tabs` table — heavier
  than a JSON setting for a list of at most a dozen entries; (c) Reminders limited to INBOX —
  rejected: the reminder is on the sent thread.
- **Data / schema** — none; one new settings key.
- **Failure modes** — corrupt JSON → default + log (REQ-1.3); a label deleted → tab hidden
  (REQ-2.5); all tabs hidden → first shown (REQ-3.3); counts query failing → tabs shown, no
  pills, no hiding (fail open on display, never on data).

## Tasks (risk-first)

1. Brief committed; PR opened.
2. Tests first: `splitTabs.test.ts` (parse defaults/invalid/duplicates, visibility with
   hide-empty and missing labels, active-tab fallback, add/remove/move); `threads.splitTabs.test.ts`
   on the SQLite harness (label ∩ INBOX paging and order; reminders order by due time, inbox
   or not); `CategoryTabs.test.tsx` extended (arbitrary tabs, kinds, counts).
3. The pure module, the queries, the store and boot restore.
4. `CategoryTabs`, `EmailList`, the shortcuts guard.
5. The Settings editor; the help card.
6. Gates (`tsc`, suite, graph, docs counts); LOG; two review legs; merge on green.

## Done when

The tests in Task 2 are green; an existing user sees exactly today's five tabs until they
edit; a label tab, a Reminders tab and hide-when-empty behave per REQ-2/3 in the running app
(Jim's glance, recorded as open).

## Rollback

Revert the squash commit; the `split_inbox_tabs` setting row is ignored by the old code.

## Review

Two cross-vendor legs on the diff from committed SHAs (Gemini 3.8 Flash High, Grok 4.6);
every finding verified against source before adoption.

## Approval

- Brief approved by: Jim's standing instruction for wave 1 ("briefs first, Tier 1, one PR per
  item", 2026-09-03).
