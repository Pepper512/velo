# SPEC-243 — Unread counts in the sidebar

- **Task:** Show the number of unread threads beside Inbox, Spam and every user label in the
  sidebar, kept current across syncs and the user's own actions.
- **Tier:** **1** — touches `services/db/threads.ts` (one read-only query), `stores/labelStore.ts`,
  `components/layout/Sidebar.tsx`, `services/emailActions.ts` (one event dispatch) and
  `constants/events.ts`; none is on `CLAUDE.md`'s Tier-2 list. No schema, no network,
  reversible by revert. Plan in the PR before code; one independent review leg.
- **Base:** `main` @ `4630e31` (the #276 merge; code pin). Citations grepped at `eeaa805` and
  unchanged by #276 (which touched no file in this list).
- **Status:** building — branch `f243-sidebar-unread-counts`.
- **Source:** upstream avihaymenahem/velo#243 "Inbox count" (*"without having unread counters on
  the left sidebar, it's quite difficult to stay on track of unread emails"*). The fork's
  2026-09-01 triage: P2, S–M, "good first issue", high everyday value. Bug-fix queue item 8.
- **Effort:** S–M · 1 day.

## Outcome

Inbox, Spam and each user label in the sidebar show a small count of unread threads, in the
same pill the smart folders and Tasks already use; nothing is shown when the count is zero.
Reading, archiving, trashing, moving or labelling a thread updates the count within half a
second; a sync updates it the same way.

## What exists, verified in the fork

1. **No count on any label today.** `Sidebar.tsx` renders the pill only for smart folders
   (`:474-500`, from `useSmartFolderStore().unreadCounts`) and Tasks (`:392-396`,
   `taskIncompleteCount`). The list rows already mark unread threads with an accent dot
   (`ThreadCard.tsx:100`), so the issue's "dots" are the list side, which exists; the sidebar
   counter is the missing half.
2. **The badge already counts Inbox unread**: `threads.ts:223-231 getUnreadInboxCount` joins
   `threads` to `thread_labels` on `INBOX` and `is_read = 0` — across all accounts, for the
   taskbar. The sidebar is per active account.
3. **The folder list's semantics** are `getThreadsForAccount(accountId, labelId)`
   (`threads.ts:23-47`): threads joined to `thread_labels` on the label. An unread count that
   uses the same join agrees with what the folder shows.
4. **Refresh plumbing:** the sidebar reloads labels and smart-folder counts on
   `velo-sync-done`, debounced 500 ms (`Sidebar.tsx:282-300`), and on account change
   (`:267-280`). Every user action goes through `executeEmailAction` (`emailActions.ts:318`):
   optimistic store update → local DB update (`:334 applyLocalDbUpdate`) → provider/queue.
   Only `sendMessage` fires an event afterwards (`:567`); read/archive/trash/move fire nothing,
   so a count refreshed only on sync would lag the user's own actions by up to 60 s.
5. `thread_labels` is keyed `(account_id, thread_id, label_id)` (`migrations.ts:58-64`), so a
   `GROUP BY label_id` over the join counts each thread once per label.
6. The typed event bus (`constants/events.ts`) has `dispatchVeloEvent`/`onVeloEvent`; a new
   name is one map entry.

## Requirements

- **REQ-1** As a user I want to see how much unread mail each folder holds.
  - REQ-1.1 WHEN the sidebar is expanded THE SYSTEM SHALL show beside Inbox, Spam and each
    user label the number of unread threads of the active account carrying that label, and
    SHALL show nothing when it is zero.
  - REQ-1.2 The number SHALL equal the number of unread threads the folder itself lists
    (same `threads ⋈ thread_labels` join as `getThreadsForAccount`).
  - REQ-1.3 WHEN the sidebar is collapsed THE SYSTEM SHALL show no number (as smart folders
    and Tasks do today).
- **REQ-2** As a user I want the counts to keep up with me.
  - REQ-2.1 WHEN a sync completes THE SYSTEM SHALL refresh the counts within the existing
    500 ms debounce.
  - REQ-2.2 WHEN an email action has changed the local database (read/unread, star, archive,
    trash, move, label, snooze, spam) THE SYSTEM SHALL fire `velo-threads-changed`, and the
    sidebar SHALL refresh the counts through the same debounce.
  - REQ-2.3 WHEN the active account changes THE SYSTEM SHALL show that account's counts and
    never the previous account's.
- **REQ-3** Cost: one query per refresh for all labels (grouped), not one per label.

## Not doing

- Counts on Starred, Snoozed, Sent, Drafts, Trash, All Mail (Drafts would want a total, not
  an unread count; the others are not "to do" folders). Easy to add later: the store holds
  every label's count already.
- Per-category counts under a split inbox (needs the `thread_categories` join; separate item).
- Refreshing the taskbar badge on `velo-threads-changed` — it has the same lag today
  (`App.tsx:418`, sync-done only) and is a one-line follow-up; kept out to keep this PR one thing.
- Replacing the inline `window.dispatchEvent(new Event("velo-sync-done"))` literals with the
  typed helper (audit P17 follow-up).

## Design

- **Change**
  - `threads.ts`: `getUnreadCountsByLabel(accountId): Promise<Record<string, number>>` —
    `SELECT tl.label_id, COUNT(*) AS count FROM threads t INNER JOIN thread_labels tl ON
    tl.account_id = t.account_id AND tl.thread_id = t.id WHERE t.account_id = $1 AND
    t.is_read = 0 GROUP BY tl.label_id` (REQ-1.2, REQ-3).
  - `labelStore.ts`: `unreadCounts: Record<string, number>`; `refreshUnreadCounts(accountId)`
    sets it from the query (on failure: log, keep the previous map); `clearLabels` clears it.
  - `events.ts`: `"velo-threads-changed": void`. `emailActions.ts`: after the local DB update
    in `executeEmailAction` (success or failure of that step — the optimistic store changed
    either way), `dispatchVeloEvent("velo-threads-changed")` (REQ-2.2).
  - `Sidebar.tsx`: call `refreshUnreadCounts` beside `loadLabels` on account change and in the
    debounced handler, which now listens to both events; `DroppableLabelItem` takes a `count`
    prop; nav items `inbox` → `INBOX` and `spam` → `SPAM` read the same map. Pill markup and
    classes copied from the smart-folder pill (REQ-1.1, 1.3).
- **Decision & alternatives** — (a) a grouped query into `labelStore` + a change event: one
  query, one store, the existing debounce. (b) Per-label queries like `smartFolderStore` does —
  N round trips per refresh; smart folders need it because each is an arbitrary search, labels
  don't. (c) Derive counts from `threadStore` — it holds only the current folder's page.
  (d) Maintain counts incrementally in the store on each action — drifts; a re-query is cheap.
  (a).
- **Data / schema** — none. The query uses the existing `thread_labels` primary key and
  `threads.is_read`; no new index (an `is_read` filter over one account's threads is small).
- **Failure modes** — a wrong join over-counts or under-counts a label; REQ-1.2's harness test
  builds threads with several labels and read states and pins each label's number. A missed
  event means a stale count until the next sync (today's behaviour), never a wrong action.

## Tasks (risk-first)
- [ ] 1. `threads.test.ts` (SQLite harness): three threads, two labels, mixed read states,
  a second account's thread with the same label — pins the map. — REQ-1.2, 2.3, 3
- [ ] 2. `labelStore.test.ts`: refresh sets the map; clear empties it; a failing query keeps
  the previous map and logs. — REQ-2.3
- [ ] 3. `emailActions.test.ts`: `executeEmailAction` dispatches `velo-threads-changed` after
  the local update. — REQ-2.2
- [ ] 4. `Sidebar.tsx` wiring and pills; a render test if the component mounts under the
  existing test mocks, otherwise the manual check below. — REQ-1.1, 1.3, 2.1
- [ ] 5. LOG.md; vault row 8; HANDOFF pin after merge; help card if `docs:check` wants one.

## Done when
`npm run test` green with the new cases; `tsc`, `graph:check`, `docs:check` green; CI green
on the merge commit. Manual, optional (needs the running app): open an unread inbox thread —
the Inbox pill drops by one within a second; apply a label to an unread thread — that label's
pill appears.

## Rollback
`git revert`; no data.

## Review
One independent leg (Tier 1): Gemini 3.7 via `agy`, diff from committed SHAs.

## Approval
Jim, 2026-09-03: *"#243 (unread counts …) … tier by the files touched"*. The plan is this
file, committed before the code.
