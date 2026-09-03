### 1. Verdict

**CHANGES REQUESTED**

---

### What Outside the Delta is Relied Upon

1. **`DbMessage` Schema (`src/services/db/messages.ts`)**: Relied upon for message structure containing mutable status fields (`is_read` / flags, `subject`, attachments) beyond `id`, `date`, `body_html`, and `body_text`.
2. **`prefetchOrder` Implementation (`src/services/threads/neighbours.ts`)**: Relied upon for how missing selections are resolved: `visibleIds.indexOf(selectedId)` evaluates to `-1` when `selectedId` is `null` or absent, without an early `if (at === -1) return [];` guard.
3. **`ThreadView` Callers (`src/components/email/ThreadView.tsx`)**: Relied upon for the reload-after-send code path that passes updated message arrays to the `setMessages` shim.
4. **Environment Event Model**: Relied upon for `window.addEventListener("velo-sync-done", ...)` being fired in the Tauri/React window context upon sync completion.

---

### 2. Findings

[H] F-01 — `src/components/email/ThreadView.tsx` — In-flight prefetch race permanently hangs `ThreadView` on skeleton loading state. In `ThreadView.tsx`, `loading` is derived as `messagesState?.threadId !== thread.id && cachedMessages === null`, where `cachedMessages` is peeked at render time. In `useEffect`, line 123 calls `const cached = threadMessageCache.peek(activeAccountId, threadId);` and line 128 guards `if (!cached || !sameMessages(cached, fresh)) setMessagesState({ threadId, list: fresh });`. If a background prefetch for `thread.id` completes between render and effect execution, `cachedMessages` was `null` during render (painting the skeleton), but `cached` inside the effect resolves to the prefetch result. When `load()` returns `fresh` matching `cached`, `!cached || !sameMessages(cached, fresh)` evaluates to `false`, skipping `setMessagesState`. Because `messagesState` is never updated and `cachedMessages` was `null`, `loading` remains `true` and `messages` remains `[]`, leaving the component permanently stuck on the loading skeleton. The effect must compare against what was actually rendered (`cachedMessages`), not re-peek the cache.

[H] F-02 — `src/services/threads/messageCache.ts` — Change fingerprint checks string length rather than content, suppressing draft edits and metadata updates. In `messageCache.ts`, `sameMessages` checks `(x.body_html?.length ?? 0) !== (y.body_html?.length ?? 0)` and `(x.body_text?.length ?? 0) !== (y.body_text?.length ?? 0)` instead of checking equality of body contents (`x.body_html !== y.body_html || x.body_text !== y.body_text`). Any in-place draft edit that preserves string length (e.g., typo fixes, word replacements with net-zero length delta) evaluates to `sameMessages === true`. Furthermore, `sameMessages` ignores all metadata fields on `DbMessage` (such as read/unread status, star/flag state, labels, attachments, and subject). When SQLite returns modified messages with equal body lengths, `ThreadView` skips `setMessagesState`, permanently suppressing updates and leaving stale cached messages on screen. String equality checks in JS are $O(1)$ by pointer or length mismatch and must be used instead.

[M] F-03 — `src/components/layout/EmailList.tsx` — Removal of `!selectedThreadId` check triggers unintended prefetch on unselected state. In `EmailList.tsx`, the previous code guarded with `if (!activeAccountId || !selectedThreadId) return;`. The delta removed `!selectedThreadId`, unconditionally calling `prefetchOrder(visibleThreads.map((t) => t.id), selectedThreadId).join("\n")` in `useMemo`. When no thread is selected (`selectedThreadId` is `null` or empty), `visibleIds.indexOf(selectedId)` evaluates to `at = -1`. In `neighbours.ts`, lines 17–19 iterate `for (let i = 1; i <= PREFETCH_AHEAD; i++)` reading `visibleIds[at + i]`, which retrieves indices `0, 1, 2` when `at = -1`. Consequently, `prefetchKey` becomes `"id0\nid1\nid2"` instead of `""`, and the effect fires a 150 ms prefetch job warming the first three threads in the list even when nothing is selected. `prefetchKey` must explicitly guard `selectedThreadId ? prefetchOrder(...).join("\n") : ""`, and `prefetchOrder` should return `[]` immediately when `at === -1`.

