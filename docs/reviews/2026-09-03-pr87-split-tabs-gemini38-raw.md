CHANGES REQUESTED

### Findings

- **H1** — `src/services/db/splitTabCounts.ts:68-80`
  *What is wrong:* The Reminders count query counts pending reminder rows instead of distinct threads.
  *Why:* A thread can have more than one pending follow-up reminder (e.g. an automated reminder alongside a manual reminder). Because the query joins `follow_up_reminders` without `DISTINCT` or `GROUP BY`, `COUNT(*)` and `SUM(...)` count each reminder row. In contrast, `getThreadsWithPendingReminders` groups by `t.account_id, t.id`. The pill count on the Reminders tab will therefore report more threads than the tab actually lists, violating REQ-2.4.
  *Exact code:*
  ```typescript
  if (request.reminders) {
    const rows = await db.select<{ total: number; unread: number | null }[]>(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN t.is_read = 0 THEN 1 ELSE 0 END) as unread
       FROM threads t
       INNER JOIN follow_up_reminders f ON f.account_id = t.account_id AND f.thread_id = t.id AND f.status = 'pending'
       WHERE t.account_id = $1`,
      [accountId],
    );
    const row = rows[0];
    out.set("reminders", { total: Number(row?.total ?? 0), unread: Number(row?.unread ?? 0) });
  }
  ```
  *Concrete change:* Aggregate distinct thread IDs:
  ```sql
  SELECT COUNT(DISTINCT t.id) as total,
         COUNT(DISTINCT CASE WHEN t.is_read = 0 THEN t.id END) as unread
  FROM threads t
  INNER JOIN follow_up_reminders f ON f.account_id = t.account_id AND f.thread_id = t.id AND f.status = 'pending'
  WHERE t.account_id = $1
  ```

- **H2** — `src/components/layout/EmailList.tsx:89-96`
  *What is wrong:* Label tabs belonging to inactive accounts leak into the visible tabs, violating REQ-2.5.
  *Why:* `userLabels` from `useLabelStore` stores labels across all accounts. `EmailList` populates `labelsById` by mapping `userLabels` without filtering by `activeAccountId`. If Account B owns a label ID that matches a configured label tab, `labelsById.get(tab.labelId)` succeeds while Account A is active, rendering the foreign tab in Account A's split strip.
  *Exact code:*
  ```typescript
  const visibleTabs = useMemo(() => {
    if (inboxViewMode !== "split") return [];
    const labelsById = new Map<string, LabelInfo>(
      userLabels.map((l) => [l.id, { name: l.name, color: l.colorBg }]),
    );
    return visibleSplitTabs(splitInboxTabs, { labelsById, counts: tabCounts });
  }, [inboxViewMode, splitInboxTabs, userLabels, tabCounts]);
  ```
  *Concrete change:* Filter `userLabels` by `l.accountId === activeAccountId` before building the map:
  ```typescript
  const visibleTabs = useMemo(() => {
    if (inboxViewMode !== "split") return [];
    const labelsById = new Map<string, LabelInfo>(
      userLabels
        .filter((l) => l.accountId === activeAccountId)
        .map((l) => [l.id, { name: l.name, color: l.colorBg }]),
    );
    return visibleSplitTabs(splitInboxTabs, { labelsById, counts: tabCounts });
  }, [inboxViewMode, splitInboxTabs, userLabels, activeAccountId, tabCounts]);
  ```

- **H3** — `src/components/layout/EmailList.tsx:86, 100` and `src/services/inbox/splitTabs.ts:187`
  *What is wrong:* Initial render tab flicker and active tab jumping when `hideWhenEmpty` is enabled.
  *Why:* `tabCounts` is initialized to `new Map()`. In `visibleSplitTabs`, `ctx.counts.get(tab.id)?.total === 0` evaluates to `undefined === 0` (`false`), so empty tabs render as visible on mount. When `loadMetadata` completes asynchronously and updates `tabCounts`, empty tabs unmount. If the first configured tab is empty with `hideWhenEmpty: true`, `resolveActiveTab` selects it on the first render, fires thread loading for it, and then jumps to the second tab on the second render once counts arrive.
  *Exact code:*
  ```typescript
  // splitTabs.ts:187
  if (tab.hideWhenEmpty && ctx.counts.get(tab.id)?.total === 0) continue;
  ```
  and
  ```typescript
  // EmailList.tsx:86, 100
  const [tabCounts, setTabCounts] = useState<Map<string, TabCount>>(() => new Map());
  ...
  const activeCategory = inboxViewMode === "split" ? resolveActiveTab(visibleTabs, routerCategory) : "All";
  ```
  *Concrete change:* Distinguish uninitialized counts from zero counts in `counts: Map<string, TabCount> | null` (or pass a boolean `countsLoaded: boolean`). When counts have not yet arrived, preserve the previous tab state or do not switch active categories until initial counts resolve.

- **M1** — `src/services/inbox/splitTabs.ts:29, 70, 200-204` and `src/components/settings/SplitTabsEditor.tsx:82-87`
  *What is wrong:* `addTab` allows adding more than `MAX_TABS` (32) tabs, which causes all tabs to be wiped and reset to `DEFAULT_SPLIT_TABS` on the next application restart.
  *Why:* `TabListSchema` enforces `.max(MAX_TABS)`. Neither `addTab` nor `SplitTabsEditor` checks `tabs.length >= MAX_TABS`. If a user with many labels adds more than 32 tabs, the state persists successfully via `setSplitInboxTabs`. On the next application launch, `parseSplitTabs` runs `TabListSchema.safeParse`, fails validation on array length, logs a warning, and permanently overwrites the user's tabs with `DEFAULT_SPLIT_TABS`.
  *Exact code:*
  ```typescript
  // splitTabs.ts:200-204
  export function addTab(tabs: SplitTab[], tab: SplitTab): SplitTab[] {
    if (tabs.some((t) => t.id === tab.id)) return tabs;
    return [...tabs, tab];
  }
  ```
  *Concrete change:* Enforce `MAX_TABS` in `addTab`:
  ```typescript
  export function addTab(tabs: SplitTab[], tab: SplitTab): SplitTab[] {
    if (tabs.length >= MAX_TABS || tabs.some((t) => t.id === tab.id)) return tabs;
    return [...tabs, tab];
  }
  ```
  and disable the "Add" button in `SplitTabsEditor.tsx` when `tabs.length >= MAX_TABS`.

- **M2** — `src/services/db/threads.ts:112, 137`
  *What is wrong:* Non-deterministic pagination ordering in `getInboxThreadsForLabel` and `getThreadsWithPendingReminders`.
  *Why:* `getInboxThreadsForLabel` orders by `t.is_pinned DESC, t.last_message_at DESC`. `getThreadsWithPendingReminders` orders by `MIN(f.remind_at) ASC, t.last_message_at DESC`. Neither query includes a unique tie-breaker such as `t.id`. When multiple threads share the same timestamp or reminder time, pagination via `LIMIT` and `OFFSET` causes threads to duplicate or be skipped across page boundaries.
  *Exact code:*
  ```typescript
  // threads.ts:112
  ORDER BY t.is_pinned DESC, t.last_message_at DESC
  LIMIT $3 OFFSET $4
  ```
  and
  ```typescript
  // threads.ts:137
  ORDER BY MIN(f.remind_at) ASC, t.last_message_at DESC
  LIMIT $2 OFFSET $3
  ```
  *Concrete change:* Append `, t.id DESC` to both `ORDER BY` clauses:
  `ORDER BY t.is_pinned DESC, t.last_message_at DESC, t.id DESC` and
  `ORDER BY MIN(f.remind_at) ASC, t.last_message_at DESC, t.id DESC`.

- **M3** — `src/components/settings/SplitTabsEditor.tsx:30, 48-53, 82-87`
  *What is wrong:* Candidate selection state in `SplitTabsEditor` is not cleared when `activeAccountId` changes.
  *Why:* `candidate` holds the selected string ID in local component state. When `activeAccountId` changes, `accountLabels` and `candidates` are recalculated for the new account, but `candidate` is not reset. If a label from the prior account was selected, the dropdown is left holding a dangling value from another account, and clicking "Add" silently fails because `candidates.find((c) => c.id === candidate)` is undefined.
  *Exact code:*
  ```typescript
  const [candidate, setCandidate] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!activeAccountId) {
      setSmartLabelIds(new Set());
      return;
    }
  ...
  }, [activeAccountId]);
  ```
  *Concrete change:* Add `setCandidate("");` inside the `useEffect` listening to `activeAccountId`.

- **L1** — `src/components/settings/SplitTabsEditor.tsx:54-55`
  *What is wrong:* Labels from other accounts display as raw opaque IDs in the settings editor.
  *Why:* `labelName` searches only `accountLabels` (filtered to `activeAccountId`). If a user configures a label tab for Account 1 and then opens Settings while Account 2 is active, `labelName` falls back to `${labelId} (not in this account)` instead of looking up the label name in the global `labels` store.
  *Exact code:*
  ```typescript
  const labelName = (labelId: string) =>
    accountLabels.find((l) => l.id === labelId)?.name ?? `${labelId} (not in this account)`;
  ```
  *Concrete change:* Fall back to searching the full `labels` array:
  ```typescript
  const labelName = (labelId: string) => {
    const accLabel = accountLabels.find((l) => l.id === labelId);
    if (accLabel) return accLabel.name;
    const anyLabel = labels.find((l) => l.id === labelId);
    return anyLabel ? `${anyLabel.name} (other account)` : `${labelId} (not found)`;
  };
  ```

- **L2** — `src/components/layout/EmailList.tsx:100`
  *What is wrong:* The router search parameter remains out of sync when `routerCategory` is `"All"` or hidden.
  *Why:* When `routerCategory` is `"All"` (the default when entering split mode) or points to a tab that became hidden, `resolveActiveTab` returns `visibleTabs[0].id` (e.g. `"Primary"`). However, nothing calls `navigateToLabel` to update the URL. The route search parameter remains `?category=All` while `activeCategory` in `EmailList` is `"Primary"`.
  *Exact code:*
  ```typescript
  const activeCategory = inboxViewMode === "split" ? resolveActiveTab(visibleTabs, routerCategory) : "All";
  ```
  *Concrete change:* In an effect, if `inboxViewMode === "split"` and `routerCategory !== activeCategory`, sync the router URL with `replace: true`.

- **N1** — `src/services/db/splitTabCounts.ts:30-48`
  *Observation:* In `getSplitTabCounts`, the category query groups all INBOX threads regardless of configured tabs (`WHERE t.account_id = $1 AND tl.label_id = 'INBOX' GROUP BY tc.category`). If `Primary` is omitted by the user while uncategorised threads exist, `tc.category IS NULL` is mapped to `name = "Primary"`, matches nothing in `out`, and is discarded. This matches REQ-2.1 (uncategorised belongs to Primary), but means unassigned threads are invisible if Primary is excluded.

---

### Requirement Compliance (REQ-1 … REQ-5)

- **REQ-1** (Choose split-inbox tabs, validation, defaults): **MET**
  - Stored in `split_inbox_tabs` JSON, kinds validated, duplicates rejected, falls back to default on parse error. (Subject to M1 regarding `MAX_TABS` overflow).
- **REQ-2** (Tabs content, ordering, Reminders, unread counts, missing labels): **PARTIALLY MET**
  - REQ-2.1 (category queries): MET.
  - REQ-2.2 (label queries): MET.
  - REQ-2.3 (Reminders queries): MET.
  - REQ-2.4 (Unread & total counts): **UNMET** due to H1 (overcounting pending reminders on multi-reminder threads).
  - REQ-2.5 (Hide non-existent label for active account): **UNMET** due to H2 (cross-account label leakage in `EmailList`).
- **REQ-3** (Hide empty tabs, active tab fallback, at least one visible): **PARTIALLY MET**
  - REQ-3.1 & REQ-3.2: **UNMET in UI execution** due to H3 (empty tabs flash and active tab jumps on initial render while counts load).
  - REQ-3.3: MET (first renderable tab remains if all hide).
- **REQ-4** (Settings editor): **MET**
  - Up/down reordering, remove, hide-when-empty toggle, candidate selector with smart labels annotated, immediate persistence. (Subject to M3 and L1).
- **REQ-5** (Keyboard shortcuts and help): **MET**
  - Shortcuts guard against unconfigured category tabs (5.1); help text updated with custom tabs, Reminders, and hide-when-empty (5.2).

---

### Test Coverage Gaps

1. **Multiple pending reminders per thread:**
   `threads.splitTabs.test.ts` does not test `getSplitTabCounts` or `getThreadsWithPendingReminders` when a single thread has multiple pending reminders with different `remind_at` timestamps. A test with two pending reminders on one thread would assert whether `total` and `unread` equal 1 or 2.
2. **Cross-account label filtering in `visibleSplitTabs` / `EmailList`:**
   `splitTabs.test.ts` only tests `visibleSplitTabs` with a pre-filtered `labelsById` map. There is no test ensuring that `EmailList`'s `labelsById` construction excludes labels belonging to other accounts present in `useLabelStore`.
3. **Array limit boundary (`MAX_TABS`) in `splitTabs.test.ts`:**
   `splitTabs.test.ts` tests `TabListSchema` with invalid JSON, but does not test `addTab` pushing past 32 items, nor the round-trip behavior of `parseSplitTabs` on a 33-item array.
4. **Category omission in counts query:**
   `threads.splitTabs.test.ts` does not assert count behavior when `categories` excludes `"Primary"` while uncategorised threads exist in SQLite.
5. **Component tests for `SplitTabsEditor`:**
   There are no unit/DOM tests for `SplitTabsEditor.tsx` covering tab reordering, disabling the remove button when only one tab remains, or switching accounts when a candidate is selected.
