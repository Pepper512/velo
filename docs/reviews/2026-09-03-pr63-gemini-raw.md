## Verdict

**CHANGES REQUESTED**

The core query architecture and event-driven debounce model are solid and well-targeted. However, there are two medium-severity issues: a test bug in `Sidebar.test.tsx` that permits false positives if `velo-threads-changed` is unwired, and an unkeyed async state update in `labelStore.ts` that can overwrite unread counts on rapid account switching.

---

## Numbered Findings

### 1. Test False Positive: Co-dispatched events mask unwired listener
- **Severity:** MEDIUM
- **File & Function:** `src/components/layout/Sidebar.test.tsx` (`it("refreshes on velo-threads-changed and velo-sync-done...")`)
- **Concern:** Dispatching both `velo-threads-changed` and `velo-sync-done` in the same test block allows the test to pass even if `velo-threads-changed` is never wired to the listener.
- **Exact Scenario:** If `window.addEventListener("velo-threads-changed", handler)` is commented out in `Sidebar.tsx`, `window.dispatchEvent(new Event("velo-sync-done"))` in the test still triggers the debounced refresh, advancing `mockCounts` to 2.
- **Consequence:** Regressions in event wiring will not be caught by CI.
- **Fix:** Split into two separate tests, or dispatch only `velo-threads-changed` when asserting that user actions refresh the sidebar.

```typescript
it("refreshes on velo-threads-changed through the 500 ms debounce", async () => {
  vi.useFakeTimers();
  mockCounts.mockResolvedValue({ INBOX: 4 });
  renderSidebar();
  await act(async () => {});

  mockCounts.mockResolvedValue({ INBOX: 3 });
  act(() => {
    window.dispatchEvent(new Event("velo-threads-changed"));
  });
  expect(mockCounts).toHaveBeenCalledTimes(1);

  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  await act(async () => {});

  expect(mockCounts).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("3 unread")).toBeInTheDocument();
});
```

---

### 2. Cross-Account Race Condition on Rapid Account Switching
- **Severity:** MEDIUM
- **File & Function:** `src/stores/labelStore.ts` (`refreshUnreadCounts`)
- **Concern:** `refreshUnreadCounts` does not verify that the resolving account matches the currently active account before setting state.
- **Exact Scenario:**
  1. User is on `acc-1` and triggers an action or sync event.
  2. `refreshUnreadCounts("acc-1")` begins an asynchronous SQLite read.
  3. User switches to `acc-2` (`activeAccountId` becomes `"acc-2"`, calling `clearLabels()` and `refreshUnreadCounts("acc-2")`).
  4. `refreshUnreadCounts("acc-1")` resolves *after* `refreshUnreadCounts("acc-2")` finishes.
- **Consequence:** `unreadCounts` for `acc-1` overwrites `acc-2`, displaying incorrect unread badges on the active account until the next sync.
- **Fix:** Check that the fetched `accountId` still matches `useAccountStore.getState().activeAccountId` before updating state, or store counts keyed by account ID `Record<string, Record<string, number>>`.

```typescript
refreshUnreadCounts: async (accountId: string) => {
  try {
    const unreadCounts = await getUnreadCountsByLabel(accountId);
    if (useAccountStore.getState().activeAccountId === accountId) {
      set({ unreadCounts });
    }
  } catch (err) {
    console.error("Failed to refresh label unread counts:", err);
  }
}
```

---

### 3. Missing Event Dispatch on Provider Revert / Permanent Failure
- **Severity:** LOW
- **File & Function:** `src/services/emailActions.ts` (`executeEmailAction`)
- **Concern:** If an email action fails permanently at the provider level and undergoes an optimistic rollback in the local DB/store, no follow-up event is fired.
- **Exact Scenario:** User marks an email as read while online. `executeEmailAction` updates local DB and dispatches `velo-threads-changed` (count drops by 1). The provider rejects the mutation with a 4xx permanent failure, and local state is reverted to unread.
- **Consequence:** The sidebar unread pill remains decremented (stale) for up to 60 seconds until `velo-sync-done` fires.
- **Fix:** If error recovery / rollback updates the local DB on failure, dispatch `dispatchVeloEvent("velo-threads-changed")` inside the rollback handler.

---

