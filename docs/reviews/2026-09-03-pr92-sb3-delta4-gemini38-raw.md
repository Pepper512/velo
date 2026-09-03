### Explicit Assumptions Outside the Delta
1. **Thread Data & Store Architecture**: `useThreadStore` is an external Zustand store holding `threads`. `loadThreads` fetches via `getThreadsForAccount(acc, label, limit, offset)` and updates this store upon resolution.
2. **Category / Tab Scope**: `getThreadsForAccount` does not accept `category`. Category partitioning in split mode is handled via client-side filtering over store items rather than DB re-queries.
3. **Async Lifecycle**: `loadThreads` does not bind to an `AbortController` or cancellation token; promises resolve asynchronously and run their completion handlers (`markStagger`, `catch`, `finally`) regardless of subsequent navigation.
4. **Stagger Implementation**: The row component gates its `.stagger-in` CSS class on `staggerSet?.folder === folderKey && staggerSet.ids.has(thread.id)` (established in pass 3 / SPEC-SB REQ-3.4), not on `loadedFolder`.

---

### 1. Verdict
**CHANGES REQUESTED**

---

### 2. Findings

- **[H] F-01 — `src/components/layout/EmailList.tsx`** — Racing loads corrupt `loadedFolder` on out-of-order resolution, permanently disabling scroll-to-selection.
  In lines 346–350 (`+ setLoadedFolder(folder);`), `markStagger` sets `loadedFolder` unconditionally with the closure-captured `folder`. If a user navigates from folder A to folder B, and load B finishes before a slow or retried load A, load A subsequently completes and invokes `setLoadedFolder("A")`. `loadedFolder` becomes `"A"` while `folderKey` remains `"B"`. Because `loadedFolder !== folderKey` is now permanently true, line 618 (`+ if (loadedFolder !== folderKey) return;`) suppresses all current and future scroll-to-selection attempts in folder B until another reload occurs.

- **[H] F-02 — `src/components/layout/EmailList.tsx`** — Split-mode tab changes (`activeCategory`) freeze `loadedFolder` and permanently block scroll-to-selection.
  Line 133 computes `folderKey` using `activeCategory` (`folderKeyOf(activeAccountId, activeLabel, activeCategory)`), and line 618 gates scrolling on `+ if (loadedFolder !== folderKey) return;`. In split mode where `activeCategory` derives from `resolveActiveTab`, switching tabs changes `folderKey`. However, because `getThreadsForAccount` only queries by `(account, label)` and tab filtering is performed client-side on rows already in memory, `loadThreads` is not re-invoked on tab switches. Consequently, `markStagger` is never called, `loadedFolder` remains set to the previous category's key, and `loadedFolder !== folderKey` permanently blocks scrolling to selected threads in the newly active tab.

- **[M] F-03 — `src/components/layout/EmailList.tsx`** — `prev === null || prev.folder === folder` in `catch` clears valid stagger sets on background reload failures.
  In line 395 (`+ setStaggerSet((prev) => (prev === null || prev.folder === folder ? null : prev));`), the check clears `staggerSet` whenever `prev.folder === folder`. If folder A loads successfully and its rows begin staggering in (`prev.folder === "A"`), any subsequent background reload for folder A (such as a `velo-sync-done` event or manual refresh) that fails will hit this block with `folder === "A"`. The condition evaluates to true and sets `staggerSet` to `null`, abruptly stripping the stagger animation from rows that are already mounted. Furthermore, if an older load A1 fails after a newer load A2 for the same folder succeeds, A1's failure wipes out A2's active stagger set.

- **[M] F-04 — `src/components/layout/EmailList.virtual.test.tsx`** — Starred mock override bypasses `mode.paged`, breaking paging test semantics.
  In lines 42–45 (`+ if (label === "STARRED") return [...rows].reverse();`), the mock returns all 200 rows reversed before evaluating `mode.paged`. If any folder-crossing test combines `label === "STARRED"` with `mode.paged = true` to test pagination or infinite scroll (`loadMore`), the mock returns the entire dataset unpaged, bypassing `limit` and `offset` slicing and invalidating pagination assertions.

- **[N] F-05 — `src/components/layout/EmailList.tsx`** — Comment falsely claims `loadedFolder` guards the stagger animation.
  Lines 129–131 (`+ // ... neither the stagger nor the scroll-to-selection may act on them.`) assert that `loadedFolder` prevents stagger from acting on outgoing rows. In reality, `loadedFolder` is only consumed in the scroll-to-selection `useEffect` (lines 618, 624); stagger gating is governed exclusively by `staggerSet.folder === folderKey`. The comment misdocuments the role of `loadedFolder`.

---

### 3. Verified-Correct List

1. **Stale Row Scroll Prevention (REQ-3.3 / F-01 Fix)**: Line 618 (`if (loadedFolder !== folderKey) return;`) correctly halts the scroll effect on the intermediate frame where the previous folder's rows remain mounted under the newly switched `folderKey`, preventing premature latching of `lastScrolledRef.current = episode` against stale indices.
2. **Scroll Re-trigger on Arrival**: Adding `loadedFolder` to the dependency array in line 624 (`[selectedThreadId, selectedPresent, folderKey, loadedFolder]`) ensures that once `loadThreads` finishes and `loadedFolder` matches `folderKey`, the effect re-runs and smoothly scrolls to `selectedThreadId` if present.
3. **Episode De-duplication**: The `lastScrolledRef.current = episode` latching mechanism continues to ensure that once a thread is scrolled into view within a folder, subsequent component re-renders or minor updates do not jump-scroll a user who has scrolled away.
4. **Scroll Regression Test**: In `EmailList.virtual.test.tsx` (lines 234–250), the new test rigorously proves the guard: because Starred threads are reversed, scrolling to the stale index on the switch frame would land on rows ~`t65..t41`; the test verifies `t150` is in view only after Starred rows settle in the store.
5. **Stagger Selector Update**: In `EmailList.virtual.test.tsx` (lines 220–232), changing the assertion to target `firstRow()` (`t199`) correctly adapts the test to the reversed dataset without compromising the check that outgoing rows drop `.stagger-in` on the transition frame.
