import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

/**
 * SPEC-243 REQ-1.1, REQ-1.3, REQ-2.1, REQ-2.2 — the unread pills beside Inbox,
 * Spam and user labels, and what refreshes them. The stores are mocked as
 * selector functions (the ThreadCard test's pattern); the label store is the
 * real one so the pills read the same map the store fills.
 */

vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));

vi.mock("../accounts/AccountSwitcher", () => ({
  AccountSwitcher: () => null,
}));
vi.mock("../labels/LabelForm", () => ({
  LabelForm: () => null,
}));
vi.mock("../ui/InputDialog", () => ({
  InputDialog: () => null,
}));

vi.mock("@/hooks/useRouteNavigation", () => ({
  useActiveLabel: () => "inbox",
  useActiveCategory: () => undefined,
}));
vi.mock("@/router/navigate", () => ({
  navigateToLabel: vi.fn(),
}));

const uiState: Record<string, unknown> = {
  toggleSidebar: vi.fn(),
  sidebarNavConfig: null,
  inboxViewMode: "unified",
  setInboxViewMode: vi.fn(),
  isSyncingFolder: null,
  setSyncingFolder: vi.fn(),
};
vi.mock("@/stores/uiStore", () => ({
  useUIStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(uiState),
    { getState: () => uiState },
  ),
}));
vi.mock("@/stores/composerStore", () => ({
  useComposerStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ openComposer: vi.fn() }),
}));
vi.mock("@/stores/taskStore", () => ({
  useTaskStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ incompleteCount: 0 }),
}));
vi.mock("@/stores/contextMenuStore", () => ({
  useContextMenuStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ openMenu: vi.fn() }),
}));
vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeAccountId: "acc-1" }),
}));
const smartFolderState: Record<string, unknown> = {
  folders: [],
  unreadCounts: {},
  loadFolders: vi.fn(),
  refreshUnreadCounts: vi.fn(),
  createFolder: vi.fn(),
};
vi.mock("@/stores/smartFolderStore", () => ({
  useSmartFolderStore: (selector: (s: Record<string, unknown>) => unknown) => selector(smartFolderState),
}));

// The label store is real; its two database calls are mocked.
vi.mock("@/services/db/labels", () => ({
  getLabelsForAccount: vi.fn().mockResolvedValue([]),
  deleteLabel: vi.fn(),
  updateLabelSortOrder: vi.fn(),
  upsertLabel: vi.fn(),
}));
vi.mock("@/services/db/threads", () => ({
  getUnreadCountsByLabel: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/services/gmail/tokenManager", () => ({
  getGmailClient: vi.fn(),
}));

import { Sidebar } from "./Sidebar";
import { useLabelStore } from "@/stores/labelStore";
import { getUnreadCountsByLabel } from "@/services/db/threads";
import { getLabelsForAccount } from "@/services/db/labels";

const mockCounts = vi.mocked(getUnreadCountsByLabel);

function dbLabel(id: string, name: string) {
  return {
    id,
    account_id: "acc-1",
    name,
    type: "user",
    color_bg: null,
    color_fg: null,
    visible: 1,
    sort_order: 0,
    imap_folder_path: null,
    imap_special_use: null,
  } as Awaited<ReturnType<typeof getLabelsForAccount>>[number];
}

function renderSidebar(collapsed = false) {
  return render(<Sidebar collapsed={collapsed} onAddAccount={() => {}} />);
}

describe("Sidebar unread counts (SPEC-243)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCounts.mockResolvedValue({});
    useLabelStore.setState({ labels: [], isLoading: false, unreadCounts: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the count beside Inbox, Spam and a user label, and nothing at zero (REQ-1.1)", async () => {
    mockCounts.mockResolvedValue({ INBOX: 4, SPAM: 2, Label_work: 1, Label_quiet: 0 });
    // Through the query the sidebar's own load runs, not setState — the load
    // replaces the list on mount.
    vi.mocked(getLabelsForAccount).mockResolvedValue([dbLabel("Label_work", "Work"), dbLabel("Label_quiet", "Quiet")]);

    renderSidebar();
    await act(async () => {});

    expect(screen.getByLabelText("4 unread")).toHaveTextContent("4");
    expect(screen.getByLabelText("2 unread")).toHaveTextContent("2");
    expect(screen.getByLabelText("1 unread")).toHaveTextContent("1");
    expect(screen.queryByLabelText("0 unread")).toBeNull();
  });

  it("shows no count on folders that are not counted (REQ-1.1: Sent, Drafts, Trash…)", async () => {
    mockCounts.mockResolvedValue({ INBOX: 1, SENT: 9, DRAFT: 9, TRASH: 9, STARRED: 9 });

    renderSidebar();
    await act(async () => {});

    expect(screen.getByLabelText("1 unread")).toBeInTheDocument();
    expect(screen.queryByLabelText("9 unread")).toBeNull();
  });

  it("shows no count when collapsed (REQ-1.3)", async () => {
    mockCounts.mockResolvedValue({ INBOX: 4 });

    renderSidebar(true);
    await act(async () => {});

    expect(screen.queryByLabelText("4 unread")).toBeNull();
  });

  // One event per test (#63 review, Gemini M1): dispatching both would let an
  // unwired `velo-threads-changed` listener pass on the strength of sync-done.
  it("refreshes the counts on velo-threads-changed through the 500 ms debounce, without reloading labels (REQ-2.2)", async () => {
    vi.useFakeTimers();
    mockCounts.mockResolvedValue({ INBOX: 4 });
    renderSidebar();
    await act(async () => {});
    expect(mockCounts).toHaveBeenCalledTimes(1); // the account-change load
    expect(getLabelsForAccount).toHaveBeenCalledTimes(1);

    mockCounts.mockResolvedValue({ INBOX: 3 });
    act(() => {
      window.dispatchEvent(new Event("velo-threads-changed"));
      window.dispatchEvent(new Event("velo-threads-changed"));
    });
    expect(mockCounts).toHaveBeenCalledTimes(1); // nothing yet: debounced

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {});

    expect(mockCounts).toHaveBeenCalledTimes(2); // two events, one query
    expect(getLabelsForAccount).toHaveBeenCalledTimes(1); // a user action does not reload the label list
    expect(smartFolderState.refreshUnreadCounts).toHaveBeenCalledWith("acc-1");
    expect(screen.getByLabelText("3 unread")).toBeInTheDocument();
  });

  it("refreshes the counts and reloads labels on velo-sync-done (REQ-2.1)", async () => {
    vi.useFakeTimers();
    mockCounts.mockResolvedValue({ INBOX: 4 });
    renderSidebar();
    await act(async () => {});

    mockCounts.mockResolvedValue({ INBOX: 5 });
    act(() => {
      window.dispatchEvent(new Event("velo-sync-done"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {});

    expect(mockCounts).toHaveBeenCalledTimes(2);
    expect(getLabelsForAccount).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("5 unread")).toBeInTheDocument();
  });

  it("a sync-done inside a user action's debounce window still reloads labels", async () => {
    vi.useFakeTimers();
    renderSidebar();
    await act(async () => {});

    act(() => {
      window.dispatchEvent(new Event("velo-sync-done"));
      window.dispatchEvent(new Event("velo-threads-changed")); // last in the window
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {});

    expect(getLabelsForAccount).toHaveBeenCalledTimes(2);
    expect(mockCounts).toHaveBeenCalledTimes(2);
  });
});
