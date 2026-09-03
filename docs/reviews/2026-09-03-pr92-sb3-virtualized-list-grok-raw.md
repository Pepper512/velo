The full review materials were offloaded. I’ll read that prompt file first so the review is based on the complete brief and diff.The prompt file is longer than one read. I’ll continue from the cutoff so the rest of the diff is in hand.1. Verdict: **CHANGES REQUESTED**

2. Findings:

[H] F-01 — `src/components/layout/EmailList.tsx` — REQ-3.3 is not met when the router already knows the selection and the list items arrive later. The scroll effect is:

```ts
useEffect(() => {
  if (!selectedThreadId) return;
  const index = itemsRef.current.findIndex((it) => it.kind === "thread" && it.threadId === selectedThreadId);
  if (index >= 0) virtualizerRef.current.scrollToIndex(index, { align: "auto" });
}, [selectedThreadId]);
```

It is keyed only on `selectedThreadId` (comment: “a reload while the user has scrolled away must not snap back”). On a deep link / first paint of a folder, that effect runs while `itemsRef.current` is still empty (`findIndex` → `-1`, no scroll). When `loadThreads` fills `visibleThreads`, the selection has not changed, so the effect does not run again. Under virtualization that is no longer “below the fold but in the DOM”: viewport ~600 px and `overscan: 8` keep only ~16–24 rows mounted, so a selected thread at index 20 is not rendered and is not scrolled to. Mouse/`j`/`k` still work because they change `selectedThreadId` after items exist. The new test only covers that later case (`nav.selectedThreadId = "t150"` after rows are already on screen) and would not have caught this. The old `querySelector` effect had the same dep array (pre-existing), but REQ-3.3 is a new SHALL on this reimplemented path and is worse now because unmounted rows cannot show selection. A first-appearance guard (`lastScrolledId !== selectedThreadId` once `index >= 0`) would satisfy REQ-3.3 without re-snapping on `velo-sync-done`.

[H] F-02 — `src/components/layout/EmailList.tsx` — `loadMore` can now fire with no user scroll, and the new test never checks it. Replacement of the 200 px scroll listener is:

```ts
const lastRenderedIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;
useEffect(() => {
  if (lastRenderedIndex >= 0 && lastRenderedIndex >= items.length - 5) loadMore();
}, [lastRenderedIndex, items.length, loadMore]);
```

For any list with `length <= 5` the inequality is true as soon as one virtual row exists (`2 >= 3-5`). For any list whose window + overscan 8 reaches the tail, it is true on the first virtualizer pass, not on a scroll event. The old listener only ran on `scroll`, so a short folder that did not overflow never called `loadMore` by itself. If existing `loadMore` is `if (loadingMore || !hasMore) return` (not in this diff; assumed from the pre-SB-3 page model), this is a no-op for `n < PAGE_SIZE` and a one-shot fill when `n === PAGE_SIZE`. If `hasMore` stays true while a page adds nothing (filter, error, empty category), this effect re-enters on every `lastRenderedIndex` / `items.length` / `loadMore` identity change with no scroll required — a new loop. The brief’s SB-3 test list required “`loadMore` near the end”; `EmailList.virtual.test.tsx` has no such case. I cannot confirm the guard without `loadMore`’s body (outside this diff).

[M] F-03 — `src/components/layout/EmailList.tsx` — First-paint `stagger-in` (REQ-3.4) is stripped on the next render and the folder reset is ordered so it often never applies. Evidence:

```ts
const firstPaintRef = useRef(true);
useEffect(() => { firstPaintRef.current = true; }, [activeAccountId, activeLabel, activeCategory]);
useEffect(() => { if (items.length > 0) firstPaintRef.current = false; });
const staggerOnThisPaint = firstPaintRef.current;
```

