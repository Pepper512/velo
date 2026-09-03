/**
 * Which window this document is running in (SPEC-P11 REQ-2.3).
 *
 * One rule, used by `main.tsx` to pick the root and by the components that
 * hide "Open in new window" inside a pop-out. The Tauri capability grant for
 * `thread-*` and `compose-*` windows deliberately omits webview creation
 * (`src-tauri/capabilities/content.json`), so a button that tried would fail
 * silently; the rule here keeps the UI and the grant in agreement.
 */
export type WindowKind = "main" | "thread" | "compose";

/** The URL rule: a thread window needs both `thread` and `account`; a compose window `compose`. */
export function windowKindFromSearch(search: string): WindowKind {
  const params = new URLSearchParams(search);
  if (params.has("thread") && params.has("account")) return "thread";
  if (params.has("compose")) return "compose";
  return "main";
}

/** True inside a thread or compose pop-out window. */
export function isPopoutWindow(): boolean {
  return windowKindFromSearch(window.location.search) !== "main";
}
