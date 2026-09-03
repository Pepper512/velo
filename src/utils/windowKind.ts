/**
 * Which window this document is running in (SPEC-P11 REQ-2.3).
 *
 * The Tauri capability grant for `thread-*` and `compose-*` windows
 * deliberately omits webview creation (`src-tauri/capabilities/content.json`),
 * so the components hide "Open in new window" inside a pop-out. The grant is
 * keyed by the **window label**, so the gate is too, wherever a label exists;
 * the URL rule that `main.tsx` routes by is the fallback (review, Gemini 3.8
 * M3 on #75 — the two must not disagree, and a label cannot be edited by the
 * page while a query string can).
 */
export type WindowKind = "main" | "thread" | "compose";

/** The URL rule `main.tsx` routes by: a thread window needs both `thread` and `account`. */
export function windowKindFromSearch(search: string): WindowKind {
  const params = new URLSearchParams(search);
  if (params.has("thread") && params.has("account")) return "thread";
  if (params.has("compose")) return "compose";
  return "main";
}

/** The label rule the capability grant is keyed by (`content.json`'s `windows`). */
export function windowKindFromLabel(label: string): WindowKind {
  if (label.startsWith("thread-")) return "thread";
  if (label.startsWith("compose-")) return "compose";
  return "main";
}

/** The current window's label, or `null` outside Tauri (Vite dev server, tests). */
function currentWindowLabel(): string | null {
  try {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    if (!internals) return null;
    const label = (
      internals as { metadata?: { currentWebview?: { label?: unknown } } }
    ).metadata?.currentWebview?.label;
    return typeof label === "string" ? label : null;
  } catch {
    return null;
  }
}

/** True inside a thread or compose pop-out window — by label when Tauri says, else by URL. */
export function isPopoutWindow(): boolean {
  const label = currentWindowLabel();
  if (label !== null) return windowKindFromLabel(label) !== "main";
  return windowKindFromSearch(window.location.search) !== "main";
}