`staggerOnThisPaint` is a render-time snapshot of a ref. After the first loaded paint, the no-deps effect sets the ref false; it does not re-render by itself, but `useVirtualizer` re-renders on measure/scroll (library behavior the prompt allows us to rely on). That next render removes `className={stagger ? "stagger-in" : undefined}` from the first thread rows and cancels the CSS animation. On a folder change, the reset effect and the flip effect run in declaration order after paint: reset sets `true`, flip immediately sets `false` if `items.length > 0`. Folder switches that do not empty `visibleThreads` before the new fetch (common; `loadThreads` is not in this diff) therefore never show stagger. Even when threads are cleared, stagger only lasts until the first measure pass. Also, `stagger && index < 15` uses the **flat item** index, not the visible-thread index: five bundle headers mean only ten threads animate; fifteen expanded bundle children mean **no** thread gets `stagger-in`. Old code used `idx` from `visibleThreads.map`. Cosmetic, but REQ-3.4 names this behavior.

[M] F-04 — `src/components/layout/EmailList.virtual.test.tsx` — The component tests do not prove what the brief claims, and several assertions can pass for the wrong reason.

- `useActiveCategory: () => null` makes `showBundles = activeLabel === "inbox" && activeCategory === "All"` false, so the EmailList test never builds bundle headers/children. Bundles are only unit-tested in `listItems.test.ts`, which does not mount a virtualizer.
- “200 threads → fewer than 40 rows” is a loose bound (600/72 ≈ 8 visible + overscan 8 ≈ 24). It does prove not-all-200, not “only the viewport plus eight.”
- The t150 test asserts presence in the DOM, not `scrollTop` / `align: "auto"`. Combined with `< 40` it is fair evidence of windowing after a **post-load** selection change; it does not cover F-01.
- Divider test: `getByText("Other emails").closest("[data-thread-id]") === "t3"` checks markup parenting, not measured height. `offsetHeight` is stubbed to 72 for every non-`overflow-y-auto` node, so a divider row whose estimate is `72+28` still reports 72. Positioning of a taller divider row is untested.
- `ResizeObserver` is a no-op, so density / pane-layout / `MailLayout` width-drag remesure is untested.
- No drag, range-select, split-tab, draft, empty-state, or `loadMore` test.

[M] F-05 — `src/components/layout/EmailList.tsx` — Drag-to-label with a source row that virtualizes off-screen is a new unmount path this commit does not address. `ThreadCard` remains `useDraggable` on the `<button>` (outside this diff, as given); the positioned wrapper is a plain `div` with `ref={virtualizer.measureElement}`. Only `overscan: 8` rows exist, so a drag plus a scroll (or a `scrollToIndex` from `j`) unmounts the drag node. The brief’s failure mode claims a `DragOverlay` already keeps the visual and that the payload is captured at drag start; **neither overlay nor payload capture appears in this diff**. If that overlay is really in `DndProvider` (outside the diff), this is a documented residual risk. If it is not, REQ-3.4’s “drag-to-label SHALL behave as today” is a regression: previously all loaded rows stayed mounted. Marked M because of that uncertainty — this needs a hand check or a test, not a comment.

[L] F-06 — `src/components/layout/EmailList.tsx` — `scrollToIndex` only searches `kind === "thread"`. A selected id that exists only as `bundle-child` (`visibleThreads` minus bundled ids in All, per given context) yields `index === -1` and does not scroll. Old code also failed here: bundle children were `<div className="pl-4">` **without** `data-thread-id`, so `querySelector` missed them. Click-to-open a child that is already on screen still works. Regression risk is `j`/`k` landing on a store thread that is only on a collapsed/expanded bundle row. Same effect as F-01; separate because of the kind filter.

[L] F-07 — `src/services/inbox/listItems.ts` — The item model does not unique-key or de-dupe a thread that is both a bundle child and a visible thread. Child key is `bundle-${category}-${thread.id}`; visible thread key is `thread.id`. Two `ThreadCard`s / two `useDraggable`s if the caller ever passes the same id in both arrays. Given context says `visibleThreads` already drops bundled/held ids in All; `buildListItems` itself will happily emit both. Keys are unique across kinds (`bundle-…` vs raw id vs `footer-loading`) unless a Gmail thread id literally equals `bundle-Newsletters` (unrealistic). Bundle-child keys are **not** “as today” (REQ-3.2): they used to be `key={thread.id}` under a nested `bundle-${category}` parent. Flattening requires the prefix; that part is the right deviation.

