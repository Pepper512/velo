/**
 * SPEC-SIT — the split inbox's tabs, as the user configured them.
 *
 * Pure: no store, no database. A tab is a category (one of the five AI
 * categories — its id is the category name, so the router's `?category=`
 * param and the `g p/u/o/c/n` shortcuts are unchanged), a label (any user
 * label, a smart label being the case the roadmap names), or Reminders
 * (threads with a pending follow-up reminder). The list lives in one JSON
 * setting, validated here at the boundary; anything invalid becomes the
 * default — today's five categories — so an existing user sees no change
 * until they edit.
 */
import { z } from "zod";
import { ALL_CATEGORIES, type ThreadCategory } from "@/services/db/threadCategories";

export type SplitTabKind = "category" | "label" | "reminders";

export interface SplitTab {
  /** `Primary` … for a category, `label:<labelId>` for a label, `reminders`. */
  id: string;
  kind: SplitTabKind;
  category?: ThreadCategory;
  labelId?: string;
  /** REQ-3.1: hide the tab when it would list nothing. */
  hideWhenEmpty: boolean;
}

export const REMINDERS_TAB_ID = "reminders";
export const SPLIT_TABS_SETTING_KEY = "split_inbox_tabs";
/** More than this is a mistake, not a configuration — enforced on add and at the boundary alike. */
export const MAX_TABS = 32;

export function categoryTabId(category: ThreadCategory): string {
  return category;
}

export function labelTabId(labelId: string): string {
  return `label:${labelId}`;
}

export const DEFAULT_SPLIT_TABS: SplitTab[] = ALL_CATEGORIES.map((category) => ({
  id: categoryTabId(category),
  kind: "category",
  category,
  hideWhenEmpty: false,
}));

const CATEGORY_NAMES = ALL_CATEGORIES as [ThreadCategory, ...ThreadCategory[]];

const TabSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("category"),
    id: z.string().min(1),
    category: z.enum(CATEGORY_NAMES),
    hideWhenEmpty: z.boolean(),
  }),
  z.object({
    kind: z.literal("label"),
    id: z.string().min(1),
    labelId: z.string().min(1).max(200),
    hideWhenEmpty: z.boolean(),
  }),
  z.object({
    kind: z.literal("reminders"),
    id: z.string().min(1),
    hideWhenEmpty: z.boolean(),
  }),
]);

const TabListSchema = z.array(TabSchema).min(1).max(MAX_TABS);

/** The id a tab must carry, derived from what it is — the stored id is not trusted. */
function expectedId(tab: z.infer<typeof TabSchema>): string {
  switch (tab.kind) {
    case "category":
      return categoryTabId(tab.category);
    case "label":
      return labelTabId(tab.labelId);
    case "reminders":
      return REMINDERS_TAB_ID;
  }
}

/**
 * REQ-1.2, 1.3: the stored JSON, validated; the default on any failure,
 * with the reason logged once.
 */
export function parseSplitTabs(json: string | null | undefined): SplitTab[] {
  if (json === null || json === undefined || json === "") return DEFAULT_SPLIT_TABS;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    console.warn("[splitTabs] split_inbox_tabs is not JSON; using the default tabs");
    return DEFAULT_SPLIT_TABS;
  }
  const result = TabListSchema.safeParse(raw);
  if (!result.success) {
    console.warn("[splitTabs] split_inbox_tabs failed validation; using the default tabs:", result.error.issues[0]?.message);
    return DEFAULT_SPLIT_TABS;
  }
  const seen = new Set<string>();
  const tabs: SplitTab[] = [];
  for (const tab of result.data) {
    const id = expectedId(tab);
    if (tab.id !== id) {
      console.warn(`[splitTabs] tab id ${tab.id} does not match its kind (${id}); using the default tabs`);
      return DEFAULT_SPLIT_TABS;
    }
    if (seen.has(id)) {
      console.warn(`[splitTabs] duplicate tab ${id}; using the default tabs`);
      return DEFAULT_SPLIT_TABS;
    }
    seen.add(id);
    switch (tab.kind) {
      case "category":
        tabs.push({ id, kind: "category", category: tab.category, hideWhenEmpty: tab.hideWhenEmpty });
        break;
      case "label":
        tabs.push({ id, kind: "label", labelId: tab.labelId, hideWhenEmpty: tab.hideWhenEmpty });
        break;
      case "reminders":
        tabs.push({ id, kind: "reminders", hideWhenEmpty: tab.hideWhenEmpty });
        break;
    }
  }
  return tabs;
}

