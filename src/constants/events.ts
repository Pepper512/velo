/**
 * The custom-event bus, typed (audit P17).
 *
 * # Why this matters more than it looks
 *
 * Nine event names were dispatched from 27 inline string literals. `velo-sync-done`
 * alone has seven producers and four consumers, and it is **the only mechanism
 * that makes a service's writes visible to the UI**.
 *
 * That is why the layers looked decoupled while being functionally entangled:
 * this bus is invisible to the import graph. `scripts/graph.mjs` cannot see it,
 * so a service and a component can be tightly coupled through an event name
 * without a single import between them. Naming the events at least makes the
 * coupling greppable and rename-safe.
 *
 * A typo in a listener name is otherwise silent in both directions — the event
 * fires, nobody hears it, and the UI simply never refreshes.
 */

/** Payloads by event name. `void` means the event carries no detail. */
export interface VeloEventMap {
  /**
   * A sync finished and the local database changed.
   *
   * The load-bearing one: services write, then fire this, and the UI re-reads.
   */
  "velo-sync-done": void;
  /**
   * A user action changed threads in the local database — read state, star,
   * archive, trash, move, label, snooze, spam (SPEC-243). Fired by
   * `executeEmailAction` after its local update, whatever the server then
   * says, so counts derived from the database can refresh at once instead of
   * waiting for the next sync.
   */
  "velo-threads-changed": void;
  "velo-toggle-command-palette": void;
  "velo-toggle-shortcuts-help": void;
  "velo-toggle-ask-inbox": void;
  "velo-move-to-folder": void;
  "velo-inline-reply": unknown;
  "velo-extract-task": unknown;
  "velo-view-raw-message": unknown;
}

export type VeloEventName = keyof VeloEventMap;

/**
 * Dispatch a Velo custom event.
 *
 * Typed so a misspelled name is a compile error rather than an event nobody
 * listens for.
 */
export function dispatchVeloEvent<K extends VeloEventName>(
  ...[name, detail]: VeloEventMap[K] extends void
    ? [name: K]
    : [name: K, detail: VeloEventMap[K]]
): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Subscribe to a Velo custom event. Returns an unsubscribe function, so callers
 * cannot forget the matching `removeEventListener` argument list.
 */
export function onVeloEvent<K extends VeloEventName>(
  name: K,
  handler: (detail: VeloEventMap[K]) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<VeloEventMap[K]>).detail);
  };
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
