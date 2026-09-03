### Outside the Delta Relied Upon
- **Store architecture**: `useThreadStore` (`threads`, `threadMap`, `isLoading`, `hasMore`, `loadingMore`, `loadMore`) and `useAccountStore` (`activeAccountId`) operate as independent stores where folder selection state (`activeLabel`, `activeCategory`) updates independently of thread loading states.
- **Virtualizer contract**: `@tanstack/react-virtual` (or equivalent) relies on DOM measurement (`measureElement`) where elements with zero height corrupt layout offsets, and container scroll events update virtual ranges.
- **Test environment**: Vitest in a JSDOM environment, where `HTMLElement.prototype.scrollTo` does not natively update `scrollTop` or dispatch a `scroll` event without an external mock/stub defined in `beforeAll` / setup files.

---

### 1. Verdict
**CHANGES REQUESTED**

---

### 2. Findings

- **[H] F-01 — `src/components/layout/EmailList.tsx`**  
  The effect keyed on `[selectedThreadId, selectedPresent]` re-scrolls on list reload or refetch, violating the requirement that background reloads must not snap the scroll position back. In the diff:
  ```tsx
  + const selectedPresent = selectedThreadId !== null && items.some((it) => it.threadId === selectedThreadId);
    useEffect(() => {
  +   if (!selectedThreadId || !selectedPresent) return;
  +   const index = itemsRef.current.findIndex((it) => it.threadId === selectedThreadId);
      if (index >= 0) virtualizerRef.current.scrollToIndex(index, { align: "auto" });
  - }, [selectedThreadId]);
  + }, [selectedThreadId, selectedPresent]);
  ```
  Whenever a reload or sync temporarily clears `threads` or drops the active thread, `selectedPresent` transitions `false -> true`. Because `selectedPresent` is in the dependency array, the effect fires and calls `scrollToIndex`, yanking the user back to `selectedThreadId` even if they had deliberately scrolled away to view older emails. The commit comments quietly redefine the requirement from *"a reload while the user has scrolled away must not snap back"* to *"a reload that merely reorders items does not snap the user back"*, which masks the regression. The component should track whether it has already scrolled for the given `selectedThreadId` (e.g., via a `lastScrolledIdRef`) so that scroll-to-selection triggers on initial arrival or selection change, but never on subsequent data refreshes.

- **[H] F-02 — `src/components/layout/EmailList.tsx`**  
  Mutating `staggerRef` during render violates React 19's Rules of React and causes a race condition across decoupled stores that breaks stagger animations on folder change. In the diff:
  ```tsx
  + const folderKey = `${activeAccountId ?? ""}|${activeLabel}|${activeCategory}`;
  + const staggerRef = useRef<{ folder: string; keys: Set<string> } | null>(null);
  + if (!isLoading && items.length > 0 && staggerRef.current?.folder !== folderKey) {
  +   staggerRef.current = { folder: folderKey, keys: new Set(items.slice(0, 15).map((it) => it.key)) };
  + }
  + const staggerKeys = staggerRef.current?.folder === folderKey ? staggerRef.current.keys : null;
  ```
  First, writing to `ref.current` during render is forbidden in React 19 (outside of one-time lazy initialization of `null` refs) because concurrent renders and Strict Mode re-runs create non-idempotent side effects. Second, `activeAccountId`/`activeLabel` and `threads`/`isLoading` reside in separate stores. When switching folders, `folderKey` changes immediately while `items` still holds the previous folder's threads (and `isLoading` remains `false` before the fetch effect initiates). `staggerRef` latches onto the old folder's thread keys under the new `folderKey`. When the new folder's items finish loading, `staggerRef.current?.folder !== folderKey` is already false, preventing the new rows from ever receiving the `stagger-in` class. Furthermore, as explicitly documented in `EmailList.virtual.test.tsx` line 186 (*"Categories and bundle rules land in separate state updates"*), capturing keys on the first loaded paint locks in pre-bundled keys before the list structure stabilizes.

- **[M] F-03 — `src/components/layout/EmailList.tsx`**  
  Strict-null inequality against `selectedThreadId` creates false positive matches for `undefined` thread IDs. In the diff:
  ```tsx
  + const selectedPresent = selectedThreadId !== null && items.some((it) => it.threadId === selectedThreadId);
  ```
  If `selectedThreadId` is `undefined` (common when props or store state represent unselected states as `undefined`), `selectedThreadId !== null` evaluates to `true`. If `items` contains any non-thread entry without a `threadId` (such as bundle headers), `it.threadId === selectedThreadId` evaluates to `undefined === undefined` (`true`), causing `selectedPresent` to falsely evaluate to `true`. While `if (!selectedThreadId)` in the effect guards immediate execution, the derivation is unsound and risks regressions if `selectedPresent` is used downstream. The check should use `Boolean(selectedThreadId)` or `selectedThreadId != null`.

- **[L] F-04 — `src/components/layout/EmailList.virtual.test.tsx`**  
  The new tests rely on an unverified scroll stub for pagination and omit test coverage for selected bundle-child scrolling. In the diff:
  ```tsx
  + const scroller = document.querySelector<HTMLElement>(".overflow-y-auto")!;
  + act(() => scroller.scrollTo({ top: 50 * ROW }));
  + await waitFor(() => expect(useThreadStore.getState().threads).toHaveLength(100));
  + expect(getThreadsForAccount).toHaveBeenLastCalledWith("acc1", "INBOX", 50, 50);
  ```
  In JSDOM, `Element.prototype.scrollTo` is a no-op; this test only works because an external harness stub outside the diff explicitly updates `scrollTop` and dispatches a synthetic `scroll` event. The test sets `top: 50 * ROW` (which in a real DOM would be clamped by `scrollHeight - clientHeight`) without asserting that intermediate scroll offsets do not trigger `loadMore` or that calls are suppressed when `hasMore` is false. Additionally, while the initial review noted that selected bundle children were excluded from scroll-to-selection, the test suite verifies expanding bundles but never asserts that selecting a bundle child actually scrolls it into view.

---

### 3. Verified-Correct List

1. **Defensive placeholder row (`EmailList.tsx`)**:
   - `if (!thread) return <div style={{ height: item.estimate }} />;` in both `bundle-child` and `thread` cases prevents the virtualizer's `measureElement` from measuring an empty node at `0px` height and corrupting scroll offsets.
2. **Item model deduplication (`listItems.ts` & `listItems.test.ts`)**:
   - `const emitted = new Set(items.flatMap((it) => (it.threadId ? [it.threadId] : [])));` and `if (emitted.has(thread.id)) continue;` ensures threads already emitted inside expanded bundles are never emitted a second time as standalone plain rows.
3. **Guard conditions on `loadMore` effect (`EmailList.tsx`)**:
   - Adding `if (!hasMore || loadingMore) return;` and including `hasMore` and `loadingMore` in the dependency array prevents redundant `loadMore()` dispatches once the list is exhausted or while an active request is in flight.
4. **Initial selection scroll before load (`EmailList.virtual.test.tsx`)**:
   - `it("scrolls a selection known before the list loads into view once it has...")` confirms that a pre-set `nav.selectedThreadId` properly scrolls to index once asynchronous thread loading populates the list.
