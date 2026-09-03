### 1. Verdict
**CHANGES REQUESTED**

---

### External Assumptions & Context Relied Upon
Outside the immediate delta, this review relies on:
1. **`items` / `itemsRef` persistence across folder switches**: `items` is component state updated asynchronously upon `loadThreads` completion; when `activeLabel` changes, `items` retains the outgoing folder's threads for at least one commit frame while the network request is in flight (explicitly confirmed by the test comment: `"The same rows are still on screen for a frame; they belong to the old folder"`).
2. **`useRouteNavigation` semantics**: `useSelectedThreadId` returns a primitive `string | null` and `useActiveCategory` returns `string | null` (as mirrored by the test mock). Re-selecting an already selected thread does not produce a new string identity.
3. **`loadThreads` lifecycle**: `loadThreads` is an uncancelled async function triggered on label/folder/account transitions that calls `getThreadsForAccount` and updates `items` and `loading`.
4. **Virtualizer interface**: `virtualizerRef.current.scrollToIndex` takes an item index in `itemsRef.current` and scrolls the list viewport.

---

### 2. Findings

- **[H] F-01 — `src/components/layout/EmailList.tsx`**  
  Folder switch with unchanged selection scrolls against stale rows of the outgoing folder and permanently suppresses scrolling for the incoming folder. In lines 605–618, the reset effect is keyed only to `[selectedThreadId]`, while the scroll effect is keyed to `[selectedThreadId, selectedPresent, folderKey]`. When a user switches folders (e.g., `activeLabel` changes from `"inbox"` to `"starred"`) with a thread selected, `folderKey` changes immediately, but `items` still holds the outgoing folder's threads. Because `selectedThreadId` did not change, the reset effect does not run. Because `folderKey` changed, the scroll effect fires immediately: `selectedPresent` evaluates to `true` against the *outgoing* folder's items, `itemsRef.current.findIndex` calculates the thread's index in the *outgoing* folder, `virtualizer.scrollToIndex` scrolls to that stale index, and `lastScrolledRef.current` is set to the new `folderKey|selectedThreadId` episode. When `loadThreads` completes and renders the new folder's items, the episode is already latched, preventing the effect from ever scrolling to the thread's actual position in the new folder.
  ```tsx
  +  useEffect(() => {
  +    lastScrolledRef.current = null;
  +  }, [selectedThreadId]);
  +  useEffect(() => {
  +    if (!selectedThreadId || !selectedPresent) return;
  +    const episode = `${folderKey}|${selectedThreadId}`;
  +    if (lastScrolledRef.current === episode) return;
  +    const index = itemsRef.current.findIndex((it) => it.threadId === selectedThreadId);
  +    if (index < 0) return;
  +    lastScrolledRef.current = episode;
  +    virtualizerRef.current.scrollToIndex(index, { align: "auto" });
  +  }, [selectedThreadId, selectedPresent, folderKey]);
  ```

- **[M] F-02 — `src/components/layout/EmailList.tsx`**  
  Reset effect keyed on primitive `selectedThreadId` fails to re-enable scrolling when re-selecting the currently selected thread after scrolling away. Lines 600–608 state that the latch resets "when the user picks a thread (even the same one again)". However, `selectedThreadId` is a primitive string; if a user scrolls away from thread `t1` and re-picks `t1` (via clicking the row, keyboard navigation, or re-navigating to the route), `selectedThreadId` does not change (`Object.is("t1", "t1") === true`). React skips the reset effect entirely, skips the scroll effect, and leaves `lastScrolledRef.current` matching `${folderKey}|${selectedThreadId}`, suppressing the scroll despite the stated intent.
  ```tsx
  +  // Scrolled once per selection *episode*: when the user picks a thread (even
  +  // the same one again)...
  +  const lastScrolledRef = useRef<string | null>(null);
  +  useEffect(() => {
  +    lastScrolledRef.current = null;
  +  }, [selectedThreadId]);
  ```

