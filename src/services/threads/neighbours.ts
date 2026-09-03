/**
 * SPEC-SB REQ-2.3: which threads to warm when one is selected — the next
 * three and the previous one, in the order the list shows them, so `j` and
 * `k` land on a thread whose messages are already cached.
 */
export const PREFETCH_AHEAD = 3;
export const PREFETCH_BEHIND = 1;
/** Quiet period after a selection change before warming starts (REQ-2.3). */
export const PREFETCH_DELAY_MS = 150;

/** The same separator the cache key uses — a character no id can contain. */
const ID_SEPARATOR = String.fromCharCode(0);
/** Ids → one string with value equality, for an effect dependency. */
export function joinIds(ids: readonly string[]): string {
  return ids.join(ID_SEPARATOR);
}
export function splitIds(key: string): string[] {
  return key === "" ? [] : key.split(ID_SEPARATOR);
}

export function prefetchOrder(visibleIds: readonly string[], selectedId: string | null): string[] {
  if (!selectedId) return [];
  const at = visibleIds.indexOf(selectedId);
  if (at < 0) return [];
  const order: string[] = [];
  for (let i = 1; i <= PREFETCH_AHEAD; i++) {
    const id = visibleIds[at + i];
    if (id !== undefined) order.push(id);
  }
  for (let i = 1; i <= PREFETCH_BEHIND && at - i >= 0; i++) {
    const id = visibleIds[at - i];
    if (id !== undefined) order.push(id);
  }
  return order;
}
