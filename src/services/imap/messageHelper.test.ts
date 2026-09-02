import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  groupMessagesByFolder,
  securityToConfigType,
  type ImapMessageInfo,
} from "./messageHelper";

// Mock the DB module
vi.mock("../db/connection", () => ({
  getDb: vi.fn(),
}));

describe("messageHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("groupMessagesByFolder", () => {
    it("groups messages by their folder", () => {
      const messages = new Map<string, ImapMessageInfo>([
        ["msg1", { uid: 100, folder: "INBOX" }],
        ["msg2", { uid: 200, folder: "INBOX" }],
        ["msg3", { uid: 300, folder: "Sent" }],
        ["msg4", { uid: 400, folder: "Drafts" }],
      ]);

      const grouped = groupMessagesByFolder(messages);

      expect(grouped.size).toBe(3);
      expect(grouped.get("INBOX")).toEqual([100, 200]);
      expect(grouped.get("Sent")).toEqual([300]);
      expect(grouped.get("Drafts")).toEqual([400]);
    });

    it("returns empty map for empty input", () => {
      const messages = new Map<string, ImapMessageInfo>();
      const grouped = groupMessagesByFolder(messages);
      expect(grouped.size).toBe(0);
    });

    it("handles single message", () => {
      const messages = new Map<string, ImapMessageInfo>([
        ["msg1", { uid: 42, folder: "Archive" }],
      ]);

      const grouped = groupMessagesByFolder(messages);
      expect(grouped.size).toBe(1);
      expect(grouped.get("Archive")).toEqual([42]);
    });
  });

  describe("securityToConfigType", () => {
    it("maps 'ssl' to 'tls'", () => {
      expect(securityToConfigType("ssl")).toBe("tls");
    });

    it("maps 'starttls' to 'starttls'", () => {
      expect(securityToConfigType("starttls")).toBe("starttls");
    });

    it("maps 'none' to 'none'", () => {
      expect(securityToConfigType("none")).toBe("none");
    });

    it("defaults to 'tls' for unknown values", () => {
      expect(securityToConfigType("unknown")).toBe("tls");
      expect(securityToConfigType("")).toBe("tls");
    });
  });

  describe("getImapUidsForMessages", () => {
    it("returns empty map for empty input", async () => {
      const { getImapUidsForMessages } = await import("./messageHelper");
      const result = await getImapUidsForMessages("acc1", []);
      expect(result.size).toBe(0);
    });
  });

  describe("findSpecialFolder", () => {
    it("returns null when no matching folder exists", async () => {
      const { getDb } = await import("../db/connection");
      const mockDb = {
        select: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      const { findSpecialFolder } = await import("./messageHelper");
      const result = await findSpecialFolder("acc1", "\\Trash");
      expect(result).toBeNull();
    });

    it("falls back to label ID lookup when imap_special_use not found", async () => {
      const { getDb } = await import("../db/connection");
      const mockDb = {
        select: vi.fn()
          .mockResolvedValueOnce([]) // first query: imap_special_use lookup → empty
          .mockResolvedValueOnce([{ imap_folder_path: "unsolbox", name: "Trash" }]), // fallback: label ID lookup
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      const { findSpecialFolder } = await import("./messageHelper");
      const result = await findSpecialFolder("acc1", "\\Trash");
      expect(result).toBe("unsolbox");
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it("returns imap_folder_path when available", async () => {
      const { getDb } = await import("../db/connection");
      const mockDb = {
        select: vi.fn().mockResolvedValue([
          { imap_folder_path: "INBOX.Trash", name: "Trash" },
        ]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      const { findSpecialFolder } = await import("./messageHelper");
      const result = await findSpecialFolder("acc1", "\\Trash");
      expect(result).toBe("INBOX.Trash");
    });

    it("falls back to name when imap_folder_path is null", async () => {
      const { getDb } = await import("../db/connection");
      const mockDb = {
        select: vi.fn().mockResolvedValue([
          { imap_folder_path: null, name: "Trash" },
        ]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      const { findSpecialFolder } = await import("./messageHelper");
      const result = await findSpecialFolder("acc1", "\\Trash");
      expect(result).toBe("Trash");
    });
  });

  describe("dropTombstonedMessageIds (F-5)", () => {
    it("does nothing for an empty list", async () => {
      const { getDb } = await import("../db/connection");
      const mockDb = { select: vi.fn() };
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      const { dropTombstonedMessageIds } = await import("./messageHelper");
      await expect(dropTombstonedMessageIds("acc1", [])).resolves.toEqual([]);
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it("drops only the ids whose rows are tombstoned; unknown ids pass through in order", async () => {
      const { getDb } = await import("../db/connection");
      const mockDb = {
        select: vi.fn().mockResolvedValue([{ id: "msg2" }]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as never);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { dropTombstonedMessageIds } = await import("./messageHelper");
      const kept = await dropTombstonedMessageIds("acc1", ["msg1", "msg2", "msg3"]);

      // msg1 and msg3 are not in the database at all (deleted locally before
      // the provider call, or re-keyed away) — they must still be sent.
      expect(kept).toEqual(["msg1", "msg3"]);
      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringMatching(/WHERE account_id = \$1 AND id IN \(\$2, \$3, \$4\) AND moved_to IS NOT NULL/),
        ["acc1", "msg1", "msg2", "msg3"],
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Skipping 1"), ["msg2"]);
      warn.mockRestore();
    });

    it("returns the input untouched when nothing is tombstoned", async () => {
      const { getDb } = await import("../db/connection");
      const mockDb = { select: vi.fn().mockResolvedValue([]) };
      vi.mocked(getDb).mockResolvedValue(mockDb as never);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { dropTombstonedMessageIds } = await import("./messageHelper");
      await expect(dropTombstonedMessageIds("acc1", ["a", "b"])).resolves.toEqual(["a", "b"]);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("chunks large batches to stay within SQLite's bound-parameter limit", async () => {
      const { getDb } = await import("../db/connection");
      const mockDb = { select: vi.fn().mockResolvedValue([]) };
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      const { dropTombstonedMessageIds } = await import("./messageHelper");
      const ids = Array.from({ length: 1200 }, (_, i) => `msg-${i}`);
      await dropTombstonedMessageIds("acc1", ids);

      expect(mockDb.select).toHaveBeenCalledTimes(3);
      expect(mockDb.select.mock.calls[2]![1]).toHaveLength(201); // account + 200 ids
    });
  });
});
