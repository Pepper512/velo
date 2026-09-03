The full request was truncated in the message, so I’ll load the offloaded prompt to get the complete brief and diff before reviewing.The prompt file was cut off in the counts query; I’ll keep reading the rest of the diff.CHANGES REQUESTED

## Findings

- **H1.** `src/services/inbox/splitTabs.ts` (`resolveActiveTab`) and `src/components/layout/EmailList.tsx` (active-tab assignment + load branch). Split mode no longer has a unified list. `"All"` is the documented sentinel for that list (brief: `"All"` meaning unified; Design: `"All" unchanged"`). This code treats it as invalid and substitutes the first visible tab:

```ts
export function resolveActiveTab(visible: VisibleTab[], requested: string): string {
  if (requested !== "All" && visible.some((t) => t.id === requested)) return requested;
  return visible[0]?.id ?? "All";
}
```

```ts
const activeCategory = inboxViewMode === "split" ? resolveActiveTab(visibleTabs, routerCategory) : "All";
```

With default tabs that makes `activeCategory` `"Primary"`, so `activeCategory !== "All"` is true and `loadTabThreads` runs. A user who never edits `split_inbox_tabs` but lands on inbox in split mode with `category=All` (or whatever `useActiveCategory` returns when the param is absent) now sees Primary, not the unified inbox. Concrete change: `if (requested === "All") return "All";` — only fall back when the requested id is a real tab that is missing from `visible`. Keep the `"All"` fetch and bundle/held filter as they are.

- **M1.** `src/services/db/splitTabCounts.ts` (Reminders `COUNT(*)`) vs `src/services/db/threads.ts` (`getThreadsWithPendingReminders`). The list de-dupes a thread with two pending rows (`GROUP BY t.account_id, t.id`, `ORDER BY MIN(f.remind_at)`). The count query does not:

```sql
SELECT COUNT(*) as total,
       SUM(CASE WHEN t.is_read = 0 THEN 1 ELSE 0 END) as unread
FROM threads t
INNER JOIN follow_up_reminders f ON f.account_id = t.account_id AND f.thread_id = t.id AND f.status = 'pending'
WHERE t.account_id = $1
```

Unread pills (and totals) over-count relative to the tab. Count distinct threads, e.g. `COUNT(DISTINCT t.id)` and `COUNT(DISTINCT CASE WHEN t.is_read = 0 THEN t.id END)` (or a grouped subquery).

- **M2.** `src/services/inbox/splitTabs.ts` (`TabListSchema` / `addTab`) and `src/stores/uiStore.ts` (`setSplitInboxTabs`). Restore rejects `> 32` tabs (`z.array(TabSchema).min(1).max(MAX_TABS)` → default). Write does not:

```ts
export function addTab(tabs: SplitTab[], tab: SplitTab): SplitTab[] {
  if (tabs.some((t) => t.id === tab.id)) return tabs;
  return [...tabs, tab];
}
```

```ts
setSplitInboxTabs: (splitInboxTabs) => {
  setSetting("split_inbox_tabs", serializeSplitTabs(splitInboxTabs)).catch(() => {});
  set({ splitInboxTabs });
},
```

A 33rd Add persists JSON that the next boot throws away (REQ-1.3). Enforce `MAX_TABS` in `addTab` / `setSplitInboxTabs` (refuse the write; do not persist a value `parseSplitTabs` will not accept).

- **M3.** `src/components/layout/EmailList.tsx` (metadata effect). `tabCounts` is only cleared when `!activeAccountId` or when not split-inbox. Switching accounts while staying on split inbox keeps the previous Map until `getSplitTabCounts` resolves. Category keys are the same across accounts, so hide-when-empty and unread pills are wrong for that interval and `resolveActiveTab` can move off a tab that only looks empty from stale totals. Clear `tabCounts` at the start of the effect when `activeAccountId` (or the counts request) changes.

- **M4.** `src/components/layout/EmailList.tsx` (resolved `activeCategory` is not written back). Fallback is display-only; `navigateToLabel` is not called. `?category=` can name a hidden/invalid tab while the strip and list show another. Initial `tabCounts` is `new Map()` (same as the fail-open catch), so a hide-when-empty tab is visible for one paint (`undefined === 0` is false), then counts arrive and REQ-3.2 jumps the list. A later failed recount restores the hidden tab from the URL. After fallback, `navigateToLabel("inbox", { category: resolved })` (guarded against loops), or do not apply hide-when-empty until a successful counts fetch for this account.

- **M5.** `src/hooks/useKeyboardShortcuts.ts` (`goToCategoryTab`). REQ-5.1 is implemented against the configured list, not the strip:

```ts
if (!ui.splitInboxTabs.some((t) => t.id === category)) return;
navigateToLabel("inbox", { category });
```

`g n` on a configured but hidden Newsletters tab still navigates; H1/M4 then resolve that to the **first** visible tab, so a user sitting on Updates is dumped on Primary. No-op unless the category is in `visibleSplitTabs` (or show the tab and skip hide for the active one).

