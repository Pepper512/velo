import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CategoryTabs } from "./CategoryTabs";
import type { VisibleTab } from "@/services/inbox/splitTabs";

// jsdom does not provide ResizeObserver or scrollIntoView
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  Element.prototype.scrollIntoView = vi.fn();
});

const FIVE: VisibleTab[] = ["Primary", "Updates", "Promotions", "Social", "Newsletters"].map((name) => ({
  id: name,
  name,
  kind: "category",
  unread: 0,
  color: null,
}));

describe("CategoryTabs", () => {
  const onTabChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the five category tabs when given today's default", () => {
    render(<CategoryTabs tabs={FIVE} activeTab="Primary" onTabChange={onTabChange} />);
    for (const name of ["Primary", "Updates", "Promotions", "Social", "Newsletters"]) {
      expect(screen.getByRole("tab", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it("renders whatever tabs it is given, in order — a label tab with its dot and a Reminders tab (SPEC-SIT REQ-2)", () => {
    const tabs: VisibleTab[] = [
      { id: "Primary", name: "Primary", kind: "category", unread: 0, color: null },
      { id: "label:lbl-1", name: "Invoices", kind: "label", unread: 3, color: "#336699" },
      { id: "reminders", name: "Reminders", kind: "reminders", unread: 1, color: null },
    ];
    render(<CategoryTabs tabs={tabs} activeTab="label:lbl-1" onTabChange={onTabChange} />);
    const rendered = screen.getAllByRole("tab").map((el) => el.textContent);
    expect(rendered).toEqual(["Primary", "Invoices3", "Reminders1"]);
    expect(screen.queryByText("Promotions")).not.toBeInTheDocument();
    const dot = screen.getByRole("tab", { name: /Invoices/ }).querySelector("span[aria-hidden]");
    expect(dot).toHaveStyle({ backgroundColor: "#336699" });
  });

  it("highlights the active tab", () => {
    render(<CategoryTabs tabs={FIVE} activeTab="Updates" onTabChange={onTabChange} />);
    expect(screen.getByRole("tab", { name: /Updates/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Primary/ })).toHaveAttribute("aria-selected", "false");
  });

  it("reports the clicked tab's id", () => {
    render(<CategoryTabs tabs={FIVE} activeTab="Primary" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /Social/ }));
    expect(onTabChange).toHaveBeenCalledWith("Social");
  });

  it("shows an unread pill only above zero", () => {
    const tabs = FIVE.map((t) => (t.id === "Updates" ? { ...t, unread: 7 } : t));
    render(<CategoryTabs tabs={tabs} activeTab="Primary" onTabChange={onTabChange} />);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
