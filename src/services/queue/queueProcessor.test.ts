import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: vi.fn(() => ({ isOnline: true, setPendingOpsCount: vi.fn() })),
  },
}));

vi.mock("../db/pendingOperations", () => ({
  getPendingOperations: vi.fn(() => Promise.resolve([])),
  updateOperationStatus: vi.fn(() => Promise.resolve()),
  deleteOperation: vi.fn(() => Promise.resolve()),
  incrementRetry: vi.fn(() => Promise.resolve()),
  getPendingOpsCount: vi.fn(() => Promise.resolve(0)),
  compactQueue: vi.fn(() => Promise.resolve(0)),
}));

vi.mock("../imap/reconcileOp", () => ({
  RECONCILE_OP: "reconcile",
  degradeReconcileOp: vi.fn(async () => {}),
}));
vi.mock("../emailActions", () => ({
  executeQueuedAction: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/utils/networkErrors", () => ({
  classifyError: vi.fn(() => ({
    type: "permanent",
    isRetryable: false,
    message: "error",
  })),
}));

vi.mock("../backgroundCheckers", () => ({
  createBackgroundChecker: vi.fn((_name: string, fn: () => Promise<void>) => ({
    start: () => fn(),
    stop: vi.fn(),
  })),
}));

import { useUIStore } from "@/stores/uiStore";
import {
  getPendingOperations,
  updateOperationStatus,
  deleteOperation,
  incrementRetry,
  compactQueue,
} from "../db/pendingOperations";
import { executeQueuedAction } from "../emailActions";
import { classifyError } from "@/utils/networkErrors";
import { startQueueProcessor, stopQueueProcessor, triggerQueueFlush } from "./queueProcessor";
import { createMockUIStoreState } from "@/test/mocks";

const mockSetPendingOpsCount = vi.fn();

