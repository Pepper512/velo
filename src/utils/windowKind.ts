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
export type WindowKind = "main" | "thread" | "compose" | "unknown";

/** The URL rule a pop-out is opened with: a thread window needs both `thread` and `account`. */
export function windowKindFromSearch(search: string): WindowKind {
  const params = new URLSearchParams(search);
  if (params.has("thread") && params.has("account")) return "thread";
  if (params.has("compose")) return "compose";
  return "main";
}

/**
 * The label rule the capability grant is keyed by (`main.json` and
 * `content.json`'s `windows`). A label that is none of them is `"unknown"`,
 * never `"main"`: a future window must not inherit main's root or main's
 * buttons by default (final review L7 on #75).
 */
export function windowKindFromLabel(label: string): WindowKind {
  if (label === "main") return "main";
  if (label.startsWith("thread-")) return "thread";
  if (label.startsWith("compose-")) return "compose";
  return "unknown";
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

/**
 * True unless this is the main window — a pop-out, or a window this code does
 * not know, which fails closed: no button that needs main's grant.
 */
export function isPopoutWindow(): boolean {
  return currentWindowKind() !== "main";
}
