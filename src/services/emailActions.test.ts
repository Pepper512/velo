import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies
vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: vi.fn(() => ({ isOnline: true })),
  },
}));

vi.mock("@/stores/threadStore", () => ({
  useThreadStore: {
    getState: vi.fn(() => ({
      updateThread: vi.fn(),
      removeThread: vi.fn(),
    })),
  },
}));

vi.mock("@/services/email/providerFactory", () => ({
  getEmailProvider: vi.fn(),
}));

vi.mock("@/services/imap/reconcileOp", () => ({
  RECONCILE_OP: "reconcile",
  enqueueReconcileOps: vi.fn(async () => 1),
  runReconcileOp: vi.fn(async () => {}),
}));
vi.mock("@/services/db/pendingOperations", () => ({
  enqueuePendingOperation: vi.fn(() => Promise.resolve("op-1")),
}));

vi.mock("@/services/db/connection", () => ({
  getDb: vi.fn(() =>
    Promise.resolve({
      execute: vi.fn(() => Promise.resolve()),
      select: vi.fn(() => Promise.resolve([])),
    }),
  ),
}));

vi.mock("@/router/navigate", () => ({
  navigateToThread: vi.fn(),
  getSelectedThreadId: vi.fn(() => null),
}));

import { useUIStore } from "@/stores/uiStore";
import { useThreadStore } from "@/stores/threadStore";
import { getEmailProvider } from "@/services/email/providerFactory";
import { enqueuePendingOperation } from "@/services/db/pendingOperations";
import {
  archiveThread,
  trashThread,
  permanentDeleteThread,
  starThread,
  markThreadRead,
  spamThread,
  moveThread,
  executeEmailAction,
} from "./emailActions";
import { navigateToThread, getSelectedThreadId } from "@/router/navigate";
import { createMockEmailProvider, createMockUIStoreState, createMockThreadStoreState } from "@/test/mocks";

const mockProvider = createMockEmailProvider();

const mockUpdateThread = vi.fn();
const mockRemoveThread = vi.fn();

