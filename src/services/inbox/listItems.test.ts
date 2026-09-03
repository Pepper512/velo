import { describe, it, expect } from "vitest";
import { buildListItems, estimateRowHeight, type BundleInput, type ListItem } from "./listItems";

/**
 * SPEC-SB SB-3 (REQ-3.1, REQ-3.2): one flat item model for everything the
 * scroller shows — bundle headers, expanded bundle children, threads (with
 * the "Other emails" divider before the first unpinned thread that follows a
 * pinned one), and the two footers — so the virtualizer can position and
 * measure each by kind.
 */

const t = (id: string, isPinned = false) => ({ id, isPinned });

const bundle = (over: Partial<BundleInput> = {}): BundleInput => ({
  category: "Newsletters",
  count: 3,
  latestSender: "Ann",
  latestSubject: "Weekly",
  expanded: false,
  threads: [],
  ...over,
});

function kinds(items: ListItem[]): string[] {
  return items.map((i) => i.kind);
}

describe("buildListItems", () => {
  it("lists threads in order with stable keys and no divider when nothing is pinned", () => {
    const items = buildListItems({ threads: [t("a"), t("b")], bundles: [], showBundles: false, loadingMore: false, allLoaded: false, density: "default" });
    expect(kinds(items)).toEqual(["thread", "thread"]);
    expect(items.map((i) => i.key)).toEqual(["a", "b"]);
    expect(items.map((i) => i.threadId)).toEqual(["a", "b"]);
    expect(items.every((i) => i.dividerBefore === false)).toBe(true);
  });

  it("puts the divider before the first unpinned thread that follows a pinned one, judged on the visible sequence (REQ-3.2)", () => {
    const items = buildListItems({ threads: [t("p1", true), t("p2", true), t("u1"), t("u2")], bundles: [], showBundles: false, loadingMore: false, allLoaded: false, density: "default" });
    expect(items.map((i) => i.dividerBefore)).toEqual([false, false, true, false]);
  });

  it("shows no divider when every visible thread is pinned or the first thread is unpinned", () => {
    expect(buildListItems({ threads: [t("p1", true)], bundles: [], showBundles: false, loadingMore: false, allLoaded: false, density: "default" })[0]!.dividerBefore).toBe(false);
    expect(buildListItems({ threads: [t("u1"), t("p1", true), t("u2")], bundles: [], showBundles: false, loadingMore: false, allLoaded: false, density: "default" }).map((i) => i.dividerBefore)).toEqual([false, false, true]);
  });

  it("prepends bundle headers, and children only when a bundle is expanded", () => {
    const items = buildListItems({
      threads: [t("a")],
      bundles: [bundle(), bundle({ category: "Promotions", expanded: true, threads: [t("x"), t("y")] })],
      showBundles: true,
      loadingMore: false,
      allLoaded: false,
      density: "default",
    });
    expect(kinds(items)).toEqual(["bundle", "bundle", "bundle-child", "bundle-child", "thread"]);
    expect(items[0]!.key).toBe("bundle-Newsletters");
    expect(items[2]!.key).toBe("bundle-Promotions-x");
    expect(items[2]!.category).toBe("Promotions");
    expect(items[2]!.threadId).toBe("x");
  });

  it("never emits a thread both as a bundle child and as a plain row (Grok F-07)", () => {
    const items = buildListItems({
      threads: [t("x"), t("a")],
      bundles: [bundle({ expanded: true, threads: [t("x")] })],
      showBundles: true,
      loadingMore: false,
      allLoaded: false,
      density: "default",
    });
    expect(items.map((i) => i.key)).toEqual(["bundle-Newsletters", "bundle-Newsletters-x", "a"]);
  });

  it("skips bundles with no threads and ignores bundles entirely when they are not shown", () => {
    const empty = bundle({ count: 0 });
    expect(kinds(buildListItems({ threads: [t("a")], bundles: [empty], showBundles: true, loadingMore: false, allLoaded: false, density: "default" }))).toEqual(["thread"]);
    expect(kinds(buildListItems({ threads: [t("a")], bundles: [bundle()], showBundles: false, loadingMore: false, allLoaded: false, density: "default" }))).toEqual(["thread"]);
  });

  it("appends the loading footer, or the all-loaded footer, never both", () => {
    expect(kinds(buildListItems({ threads: [t("a")], bundles: [], showBundles: false, loadingMore: true, allLoaded: false, density: "default" }))).toEqual(["thread", "loading"]);
    expect(kinds(buildListItems({ threads: [t("a")], bundles: [], showBundles: false, loadingMore: false, allLoaded: true, density: "default" }))).toEqual(["thread", "all-loaded"]);
    expect(kinds(buildListItems({ threads: [t("a")], bundles: [], showBundles: false, loadingMore: true, allLoaded: true, density: "default" }))).toEqual(["thread", "loading"]);
  });

  it("carries a per-item height estimate by kind and density, larger with a divider", () => {
    const [p, u] = buildListItems({ threads: [t("p", true), t("u")], bundles: [], showBundles: false, loadingMore: false, allLoaded: false, density: "compact" });
    expect(p!.estimate).toBe(estimateRowHeight("thread", "compact", false));
    expect(u!.estimate).toBe(estimateRowHeight("thread", "compact", true));
    expect(u!.estimate).toBeGreaterThan(p!.estimate);
  });
});

describe("estimateRowHeight", () => {
  it("orders densities compact < default < spacious for a thread row", () => {
    const c = estimateRowHeight("thread", "compact", false);
    const d = estimateRowHeight("thread", "default", false);
    const s = estimateRowHeight("thread", "spacious", false);
    expect(c).toBeLessThan(d);
    expect(d).toBeLessThan(s);
  });

  it("gives bundle rows and footers their own sizes regardless of density", () => {
    expect(estimateRowHeight("bundle", "compact", false)).toBe(estimateRowHeight("bundle", "spacious", false));
    expect(estimateRowHeight("loading", "default", false)).toBe(estimateRowHeight("all-loaded", "default", false));
  });
});
