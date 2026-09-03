import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_SPLIT_TABS,
  parseSplitTabs,
  serializeSplitTabs,
  visibleSplitTabs,
  resolveActiveTab,
  addTab,
  removeTab,
  moveTab,
  setHideWhenEmpty,
  categoryTabId,
  labelTabId,
  REMINDERS_TAB_ID,
  type SplitTab,
} from "./splitTabs";

const label = (labelId: string, hideWhenEmpty = false): SplitTab => ({
  id: labelTabId(labelId),
  kind: "label",
  labelId,
  hideWhenEmpty,
});
const category = (name: SplitTab["category"] & string, hideWhenEmpty = false): SplitTab => ({
  id: categoryTabId(name),
  kind: "category",
  category: name,
  hideWhenEmpty,
});
const reminders = (hideWhenEmpty = false): SplitTab => ({
  id: REMINDERS_TAB_ID,
  kind: "reminders",
  hideWhenEmpty,
});

describe("parseSplitTabs (REQ-1.1, 1.2, 1.3)", () => {
  it("is the five categories in today's order when nothing is stored", () => {
    expect(parseSplitTabs(null)).toEqual(DEFAULT_SPLIT_TABS);
    expect(DEFAULT_SPLIT_TABS.map((t) => t.id)).toEqual([
      "Primary",
      "Updates",
      "Promotions",
      "Social",
      "Newsletters",
    ]);
    expect(DEFAULT_SPLIT_TABS.every((t) => t.kind === "category" && !t.hideWhenEmpty)).toBe(true);
  });

  it("round-trips a custom list", () => {
    const tabs = [category("Primary"), label("lbl-1", true), reminders(), category("Updates", true)];
    expect(parseSplitTabs(serializeSplitTabs(tabs))).toEqual(tabs);
  });

  it("falls back to the default, and says so, on malformed JSON, a wrong shape, an unknown kind, a duplicate, or an empty list", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of [
      "not json",
      "{}",
      "[]",
      JSON.stringify([{ id: "x", kind: "magic", hideWhenEmpty: false }]),
      JSON.stringify([{ id: "Primary", kind: "category", category: "Nope", hideWhenEmpty: false }]),
      JSON.stringify([category("Primary"), category("Primary")]),
      JSON.stringify([{ id: "label:a", kind: "label", hideWhenEmpty: false }]), // no labelId
      JSON.stringify([{ id: "wrong-id", kind: "reminders", hideWhenEmpty: false }]), // id must match kind
    ]) {
      expect(parseSplitTabs(bad), bad).toEqual(DEFAULT_SPLIT_TABS);
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not trust the id: a category tab's id is its category name and a label tab's id is derived from the label", () => {
    expect(parseSplitTabs(JSON.stringify([{ id: "Updates", kind: "category", category: "Primary", hideWhenEmpty: false }]))).toEqual(DEFAULT_SPLIT_TABS);
    expect(parseSplitTabs(JSON.stringify([{ id: "label:other", kind: "label", labelId: "lbl-1", hideWhenEmpty: false }]))).toEqual(DEFAULT_SPLIT_TABS);
  });
});