describe("queueProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({
      setPendingOpsCount: mockSetPendingOpsCount,
    }) as never);
    vi.mocked(getPendingOperations).mockResolvedValue([]);
  });

  it("skips processing when offline", async () => {
    vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({
      isOnline: false,
      setPendingOpsCount: mockSetPendingOpsCount,
    }) as never);
    await triggerQueueFlush();
    expect(getPendingOperations).not.toHaveBeenCalled();
  });

  it("compacts queue before processing", async () => {
    await triggerQueueFlush();
    expect(compactQueue).toHaveBeenCalled();
  });

  it("processes pending operations successfully", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "archive",
        resource_id: "t1",
        params: '{"threadId":"t1","messageIds":[]}',
        status: "pending",
        retry_count: 0,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);

    await triggerQueueFlush();

    expect(updateOperationStatus).toHaveBeenCalledWith("op-1", "executing");
    expect(executeQueuedAction).toHaveBeenCalledWith("acct-1", "archive", {
      threadId: "t1",
      messageIds: [],
    });
    expect(deleteOperation).toHaveBeenCalledWith("op-1");
  });

  it("retries on retryable errors", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "star",
        resource_id: "t1",
        params: '{"threadId":"t1","messageIds":[],"starred":true}',
        status: "pending",
        retry_count: 0,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);
    vi.mocked(executeQueuedAction).mockRejectedValueOnce(new Error("Failed to fetch"));
    vi.mocked(classifyError).mockReturnValueOnce({
      type: "network",
      isRetryable: true,
      message: "Failed to fetch",
    });

    await triggerQueueFlush();

    expect(updateOperationStatus).toHaveBeenCalledWith("op-1", "pending", "Failed to fetch");
    expect(incrementRetry).toHaveBeenCalledWith("op-1");
    expect(deleteOperation).not.toHaveBeenCalled();
  });

  it("marks as failed on permanent errors", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "archive",
        resource_id: "t1",
        params: '{"threadId":"t1","messageIds":[]}',
        status: "pending",
        retry_count: 0,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);
    vi.mocked(executeQueuedAction).mockRejectedValueOnce(new Error("Bad request"));
    vi.mocked(classifyError).mockReturnValueOnce({
      type: "permanent",
      isRetryable: false,
      message: "Bad request",
    });

    await triggerQueueFlush();

    expect(updateOperationStatus).toHaveBeenCalledWith("op-1", "failed", "Bad request");
  });

  it("degrades a reconcile op that spends its third strike, even on a retryable error (F-4 REQ-4.3)", async () => {
    const { degradeReconcileOp } = await import("../imap/reconcileOp");
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-r",
        account_id: "acct-1",
        operation_type: "reconcile",
        resource_id: "reconcile:INBOX",
        params: '{"folder":"INBOX","uids":[5],"kind":"repair"}',
        status: "pending",
        retry_count: 2,
        max_retries: 3,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);
    vi.mocked(executeQueuedAction).mockRejectedValueOnce(new Error("Failed to fetch"));
    vi.mocked(classifyError).mockReturnValueOnce({ type: "network", isRetryable: true, message: "Failed to fetch" });

    await triggerQueueFlush();

    expect(updateOperationStatus).toHaveBeenCalledWith("op-r", "failed", "Failed to fetch");
    expect(incrementRetry).not.toHaveBeenCalled();
    expect(degradeReconcileOp).toHaveBeenCalledWith("acct-1", { folder: "INBOX", uids: [5], kind: "repair" }, "reconcile:INBOX");
    // Degrade lands before the row is marked failed (Grok M6 on #50).
    const degradeOrder = vi.mocked(degradeReconcileOp).mock.invocationCallOrder[0]!;
    const failedCall = vi.mocked(updateOperationStatus).mock.calls.findIndex((c) => c[1] === "failed");
    expect(vi.mocked(updateOperationStatus).mock.invocationCallOrder[failedCall]!).toBeGreaterThan(degradeOrder);
  });

  it("degrades a reconcile op with unparsable params from its resource id, and still marks it failed if the degrade itself throws", async () => {
    const { degradeReconcileOp } = await import("../imap/reconcileOp");
    const spent = {
      id: "op-b",
      account_id: "acct-1",
      operation_type: "reconcile",
      resource_id: "reconcile:INBOX",
      params: "not json",
      status: "pending",
      retry_count: 0,
      max_retries: 3,
      next_retry_at: null,
      created_at: 1000,
      error_message: null,
    };
    vi.mocked(getPendingOperations).mockResolvedValueOnce([spent]);
    vi.mocked(executeQueuedAction).mockRejectedValueOnce(new Error("Bad request"));
    vi.mocked(degradeReconcileOp).mockRejectedValueOnce(new Error("db closed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await triggerQueueFlush();

    expect(degradeReconcileOp).toHaveBeenCalledWith("acct-1", null, "reconcile:INBOX");
    expect(updateOperationStatus).toHaveBeenCalledWith("op-b", "failed", "error");
  });

  it("does not degrade a user op the same way: it keeps retrying under incrementRetry", async () => {
    const { degradeReconcileOp } = await import("../imap/reconcileOp");
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-u",
        account_id: "acct-1",
        operation_type: "archive",
        resource_id: "t1",
        params: '{"threadId":"t1","messageIds":[]}',
        status: "pending",
        retry_count: 9,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);
    vi.mocked(executeQueuedAction).mockRejectedValueOnce(new Error("Failed to fetch"));
    vi.mocked(classifyError).mockReturnValueOnce({ type: "network", isRetryable: true, message: "Failed to fetch" });

    await triggerQueueFlush();

    expect(incrementRetry).toHaveBeenCalledWith("op-u");
    expect(degradeReconcileOp).not.toHaveBeenCalled();
  });

  it("updates pending count after processing", async () => {
    await triggerQueueFlush();
    expect(mockSetPendingOpsCount).toHaveBeenCalledWith(0);
  });

  it("start and stop work without errors", () => {
    startQueueProcessor();
    stopQueueProcessor();
  });
});
