/**
 * The thread list's item model (SPEC-SB, SB-3): one flat array of everything
 * the scroller shows, so the virtualizer can position and measure each row
 * by kind — bundle headers, expanded bundle children, threads (with the
 * "Other emails" divider before the first unpinned thread that follows a
 * pinned one), and the two footers.
 *
 * Pure: the component hands it the visible threads and the bundle state it
 * already derives, and renders whatever comes back.
 */
import type { EmailDensity } from "@/stores/uiStore";

export type ListItemKind = "bundle" | "bundle-child" | "thread" | "loading" | "all-loaded";

export interface ListItem {
  kind: ListItemKind;
  /** Stable React key; also the virtualizer's item key. */
  key: string;
  threadId?: string;
  /** The bundle's category, on the header and on its children. */
  category?: string;
  /** REQ-3.2: the divider band sits inside this row, above the card. */
  dividerBefore: boolean;
  /** Initial height for the virtualizer, corrected by measurement after mount. */
  estimate: number;
}

export interface BundleInput {
  category: string;
  count: number;
  latestSender: string | null;
  latestSubject: string | null;
  expanded: boolean;
  threads: ReadonlyArray<{ id: string }>;
}

export interface ListItemsInput {
  threads: ReadonlyArray<{ id: string; isPinned: boolean }>;
  bundles: ReadonlyArray<BundleInput>;
  showBundles: boolean;
  loadingMore: boolean;
  allLoaded: boolean;
  density: EmailDensity;
}

/** Height of the divider band (`px-4 py-1.5` + a text line + border). */
const DIVIDER_HEIGHT = 28;

/**
 * Pixel estimates measured from the classes each row kind renders with at
 * the default font scale; the virtualizer measures the real thing on mount
 * and keeps the scrollbar honest either way.
 */
export function estimateRowHeight(kind: ListItemKind, density: EmailDensity, dividerBefore: boolean): number {
  const divider = dividerBefore ? DIVIDER_HEIGHT : 0;
  switch (kind) {
    case "thread":
    case "bundle-child":
      return (density === "compact" ? 44 : density === "spacious" ? 88 : 72) + divider;
    case "bundle":
      return 64;
    case "loading":
    case "all-loaded":
      return 40;
  }
}

export function buildListItems(input: ListItemsInput): ListItem[] {
  const items: ListItem[] = [];

  if (input.showBundles) {
    for (const bundle of input.bundles) {
      if (bundle.count === 0) continue;
      items.push({
        kind: "bundle",
        key: `bundle-${bundle.category}`,
        category: bundle.category,
        dividerBefore: false,
        estimate: estimateRowHeight("bundle", input.density, false),
      });
      if (!bundle.expanded) continue;
      for (const thread of bundle.threads) {
        items.push({
          kind: "bundle-child",
          key: `bundle-${bundle.category}-${thread.id}`,
          threadId: thread.id,
          category: bundle.category,
          dividerBefore: false,
          estimate: estimateRowHeight("bundle-child", input.density, false),
        });
      }
    }
  }

  let previousPinned = false;
  for (const thread of input.threads) {
    const dividerBefore = previousPinned && !thread.isPinned;
    items.push({
      kind: "thread",
      key: thread.id,
      threadId: thread.id,
      dividerBefore,
      estimate: estimateRowHeight("thread", input.density, dividerBefore),
    });
    previousPinned = thread.isPinned;
  }

  if (input.loadingMore) {
    items.push({ kind: "loading", key: "footer-loading", dividerBefore: false, estimate: estimateRowHeight("loading", input.density, false) });
  } else if (input.allLoaded) {
    items.push({ kind: "all-loaded", key: "footer-all-loaded", dividerBefore: false, estimate: estimateRowHeight("all-loaded", input.density, false) });
  }

  return items;
}
