### 1. Verdict
**APPROVE**

All five prior holes are cleanly closed without introducing new correctness bugs, memory leaks, or render-cycle regressions.

---

### 2. Findings

* **[N] N-01** — `src/components/email/ThreadView.tsx` — In `useMemo(() => (activeAccountId ? threadMessageCache.peek(activeAccountId, thread.id) : null), [activeAccountId, thread.id])`, `cachedMessages` is tied to `[activeAccountId, thread.id]`. In React 19, `useMemo` is not a semantic guarantee and could theoretically drop its cache under memory pressure. If that occurs, `cachedMessages` would re-peek, and because it is in `useEffect(..., [activeAccountId, thread.id, cachedMessages])`, the effect would re-run. This re-run is completely benign (it executes `load()`, confirms equality, and performs no state update), but it is worth noting as an edge case of React 19 memoization semantics.
* **[N] N-02** — `src/services/threads/messageCache.ts` — In `sameMessages(a, b)`, the check covers `id`, `date`, `is_read`, `is_starred`, `body_html`, and `body_text`, but does not compare draft-specific recipient headers (`to`/`cc`/`bcc`) or subject lines. This is safe under the standard assumption that draft updates touch `date` upon persistence, but any draft edit affecting solely metadata without touching body or date would rely on `x.date !== y.date`.

---

### 3. Verified-Correct List

1. **Hole 1 Closed (Render vs. Effect Race / Skeleton Latch):** `ThreadView.tsx` now captures `const painted = cachedMessages;` instead of re-peeking the cache inside `useEffect`. If a prefetch warm-up completes between render and effect execution when initial render painted `null`, `painted` remains `null`. The condition `if (!painted || !sameMessages(painted, fresh))` evaluates to `true`, guaranteeing that `setMessagesState` is invoked and the skeleton is replaced by the loaded messages.
2. **Hole 2 Closed (Fingerprint Fidelity):** `sameMessages` in `messageCache.ts` replaces length comparisons with strict string equality (`x.body_html !== y.body_html || x.body_text !== y.body_text`) and adds flag checks (`x.is_read !== y.is_read || x.is_starred !== y.is_starred`). Same-length draft edits and flag toggles are now reliably caught. String equality in V8 checks reference/length first, keeping this comparison performant.
3. **Hole 3 Closed (Multi-Account Thread ID Collision):** `messagesState` now stores `{ accountId: string; threadId: string; list: DbMessage[] }`. The derivation `const stateIsCurrent = messagesState !== null && messagesState.accountId === activeAccountId && messagesState.threadId === thread.id;` prevents displaying cached or state messages across accounts if thread IDs collide or when switching active accounts.
4. **Hole 4 Closed (Pure Peek vs. Recency):** `peek` in `messageCache.ts` is now a pure `entries.get(...) ?? null` without calling `touch()`. Reading `cachedMessages` during render via `useMemo` is side-effect-free and compliant with React 19 concurrent rendering. Recency promotion is handled asynchronously during `load()`.
5. **Nit 5 Closed (Delimiter Consistency):** `neighbours.ts` uses `const ID_SEPARATOR = String.fromCharCode(0);` matching the cache key's NUL separator, avoiding collisions with IDs containing newlines or arbitrary text.
6. **`cachedMessages` Effect Dependency:** `cachedMessages` is memoized on `[activeAccountId, thread.id]`. It will not change reference across re-renders for the same active thread. Adding it to the `useEffect` dependency array satisfies `react-hooks/exhaustive-deps` without triggering spurious or runaway effect executions.
7. **`stateIsCurrent` Derivation & Loading Logic:** `const loading = !stateIsCurrent && cachedMessages === null;` properly reflects state: when navigating to an uncached thread, `stateIsCurrent` is `false` and `cachedMessages` is `null`, displaying the skeleton; when navigating to a cached thread, `loading` is immediately `false` and renders `cachedMessages` with zero skeleton flash.
8. **`setMessages` Shim:** `useCallback((list: DbMessage[]) => { if (activeAccountId) setMessagesState({ accountId: activeAccountId, threadId: thread.id, list }); }, [activeAccountId, thread.id])` conforms to the new `messagesState` shape and guards against empty accounts. Because it closes over `thread.id`, an asynchronous reload-after-send finishing after navigation will not contaminate the newly viewed thread (`stateIsCurrent` will evaluate to `false`).
9. **Catch Path Invariant:** In `ThreadView.tsx`, `if (!cancelled && !painted) setMessagesState({ accountId, threadId, list: [] });` ensures that if a background load fails when cached data was already painted, the painted content is preserved rather than blanked out. If no content was painted (skeleton active), it clears to `[]` to dismiss the skeleton.
10. **Test Isolation (`afterEach`):** Adding `afterEach(() => threadMessageCache.clear());` in `messageCache.test.ts` isolates tests exercising the singleton `threadMessageCache`, preventing LRU state and capacity limits from leaking across test cases.
11. **Delimiter Round-Trip (`joinIds`/`splitIds`):** In `neighbours.ts`, `splitIds` guards empty strings (`key === "" ? [] : key.split(ID_SEPARATOR)`), correctly preventing `"".split("\0")` from producing `[""]` on an empty array and guaranteeing `splitIds(joinIds(ids)) == ids`.

---

### Explicit Dependencies Outside the Delta
This review relies on the following invariants outside the inspected delta:
* `threadMessageCache.load(accountId, threadId)` promotes entries to MRU in its underlying LRU cache upon resolution.
* Any local draft update or metadata mutation persists to SQLite with an updated `date` timestamp (or updated body), allowing `sameMessages` to detect changes.
* Account IDs and thread IDs are non-empty strings that never contain the NUL byte (`\0`).
* The reload-after-send path and background sync either update the SQLite backing store or trigger cache invalidation/reload on synchronization events.
