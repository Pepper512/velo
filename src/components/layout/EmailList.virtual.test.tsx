import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

/**
 * SPEC-SB SB-3 (REQ-3): the list renders only the rows in view. jsdom has no
 * layout, so the scroll container reports a 600 px viewport and every row its
 * estimated height; the virtualizer does the rest.
 */

// Router hooks: inbox, "All", a mutable selection.
const nav = vi.hoisted(() => ({ selectedThreadId: null as string | null }));
vi.mock("@/hooks/useRouteNavigation", () => ({
  useActiveLabel: () => "inbox",
  useSelectedThreadId: () => nav.selectedThreadId,
  useActiveCategory: () => null,
}));
vi.mock("@/router/navigate", () => ({ navigateToThread: vi.fn(), navigateToLabel: vi.fn() }));

// 200 threads from the "database", the first three pinned.
const rows = vi.hoisted(() =>
  Array.from({ length: 200 }, (_, i) => ({
    id: `t${i}`,
    account_id: "acc1",
    subject: `Subject ${i}`,
    snippet: "snippet",
    last_message_at: 1_000_000 - i,
    message_count: 1,
    is_read: 1,
    is_starred: 0,
    is_pinned: i < 3 ? 1 : 0,
    is_muted: 0,
    has_attachments: 0,
    from_name: "Sender",
    from_address: "s@example.com",
  })),
);
// Switches for the paging and bundle cases; reset before each test.
const mode = vi.hoisted(() => ({ paged: false, bundled: false }));
const getThreadsForAccount = vi.hoisted(() =>
  vi.fn(async (_acc: string, _label: string | undefined, limit: number, offset: number) =>
    mode.paged ? rows.slice(offset, offset + limit) : rows,
  ),
);
vi.mock("@/services/db/threads", () => ({
  getThreadsForAccount,
  getThreadsForCategory: vi.fn(async () => []),
  getInboxThreadsForLabel: vi.fn(async () => []),
  getThreadsWithPendingReminders: vi.fn(async () => []),
  getThreadLabelIds: vi.fn(async () => []),
  getUnreadCountsByLabel: vi.fn(async () => new Map()),
  deleteThread: vi.fn(),
}));
vi.mock("@/services/db/threadCategories", () => ({
  ALL_CATEGORIES: ["Primary", "Updates", "Promotions", "Social", "Newsletters"],
  // In the bundle case, t0 and t1 are Newsletters and get bundled away.
  getCategoriesForThreads: vi.fn(async () => (mode.bundled ? new Map([["t0", "Newsletters"], ["t1", "Newsletters"]]) : new Map())),
}));
vi.mock("@/services/db/splitTabCounts", () => ({ getSplitTabCounts: vi.fn(async () => new Map()) }));
vi.mock("@/services/db/followUpReminders", () => ({ getActiveFollowUpThreadIds: vi.fn(async () => new Set()) }));
vi.mock("@/services/db/bundleRules", () => ({
  getBundleRules: vi.fn(async () => (mode.bundled ? [{ id: "r1", account_id: "acc1", category: "Newsletters", is_bundled: 1, delivery_schedule: "daily", enabled: 1 }] : [])),
  getHeldThreadIds: vi.fn(async () => new Set()),
  getBundleSummaries: vi.fn(async () =>
    mode.bundled ? new Map([["Newsletters", { count: 2, latestSubject: "Subject 0", latestSender: "Sender" }]]) : new Map(),
  ),
}));
vi.mock("@/services/db/messages", () => ({ getMessagesForThread: vi.fn(async () => []) }));
vi.mock("@/services/db/connection", () => ({ getDb: vi.fn() }));
vi.mock("@/services/search/smartFolderQuery", () => ({ getSmartFolderSearchQuery: vi.fn(), mapSmartFolderRows: vi.fn() }));
vi.mock("@/services/gmail/tokenManager", () => ({ getGmailClient: vi.fn() }));
vi.mock("@/services/db/settings", () => ({ setSetting: vi.fn(async () => {}), getSetting: vi.fn(async () => null) }));
vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }),
}));
vi.mock("../search/SearchBar", () => ({ SearchBar: () => null }));

import { EmailList } from "./EmailList";
import { useThreadStore } from "@/stores/threadStore";
import { useAccountStore } from "@/stores/accountStore";

const VIEWPORT = 600;
const ROW = 72;

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  // The virtualizer reads the viewport from offsetWidth/offsetHeight and each
  // row from getBoundingClientRect: the scroll container is 600 px tall, every
  // row reports its estimate.
  const sizeOf = (el: HTMLElement) => (el.classList.contains("overflow-y-auto") ? VIEWPORT : ROW);
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return sizeOf(this); } });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return 320; } });
  // scrollToIndex clamps to scrollHeight - clientHeight: the scroller's content
  // is the positioned inner div whose height the virtualizer set.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return sizeOf(this); } });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      const inner = this.firstElementChild as HTMLElement | null;
      const h = inner ? parseFloat(inner.style.height) : 0;
      return Number.isFinite(h) && h > 0 ? h : sizeOf(this);
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    const h = sizeOf(this);
    return { height: h, width: 320, top: 0, left: 0, bottom: h, right: 320, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  // jsdom's scrollTop never changes; give it a backing field so a scroll sticks.
  const scrollTops = new WeakMap<Element, number>();
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get() { return scrollTops.get(this) ?? 0; },
    set(v: number) { scrollTops.set(this, v); },
  });
  // jsdom has no scrollTo; the virtualizer scrolls through it and listens for "scroll".
  Element.prototype.scrollTo = function (opts?: ScrollToOptions | number) {
    const top = typeof opts === "number" ? opts : (opts?.top ?? 0);
    (this as HTMLElement).scrollTop = top;
    this.dispatchEvent(new Event("scroll"));
  } as typeof Element.prototype.scrollTo;
});