- **[M] F-03 — `src/components/layout/EmailList.tsx`**  
  Unconditional `setStaggerSet(null)` in `loadThreads` catch block races with and wipes out stagger sets of newer folder loads. In lines 384–388, `loadThreads` catches errors and calls `setStaggerSet(null)`. If a user rapidly navigates from Folder A to Folder B, and Load B resolves successfully (`setStaggerSet({ folder: "B", ids: ... })`) before a slow or aborted Load A rejects, Load A's `catch` block executes `setStaggerSet(null)` unconditionally. Unlike the success path which tags `folder` so stale resolutions are ignored by `staggerSet?.folder === folderKey`, `setStaggerSet(null)` lacks any folder/request check and clears Folder B's active stagger set.
  ```tsx
       } catch (err) {
         console.error("Failed to load threads:", err);
  +      // Nothing new landed, so nothing should animate in (Gemini third pass F-04).
  +      setStaggerSet(null);
       } finally {
  ```

- **[M] F-04 — `src/components/layout/EmailList.virtual.test.tsx`**  
  The new folder-change test yields a false positive due to shared mock thread IDs and omitted selection assertions. In lines 214–227, the test switches `nav.label` from `"inbox"` to `"starred"` and verifies that `row("t0")` loses and regains `.stagger-in`. However, the mock `getThreadsForAccount` returns identical thread IDs (`t0`, etc.) for every folder query, meaning the test asserts on the exact same DOM node rather than verifying outgoing rows are replaced by incoming folder-specific rows. Crucially, the test leaves `nav.selectedThreadId = null`, completely failing to exercise or detect the critical scroll latch regression (F-01) during folder transitions.
  ```tsx
  +  it("staggers the new folder's rows after a folder change, not the outgoing list's (REQ-3.4)", async () => {
  +    const { rerender } = render(<EmailList />);
  ...
  +    nav.label = "starred";
  +    act(() => rerender(<EmailList />));
  ...
  +    await waitFor(() => expect(row("t0")!.classList.contains("stagger-in")).toBe(true));
  +  });
  ```

- **[L] F-05 — `src/components/layout/EmailList.tsx`**  
  Inconsistent null handling and parameter typing for `category` in `folderKeyOf`. Lines 42–44 type `accountId` as `string | null` with fallback `accountId ?? ""`, but type `category` as `string` and interpolate `${category}` directly. Because `useActiveCategory` returns `null` when no category is active (demonstrated by line 15 of the test mock), passing `activeCategory` produces literal string `"null"` (`"${accountId ?? ""}|${label}|null"`) and violates strict null checks unless cast.
  ```tsx
  +function folderKeyOf(accountId: string | null, label: string, category: string): string {
  +  return `${accountId ?? ""}|${label}|${category}`;
  +}
  ```

---

### 3. Verified-Correct List

1. **Temporal Dead Zone Elimination**: Hoisting `folderKeyOf` to module scope and declaring `const folderKey` at line 131 before any effect hooks resolves the TDZ `ReferenceError` identified in the third pass.
2. **Account Null Key Consistency**: Using `folderKeyOf` with `${accountId ?? ""}` in both `loadThreads` (line 344) and render (line 131) ensures the key is identical (`"|label|category"`) when `activeAccountId` is null, preventing key mismatch when no account ID is present.
3. **Transitional Stagger Suppression**: Evaluating `staggerIds = staggerSet?.folder === folderKey ? staggerSet.ids : null` ensures that on the transitional frame before the new folder's data lands, the outgoing rows do not receive or maintain stagger styling under the new folder's key.
4. **Reload Snap Guard**: When a folder's data reloads without changing `folderKey` or `selectedThreadId`, `lastScrolledRef.current === episode` holds, preventing the list from snapping a scrolled-away user back to the selected row upon data refresh.
5. **Hook Declaration Order**: Placing the reset effect prior to the scroll effect ensures that whenever both effects are scheduled in the same commit, the reset effect executes before the scroll effect.