describe("emailActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEmailProvider).mockResolvedValue(mockProvider as never);
    vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState() as never);
    vi.mocked(useThreadStore.getState).mockReturnValue(createMockThreadStoreState({
      updateThread: mockUpdateThread,
      removeThread: mockRemoveThread,
    }) as never);
  });

  describe("online execution", () => {
    it("archives a thread via provider", async () => {
      const result = await archiveThread("acct-1", "t1", ["m1"]);
      expect(result.success).toBe(true);
      expect(result.queued).toBeUndefined();
      expect(mockRemoveThread).toHaveBeenCalledWith("t1");
      expect(mockProvider.archive).toHaveBeenCalledWith("t1", ["m1"]);
    });

    it("trashes a thread via provider", async () => {
      const result = await trashThread("acct-1", "t1", ["m1"]);
      expect(result.success).toBe(true);
      expect(mockProvider.trash).toHaveBeenCalledWith("t1", ["m1"]);
    });

    it("stars a thread via provider", async () => {
      const result = await starThread("acct-1", "t1", ["m1"], true);
      expect(result.success).toBe(true);
      expect(mockUpdateThread).toHaveBeenCalledWith("t1", { isStarred: true });
      expect(mockProvider.star).toHaveBeenCalledWith("t1", ["m1"], true);
    });

    it("marks thread read via provider", async () => {
      const result = await markThreadRead("acct-1", "t1", ["m1"], true);
      expect(result.success).toBe(true);
      expect(mockUpdateThread).toHaveBeenCalledWith("t1", { isRead: true });
      expect(mockProvider.markRead).toHaveBeenCalledWith("t1", ["m1"], true);
    });

    it("reports spam via provider", async () => {
      const result = await spamThread("acct-1", "t1", ["m1"], true);
      expect(result.success).toBe(true);
      expect(mockRemoveThread).toHaveBeenCalledWith("t1");
      expect(mockProvider.spam).toHaveBeenCalledWith("t1", ["m1"], true);
    });
  });

  describe("offline queueing", () => {
    beforeEach(() => {
      vi.mocked(useUIStore.getState).mockReturnValue({ isOnline: false } as never);
    });

    it("queues archive when offline", async () => {
      const result = await archiveThread("acct-1", "t1", ["m1"]);
      expect(result.success).toBe(true);
      expect(result.queued).toBe(true);
      expect(mockProvider.archive).not.toHaveBeenCalled();
      expect(enqueuePendingOperation).toHaveBeenCalledWith(
        "acct-1",
        "archive",
        "t1",
        expect.objectContaining({ threadId: "t1", messageIds: ["m1"] }),
      );
    });

    it("still applies optimistic UI update when offline", async () => {
      await starThread("acct-1", "t1", ["m1"], true);
      expect(mockUpdateThread).toHaveBeenCalledWith("t1", { isStarred: true });
    });
  });

  describe("network error → queue fallback", () => {
    it("queues on retryable network error", async () => {
      vi.mocked(useUIStore.getState).mockReturnValue({ isOnline: true } as never);
      mockProvider.archive.mockRejectedValueOnce(new Error("Failed to fetch"));

      const result = await archiveThread("acct-1", "t1", ["m1"]);
      expect(result.success).toBe(true);
      expect(result.queued).toBe(true);
      expect(enqueuePendingOperation).toHaveBeenCalled();
    });
  });

  describe("unknown outcome → reconcile op (F-4 REQ-4.1)", () => {
    it("queues a targeted re-check for a move whose server outcome is unknown, and does not retry the move", async () => {
      const { enqueueReconcileOps } = await import("@/services/imap/reconcileOp");
      vi.mocked(useUIStore.getState).mockReturnValue({ isOnline: true } as never);
      mockProvider.archive.mockRejectedValueOnce(
        new Error("VELO_OUTCOME_UNKNOWN: UID MOVE timed out after 30s. The move may already have completed on the server."),
      );

      const result = await archiveThread("acct-1", "t1", ["imap-acct-1-INBOX-5"]);

      expect(result.success).toBe(false);
      expect(enqueuePendingOperation).not.toHaveBeenCalled();
      expect(enqueueReconcileOps).toHaveBeenCalledWith("acct-1", ["imap-acct-1-INBOX-5"]);
    });

    it("does not queue a re-check for a flag change", async () => {
      const { enqueueReconcileOps } = await import("@/services/imap/reconcileOp");
      vi.mocked(useUIStore.getState).mockReturnValue({ isOnline: true } as never);
      mockProvider.star.mockRejectedValueOnce(new Error("VELO_OUTCOME_UNKNOWN: odd"));

      await starThread("acct-1", "t1", ["imap-acct-1-INBOX-5"], true);

      expect(enqueueReconcileOps).not.toHaveBeenCalled();
    });

    it("gives a queued move the same observer when its outcome is unknown, and still fails the op (Grok M5 on #50)", async () => {
      const { enqueueReconcileOps } = await import("@/services/imap/reconcileOp");
      const { executeQueuedAction } = await import("./emailActions");
      mockProvider.archive.mockRejectedValueOnce(new Error("VELO_OUTCOME_UNKNOWN: UID MOVE timed out after 30s."));

      await expect(
        executeQueuedAction("acct-1", "archive", { threadId: "t1", messageIds: ["imap-acct-1-INBOX-5"] }),
      ).rejects.toThrow(/VELO_OUTCOME_UNKNOWN/);

      expect(enqueueReconcileOps).toHaveBeenCalledWith("acct-1", ["imap-acct-1-INBOX-5"]);
      expect(mockProvider.archive).toHaveBeenCalledTimes(1);
    });

    it("does not queue a re-check for a queued move that fails for an ordinary reason", async () => {
      const { enqueueReconcileOps } = await import("@/services/imap/reconcileOp");
      const { executeQueuedAction } = await import("./emailActions");
      mockProvider.archive.mockRejectedValueOnce(new Error("Failed to fetch"));

      await expect(
        executeQueuedAction("acct-1", "archive", { threadId: "t1", messageIds: ["imap-acct-1-INBOX-5"] }),
      ).rejects.toThrow();
      expect(enqueueReconcileOps).not.toHaveBeenCalled();
    });

    it("routes a queued reconcile op to its handler instead of a provider action", async () => {
      const { runReconcileOp } = await import("@/services/imap/reconcileOp");
      const { executeQueuedAction } = await import("./emailActions");

      await executeQueuedAction("acct-1", "reconcile", { folder: "INBOX", uids: [5], kind: "repair" });

      expect(runReconcileOp).toHaveBeenCalledWith("acct-1", { folder: "INBOX", uids: [5], kind: "repair" });
      expect(mockProvider.archive).not.toHaveBeenCalled();
    });
  });

  describe("permanent error → revert", () => {
    it("reverts star on permanent error", async () => {
      vi.mocked(useUIStore.getState).mockReturnValue({ isOnline: true } as never);
      mockProvider.star.mockRejectedValueOnce(new Error("Invalid request"));

      const result = await starThread("acct-1", "t1", ["m1"], true);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      // Revert: set starred to false
      expect(mockUpdateThread).toHaveBeenCalledWith("t1", { isStarred: false });
    });

    it("reverts markRead on permanent error", async () => {
      vi.mocked(useUIStore.getState).mockReturnValue({ isOnline: true } as never);
      mockProvider.markRead.mockRejectedValueOnce(new Error("Bad request"));

      const result = await markThreadRead("acct-1", "t1", ["m1"], true);
      expect(result.success).toBe(false);
      // Revert: set read to false
      expect(mockUpdateThread).toHaveBeenCalledWith("t1", { isRead: false });
    });
  });

  // Audit P13(a): the service REPORTS the next thread; it no longer navigates.
  // These assertions moved from "navigateToThread was called" to "the result
  // says what should be selected", and selection is passed in rather than read
  // from router state. Navigation itself is covered by useEmailActions.test.ts.
  describe("auto-advance after removal", () => {
    const threads = [
      { id: "t1" },
      { id: "t2" },
      { id: "t3" },
    ];

    it("reports the next thread when archiving the viewed thread", async () => {
      const selected = "t2";
      vi.mocked(useThreadStore.getState).mockReturnValue(createMockThreadStoreState({
        threads,
        updateThread: mockUpdateThread,
        removeThread: mockRemoveThread,
      }) as never);

      const result = await executeEmailAction(
        "acct-1",
        { type: "archive", threadId: "t2", messageIds: ["m1"] },
        selected,
      );
      expect(result.nextThreadId).toBe("t3");
    });

    it("reports the previous thread when archiving the last thread", async () => {
      const selected = "t3";
      vi.mocked(useThreadStore.getState).mockReturnValue(createMockThreadStoreState({
        threads,
        updateThread: mockUpdateThread,
        removeThread: mockRemoveThread,
      }) as never);

      const result = await executeEmailAction(
        "acct-1",
        { type: "archive", threadId: "t3", messageIds: ["m1"] },
        selected,
      );
      expect(result.nextThreadId).toBe("t2");
    });

    it("reports no next thread when archiving a non-viewed thread", async () => {
      const selected = "t1";
      vi.mocked(useThreadStore.getState).mockReturnValue(createMockThreadStoreState({
        threads,
        updateThread: mockUpdateThread,
        removeThread: mockRemoveThread,
      }) as never);

      const result = await executeEmailAction(
        "acct-1",
        { type: "archive", threadId: "t2", messageIds: ["m1"] },
        selected,
      );
      expect(result.nextThreadId).toBeUndefined();
    });

    it("reports no next thread when archiving the only thread", async () => {
      const selected = "t1";
      vi.mocked(useThreadStore.getState).mockReturnValue(createMockThreadStoreState({
        threads: [{ id: "t1" }],
        updateThread: mockUpdateThread,
        removeThread: mockRemoveThread,
      }) as never);

      const result = await executeEmailAction(
        "acct-1",
        { type: "archive", threadId: "t1", messageIds: ["m1"] },
        selected,
      );
      expect(result.nextThreadId).toBeUndefined();
    });

    it("reports the next thread on trash action", async () => {
      const selected = "t1";
      vi.mocked(useThreadStore.getState).mockReturnValue(createMockThreadStoreState({
        threads,
        updateThread: mockUpdateThread,
        removeThread: mockRemoveThread,
      }) as never);

      const result = await executeEmailAction(
        "acct-1",
        { type: "trash", threadId: "t1", messageIds: ["m1"] },
        selected,
      );
      expect(result.nextThreadId).toBe("t2");
    });

    it("reports the next thread on spam action", async () => {
      const selected = "t1";
      vi.mocked(useThreadStore.getState).mockReturnValue(createMockThreadStoreState({
        threads,
        updateThread: mockUpdateThread,
        removeThread: mockRemoveThread,
      }) as never);

      const result = await executeEmailAction(
        "acct-1",
        { type: "spam", threadId: "t1", messageIds: ["m1"], isSpam: true },
        selected,
      );
      expect(result.nextThreadId).toBe("t2");
    });

    it("reports the next thread on permanentDelete action", async () => {
      const selected = "t2";
      vi.mocked(useThreadStore.getState).mockReturnValue(createMockThreadStoreState({
        threads,
        updateThread: mockUpdateThread,
        removeThread: mockRemoveThread,
      }) as never);

      const result = await executeEmailAction(
        "acct-1",
        { type: "permanentDelete", threadId: "t2", messageIds: ["m1"] },
        selected,
      );
      expect(result.nextThreadId).toBe("t3");
    });

    it("reports the next thread on moveToFolder action", async () => {
      const selected = "t2";
      vi.mocked(useThreadStore.getState).mockReturnValue(createMockThreadStoreState({
        threads,
        updateThread: mockUpdateThread,
        removeThread: mockRemoveThread,
      }) as never);

      const result = await executeEmailAction(
        "acct-1",
        { type: "moveToFolder", threadId: "t2", messageIds: ["m1"], folderPath: "Archive" },
        selected,
      );
      expect(result.nextThreadId).toBe("t3");
    });
  });

  describe("executeEmailAction with draft actions", () => {
    it("sends a message via provider", async () => {
      const result = await executeEmailAction("acct-1", {
        type: "sendMessage",
        rawBase64Url: "base64data",
        threadId: "t1",
      });
      expect(result.success).toBe(true);
      expect(mockProvider.sendMessage).toHaveBeenCalledWith("base64data", "t1");
    });

    it("creates a draft via provider", async () => {
      const result = await executeEmailAction("acct-1", {
        type: "createDraft",
        rawBase64Url: "base64data",
      });
      expect(result.success).toBe(true);
      expect(mockProvider.createDraft).toHaveBeenCalledWith("base64data", undefined);
    });
  });
});
