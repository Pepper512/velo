import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Which window this document is running in (SPEC-P11 REQ-2.3).
 *
 * The Tauri capability grant for `thread-*` and `compose-*` windows
 * deliberately omits webview creation (`src-tauri/capabilities/content.json`),
 * so the components hide "Open in new window" inside a pop-out. The grant is
 * keyed by the **window label**, so the answer is too, wherever Tauri gives
 * one — and `main.tsx` picks its root by the same answer, so the root and the
 * gate cannot disagree (review on #75: Gemini 3.8 M3, Grok H2, delta F1). The
 * URL rule is the fallback outside Tauri (Vite dev server, jsdom tests), where
 * there is no label.
 */
export type WindowKind = "main" | "thread" | "compose";

/** The URL rule a pop-out is opened with: a thread window needs both `thread` and `account`. */
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

/**
 * The current window's label through the public API, or `null` outside Tauri.
 * `getCurrentWindow()` is synchronous and reads Tauri's injected metadata; it
 * throws where there is none.
 */
function currentWindowLabel(): string | null {
  try {
    const label: unknown = getCurrentWindow().label;
    return typeof label === "string" ? label : null;
  } catch {
    return null;
  }
}

/** Which window this is: by label inside Tauri, by URL otherwise. */
export function currentWindowKind(): WindowKind {
  const label = currentWindowLabel();
  if (label !== null) return windowKindFromLabel(label);
  return windowKindFromSearch(window.location.search);
}

/** True inside a thread or compose pop-out window. */
export function isPopoutWindow(): boolean {
  return currentWindowKind() !== "main";
}