### 4. Over-fetching in Debounced Handler on Thread Actions
- **Severity:** LOW
- **File & Function:** `src/components/layout/Sidebar.tsx` (`useEffect` event listener)
- **Concern:** Reusing the exact same handler for `velo-threads-changed` and `velo-sync-done` causes unnecessary queries.
- **Exact Scenario:** On every email action (e.g., reading an email), the debounced handler executes `loadLabels(activeAccountId)` (re-queries label definitions) and `refreshSmartFolderCounts(activeAccountId)` (executes full search queries across all smart folders) in addition to `refreshUnreadCounts`.
- **Consequence:** Unnecessary SQLite query load and potential UI churn on smart folders when only thread read state changed.
- **Fix:** Separate the event handlers or restrict `loadLabels` and `refreshSmartFolderCounts` to `velo-sync-done` unless label structures change.

---

### 5. Incomplete Isolation Assertion in Agreement Test
- **Severity:** NIT
- **File & Function:** `src/services/db/threads.unreadCounts.test.ts` (`it("agrees with what the folder lists")`)
- **Concern:** The second test verifying `getUnreadCountsByLabel` against `getThreadsForAccount` does not seed threads for a second account (`OTHER`).
- **Exact Scenario:** If the query was missing the `t.account_id = $1` predicate on the join, Test 1 catches it, but Test 2 would pass vacuously because only one account is seeded.
- **Consequence:** Reduced test isolation verification between `getUnreadCountsByLabel` and `getThreadsForAccount`.
- **Fix:** Seed `OTHER` threads in the agreement test as well.

---

## Analysis of Review Criteria

### 1. Correctness of Count
- **Join Semantics:** `getUnreadCountsByLabel` uses `threads t INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id WHERE t.account_id = $1 AND t.is_read = 0 GROUP BY tl.label_id`. This aligns directly with `getThreadsForAccount(accountId, labelId)` (`threads ⋈ thread_labels`).
- **Double Counting:** PK `(account_id, thread_id, label_id)` guarantees one row per thread-label pair; grouping by `tl.label_id` correctly counts each thread once per label.
- **Muted / Snoozed / Bundled Threads:** If snoozing or muting removes the `INBOX` label from `thread_labels` in Velo, the counts remain exact. If snoozed threads retain `INBOX` in `thread_labels` without a dedicated `is_snoozed` column check, both the folder view and the count will include them consistently.

### 2. Freshness and Races
- **Local DB Update vs Event:** `dispatchVeloEvent("velo-threads-changed")` is called after `await applyLocalDbUpdate(...)`, ensuring the database write is committed before the 500 ms debounce timer starts.
- **Timer Cleanup:** `Sidebar.tsx` clears `timer` during `useEffect` cleanup on unmount and dependency changes (`if (timer) clearTimeout(timer)`), preventing timer leaks.

### 3. Cost & Debounce
- **Query Efficiency:** One single grouped query replaces what would have been $N$ queries across user labels.
- **Bulk Actions:** Rapid consecutive actions (e.g., bulk mark as read) will trigger `clearTimeout(timer)` repeatedly, executing only a single SQLite read 500 ms after the last action.

### 4. Test Mocks
- **Selector Function Mocking in `Sidebar.test.tsx`:** Mocking `useAccountStore` and `useUIStore` with static return values hides dynamic Zustand subscription updates, selector memoization edge cases, and account-switching state transitions.

---

## Questions
1. Does snoozing a thread remove its `INBOX` entry in `thread_labels`, or does it set a flag on `threads`? If it sets a flag without modifying `thread_labels`, should `is_snoozed = 0` be added to the unread query?
2. Are bulk operations executed in a loop calling `executeEmailAction` individually, or is there a batch action API? (If looped, 50 actions fire 50 custom events; debounce handles this safely, but batch-level dispatching would be cleaner).

---

## What Is Good
- **Design & Performance:** Single grouped SQL aggregation (`GROUP BY tl.label_id`) rather than per-label roundtrips.
- **Spec Adherence:** Clear adherence to Tier 1 change constraints without altering database schemas or adding dependencies.
- **TDD Setup:** Real SQLite integration tests using the migration harness (`createSqliteHarness`) ensuring production SQL syntax is directly exercised.
- **UI Integration:** Clean reuse of `UnreadPill` styling and `NAV_UNREAD_LABEL` lookup table.
