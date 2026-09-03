import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/services/db/smartLabelRules", () => ({
  getSmartLabelRulesForAccount: vi.fn(async () => [{ label_id: "lbl-smart" }]),
}));

import { SplitTabsEditor } from "./SplitTabsEditor";
import { useUIStore } from "@/stores/uiStore";
import { useLabelStore } from "@/stores/labelStore";
import { useAccountStore } from "@/stores/accountStore";
import { DEFAULT_SPLIT_TABS } from "@/services/inbox/splitTabs";

/**
 * SPEC-SIT REQ-4 — the editor: reorder, remove (never the last), hide-when-empty,
 * add from the account's labels (smart ones marked) and Reminders.
 */
describe("SplitTabsEditor", () => {
  beforeEach(() => {
    useUIStore.setState({ splitInboxTabs: DEFAULT_SPLIT_TABS });
    useAccountStore.setState({ activeAccountId: "acc-1" } as never);
    useLabelStore.setState({
      labels: [
        { id: "lbl-smart", accountId: "acc-1", name: "Invoices", type: "user", colorBg: "#123", colorFg: null, sortOrder: 0 },
        { id: "lbl-plain", accountId: "acc-1", name: "Family", type: "user", colorBg: null, colorFg: null, sortOrder: 1 },
        { id: "INBOX", accountId: "acc-1", name: "INBOX", type: "system", colorBg: null, colorFg: null, sortOrder: 2 },
        { id: "lbl-other", accountId: "acc-2", name: "Elsewhere", type: "user", colorBg: null, colorFg: null, sortOrder: 0 },
      ],
    } as never);
    // The store's setter persists through the settings service; not under test here.
    vi.spyOn(useUIStore.getState(), "setSplitInboxTabs").mockImplementation((tabs) => {
      useUIStore.setState({ splitInboxTabs: tabs });
    });
  });

  it("lists the configured tabs in order and offers the account's user labels (smart ones marked) and Reminders", async () => {
    render(<SplitTabsEditor />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("Primary");
    expect(items[4]).toContain("Newsletters");
    const options = Array.from(screen.getByRole("combobox", { name: "Tab to add" }).querySelectorAll("option")).map((o) => o.textContent);
    await waitFor(() => expect(options.some((o) => o === "Invoices (smart label)") || screen.getByRole("option", { name: "Invoices (smart label)" })).toBeTruthy());
    expect(screen.getByRole("option", { name: "Family" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Reminders" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Elsewhere" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /INBOX/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Primary/ })).not.toBeInTheDocument();
  });

  it("adds the chosen tab at the end and moves it up", () => {
    render(<SplitTabsEditor />);
    fireEvent.change(screen.getByRole("combobox", { name: "Tab to add" }), { target: { value: "reminders" } });
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    expect(useUIStore.getState().splitInboxTabs.map((t) => t.id)).toEqual([
      "Primary", "Updates", "Promotions", "Social", "Newsletters", "reminders",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Move Reminders up" }));
    expect(useUIStore.getState().splitInboxTabs.map((t) => t.id)[4]).toBe("reminders");
  });

  it("removes a tab, toggles hide-when-empty, and never removes the last tab", () => {
    render(<SplitTabsEditor />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Promotions when empty" }));
    expect(useUIStore.getState().splitInboxTabs.find((t) => t.id === "Promotions")?.hideWhenEmpty).toBe(true);
    for (const name of ["Updates", "Promotions", "Social", "Newsletters"]) {
      fireEvent.click(screen.getByRole("button", { name: `Remove ${name}` }));
    }
    expect(useUIStore.getState().splitInboxTabs.map((t) => t.id)).toEqual(["Primary"]);
    expect(screen.getByRole("button", { name: "Remove Primary" })).toBeDisabled();
  });
});