[L] F-08 — `src/services/inbox/listItems.ts` — Estimates ignore root font scale (called out in *What exists* 2) and treat `bundle-child` like a thread (`44/72/88`). `measureElement` on the absolute wrapper should correct after mount (`offsetHeight` / border-box RO — library behavior). Until that lands, `getTotalSize()` is wrong and the scrollbar jumps — the thing REQ-3.2’s “initial estimate SHALL keep the scrollbar stable” is meant to avoid. Divider `+ 28` on the measured wrapper is the right model (band is inside the thread row).

[L] F-09 — `src/components/layout/EmailList.tsx` — Drive-by prefetch-key change in an SB-3 commit: `prefetchOrder(…).join("\n")` / `.split("\n")` becomes `joinIds` / `splitIds`. `neighbours.ts` is not in this diff, so this is not a new helper, but it is unrelated to REQ-3 and sits next to a new `threadMap` subscription. REQ-4 is “nothing else changes” except the named list work. Low blast radius.

[N] F-10 — `package.json` — `"@tanstack/react-virtual": "3.14.10"` is an exact pin (REQ-3.5). No other `package.json` dependency lines change. Lockfile provenance is **not in this diff** (explicitly omitted); I did not verify SLSA/attestations.

[N] F-11 — `src/components/layout/EmailList.tsx` — Virtualizer wiring that looks right: `itemsRef.current = items` during render so `estimateSize` / `getItemKey` do not close over a stale `items` array; `getItemKey` is the stable `item.key`; `overscan: 8`; inner container `height: virtualizer.getTotalSize()` + `position: relative`; rows `position: absolute; transform: translateY(start)` + `data-index` + `measureElement`. Absolute wrappers do report `offsetHeight` (library reads that / RO border-box). `MailLayout` width drags and the three reading-pane heights should RO-resize the scroller (not tested). `renderItem` returning `null` when `threadMap.get` misses still leaves an empty measured wrapper (height ~0) — should not happen if `visibleThreads` and `threadMap` come from the same `setThreads` (given context).

3. What I verified and found correct:

- REQ-3.1 item kinds: `buildListItems` emits bundle, bundle-child, thread, loading, all-loaded; `renderItem` has a case for each; both footers are mutually exclusive (`loadingMore` wins).
- REQ-3.2 divider rule on the **visible** sequence: `previousPinned && !thread.isPinned`, then `previousPinned = thread.isPinned`. Fixes the old `filteredThreads[idx-1]` / `visibleThreads` mismatch. Tests cover `[p,p,u,u]`, all-pinned, leading unpinned, and a later pin→unpin.
- REQ-3.2 measurement model: divider lives inside the measured thread wrapper; estimate adds `DIVIDER_HEIGHT`; density 44/72/88.
- REQ-3.5 exact version pin in `package.json`; no other deps in that file.
- REQ-4 for store / `ThreadCard` / keyboard / DB: this diff only *reads* `threadMap` and `emailDensity`; `ThreadCard` props match the old call sites (`showCategoryBadge={showBundles}` ≡ the old All-inbox check).
- `showBundles` and bundle child source (`filteredThreads.filter` + `categoryMap`) match the removed JSX.
- Selection/multi-select/`j`/`k` still go through store + router, not the DOM (given context) — virtualization does not change those code paths.
- Stagger is not applied to rows that merely scroll into view after `firstPaintRef` is false (the intended half of REQ-3.4).
- `listItems.test.ts` is honest for the pure model (keys, divider, footers, estimates).
- Empty/skeleton path: the virtualizer replaces only the old `<>…</>` list body; the outer ternary that chose that body is unchanged in the hunk.

**Uncertainty (explicit):** `loadMore` / `hasMore` / whether folder changes clear `threads`; whether `DndProvider` already has a `DragOverlay`; lockfile provenance; whether TanStack 3.14.10 re-runs `scrollToIndex` after first measure (design claims it does).
