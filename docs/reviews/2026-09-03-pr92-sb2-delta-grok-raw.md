**1. Verdict: CHANGES REQUESTED**

**2. Findings**

**[M] F1 — `src/services/threads/messageCache.ts` — F4 is still open for same-length body edits.** The widened fingerprint only compares lengths, not content:

```ts
if ((x.body_html?.length ?? 0) !== (y.body_html?.length ?? 0)) return false;
if ((x.body_text?.length ?? 0) !== (y.body_text?.length ?? 0)) return false;
```

A local draft save that keeps `id`, `date`, and character count (`"their"` → `"there"`, a same-length typo, an HTML rewrite of equal length) still returns `true`, so ThreadView’s `if (!cached || !sameMessages(cached, fresh))` skips `setMessagesState` and the first-paint `useMemo` peek keeps showing the old body. The new test only pins the unequal-length case (`"<p>hi</p>"` vs `"<p>hi there</p>"`) and would not catch this. Bodies are already in memory; `x.body_html !== y.body_html || x.body_text !== y.body_text` is the check F4 actually needs.

**[M] F2 — `src/components/email/ThreadView.tsx` — keyed state is only `threadId`, while the cache key is `(accountId, threadId)`.** Diff evidence:

```ts
const [messagesState, setMessagesState] = useState<{ threadId: string; list: DbMessage[] } | null>(null);
const messages = messagesState?.threadId === thread.id ? messagesState.list : (cachedMessages ?? []);
const setMessages = useCallback(
  (list: DbMessage[]) => setMessagesState({ threadId: thread.id, list }),
  [thread.id],
);
```

`peek`/`load`/`keyOf` all discriminate on account. After this patch, state *wins* over the cache whenever `messagesState.threadId === thread.id`. If `ThreadView` stays mounted across an account switch and the new thread’s id collides (the reason the cache uses `\u0000` between account and thread), one paint — and every subsequent paint until load lands — shows the previous account’s rows under the new header. That is the same class of bug SB-2 just fixed for `j`/`k`. Key state with `{ accountId, threadId }` (and treat a missing account as a miss).

**[M] F3 — `src/components/email/ThreadView.tsx` — `sameMessages` skip can leave `loading === true` forever.** Render snapshot vs effect peek are not the same read:

```ts
const cachedMessages = useMemo(
  () => (activeAccountId ? threadMessageCache.peek(activeAccountId, thread.id) : null),
  [activeAccountId, thread.id],
);
const loading = messagesState?.threadId !== thread.id && cachedMessages === null;
// …
const cached = threadMessageCache.peek(activeAccountId, threadId);
.then((fresh) => {
  if (cancelled) return;
  if (!cached || !sameMessages(cached, fresh)) setMessagesState({ threadId, list: fresh });
})
```

`useMemo` can record a miss; a neighbour `prefetch` (the SB-2 warm-up path) can `touch` the entry in the render→passive-effect window; the effect then peeks a hit, `sameMessages` is true, and `setMessagesState` is skipped. Nothing subscribes ThreadView to the cache, so React never re-renders, `cachedMessages` stays `null`, `messagesState` is still the other thread, and `loading` stays true until `thread.id` / `activeAccountId` changes. The catch path even calls this out (“rather than a skeleton forever”) and then the success path reintroduces it. Commit keyed state on load whenever `messagesState` is not already this thread (or drop the skip).

**[L] F4 — `src/services/threads/messageCache.ts` / `ThreadView.tsx` — render-time `peek` mutates LRU order.** `peek` always `touch`es:

```ts
if (!value) return null;
touch(key, value);
return value;
```

and ThreadView calls it inside `useMemo` during render. That is an impure render (React 19 will double-invoke it in Strict Mode). Because `peek` only reorders existing keys and never inserts, a discarded/concurrent render cannot grow the map or by itself evict; it can only change which victim a later `load`/`prefetch` insert picks. Content cannot go wrong. Still: a render-only `get` (no `touch`) plus `touch` from `load`/the effect would make the render path pure. `useMemo` here is otherwise the right shape — it snapshots the array so a later `velo-sync-done` `clear()` does not turn the next parent re-render into an empty miss.

**[L] F5 — `src/components/layout/EmailList.tsx` — `prefetchKey` join/split uses `'\n'`, which ids are not forbidden from containing.** Evidence: `.join("\n")` / `prefetchKey.split("\n")`. `keyOf` was just rewritten to `\u0000` because “no id can contain” it; this separator was not given the same treatment. A newline in a thread id would prefetch the wrong tokens. Unlikely for current ids, but the two separators are now inconsistent.

