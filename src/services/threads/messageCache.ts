/**
 * Thread message cache (SPEC-SB, SB-2): a thread opens with its messages
 * already in hand.
 *
 * Stale-while-revalidate: `peek` gives the thread view something to paint at
 * once, `load` re-queries SQLite and replaces the entry, `prefetch` warms the
 * neighbours of the selected thread one query at a time. Bodies live in
 * SQLite (nothing here touches the network), so the only staleness window is
 * between a local mutation and the re-query that `load` performs on every
 * open — and `velo-sync-done` clears the cache besides.
 */
import { getMessagesForThread, type DbMessage } from "../db/messages";

export type MessageLoader = (accountId: string, threadId: string) => Promise<DbMessage[]>;

export interface PrefetchJob {
  /** Stop before the next thread; the query in flight still lands. */
  cancel: () => void;
  /** Resolves when the job has stopped, cancelled or not; never rejects. */
  finished: Promise<void>;
}

export interface MessageCache {
  peek: (accountId: string, threadId: string) => DbMessage[] | null;
  load: (accountId: string, threadId: string) => Promise<DbMessage[]>;
  prefetch: (accountId: string, threadIds: string[]) => PrefetchJob;
  clear: () => void;
  size: () => number;
}

/** REQ-2.2: at most this many threads per session. */
export const MESSAGE_CACHE_CAPACITY = 30;

function keyOf(accountId: string, threadId: string): string {
  // A separator no id can contain, written as an escape so the source stays text.
  return `${accountId}\u0000${threadId}`;
}

export function createMessageCache(loader: MessageLoader, options: { capacity?: number } = {}): MessageCache {
  const capacity = options.capacity ?? MESSAGE_CACHE_CAPACITY;
  // Map preserves insertion order; re-inserting on use makes the first key the
  // least recently used.
  const entries = new Map<string, DbMessage[]>();
  // Bumped by clear(): a load that started before a clear must not put its
  // pre-sync rows back after it (Grok SB-2 F2).
  let generation = 0;

  const touch = (key: string, value: DbMessage[]) => {
    entries.delete(key);
    entries.set(key, value);
    while (entries.size > capacity) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  // Pure: no LRU touch, so the thread view may read it during render.
  // Recency is refreshed by the load that always follows a peek.
  const peek: MessageCache["peek"] = (accountId, threadId) => entries.get(keyOf(accountId, threadId)) ?? null;

  const load: MessageCache["load"] = async (accountId, threadId) => {
    const startedIn = generation;
    const messages = await loader(accountId, threadId);
    if (startedIn === generation) touch(keyOf(accountId, threadId), messages);
    return messages;
  };

  const prefetch: MessageCache["prefetch"] = (accountId, threadIds) => {
    let cancelled = false;
    const finished = (async () => {
      for (const threadId of threadIds) {
        if (cancelled) return;
        if (entries.has(keyOf(accountId, threadId))) continue;
        try {
          await load(accountId, threadId);
        } catch {
          // A failed read leaves no entry; the next thread still gets its turn.
        }
      }
    })();
    return { cancel: () => { cancelled = true; }, finished };
  };

  return {
    peek,
    load,
    prefetch,
    clear: () => {
      generation++;
      entries.clear();
    },
    size: () => entries.size,
  };
}

/**
 * "Did the thread change" for the re-query after a cached paint: ids, dates,
 * read/starred flags and the bodies themselves, in order. String equality is
 * a pointer-or-length check first, so this is as cheap as a fingerprint and
 * misses nothing a draft edit or a flag flip could do (Gemini follow-up F-02).
 */
export function sameMessages(a: DbMessage[], b: DbMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.date !== y.date) return false;
    if (x.is_read !== y.is_read || x.is_starred !== y.is_starred) return false;
    if (x.body_html !== y.body_html || x.body_text !== y.body_text) return false;
  }
  return true;
}

/** The app-wide cache over SQLite, cleared whenever a sync finishes. */
export const threadMessageCache: MessageCache = createMessageCache(getMessagesForThread);

if (typeof window !== "undefined") {
  window.addEventListener("velo-sync-done", () => threadMessageCache.clear());
}
