/**
 * The navigation half of the email actions (audit P13).
 *
 * `emailActions.ts` used to navigate directly, which is why `services →
 * router → routeTree → App` existed and why 54 import cycles ran through it.
 * The service now only *reports* `nextThreadId`; this adapter performs the
 * navigation. These tests own the behaviour that moved, so it is still covered
 * after the decoupling rather than merely deleted along with the old assertions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("@/services/emailActions", () => ({
  executeEmailAction: (...args: unknown[]) => mockExecute(...args),
}));

vi.mock("@/router/navigate", () => ({
  navigateToThread: vi.fn(),
  getSelectedThreadId: vi.fn(() => null),
}));

import { runEmailAction, archiveThread, trashThread } from "./useEmailActions";
import { navigateToThread, getSelectedThreadId } from "@/router/navigate";

describe("useEmailActions adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ success: true });
  });

  it("passes the current selection into the service", async () => {
    vi.mocked(getSelectedThreadId).mockReturnValue("t2");

    await runEmailAction("acct-1", {
      type: "archive",
      threadId: "t2",
      messageIds: [],
    });

    // Third argument is the selection the service can no longer read itself.
    expect(mockExecute).toHaveBeenCalledWith(
      "acct-1",
      expect.objectContaining({ type: "archive", threadId: "t2" }),
      "t2",
    );
  });

  it("navigates when the service reports a next thread", async () => {
    mockExecute.mockResolvedValue({ success: true, nextThreadId: "t3" });

    await runEmailAction("acct-1", {
      type: "archive",
      threadId: "t2",
      messageIds: [],
    });

    expect(navigateToThread).toHaveBeenCalledWith("t3");
  });

  it("does not navigate when no next thread is reported", async () => {
    mockExecute.mockResolvedValue({ success: true });

    await runEmailAction("acct-1", {
      type: "star",
      threadId: "t2",
      starred: true,
    });

    expect(navigateToThread).not.toHaveBeenCalled();
  });

  it("does not navigate on a failed action", async () => {
    mockExecute.mockResolvedValue({ success: false, error: "boom" });

    const result = await runEmailAction("acct-1", {
      type: "trash",
      threadId: "t2",
      messageIds: [],
    });

    expect(navigateToThread).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("returns the service result unchanged", async () => {
    const serviceResult = { success: true, queued: true, nextThreadId: "t9" };
    mockExecute.mockResolvedValue(serviceResult);

    const result = await runEmailAction("acct-1", {
      type: "archive",
      threadId: "t1",
      messageIds: [],
    });

    expect(result).toEqual(serviceResult);
  });

  describe("UI wrappers keep the service wrapper signatures", () => {
    it("archiveThread builds the right action and navigates", async () => {
      vi.mocked(getSelectedThreadId).mockReturnValue("t1");
      mockExecute.mockResolvedValue({ success: true, nextThreadId: "t2" });

      await archiveThread("acct-1", "t1", ["m1"]);

      expect(mockExecute).toHaveBeenCalledWith(
        "acct-1",
        { type: "archive", threadId: "t1", messageIds: ["m1"] },
        "t1",
      );
      expect(navigateToThread).toHaveBeenCalledWith("t2");
    });

    it("trashThread builds the right action", async () => {
      // Set explicitly: `clearAllMocks` clears calls but NOT implementations,
      // so a `mockReturnValue` from a previous test would leak into this one.
      vi.mocked(getSelectedThreadId).mockReturnValue(null);

      await trashThread("acct-1", "t5", ["m9"]);

      expect(mockExecute).toHaveBeenCalledWith(
        "acct-1",
        { type: "trash", threadId: "t5", messageIds: ["m9"] },
        null,
      );
    });
  });
});
