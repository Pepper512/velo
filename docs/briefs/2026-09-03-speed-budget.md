# SPEC-SB — Speed budget: a virtualized list, threads that open without a skeleton, and a "Reduce effects" mode that stops the GPU work (#232)

- **Task:** Make the inbox feel instant and idle quietly. Three parts, one brief, one PR,
  three rebase-merged commits each reviewed on its own diff (the PR D/E pattern):
  **SB-1** "Reduce effects" — the existing "Reduce motion" toggle grows to cover the backdrop
  blurs, hover/press transitions and list stagger, and defaults **on** for Linux; **SB-2** a thread opens
  with its messages already in hand — a small stale-while-revalidate cache of
  `getMessagesForThread` results, warmed for the neighbours of the selected thread; **SB-3**
  the thread list renders only the rows in view with `@tanstack/react-virtual`.
- **Tier:** **1** — Jim's 2026-09-03 instruction ("brief first, Tier 1, one PR per item; the
  dependency is approved, add nothing else"). The one dependency is pre-approved (LOG.md
  2026-09-02 decision 3: "`@tanstack/react-virtual` approved … headless, no transitive deps");
  a threat note on it is in *Design* all the same. No schema, no Rust, no capability, no CSP.
- **Base:** `main` @ `2c80217` (code pin `91e01f6`, #90). Citations grepped at `2c80217`.
- **Status:** approved (brief) — branch `speed-budget`, PR opened with this file before any
  code. Jim, 2026-09-03: *"next is the speed budget (list virtualization with the
  already-approved @tanstack/react-virtual, body prefetch, reduce-effects; #232) — brief first,
  Tier 1, one PR per item; the dependency is approved, add nothing else."*
- **Source:** ROADMAP §4 wave 1, item 4 (P1, 6 days); the vault's
  `2026-09-01_Velo_Superhuman-Parity_Enhancements.md` row "Speed budget: virtualized list,
  next-N body prefetch, 'reduce effects' mode (default on for Linux)" and its effort note
  ("Virtualizing `EmailList` is the hard part: variable row heights, multi-select ranges and
  `@dnd-kit` drag all touch the list"); upstream **#232** "Performance on Linux is very slow" —
  WebKitWebProcess at full CPU while idle, up-to-1 s lag; the vault triage: five blobs under
  `backdrop-filter` and six one-minute timers; the vault queue row 4.
- **Effort:** L · 6 days (SB-1 ½, SB-2 1, SB-3 3–4, review ½).

## Outcome

On a Linux box Velo starts with flat panels and no animation, and sits at idle CPU. On any
box, pressing `j` down a folder of five hundred threads never stutters, because only the
fifteen rows on screen exist; the thread I land on shows its messages at once instead of
three grey bars; the list no longer rebuilds itself every minute because a reminder happens
to be pending. Nothing about selection, drag-to-label, bundles, pinned dividers, the split
tabs or the reading-pane layouts changes for the user.

## What exists, verified at `2c80217`

1. **The list is `EmailList.tsx` (803 lines).** Scroll container `:632` (`flex-1
   overflow-y-auto`); rows `:702-728` — a `div[data-thread-id]` wrapper per thread, the first
   fifteen with `stagger-in` and a per-index `animationDelay`, an "Other emails" divider band
   injected *inside* the wrapper of the first unpinned row (`:712-716`); bundle header rows
   and their expanded children precede the threads in the same scroller (`:646-701`); two
   footer rows follow (`:729-738`). **Latent bug:** the divider reads the previous row from
   `filteredThreads` while iterating `visibleThreads` (`:703`) — two different arrays.
2. **Row height varies by density** (`ThreadCard.tsx:83`, `:97-99`; compact hides the snippet
   row, `:134`), by the root font scale (`globals.css:73-76`, `App.tsx:478-482`), by the
   divider band, and by row kind (bundle header, bundle child in `pl-4`, footer). Text never
   wraps (`truncate` throughout), so height is a function of kind + density, not content.
3. **Pagination and reload.** `PAGE_SIZE = 50` (`:35`); `loadMore` on a raw scroll listener
   when within 200 px of the bottom (`:513-526`); **every `velo-sync-done` reloads the whole
   page** after a 500 ms debounce (`:499-510`), and each reload runs one `getThreadLabelIds`
   query per thread (`:270-292`) and replaces the array (`:335`).
4. **What assumes rows are in the DOM:** only the scroll-into-view of the selected thread —
   `querySelector('[data-thread-id=…]').scrollIntoView` (`:490-496`). Selection (`selectThread`,
   `toggleThreadSelection`, `selectThreadRange`, `selectAllFromHere` — `threadStore.ts:53-96`)
   and `j`/`k` (`useKeyboardShortcuts.ts:213-232`) index the **store** array, not the DOM. Drag:
   every rendered `ThreadCard` is a `useDraggable` (`ThreadCard.tsx:45-48`) whose node is the
   row `<button>` itself (`:74-77`); droppables are sidebar items only; one `PointerSensor`
   with an 8 px activation distance (`DndProvider.tsx:72-76`); the drag payload reads the
   selection lazily (`ThreadCard.tsx:38-43`). No row is ever measured (no ResizeObserver, no
   `getBoundingClientRect` on rows).
5. **Bodies are local.** Opening a thread runs one SQLite `SELECT *` (`messages.ts:41-54`)
   from `ThreadView.tsx:103-110`, `loading` true until it returns, three `MessageSkeleton`s
   meanwhile (`:413-421`); no network fetch on open. `ThreadView` remounts per thread
   (`ReadingPane.tsx:19-21` keys nothing, but `thread` changes → the effect re-runs with
   `setLoading(true)`), so every `j` shows the skeleton. No cache or prefetch exists for
   messages; attachments have one (`preCacheManager.ts`).
6. **Effects.** Five blobs, `filter: blur(80px)` + a 20 s infinite animation each
   (`globals.css:112-118`, `:125-172`, markup `App.tsx:577-583`); `backdrop-filter` in
   `.glass-panel` / `.glass-modal` / `.glass-backdrop` (`:224-239`, tokens `:30-36`) on the
   sidebar, the list, the reading pane, modals, toasts (18 sites in `.tsx`); `backdropIn`
   **animates `backdrop-filter`** for the composer overlay (`:398-413`, `Composer.tsx:514`);
   `hover-lift` (eight transitioned properties + a hover transform, `:362-370`) and
   `press-scale` on every row (`ThreadCard.tsx:82`); `stagger-in` (`:415-418`).
   **"Reduce motion" already exists** — `reduce_motion` key (`settingsKeys.ts:63`), store
   `uiStore.ts:71,136,224-227`, restored at boot only when stored `"true"` (`App.tsx:291-295`),
   toggles `.reduce-motion` on `<html>` (`:484-488`), one `ToggleRow` in Settings → Appearance
   (`SettingsPage.tsx:550-555`) — and **its CSS hides the blobs only** (`globals.css:120-123`).
   `prefers-reduced-motion` kills animations and blobs (`:421-432`) but not the static blurs.
7. **Platform.** `@tauri-apps/plugin-os` is a dependency with `os:default` in `main.json:77`
   (not in `content.json`, by P11 design); the only `platform()` call is the Developer tab
   (`SettingsPage.tsx:1786-1799`, dynamic import). `TitleBar.tsx:5` sniffs the UA for macOS.
8. **Timers (#232's "audit intervals").** Six one-minute checkers from one factory that runs
   the check immediately then every 60 s (`backgroundCheckers.ts:26-30`): sync
   (`syncManager.ts:307`), snooze, scheduled send, follow-up, bundles; queue every 30 s;
   attachments every 15 min; updater every 4 h. **Three dispatch `velo-sync-done`:** sync
   after every run; snooze only when it un-snoozed something (`snoozeManager.ts:59-86`, inside
   the `if`); follow-up only after its loop, and its query is **due-only**
   (`followUpReminders.ts:55-62`, `remind_at <= now`), so every reminder it touches is
   cancelled or triggered — a warranted reload. (A first draft of this brief read the follow-up
   dispatch as unconditional; the query says otherwise — §6 of the handoff, again.) The
   per-minute reload that remains is sync's own, by design; see *Not doing*.
9. **Tests.** `EmailList` has none; `threadStore.test.ts`, `ThreadCard.test.tsx` (mocks
   `useDraggable`, the stores and the router hook), `CategoryTabs.test.tsx:6-15` (the
   jsdom stubs for `ResizeObserver` and `scrollIntoView`), `DndProvider.test.ts` (pure).
   jsdom reports zero layout, so a virtualizer renders nothing unless the scroll element's
   rect is stubbed.
10. **The dependency.** `@tanstack/react-virtual` 3.14.10 → `@tanstack/virtual-core` 3.17.8,
    no further dependencies, peers React 16.8–19, MIT, 56 KB + 410 KB unpacked, **SLSA v1
    provenance attested on both** (`npm view … dist.attestations`); `npm audit signatures`
    already runs in CI (PR D). Same family as `@tanstack/react-router` already in use.

## Requirements

- **REQ-1 (SB-1) Reduce effects.**
  - REQ-1.1 The Appearance toggle SHALL read **"Reduce effects"** with the description
    "Flat panels, no blur or animation — quieter on the CPU (recommended on Linux)". The stored
    key stays `reduce_motion`; a user who turned it on keeps it on.
  - REQ-1.2 WHEN the toggle is on THE SYSTEM SHALL, in addition to hiding the blobs: remove
    every `backdrop-filter` (`.glass-panel`, `.glass-modal`, `.glass-backdrop`, the
    `backdropIn` keyframes and the Tailwind `backdrop-blur-*` utilities in use) and give the
    overlay backdrop its final tint without animating; disable `hover-lift` transitions and
    transform, `press-scale`, and `stagger-in`. Layout SHALL not change (same paddings,
    borders, shadows stay).
  - REQ-1.3 WHEN no value is stored for `reduce_motion` AND the platform reports `linux`
    THE SYSTEM SHALL apply the toggle **on** for the session without persisting it (the user's
    first touch of the toggle persists). Any other platform, or a failed platform read (the
    pop-out windows have no `os` grant), defaults **off** as today.
- **REQ-2 (SB-2) Open instantly.**
  - REQ-2.1 WHEN a thread's messages are cached THE SYSTEM SHALL render them on the first
    paint of `ThreadView` with no skeleton, then re-query the database and replace them if the
    result differs (stale-while-revalidate); WHEN not cached, behaviour is today's.
  - REQ-2.2 The cache SHALL hold at most 30 threads per session (least-recently-used
    eviction), be keyed by `(accountId, threadId)`, and be cleared on `velo-sync-done`.
  - REQ-2.3 WHEN the selected thread changes THE SYSTEM SHALL, after a 150 ms quiet period,
    warm the cache for the next three and the previous one thread **in visible list order**,
    one query at a time, skipping threads already cached; a newer selection cancels a pending
    warm-up.
- **REQ-3 (SB-3) Virtualized list.**
  - REQ-3.1 The list SHALL render only the items within the viewport plus an overscan of
    eight, positioned by the virtualizer, for every item kind today's list has: bundle header,
    bundle child, thread (with its optional "Other emails" divider), and the two footers.
  - REQ-3.2 The divider SHALL appear before the first unpinned **visible** thread that follows
    a pinned visible thread (fixing *What exists* 1's latent bug); rows SHALL be keyed as
    today; heights SHALL be measured after mount so dividers, bundle rows and density changes
    are exact; the initial estimate per kind and density SHALL keep the scrollbar stable.
  - REQ-3.3 Selecting a thread (mouse, `j`/`k`, router) SHALL scroll it into view through the
    virtualizer, including a thread not currently rendered; `loadMore` SHALL fire when the last
    rendered item is within five of the end.
  - REQ-3.4 Selection (single, toggle, shift-range, select-all-from-here), the context menu,
    drag-to-label, bundle expand/collapse, the read filter, search, the split tabs, and the
    three reading-pane layouts SHALL behave as today. `stagger-in` SHALL play only on the first
    paint of a loaded list, never on rows that scroll into view later.
  - REQ-3.5 `@tanstack/react-virtual` SHALL be pinned exactly (`"3.14.10"`, no range); the
    lockfile SHALL carry its provenance; no other dependency changes.
- **REQ-4** Nothing else changes: the store, the DB queries, `ThreadCard`'s markup and the
  keyboard map are untouched except where named above.

## Not doing

- **Consolidating the six one-minute timers** — the audit (*What exists* 8) found the cost is
  not the timers but the reload sync's own `velo-sync-done` triggers every minute; the
  checkers' dispatches are all conditional already. Recorded.
- **The `getThreadLabelIds` N+1 on every page load** (`EmailList.tsx:270-292`) — a real cost,
  its own small PR (one `IN (…)` query). Recorded.
- **"Select all" selecting the store while the count shows the filtered list**
  (`EmailList.tsx:589-596` vs `threadStore.ts:84-87`) — pre-existing, recorded.
- **Network body prefetch** — bodies are local (*What exists* 5); there is nothing to fetch.
- **CSS containment / `content-visibility`** — virtualization makes them moot for the list;
  elsewhere, YAGNI.
- **Skipping the reload when a sync changed nothing** — needs a changed-flag from the sync
  path; a follow-up.
- **Memoising `ThreadCard`** unless SB-3's test shows re-renders of visible rows on a reload —
  decided during SB-3, noted in LOG.md either way.

## Design

**SB-1.**
- `globals.css`: under `.reduce-motion`, `backdrop-filter: none` (and `-webkit-`) for the three
  glass classes and for `.backdrop-animate` (which gets the `to` background directly, no
  animation); `.stagger-in { animation: none }`; `.hover-lift { transition: none }` and
  `.hover-lift:hover:not(:active) { transform: none; box-shadow: none }`;
  `.press-scale:active { transform: none }`. The Tailwind `backdrop-blur-*` sites (five) get
  the same via `.reduce-motion [class*="backdrop-blur"] { backdrop-filter: none }`.
- `src/services/effects/reduceEffects.ts` (new, pure): `resolveReduceEffects({ stored, platform
  })` → `{ value, persisted }` per REQ-1.3; `readPlatform()` wraps the dynamic import in a
  try/catch → `"linux" | "macos" | "windows" | "unknown"`. `App.tsx:291-295` calls it.
- `SettingsPage.tsx:550-555`: label and description.
- Help: the Appearance entry that mentions "Reduce motion" (`document-feature` skill).

**SB-2.**
- `src/services/threads/messageCache.ts` (new): `peekThreadMessages(accountId, threadId)`,
  `loadThreadMessages(accountId, threadId)` (query, store, return), `prefetchThreadMessages
  (accountId, threadIds)` (sequential, skips cached, returns a cancel function),
  `clearThreadMessageCache()`; LRU 30; the loader is injectable for tests; the module
  subscribes to `velo-sync-done` once.
- `src/services/threads/neighbours.ts` (new, pure): `prefetchOrder(visibleIds, selectedId)`
  → `[next1, next2, next3, prev1]` filtered to existing ids.
- `ThreadView.tsx:103-110`: `useState(() => peek(...) ?? [])`, `loading = !peeked`, then
  `loadThreadMessages` → `setMessages` when the result differs by ids+dates (a cheap
  fingerprint), so an unchanged thread does not re-render.
- `EmailList.tsx`: a `useEffect` on `[selectedThreadId, visibleThreads]` with a 150 ms timer
  that calls `prefetchThreadMessages(accountId, prefetchOrder(...))` and cancels on change.

**SB-3.**
- `src/services/inbox/listItems.ts` (new, pure): `buildListItems(input)` → `ListItem[]`
  (`kind`, `key`, `threadId?`, `category?`, `dividerBefore`, `estimate`) and `estimateRowHeight
  (kind, density)` (default 72 / compact 44 / spacious 88 for threads, +28 for a divider, 64
  for a bundle header, footer 40 — measured from the classes, corrected by `measureElement`).
- `EmailList.tsx`: `useVirtualizer({ count, getScrollElement: () => scrollContainerRef.current,
  estimateSize: i => items[i].estimate, getItemKey: i => items[i].key, overscan: 8 })`; one
  relative container of `getTotalSize()` height; each virtual item absolutely positioned by
  `translateY(start)`, `data-index`, `ref={virtualizer.measureElement}`; the existing row
  markup moves into a `renderItem(item)` switch. Scroll-into-view becomes
  `virtualizer.scrollToIndex(indexOfThread, { align: "auto" })`. `loadMore` from the last
  virtual item's index. `stagger-in` gated by a `firstPaintRef` that flips after the first
  render with items. The drag node stays the `ThreadCard` button; the positioned wrapper is a
  plain div.
- **Threat note on the dependency:** headless (no DOM of its own, no `innerHTML`, no network,
  no `eval`); exact pin; provenance attested and verified by CI's `npm audit signatures`;
  blast radius = the list render path only; removal = `git revert` of the SB-3 commit.
- **Decision & alternatives** — (a) `@tanstack/react-virtual` with a unified item model
  (chosen; approved; dynamic measurement handles the divider and bundles). (b) `react-window`:
  fixed-size lists want one height per row; the density/divider/bundle mix would need an
  item-size function and manual resets — more code, not approved. (c) CSS
  `content-visibility: auto` on rows, no dependency: WebKitGTK support is the very engine in
  question, and it does not reduce React's work on reload. (d) For SB-2, an in-store messages
  map: the store is thread metadata by design; a side cache with SWR keeps correctness
  trivially (the DB is re-read on every open). (e) For SB-1, a new `reduce_effects` key: a
  second toggle for the same intent; the existing key with a broader effect is simpler and
  keeps existing users' choice.
- **Failure modes** — platform read throws in a pop-out: default off (REQ-1.3); cache holds
  a thread that sync just moved: SWR replaces it on the same open, and `velo-sync-done` clears
  the cache anyway; a drag in flight when its row unmounts by scrolling: `DragOverlay` keeps
  the visual and the payload was captured at drag start — recorded, tested by hand; virtual
  measurement in jsdom returns 0: tests stub the scroll element's rect and the row's
  `getBoundingClientRect`; `scrollToIndex` before measurement settles: TanStack re-runs it
  against measured sizes (`align: "auto"`).

## Tasks (in commit order; each commit independently revertible)
- [ ] **SB-1:** `reduceEffects.test.ts` → `reduceEffects.ts`; CSS; Settings copy; App restore;
  Help. — REQ-1
- [ ] **SB-2:** `messageCache.test.ts` (LRU, SWR loader, clear-on-sync, sequential prefetch
  with cancel) → `messageCache.ts`; `neighbours.test.ts` → `neighbours.ts`; `ThreadView` +
  `EmailList` wiring. — REQ-2
- [ ] **SB-3 (the risk; if it blocks, the PR lands with SB-1 and SB-2 and says so):**
  `listItems.test.ts` → `listItems.ts`; the `EmailList` virtual render test (200 threads →
  fewer than 40 rows in the DOM; select index 150 → its row appears; bundle rows and the
  divider positioned; `loadMore` near the end); then the `EmailList` rewrite; a hand check of
  drag-to-label. — REQ-3
- [ ] Each commit gets its two review legs on its own diff, a follow-up pass on each fix
  delta; LOG.md; CLAUDE.md / `docs/development.md` counts; HANDOFF after merge; the vault
  queue row.

## Done when
`npx vitest run` green with the new tests, `tsc`, `graph:check`, `docs:check` green; CI green
on the merge commit including `npm audit signatures`; the DOM holds fewer than 40 thread rows
with 200 loaded. **Manual (Jim, open):** on Linux, first launch shows flat panels and idle CPU
in System Monitor with WebKitWebProcess quiet; on any platform, toggle Reduce effects and see
blur and hover lift stop; scroll a large folder and `j` to the bottom without stutter; drag a
row onto a label; `j` through threads and see messages without the skeleton.

## Rollback
`git revert` per commit (three legal revert sets). Turning Reduce effects off is SB-1's runtime
rollback; SB-2 is a cache cleared on every sync; SB-3's revert removes the dependency with
the code.

## Review
Two legs per commit: Gemini 3.8 Flash High via `agy`; Grok 4.6 via the `grok` CLI. Diffs from
committed SHAs; findings verified against source before adoption; a follow-up pass on every fix
delta; dispositions on the PR and in LOG.md.

## Approval
Jim, 2026-09-03, by the roadmap prompt quoted under *Status*; the dependency by LOG.md
2026-09-02 decision 3. The brief is this file, committed before the code.
