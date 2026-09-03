1. Verdict: **CHANGES REQUESTED**

2. Findings

**[H] F-01 — `src/components/layout/EmailList.tsx` — folder-switch scroll fires on leftover rows and then latches**

The new test states the list is not cleared on folder change (“The same rows are still on screen for a frame”). `selectedPresent` is `items.some(...)`, so that frame still counts the outgoing row as present. The reset effect is keyed only on `[selectedThreadId]`, so a folder/account switch that keeps the selection does **not** clear `lastScrolledRef`. The scroll effect *does* re-run because `folderKey` is in its deps; `episode` is `` `${folderKey}|${selectedThreadId}` ``, which does not match the previous folder’s latch, so it `scrollToIndex`s the **outgoing** index and immediately stores the **incoming** episode:

```ts
useEffect(() => { lastScrolledRef.current = null; }, [selectedThreadId]);
useEffect(() => {
  if (!selectedThreadId || !selectedPresent) return;
  const episode = `${folderKey}|${selectedThreadId}`;
  if (lastScrolledRef.current === episode) return;
  // ...
  lastScrolledRef.current = episode;
  virtualizerRef.current.scrollToIndex(index, { align: "auto" });
}, [selectedThreadId, selectedPresent, folderKey]);
```

When the new rows land, `selectedThreadId` is unchanged and `selectedPresent` stays `true` if that thread exists in the new folder (normal for Gmail: Inbox + Starred). Deps do not change again, so the incoming list never scrolls. If the thread is *not* in the new folder, `selectedPresent` falls to `false` after the fact — too late; the container has already been snapped to the old index. That is the reload snap the latch was meant to prevent, just triggered by `folderKey` while `items` still belong to the previous key. Same walk for an account switch that leaves `selectedThreadId` in place.

Walk of the other paths (assuming leftover `items` until the next `loadThreads` resolves, and that re-clicking the already-selected row does not change the route id):

| Event | Scroll? | Correct? |
|---|---|---|
| Mount with selection, list empty then arrives | Reset runs once (`latch=null`); second commit `selectedPresent` rises → scroll | Yes |
| Select a different thread | Reset then scroll in the same commit; `episode` also changes with the id | Yes |
| Deselect then select the same id again | Reset on `null` / on the re-select; without the reset, `episode` would match the stale latch and suppress | Yes (this is the only reason the reset effect is not redundant with `episode`) |
| Re-click the currently selected row after scrolling away | Neither effect runs (`selectedThreadId` unchanged) | Matches the latch; the comment’s “even the same one again” overclaims |
| Folder/account switch, selection unchanged | Premature scroll on leftover rows; latch blocks the real list | **No** |
| Reload that drops and re-adds the row, same folder | `selectedThreadId` / `folderKey` unchanged; if `selectedPresent` flickers, `episode === latch` suppresses | Yes |
| Reload that replaces items in one setState | Effect does not re-run | Yes |

**[M] F-02 — `src/components/layout/EmailList.tsx` — `setStaggerSet(null)` on any failed load can clobber a newer success**

```ts
} catch (err) {
  console.error("Failed to load threads:", err);
  setStaggerSet(null);
}
```

`folder` is captured at invoke time, but the catch does not pair the failure with that capture, an abort flag, or a generation token. Two `loadThreads` in flight (folder switch, Strict Mode remount, overlapping refresh): a **later-settling failure** of the older call wipes the stagger the newer call just installed. If a previous request is aborted into this `catch`, the abort itself clears the in-flight folder’s set. REQ-3.4 then silently does not animate. A failed load that is still the latest call *should* clear; this catch does not distinguish that.

**[M] F-03 — `src/components/layout/EmailList.virtual.test.tsx` — folder-change test can pass for the wrong reason**

`useActiveLabel: () => nav.label` reads a mutable hoisted object, not React state. The mock still returns the same thread ids for every folder, and the test never asserts `getThreadsForAccount` was called with the starred label (or that the incoming stagger ids came from that response). Sequence that passes:

1. First load stamps `{ folder: "…|inbox|…", ids: {t0…} }` → `stagger-in` true.
2. `nav.label = "starred"` + `rerender` → render `folderKey` mismatches → class drops. This only proves the render-time key guard.
3. `waitFor` class true again succeeds for **any** later `setStaggerSet` whose `folder` equals the current key with id `t0` — including an effect that copies the old id set onto the new key, or a stale load that stamps `folderKeyOf` at completion from live hook state rather than from the captured `folder`.

It does not prove “staggers the new folder’s rows, not the outgoing list’s.” It also never exercises F-01 (no selection, no `scrollToIndex` assertion).

**[L] F-04 — `src/components/layout/EmailList.tsx` — `folderKeyOf` coalesces `accountId` but not `category`**

```ts
function folderKeyOf(accountId: string | null, label: string, category: string): string {
  return `${accountId ?? ""}|${label}|${category}`;
}
```

Both call sites pass the same `activeCategory`. If that value is ever `null` (the test mock is `useActiveCategory: () => null`), interpolation yields the literal `"null"`, which is consistent *inside this file*. If split-mode `resolveActiveTab` / `visibleTabs` (outside this delta) feeds the fetch a different string than `activeCategory` (`null` vs `""` vs `"all"`), stagger comparison and the scroll episode will not match the list on screen. Not a bug in the helper itself; it is the remaining mismatch surface the hoist does not close.

3. Verified-correct

- **TDZ:** `folderKey` is now computed at the top of the component, before both effects and before `staggerIds`. The third-pass crash on first selection is gone.
- **Shared key helper:** `loadThreads` and the render both use `folderKeyOf(activeAccountId, activeLabel, activeCategory)`, including `accountId ?? ""`. The previous `"null|…"` vs `"|…"` stagger miss when `activeAccountId` is null is gone.
- **New selection / first appearance:** episode includes `selectedThreadId`; reset-before-scroll in the same commit also covers deselect → reselect of the same id in the same folder.
- **Reload drop/re-add, same folder:** reset does not run; episode is unchanged; `lastScrolledRef` suppresses a snap of a user who scrolled away.
- **Failed load, single-flight:** `setStaggerSet(null)` is the right idea for “nothing new landed” when that failure is the only in-flight load.
- **Stagger render guard:** `staggerIds = staggerSet?.folder === folderKey ? staggerSet.ids : null` still drops the class as soon as the on-screen key changes, which is what the new test’s intermediate `expect(false)` actually measures.

**Relied on, outside the delta:** React 19 still runs layout/passive effects in declaration order within a commit. `loadThreads` does not clear `items` before the fetch (stated by the new test). `selectedThreadId` is a route string and is stable if the user clicks the already-selected row. Thread ids can appear under more than one label. Overlapping `loadThreads` calls are possible (no abort/generation in this diff). `activeCategory` here is assumed to be the same value used to fetch, including in split mode — not verified in this diff.
