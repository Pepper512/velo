### External Assumptions & Dependencies Outside Delta
In conducting this review, the following behaviors outside the delta are relied upon:
1. **`loadThreads` dependencies & query alignment**: `useCallback` lists `activeAccountId`, `activeLabel`, and `activeCategory` in its dependency array so that `folder` and query arguments are created fresh on folder/account switches.
2. **Model shape**: `mapSmartFolderRows` and `mapDbThreads` produce arrays of items containing `id: string` matching `thread.id`.
3. **Item shape**: `items` in the virtualizer list contains elements with `threadId?: string`, and `itemsRef.current` mirrors `items`.
4. **Virtualizer API**: `virtualizerRef.current.scrollToIndex` accepts `{ align: "auto" }`.
5. **Test environment**: Vitest/Jest test environment runs with real timers for `EmailList.virtual.test.tsx` (fake timers would hang on `setTimeout`).

---

### 1. Verdict
**CHANGES REQUESTED**

---

### 2. Findings

- **[H] F-01 — `src/components/layout/EmailList.tsx` — `lastScrolledRef` permanently blocks scrolling on deselect/re-select, account switch, and filter re-entry**
  In the scroll effect (+594–601):
  ```typescript
  +  const lastScrolledRef = useRef<string | null>(null);
     useEffect(() => {
       if (!selectedThreadId || !selectedPresent) return;
  +    if (lastScrolledRef.current === selectedThreadId) return;
       const index = itemsRef.current.findIndex((it) => it.threadId === selectedThreadId);
  -    if (index >= 0) virtualizerRef.current.scrollToIndex(index, { align: "auto" });
  +    if (index < 0) return;
  +    lastScrolledRef.current = selectedThreadId;
  +    virtualizerRef.current.scrollToIndex(index, { align: "auto" });
     }, [selectedThreadId, selectedPresent]);
  ```
  `lastScrolledRef.current` latches onto `selectedThreadId` and is never cleared or reset. When a thread is deselected (`selectedThreadId = null`), line 595 returns early without clearing `lastScrolledRef.current`. If the user scrolls away and subsequently re-selects the same thread, line 596 exits immediately because `lastScrolledRef.current === selectedThreadId`, failing to scroll to the selection. Similarly, `lastScrolledRef` contains no account or folder scoping: switching accounts or folders while preserving `selectedThreadId` (or switching back) will not scroll to the selected thread when the new list loads. Finally, if a selected thread temporarily leaves the list due to an active search/category filter and later re-enters (`selectedPresent` transitioning `false -> true`), line 596 short-circuits and refuses to scroll. To fix this, `lastScrolledRef` must reset when selection is cleared (`if (!selectedThreadId) { lastScrolledRef.current = null; return; }`) and track composite selection context (`${folderKey}|${selectedThreadId}`).

- **[M] F-02 — `src/components/layout/EmailList.virtual.test.tsx` — Non-deterministic `setTimeout(20)` negative assertion and absent regression tests for SB-3 fixes**
  In the virtualizer test (+203–206):
  ```typescript
  +    act(() => scroller.scrollTo({ top: 10 * ROW }));
  +    await new Promise((r) => setTimeout(r, 20));
  +    expect(getThreadsForAccount).toHaveBeenCalledTimes(1);
  ```
  Using an arbitrary real-time timer (`setTimeout(r, 20)`) outside `act()` to assert that a fetch was not triggered is non-deterministic and will cause CI test flakiness under load, or will hang indefinitely if `vi.useFakeTimers()` is configured. Furthermore, the test delta only checks REQ-3.3 scroll threshold paging and introduces zero regression tests for the three primary bug fixes in this commit: there are no assertions verifying that `staggerSet` animates the first 15 rows of a newly loaded folder and excludes outgoing/paged rows, that `lastScrolledRef` prevents reload snapping, or that `selectedPresent` guards against undefined `threadId`.

- **[L] F-03 — `src/components/layout/EmailList.tsx` — Asymmetric key formatting between `folder` and `folderKey`**
  In `loadThreads` (+335):
  ```typescript
  +    const folder = `${activeAccountId}|${activeLabel}|${activeCategory}`;
  ```
  contrasts with line 619:
  ```typescript
       const folderKey = `${activeAccountId ?? ""}|${activeLabel}|${activeCategory}`;
  ```
  While `activeAccountId` is guarded by `if (!activeAccountId) return;` at line 327 making these evaluate identically when active, the asymmetric handling (`activeAccountId` vs `activeAccountId ?? ""`) creates unnecessary coupling and potential drift if the null check is refactored. Both should use a shared helper function for composite key generation.

- **[L] F-04 — `src/components/layout/EmailList.tsx` — `staggerSet` is not reset on load failure**
  In `loadThreads` (+336, +355, +374):
  ```typescript
       try {
         ...
         setThreads(mapped);
  +      markStagger(mapped);
       } catch (err) {
  ```
  If `db.select` or `mapDbThreads` throws an exception, `staggerSet` is not cleared in the `catch` block. If the user reloads the same folder and the query fails, the stale `staggerSet` for that `folderKey` remains in state.

---

### 3. Verified-Correct List

- **Elimination of render-phase side effect**: The prohibited React 19 render-phase ref mutation (`staggerRef.current = ...` inside render) has been completely removed. State is updated in `loadThreads`, and render purely derives `staggerIds`.
- **Render batching & no extra renders**: `setThreads` and `setStaggerSet` are called synchronously in `loadThreads`. Under React 19 automatic batching, this triggers exactly one unified render.
- **`loadMore` isolation**: `loadMore` does not invoke `markStagger`, ensuring subsequent pages do not trigger stagger animations or cause additional state updates.
- **`markStagger` closure correctness against racing queries**: Because `const folder` is captured synchronously at the entry of `loadThreads` in the same scope as the query parameters, `markStagger` cannot record the wrong folder name for the rows it queried. Even if two queries race and finish out of order, line 620 (`staggerSet?.folder === folderKey ? staggerSet.ids : null`) ensures a stale load's stagger set will not match the active folder key.
- **Initial mount scroll-to-selection**: On initial boot or deep link, `lastScrolledRef.current` starts as `null`, allowing the scroll effect to run once when `selectedPresent` transitions to `true`.
- **Undefined selection guard**: `!!selectedThreadId && items.some((it) => it.threadId !== undefined && it.threadId === selectedThreadId)` safely eliminates false-positive matches when `threadId` or `selectedThreadId` is undefined.