export function serializeSplitTabs(tabs: SplitTab[]): string {
  return JSON.stringify(tabs);
}

export interface TabCount {
  /** Threads the tab would list — what "empty" means (REQ-3.1). */
  total: number;
  unread: number;
}

export interface LabelInfo {
  name: string;
  color?: string | null;
}

/** A tab as the strip renders it. */
export interface VisibleTab {
  id: string;
  name: string;
  kind: SplitTabKind;
  unread: number;
  color: string | null;
}

function render(tab: SplitTab, labelsById: Map<string, LabelInfo>, counts: Map<string, TabCount>): VisibleTab | null {
  const unread = counts.get(tab.id)?.unread ?? 0;
  switch (tab.kind) {
    case "category":
      return { id: tab.id, name: tab.category ?? tab.id, kind: "category", unread, color: null };
    case "label": {
      const info = tab.labelId ? labelsById.get(tab.labelId) : undefined;
      // REQ-2.5: a label the active account does not have is not a tab here.
      if (!info) return null;
      return { id: tab.id, name: info.name, kind: "label", unread, color: info.color ?? null };
    }
    case "reminders":
      return { id: tab.id, name: "Reminders", kind: "reminders", unread, color: null };
  }
}

/**
 * REQ-2.5, 3.1, 3.3: the tabs to draw. A hide-when-empty tab with a known
 * total of zero is dropped; an unknown count keeps the tab (fail open on
 * display). A tab the user explicitly asked for (`keep` — the router's
 * request, a shortcut's target) is never hidden, so `g n` on an empty
 * Newsletters shows an empty Newsletters rather than yanking to the first
 * tab (Grok M5 on #87). If everything would hide, the first renderable tab
 * stays.
 */
export function visibleSplitTabs(
  tabs: SplitTab[],
  ctx: { labelsById: Map<string, LabelInfo>; counts: Map<string, TabCount>; keep?: string },
): VisibleTab[] {
  const out: VisibleTab[] = [];
  let firstRenderable: VisibleTab | null = null;
  for (const tab of tabs) {
    const rendered = render(tab, ctx.labelsById, ctx.counts);
    if (!rendered) continue;
    if (!firstRenderable) firstRenderable = rendered;
    const hidden = tab.hideWhenEmpty && ctx.counts.get(tab.id)?.total === 0 && tab.id !== ctx.keep;
    if (hidden) continue;
    out.push(rendered);
  }
  if (out.length === 0 && firstRenderable) return [firstRenderable];
  return out;
}

/**
 * REQ-3.2: the tab to show for a requested id — itself if visible, else the
 * first visible, else All. `"All"` passes through untouched: it is the
 * unified list, not a tab, and the list's `"All"` path stays exactly as it
 * was (Grok H1 on #87).
 */
export function resolveActiveTab(visible: VisibleTab[], requested: string): string {
  if (requested === "All") return "All";
  if (visible.some((t) => t.id === requested)) return requested;
  return visible[0]?.id ?? "All";
}

export function addTab(tabs: SplitTab[], tab: SplitTab): SplitTab[] {
  // The cap the boundary enforces is enforced here too, or a 33rd tab would
  // persist and reset everything to the default at the next boot (Gemini M1).
  if (tabs.length >= MAX_TABS || tabs.some((t) => t.id === tab.id)) return tabs;
  return [...tabs, tab];
}

export function removeTab(tabs: SplitTab[], id: string): SplitTab[] {
  if (tabs.length <= 1) return tabs;
  return tabs.filter((t) => t.id !== id);
}

export function moveTab(tabs: SplitTab[], id: string, delta: -1 | 1): SplitTab[] {
  const from = tabs.findIndex((t) => t.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= tabs.length) return tabs;
  const next = [...tabs];
  const moving = next[from]!;
  next[from] = next[to]!;
  next[to] = moving;
  return next;
}

export function setHideWhenEmpty(tabs: SplitTab[], id: string, hideWhenEmpty: boolean): SplitTab[] {
  return tabs.map((t) => (t.id === id ? { ...t, hideWhenEmpty } : t));
}
