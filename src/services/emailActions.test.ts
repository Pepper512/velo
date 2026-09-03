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
vi.mock("@/services/db/followUpReminders", () => ({
  getFollowUpForThread: vi.fn(async () => null),
  insertFollowUpReminder: vi.fn(async () => "fu-1"),
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
import { getFollowUpForThread, insertFollowUpReminder } from "@/services/db/followUpReminders";
import {
  archiveThread,
  trashThread,
  permanentDeleteThread,
  starThread,
  markThreadRead,
  spamThread,
  moveThread,
  executeEmailAction,
  executeQueuedAction,
  sendEmail,
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

  // SPEC-243 REQ-2.2 — every action that changed the local database tells the
  // UI so, whether it then ran online, queued, or failed on the server. The
  // sidebar's unread counts refresh on it; without it they lag until the next sync.
  describe("velo-threads-changed (SPEC-243)", () => {
    function listen(): { handler: ReturnType<typeof vi.fn>; stop: () => void } {
      const handler = vi.fn();
      window.addEventListener("velo-threads-changed", handler);
      return { handler, stop: () => window.removeEventListener("velo-threads-changed", handler) };
    }

    it("fires once after the local update when the action runs online", async () => {
      const { handler, stop } = listen();

      await executeEmailAction("acct-1", { type: "markRead", threadId: "t1", messageIds: ["m1"], read: true });

      expect(handler).toHaveBeenCalledTimes(1);
      stop();
    });

    it("fires when the action is queued offline", async () => {
      vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({ isOnline: false }) as never);
      const { handler, stop } = listen();

      await executeEmailAction("acct-1", { type: "archive", threadId: "t1", messageIds: ["m1"] });

      expect(handler).toHaveBeenCalledTimes(1);
      stop();
    });

    it("fires even when the provider then fails permanently — the local database did change", async () => {
      mockProvider.archive.mockRejectedValueOnce(new Error("Invalid request"));
      const { handler, stop } = listen();

      const result = await executeEmailAction("acct-1", { type: "archive", threadId: "t1", messageIds: ["m1"] });

      expect(result.success).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
      stop();
    });
  });

  describe("auto reminder on send (SPEC-QSR)", () => {
    const raw = "cmF3";

    beforeEach(() => {
      vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({ isOnline: true }) as never);
      vi.mocked(getFollowUpForThread).mockResolvedValue(null);
      vi.mocked(insertFollowUpReminder).mockResolvedValue("fu-1");
      mockProvider.sendMessage.mockResolvedValue({ id: "msg-1", threadId: "thr-9" });
    });

    it("sets the reminder on the provider's thread after an immediate send the user wanted it for (REQ-1.4, 2.1)", async () => {
      const result = await sendEmail("acct-1", raw, undefined, { autoReminderDays: 3 });
      expect(result.success).toBe(true);
      expect(insertFollowUpReminder).toHaveBeenCalledWith("acct-1", "thr-9", "msg-1", expect.any(Number));
    });

    it("sets nothing when the user did not want one", async () => {
      const result = await sendEmail("acct-1", raw);
      expect(result.success).toBe(true);
      expect(insertFollowUpReminder).not.toHaveBeenCalled();
    });

    it("carries the wish and the frozen delay on the queued op when offline, and sets nothing yet (REQ-1.1)", async () => {
      vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({ isOnline: false }) as never);
      const result = await sendEmail("acct-1", raw, "thr-reply", { autoReminderDays: 2 });
      expect(result.queued).toBe(true);
      expect(enqueuePendingOperation).toHaveBeenCalledWith(
        "acct-1",
        "sendMessage",
        "thr-reply",
        expect.objectContaining({ rawBase64Url: raw, threadId: "thr-reply", autoReminderDays: 2 }),
      );
      expect(mockProvider.sendMessage).not.toHaveBeenCalled();
      expect(insertFollowUpReminder).not.toHaveBeenCalled();
    });

    it("sets the reminder when the queue processor's send succeeds, on the provider's thread (REQ-1.2)", async () => {
      mockProvider.sendMessage.mockResolvedValue({ id: "msg-2", threadId: "thr-2" });
      await executeQueuedAction("acct-1", "sendMessage", { rawBase64Url: raw, autoReminderDays: 7 });
      expect(mockProvider.sendMessage).toHaveBeenCalledWith(raw, undefined);
      expect(insertFollowUpReminder).toHaveBeenCalledWith("acct-1", "thr-2", "msg-2", expect.any(Number));
    });

    it("falls back to the thread the queued message replied to when the provider reports none", async () => {
      mockProvider.sendMessage.mockResolvedValue({ id: "msg-3" });
      await executeQueuedAction("acct-1", "sendMessage", { rawBase64Url: raw, threadId: "thr-old", autoReminderDays: 1 });
      expect(insertFollowUpReminder).toHaveBeenCalledWith("acct-1", "thr-old", "msg-3", expect.any(Number));
    });

    it("sets nothing for a queued row without the wish (rows from before this change), and none when the send fails (REQ-1.3)", async () => {
      await executeQueuedAction("acct-1", "sendMessage", { rawBase64Url: raw });
      expect(insertFollowUpReminder).not.toHaveBeenCalled();

      mockProvider.sendMessage.mockRejectedValue(new Error("Network error"));
      await expect(
        executeQueuedAction("acct-1", "sendMessage", { rawBase64Url: raw, autoReminderDays: 3 }),
      ).rejects.toThrow("Network error");
      expect(insertFollowUpReminder).not.toHaveBeenCalled();
    });

    it("keeps the send outcome whatever the reminder does: a lookup that throws is logged, not surfaced (REQ-2.2)", async () => {
      vi.mocked(getFollowUpForThread).mockRejectedValue(new Error("DB error"));
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await sendEmail("acct-1", raw, undefined, { autoReminderDays: 3 });
      expect(result.success).toBe(true);
      expect(spy).toHaveBeenCalled();
      await expect(
        executeQueuedAction("acct-1", "sendMessage", { rawBase64Url: raw, autoReminderDays: 3 }),
      ).resolves.toBeUndefined();
      spy.mockRestore();
    });

    it("carries the wish on the row queued after a retryable provider failure too (REQ-1.1, Gemini gap 1)", async () => {
      mockProvider.sendMessage.mockRejectedValueOnce(new Error("Network error"));
      const result = await sendEmail("acct-1", raw, undefined, { autoReminderDays: 3 });
      expect(result.queued).toBe(true);
      expect(enqueuePendingOperation).toHaveBeenCalledWith(
        "acct-1",
        "sendMessage",
        expect.any(String),
        expect.objectContaining({ autoReminderDays: 3 }),
      );
      expect(insertFollowUpReminder).not.toHaveBeenCalled();
    });

    it("warns and sets nothing when the provider reports no message id (Gemini gap 2)", async () => {
      mockProvider.sendMessage.mockResolvedValue({} as never);
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await sendEmail("acct-1", raw, undefined, { autoReminderDays: 3 });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("no message id"));
      expect(getFollowUpForThread).not.toHaveBeenCalled();
      expect(insertFollowUpReminder).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("never sets a second reminder on a thread that already has a pending one — a re-executed row is safe (Gemini gap 4)", async () => {
      vi.mocked(getFollowUpForThread).mockResolvedValue({
        id: "fu-0", account_id: "acct-1", thread_id: "thr-9", message_id: "old", remind_at: 1, status: "pending", created_at: 1,
      });
      await executeQueuedAction("acct-1", "sendMessage", { rawBase64Url: raw, autoReminderDays: 3 });
      expect(insertFollowUpReminder).not.toHaveBeenCalled();
    });

    it("survives the queue's JSON round trip: the delay is still a number after stringify/parse (Grok gap)", async () => {
      vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({ isOnline: false }) as never);
      await sendEmail("acct-1", raw, undefined, { autoReminderDays: 7 });
      const stored = vi.mocked(enqueuePendingOperation).mock.calls[0]![3];
      const replayed = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
      expect(replayed.autoReminderDays).toBe(7);

      vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({ isOnline: true }) as never);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 7, 12, 0, 0)); // Monday noon
      await executeQueuedAction("acct-1", "sendMessage", replayed);
      // The stored delay is what the reminder uses: 7 days from now, 09:00, Monday 14 Sep.
      const remindAt = vi.mocked(insertFollowUpReminder).mock.calls[0]![3];
      const due = new Date(remindAt * 1000);
      expect([due.getMonth() + 1, due.getDate(), due.getHours()]).toEqual([9, 14, 9]);
      vi.useRealTimers();
    });

    it("prefers the provider's thread when both it and the reply's are known (Grok gap)", async () => {
      mockProvider.sendMessage.mockResolvedValue({ id: "msg-5", threadId: "thr-provider" });
      await executeQueuedAction("acct-1", "sendMessage", { rawBase64Url: raw, threadId: "thr-reply", autoReminderDays: 3 });
      expect(insertFollowUpReminder).toHaveBeenCalledWith("acct-1", "thr-provider", "msg-5", expect.any(Number));
    });

    it("warns and sets nothing when neither the provider nor the action knows a thread (Grok gap)", async () => {
      mockProvider.sendMessage.mockResolvedValue({ id: "msg-6" });
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await executeQueuedAction("acct-1", "sendMessage", { rawBase64Url: raw, autoReminderDays: 3 });
      expect(insertFollowUpReminder).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("No thread id"));
      spy.mockRestore();
    });

    it("ignores a stray autoReminderDays on a non-send action (Grok gap)", async () => {
      await executeQueuedAction("acct-1", "archive", { threadId: "t1", messageIds: ["m1"], autoReminderDays: 3 });
      expect(mockProvider.archive).toHaveBeenCalled();
      expect(getFollowUpForThread).not.toHaveBeenCalled();
      expect(insertFollowUpReminder).not.toHaveBeenCalled();
    });

    it("falls back to the reply's thread when the provider reports an empty one (Gemini L2)", async () => {
      mockProvider.sendMessage.mockResolvedValue({ id: "msg-4", threadId: "" });
      await executeQueuedAction("acct-1", "sendMessage", { rawBase64Url: raw, threadId: "thr-old", autoReminderDays: 3 });
      expect(insertFollowUpReminder).toHaveBeenCalledWith("acct-1", "thr-old", "msg-4", expect.any(Number));
    });
  });
});