- **M6.** `src/components/layout/EmailList.tsx` (`visibleTabs` memo) vs `src/components/settings/SplitTabsEditor.tsx`. The editor scopes labels with `l.accountId === activeAccountId`. EmailList does not:

```ts
const labelsById = new Map<string, LabelInfo>(
  userLabels.map((l) => [l.id, { name: l.name, color: l.colorBg }]),
);
```

If `userLabels` is the full store, a label tab from another account is renderable and violates REQ-2.5. Filter by `activeAccountId` here the same way (or prove `userLabels` is already scoped and add a test).

- **L1.** `src/components/settings/SplitTabsEditor.tsx`. `candidate` is not reset when `activeAccountId` changes. A selected `label:<id>` from the previous account remains in state; the `<select>` value matches no option; Add no-ops. `setCandidate("")` in the account effect.

- **L2.** `src/components/settings/SplitTabsEditor.tsx` (hide checkbox). The control is wrapped in `<label>Hide when empty</label>` and also has `aria-label={`Hide ${tabName(tab)} when empty`}`. Drop the `aria-label` (the `<label>` already names it) or drop the visible duplicate so it is announced once.

- **N1.** `splitInboxTabs` in the metadata effect deps is the Zustand array; identity is stable until `set`/`restore`. It will not refetch every render. `visibleTabs` correctly recomputes when that array, `userLabels`, or `tabCounts` changes.

- **N2.** Bundle/held remaining `"All"`-only matches the brief; a label or Reminders tab will list bundled/held threads. That is intended.

- **N3.** `parseSplitTabs` does not trust stored `id` (derived `expectedId`, mismatch → default). `labelId` is length-capped (1..200), not charset-capped; it is bound as a SQL parameter and used as a Map key, so odd characters do not inject. Prototype keys are not an issue: `JSON.parse` + Zod object + `Map`. EmailList infers kind from the id prefix (`"reminders"` / `"label:"`); that is safe only because parse/editor keep ids canonical — do not let `setSplitInboxTabs` skip that invariant (see M2).

## REQ-1 … REQ-5

| REQ | From this diff |
| --- | --- |
| **REQ-1** | **Met.** `split_inbox_tabs` JSON; kinds + `hideWhenEmpty`; default five categories, `hideWhenEmpty: false`; Zod + derived-id + duplicates + empty list → default + `console.warn`. M2 is a hole on the write path, not the parse path. |
| **REQ-2** | **Met** for 2.1–2.4 in the queries/tests (category path still `getThreadsForCategory`; label = INBOX ∩ label, pinned then newest, paged; Reminders = pending, any label, `MIN(remind_at)`; counts total+unread). **2.5 met in the pure helper**; **untestable / at risk in EmailList** (M6) without seeing how `userLabels` is built. |
| **REQ-3** | **3.1 met** in `visibleSplitTabs` (missing count fail-open; total 0 + `hideWhenEmpty` hides). **3.2 met in the pure function**, **not fully in the UI** (H1 treats `"All"` as invalid; M4 does not persist fallback). **3.3 met** for hide-when-empty (tested). If every tab is a missing label, the strip is empty and resolve returns `"All"` — 2.5 vs 3.3; not tested. |
| **REQ-4** | **Met in code** (General, under inbox view mode, split-only; up/down/remove/hide; add categories, account user labels with smart mark, Reminders). Persist-via-store is the right split (`set` vs `restore`). **Untestable from tests in this diff** (no editor/store tests). |
| **REQ-5** | **5.1 implemented** against configured tabs (M5 vs hidden). **Untested.** **5.2 met** in `helpContent.ts`. |

## Tests this diff does not cover

- `resolveActiveTab("All")` driving EmailList: still `getThreadsForAccount` + bundle/held, not `loadTabThreads(first tab)`.
- Reminders: two pending rows on one thread (list = one row, soonest `remind_at`; counts = one thread); empty reminders (`COUNT(*) = 0`, `SUM` NULL → `{0,0}`); paging.
- `getSplitTabCounts` with Primary omitted while uncategorised INBOX rows exist (must not leak into another category).
- `parseSplitTabs`: 33 tabs; `labelId` of length 201; valid extra keys stripped vs rejected.
- `addTab` / `setSplitInboxTabs` refusing a 33rd tab so restore cannot wipe the setting.
- `goToCategoryTab`: not in the list → no navigate; in the list but hidden → no yank to tab 0.
- EmailList: `userLabels` from another account hidden (REQ-2.5); `tabCounts` reset on account change; hide-when-empty tab in the URL after counts load.
- `SplitTabsEditor`: account switch clears candidate and candidate list; cannot add a duplicate; cannot remove the last tab.
- `visibleSplitTabs`: configuration is only missing-label tabs → defined strip/`"All"` behaviour.
