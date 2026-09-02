import { openUrl } from "@tauri-apps/plugin-opener";
import { useUIStore } from "@/stores/uiStore";

/**
 * The single seam between a click inside the email iframe and the operating
 * system (SPEC-F-2 REQ-2, REQ-3). Every outcome is observable so the user is
 * never left with a click that silently did nothing.
 *
 * Order of checks matters: in-page anchors (`#top`, `<a name>`) resolve to the
 * iframe's own document and must stay a silent no-op (REQ-2.4); the opener's
 * scheme set is narrower than the sanitizer's, so schemes DOMPurify lets through
 * but the opener will not take get a specific message rather than a generic
 * failure (REQ-2.3).
 */
export type OpenLinkOutcome = "opened" | "ignored" | "unsupported" | "failed";

/** Exactly what `opener:default` permits (tauri-plugin-opener `permissions/default.toml`). */
const OPENER_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "mailto:", "tel:"]);

export interface OpenLinkDeps {
  /** Where failures are reported. Receives scheme + host only — never the full URL (REQ-3.1). */
  log?: (message: string) => void;
}

function defaultLog(message: string): void {
  console.error(message);
}

/**
 * Would `openEmailLink` do anything with this href? False for no href, an
 * unparseable one, and fragment-only / same-document links — the silent
 * no-ops of REQ-2.4. The phishing gate (SPEC-F-3) asks this first so an
 * in-page anchor is never analysed or confirmed.
 */
export function isOpenableHref(href: string | null | undefined, frameOrigin: string): boolean {
  if (!href) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return url.protocol !== "about:" && url.origin !== frameOrigin;
}

export async function openEmailLink(
  href: string | null | undefined,
  frameOrigin: string,
  deps: OpenLinkDeps = {},
): Promise<OpenLinkOutcome> {
  const log = deps.log ?? defaultLog;
  if (!href) return "ignored";

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return "ignored";
  }

  // Fragment-only and same-document links: the DOM resolved them against the
  // iframe's own document. Nothing to open, nothing to say.
  if (!isOpenableHref(href, frameOrigin)) return "ignored";

  const { addNotice } = useUIStore.getState();

  if (!OPENER_SCHEMES.has(url.protocol)) {
    addNotice({ text: `This kind of link (${url.protocol}) can't be opened from Velo` });
    return "unsupported";
  }

  try {
    await openUrl(href);
    return "opened";
  } catch (err) {
    const where = url.host || url.protocol;
    log(`Failed to open link ${url.protocol}//${url.host}: ${err instanceof Error ? err.message : String(err)}`);
    addNotice({
      text: `Couldn't open link — ${where}`,
      action: {
        label: "Copy link",
        onClick: () => navigator.clipboard.writeText(href),
      },
    });
    return "failed";
  }
}