[M] F-04 — `src/components/email/ThreadView.tsx` & `src/services/threads/messageCache.ts` — Impure render side effect in React 19 `useMemo`. In `ThreadView.tsx`, `cachedMessages` is computed via `useMemo(() => (activeAccountId ? threadMessageCache.peek(activeAccountId, thread.id) : null), [activeAccountId, thread.id])`. In `messageCache.ts`, `peek` executes `touch(key, value)`, which mutates the cache singleton's `entries` Map (`entries.delete(key); entries.set(key, value)`). Under React 19 concurrent rendering and strict mode, render phase functions and `useMemo` callbacks must be pure. Calling `touch` inside `useMemo` mutates LRU cache eviction priority during speculative or aborted renders that may never commit. `peek` should be a pure inspection without LRU mutation, deferring cache touches to `load()` or effects.

[L] F-05 — `src/components/email/ThreadView.tsx` — `messagesState` lacks account scoping, risking transient cross-account leak on ID collision. In `ThreadView.tsx`, state is defined as `useState<{ threadId: string; list: DbMessage[] } | null>(null)` and verified via `messagesState?.threadId === thread.id`. Unlike `threadMessageCache` (which partitions keys by `${accountId}\u0000${threadId}`) and `useMemo` (which depends on `activeAccountId`), `messagesState` does not store or check `activeAccountId`. If the active account switches while retaining a thread ID that exists in both accounts (such as sequential IDs or ID collisions), `messagesState?.threadId === thread.id` evaluates to `true`, rendering messages from the previous account under the new account until the async `load` finishes. `messagesState` should store `{ accountId: string; threadId: string; list: DbMessage[] }`.

[L] F-06 — `src/services/threads/messageCache.test.ts` — App singleton capacity is unverified and leaves dirty state across tests. In `messageCache.test.ts`, the new test suite for `threadMessageCache` asserts `expect(MESSAGE_CACHE_CAPACITY).toBe(30)` but never loads 31 items into the singleton to assert that eviction actually occurs at 30. Furthermore, the second test loads `"ab", "c"` into the app-wide singleton without clearing it in an `afterEach` hook, leaking dirty state to subsequent test files importing `threadMessageCache`.

---

### 3. Verified-Correct List

1. **`App.tsx` Platform Plugin Optimization**: Guarding `readPlatform()` behind `decided ? "unknown" : await readPlatform()` avoids unnecessary plugin resolution when `reduce_motion` is already set to `"true"` or `"false"`.
2. **`reduceEffects.test.ts` Plugin Fault Handling**: Confirms `readPlatform` handles rejected promises from the platform plugin and safely resolves to `"unknown"`.
3. **Generation Counter in `messageCache.ts`**: Incrementing `generation` on `clear()` and checking `startedIn === generation` in `load()` prevents queries that were in flight across a `clear()` from re-populating the cache with stale rows.
4. **Binary NUL Escape in Cache Keys**: Using the escaped string `\u0000` (`keyOf`) prevents git binary file detection while ensuring account and thread IDs do not collide ambiguously (`"ab\0c"` vs `"a\0bc"`).
5. **Effect Cancellation Guard**: `cancelled` boolean flag inside `ThreadView.tsx` cleanup properly discards completed SQLite queries if the thread or active account changes before the promise settles.
6. **Reference-Stable Prefetch Memoization**: Joining IDs with `\n` in `prefetchKey` creates a primitive equality check in `useEffect`, successfully preventing reference-only updates to `visibleThreads` from restarting timers or cancelling running jobs.
7. **`neighbours.ts` Negative Index Underflow Fix**: Adding `&& at - i >= 0` prevents negative index accesses when checking backwards neighbours at `at = 0`.