beforeEach(() => {
  nav.selectedThreadId = null;
  mode.paged = false;
  mode.bundled = false;
  getThreadsForAccount.mockClear();
  useAccountStore.setState({ activeAccountId: "acc1", accounts: [{ id: "acc1", email: "me@example.com" }] } as never);
  useThreadStore.setState({ threads: [], isLoading: false, selectedThreadIds: new Set(), searchThreadIds: null, searchQuery: "" });
});

function renderedRows(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-thread-id]")).map((el) => el.dataset.threadId!);
}

describe("EmailList — virtualized (SPEC-SB REQ-3)", () => {
  it("renders a window of rows, not all 200 (REQ-3.1)", async () => {
    render(<EmailList />);
    await waitFor(() => expect(useThreadStore.getState().threads).toHaveLength(200));
    await waitFor(() => expect(renderedRows().length).toBeGreaterThan(0));
    const count = renderedRows().length;
    expect(count).toBeLessThan(40);
    expect(renderedRows()[0]).toBe("t0");
  });

  it("brings a far-away selected thread into the rendered window (REQ-3.3)", async () => {
    const { rerender } = render(<EmailList />);
    await waitFor(() => expect(renderedRows().length).toBeGreaterThan(0));
    expect(renderedRows()).not.toContain("t150");
    // The router would re-render the list with the new selection.
    nav.selectedThreadId = "t150";
    act(() => rerender(<EmailList />));
    await waitFor(() => expect(renderedRows()).toContain("t150"));
    expect(renderedRows().length).toBeLessThan(40);
  });

  it("staggers the rows of the first loaded paint, keeps it for them, never gives it to rows scrolled in later (REQ-3.4)", async () => {
    const { rerender } = render(<EmailList />);
    await waitFor(() => expect(renderedRows().length).toBeGreaterThan(0));
    const row = (id: string) => document.querySelector<HTMLElement>(`[data-thread-id="${id}"]`);
    expect(row("t0")!.classList.contains("stagger-in")).toBe(true);
    // A re-render (the virtualizer measures within a frame) must not strip it mid-animation.
    act(() => rerender(<EmailList />));
    expect(row("t0")!.classList.contains("stagger-in")).toBe(true);
    // A row that scrolls into view later is not part of that first paint.
    nav.selectedThreadId = "t150";
    act(() => rerender(<EmailList />));
    await waitFor(() => expect(row("t150")).not.toBeNull());
    expect(row("t150")!.classList.contains("stagger-in")).toBe(false);
  });

  it("scrolls a selection known before the list loads into view once it has (REQ-3.3, Gemini F-01)", async () => {
    nav.selectedThreadId = "t150";
    render(<EmailList />);
    await waitFor(() => expect(renderedRows()).toContain("t150"));
    expect(renderedRows().length).toBeLessThan(40);
  });

  it("puts bundle headers first and keeps bundled threads out of the rows until expanded (REQ-3.1)", async () => {
    mode.bundled = true;
    render(<EmailList />);
    await waitFor(() => expect(screen.getAllByText("Newsletters").length).toBeGreaterThan(0));
    // Categories and bundle rules land in separate state updates; wait for both.
    await waitFor(() => expect(renderedRows()).not.toContain("t0"));
    expect(renderedRows()[0]).toBe("t2");
    const firstWrapper = document.querySelector<HTMLElement>("[data-index='0']")!;
    expect(firstWrapper.textContent).toContain("Newsletters");
    act(() => firstWrapper.querySelector("button")!.click());
    await waitFor(() => expect(document.querySelectorAll(".pl-4").length).toBe(2));
  });

  it("loads the next page when the last rendered row is within five of the end (REQ-3.3)", async () => {
    mode.paged = true;
    render(<EmailList />);
    await waitFor(() => expect(useThreadStore.getState().threads).toHaveLength(50));
    expect(getThreadsForAccount).toHaveBeenCalledTimes(1);
    // Scroll to the end of the first page: the virtualizer renders the tail.
    const scroller = document.querySelector<HTMLElement>(".overflow-y-auto")!;
    act(() => scroller.scrollTo({ top: 50 * ROW }));
    await waitFor(() => expect(useThreadStore.getState().threads).toHaveLength(100));
    expect(getThreadsForAccount).toHaveBeenLastCalledWith("acc1", "INBOX", 50, 50);
  });

  it("puts the 'Other emails' divider before the first unpinned thread (REQ-3.2)", async () => {
    render(<EmailList />);
    await waitFor(() => expect(renderedRows().length).toBeGreaterThan(3));
    const divider = screen.getByText("Other emails");
    const row = divider.closest("[data-thread-id]") as HTMLElement;
    expect(row.dataset.threadId).toBe("t3");
  });
});