**[L] F6 — `src/services/threads/messageCache.test.ts` — singleton tests overclaim and share process-global state.** `"holds 30 threads and is cleared by velo-sync-done"` only asserts `MESSAGE_CACHE_CAPACITY === 30`, one `load`, and that `dispatchEvent("velo-sync-done")` empties the map — it never inserts 31 entries. The second spec leaves `"ab"/"c"` in the app singleton and neither test isolates the `window` listener. Sequential vitest will pass; a concurrent sibling that also fires `velo-sync-done` will not.

**[L] F7 — `src/services/threads/messageCache.ts` vs `ThreadView.tsx` — generation fixes the cache, not the open view.** `load` still `return messages` after a generation mismatch, and ThreadView still `setMessagesState({ threadId, list: fresh })` with those rows. F2 as written is fixed (test pins `peek` is null). An in-flight open-thread load that raced `velo-sync-done` will still paint pre-sync bodies; they will not be re-fetched until `thread.id` changes. Residual, not a regression of the stated F2.

**[N] F8 — `src/App.tsx` — unrelated reduce-motion plugin skip.** `decided ? "unknown" : await readPlatform()` is fine if `resolveReduceEffects` ignores `platform` once `stored` is `"true"`/`"false"` (not in this delta). It is not an SB-2 fix; keep it if that helper’s contract is as the comment says.

**[N] F9 — `src/services/threads/neighbours.ts` — `at - i >= 0`.** Equivalent to the old `id !== undefined` skip for ordinary arrays (`arr[-1]` is `undefined`). Harmless.

**3. Verified-correct**

- **First paint / no previous-thread bleed (original F1).** `messages` is derived, not effect-written: if `messagesState` is for another thread, the render uses `peek` or `[]`. A cached thread paints on the first render after `j`/`k`; a miss shows `[]` with `loading === true` rather than the previous thread’s rows. `loading` cannot stick from a missed `setLoading(false)` because it is derived.
- **`cancelled` guard.** Cleanup sets `cancelled`; both `then` and `catch` return/skip `setMessagesState`. A result for thread A cannot land in state after the effect has been re-run for B. Capturing `threadId` in the effect (not via the `setMessages` shim) is the right write.
- **`setMessages` shim (given the assumption below).** `(list) => setMessagesState({ threadId: thread.id, list })` tags writes with the thread from the callback’s render. A late reload-after-send that closed over the old shim writes `{ threadId: A, list }`, which the display predicate will ignore while B is showing.
- **Catch on miss.** `if (!cancelled && !cached) setMessagesState({ threadId, list: [] })` ends the skeleton on failure; a failed revalidation with a cache hit leaves the cached paint in place (SWR).
- **NUL separator (original F2).** `` `${accountId}\u0000${threadId}` `` is an escape in source; the appended file has no literal NUL. `"ab"+"c"` vs `"a"+"bc"` is covered.
- **Generation counter (original F5).** `startedIn === generation` before `touch`; `clear` increments then `entries.clear()`. The new test is the right regression: caller still receives rows, `peek` is null.
- **`prefetchKey` (original F3).** `useMemo` still reruns when `visibleThreads`’s *identity* changes, but the effect depends on the joined string. Same neighbour ids ⇒ same string ⇒ no timer restart, no `job.cancel()`. `prefetchKey === ""` preserves the old empty-order early return. `activeAccountId` stays in the effect deps so an account switch with identical ids still re-warms.
- **Capacity constant + `velo-sync-done` wiring (original F4, as far as the test goes).** Singleton is `createMessageCache(getMessagesForThread)` with default `MESSAGE_CACHE_CAPACITY` (30); module listener calls `clear()`.
- **Prefetch cancel semantics** in the appended file still match the interface: in-flight `load` is not aborted; `cancelled` only stops the next thread; `load` remains generation-gated.

**Outside the delta I rely on (not verified here)**

- Rest of `ThreadView.tsx`: the skeleton is gated on `loading` (so `messages === []` during a miss is not shown as “this thread is empty”); every remaining `setMessages(...)` passes a `DbMessage[]`, not an updater function (the shim would store the function as `list` and crash); reload-after-send does not need the old `setMessages(prev => …)` form.
- Rest of `EmailList.tsx`: `prefetchOrder(ids, selectedThreadId)` returns `[]` when there is no selection / selected id is not in the list, so dropping `if (!selectedThreadId) return` is equivalent; thread ids do not contain `\n`.
- `resolveReduceEffects({ stored, platform })` does not consult `platform` when `stored` is `"true"` or `"false"`.
- `DbMessage.body_html` / `body_text` are optional strings; `msg()` in the test file builds a comparable row.
- Parent does not already remount `ThreadView` in a way that fights keyed state; vitest provides `window` and runs these two singleton tests sequentially.
- App-wide `velo-sync-done` still does not, and is not required by this spec to, retick ThreadView’s `[activeAccountId, thread.id]` effect.