describe("visibleSplitTabs (REQ-2.5, 3.1, 3.3)", () => {
  const labelsById = new Map([["lbl-1", { name: "Invoices", color: "#123456" }]]);

  it("shows every tab with its name, kind and counts when nothing hides", () => {
    const tabs = [category("Primary"), label("lbl-1"), reminders()];
    const counts = new Map([
      ["Primary", { total: 3, unread: 1 }],
      ["label:lbl-1", { total: 2, unread: 2 }],
      ["reminders", { total: 0, unread: 0 }],
    ]);
    expect(visibleSplitTabs(tabs, { labelsById, counts })).toEqual([
      { id: "Primary", name: "Primary", kind: "category", unread: 1, color: null },
      { id: "label:lbl-1", name: "Invoices", kind: "label", unread: 2, color: "#123456" },
      { id: "reminders", name: "Reminders", kind: "reminders", unread: 0, color: null },
    ]);
  });

  it("hides a hide-when-empty tab whose total is zero, but not one with unread zero and total above zero", () => {
    const tabs = [category("Primary"), category("Promotions", true), category("Social", true)];
    const counts = new Map([
      ["Primary", { total: 1, unread: 0 }],
      ["Promotions", { total: 0, unread: 0 }],
      ["Social", { total: 4, unread: 0 }],
    ]);
    expect(visibleSplitTabs(tabs, { labelsById, counts }).map((t) => t.id)).toEqual(["Primary", "Social"]);
  });

  it("hides a label tab whose label the active account does not have, and keeps the tab in the configuration", () => {
    const tabs = [category("Primary"), label("lbl-gone")];
    const visible = visibleSplitTabs(tabs, { labelsById, counts: new Map() });
    expect(visible.map((t) => t.id)).toEqual(["Primary"]);
    expect(tabs).toHaveLength(2);
  });

  it("never hides everything: with every tab empty and hiding, the first configured tab stays", () => {
    const tabs = [category("Updates", true), category("Social", true)];
    const counts = new Map([
      ["Updates", { total: 0, unread: 0 }],
      ["Social", { total: 0, unread: 0 }],
    ]);
    expect(visibleSplitTabs(tabs, { labelsById, counts }).map((t) => t.id)).toEqual(["Updates"]);
  });

  it("treats a missing count as unknown: the tab is shown and its pill is empty (fail open on display)", () => {
    const tabs = [category("Primary", true)];
    const [only] = visibleSplitTabs(tabs, { labelsById, counts: new Map() });
    expect(only?.id).toBe("Primary");
    expect(only?.unread).toBe(0);
  });
});

describe("resolveActiveTab (REQ-3.2)", () => {
  const visible = visibleSplitTabs([category("Primary"), reminders()], {
    labelsById: new Map(),
    counts: new Map(),
  });

  it("keeps a requested tab that is visible", () => {
    expect(resolveActiveTab(visible, "reminders")).toBe("reminders");
  });

  it("falls back to the first visible tab when the request is hidden, unknown, or All", () => {
    expect(resolveActiveTab(visible, "Promotions")).toBe("Primary");
    expect(resolveActiveTab(visible, "label:nope")).toBe("Primary");
    expect(resolveActiveTab(visible, "All")).toBe("Primary");
  });

  it("returns All when nothing is visible at all", () => {
    expect(resolveActiveTab([], "Primary")).toBe("All");
  });
});

describe("editing helpers (REQ-4)", () => {
  it("adds a tab once, at the end", () => {
    const tabs = addTab(DEFAULT_SPLIT_TABS, reminders());
    expect(tabs.map((t) => t.id)).toEqual([...DEFAULT_SPLIT_TABS.map((t) => t.id), "reminders"]);
    expect(addTab(tabs, reminders())).toEqual(tabs);
  });

  it("removes a tab but never the last one", () => {
    expect(removeTab([category("Primary"), reminders()], "Primary").map((t) => t.id)).toEqual(["reminders"]);
    expect(removeTab([reminders()], "reminders").map((t) => t.id)).toEqual(["reminders"]);
  });

  it("moves a tab up or down and clamps at the ends", () => {
    const tabs = [category("Primary"), category("Updates"), reminders()];
    expect(moveTab(tabs, "reminders", -1).map((t) => t.id)).toEqual(["Primary", "reminders", "Updates"]);
    expect(moveTab(tabs, "Primary", -1)).toEqual(tabs);
    expect(moveTab(tabs, "reminders", 1)).toEqual(tabs);
  });

  it("toggles hide-when-empty on one tab only", () => {
    const tabs = setHideWhenEmpty([category("Primary"), reminders()], "reminders", true);
    expect(tabs.map((t) => t.hideWhenEmpty)).toEqual([false, true]);
  });
});
