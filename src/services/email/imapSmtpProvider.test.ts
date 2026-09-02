import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImapSmtpProvider } from "./imapSmtpProvider";
import { useUIStore } from "@/stores/uiStore";

// Mock all external dependencies
vi.mock("../db/accounts", () => ({
  getAccount: vi.fn(),
}));

vi.mock("../imap/imapConfigBuilder", () => ({
  buildImapConfig: vi.fn(),
  buildSmtpConfig: vi.fn(),
}));

vi.mock("../imap/imapSync", () => ({
  imapInitialSync: vi.fn(),
  imapDeltaSync: vi.fn(),
  imapMessageToParsedMessage: vi.fn(),
}));

vi.mock("../imap/folderMapper", () => ({
  mapFolderToLabel: vi.fn(),
  getSyncableFolders: vi.fn(),
}));

vi.mock("../imap/sessionManager", () => ({
  // The pool is exercised in Rust (imap::pool) and in sessionManager.test.ts.
  // Here it stands aside: run the operation against a fixed session id so these
  // tests keep asserting sync behaviour rather than session plumbing.
  withSession: vi.fn(
    async (
      _accountId: string,
      _kind: string,
      _opts: { retrySafe?: boolean },
      fn: (id: string) => Promise<unknown>,
    ) => fn("test-session"),
  ),
  invalidateAccountCredentials: vi.fn(async () => {}),
  closeAccountSessions: vi.fn(async () => {}),
}));
vi.mock("../imap/tauriCommands", () => ({
  imapListFolders: vi.fn(),
  imapSetFlags: vi.fn(),
  imapMoveMessages: vi.fn(),
  imapDeleteMessages: vi.fn(),
  imapFetchMessageBody: vi.fn(),
  imapFetchAttachment: vi.fn(),
  imapFetchRawMessage: vi.fn(),
  imapTestConnection: vi.fn(),
  imapAppendMessage: vi.fn(),
  smtpSendEmail: vi.fn(),
  smtpTestConnection: vi.fn(),
}));

vi.mock("../imap/messageHelper", () => ({
  findSpecialFolder: vi.fn(),
  // F-5: every action filters to live rows first. Pass-through by default so
  // the existing action tests keep asserting protocol behaviour; the F-5 block
  // below overrides it where the filter is the thing under test.
  dropTombstonedMessageIds: vi.fn(async (_accountId: string, ids: string[]) => ids),
}));

vi.mock("../imap/moveHygiene", () => ({
  settleMovedRows: vi.fn(async () => {}),
}));

vi.mock("../db/messages", () => ({
  upsertMessage: vi.fn(),
}));

vi.mock("../db/threads", () => ({
  upsertThread: vi.fn(),
  setThreadLabels: vi.fn(),
  getThreadLabelIds: vi.fn().mockResolvedValue([]),
}));

import { getAccount } from "../db/accounts";
import { buildImapConfig, buildSmtpConfig } from "../imap/imapConfigBuilder";
import { mapFolderToLabel, getSyncableFolders } from "../imap/folderMapper";
import {
  imapListFolders,
  imapSetFlags,
  imapMoveMessages,
  imapDeleteMessages,
  imapTestConnection,
  imapAppendMessage,
  smtpSendEmail,
  smtpTestConnection,
} from "../imap/tauriCommands";
import { invalidateAccountCredentials } from "../imap/sessionManager";
import { findSpecialFolder, dropTombstonedMessageIds } from "../imap/messageHelper";
import { settleMovedRows } from "../imap/moveHygiene";
import { upsertMessage } from "../db/messages";
import { upsertThread, setThreadLabels, getThreadLabelIds } from "../db/threads";

const mockImapConfig = {
  host: "imap.example.com",
  port: 993,
  security: "tls" as const,
  username: "user@example.com",
  password: "secret",
  auth_method: "password" as const,
};

const mockSmtpConfig = {
  host: "smtp.example.com",
  port: 587,
  security: "starttls" as const,
  username: "user@example.com",
  password: "secret",
  auth_method: "password" as const,
};

const mockAccount = {
  id: "acc-1",
  email: "user@example.com",
  display_name: "Test User",
  imap_host: "imap.example.com",
  imap_port: 993,
  imap_security: "ssl",
  smtp_host: "smtp.example.com",
  smtp_port: 587,
  smtp_security: "starttls",
  auth_method: "password",
  imap_password: "secret",
  oauth_provider: null,
  oauth_client_id: null,
  oauth_client_secret: null,
};

describe("ImapSmtpProvider", () => {
  let provider: ImapSmtpProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ImapSmtpProvider("acc-1");

    vi.mocked(getAccount).mockResolvedValue(mockAccount as never);
    vi.mocked(buildImapConfig).mockReturnValue(mockImapConfig);
    vi.mocked(buildSmtpConfig).mockReturnValue(mockSmtpConfig);
  });

  it("has correct accountId and type", () => {
    expect(provider.accountId).toBe("acc-1");
    expect(provider.type).toBe("imap");
  });

  // ---------- Folder operations ----------

  describe("listFolders", () => {
    it("calls imapListFolders and maps results", async () => {
      const rawFolders = [
        {
          path: "INBOX",
          name: "INBOX",
          delimiter: "/",
          special_use: "\\Inbox",
          exists: 42,
          unseen: 5,
        },
        {
          path: "Sent",
          name: "Sent",
          delimiter: "/",
          special_use: "\\Sent",
          exists: 100,
          unseen: 0,
        },
      ];

      vi.mocked(imapListFolders).mockResolvedValue(rawFolders);
      vi.mocked(getSyncableFolders).mockReturnValue(rawFolders);
      vi.mocked(mapFolderToLabel).mockImplementation((f) => ({
        labelId: f.path,
        labelName: f.name,
        type: f.special_use ? "system" : "user",
      }));

      const folders = await provider.listFolders();

      // E2/P15: the provider hands a pooled session id, not a config.
      expect(imapListFolders).toHaveBeenCalledWith("test-session");
      expect(folders).toHaveLength(2);
      expect(folders[0]).toEqual({
        id: "INBOX",
        name: "INBOX",
        path: "INBOX",
        type: "system",
        specialUse: "\\Inbox",
        delimiter: "/",
        messageCount: 42,
        unreadCount: 5,
      });
    });
  });

  describe("createFolder", () => {
    it("throws an informative error", async () => {
      await expect(provider.createFolder("test")).rejects.toThrow(
        "not supported",
      );
    });
  });

  describe("deleteFolder", () => {
    it("throws an informative error", async () => {
      await expect(provider.deleteFolder("test")).rejects.toThrow(
        "not supported",
      );
    });
  });

  describe("renameFolder", () => {
    it("throws an informative error", async () => {
      await expect(provider.renameFolder("old", "new")).rejects.toThrow(
        "not supported",
      );
    });
  });

  // ---------- Raw message ----------

  describe("fetchRawMessage", () => {
    it("parses IMAP message ID and calls imapFetchRawMessage", async () => {
      const { imapFetchRawMessage } = await import("../imap/tauriCommands");
      vi.mocked(imapFetchRawMessage).mockResolvedValue("From: test@example.com\r\nSubject: Hello\r\n\r\nBody");

      const result = await provider.fetchRawMessage("imap-acc-1-INBOX-42");

      expect(imapFetchRawMessage).toHaveBeenCalledWith("test-session", "INBOX", 42);
      expect(result).toBe("From: test@example.com\r\nSubject: Hello\r\n\r\nBody");
    });

    it("throws for invalid message ID format", async () => {
      await expect(provider.fetchRawMessage("invalid-id")).rejects.toThrow(
        "Invalid IMAP message ID format",
      );
    });
  });

  // ---------- Actions ----------

  describe("move-time row hygiene (F-5)", () => {
    beforeEach(() => {
      vi.mocked(dropTombstonedMessageIds).mockImplementation(async (_a, ids) => ids);
      vi.mocked(findSpecialFolder).mockResolvedValue("Archive");
    });

    it("settles the local rows with the server's COPYUID mapping after a move", async () => {
      const mapping = [
        { source_uid: 100, dest_uid: 7 },
        { source_uid: 200, dest_uid: 8 },
      ];
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true, mapping });

      await provider.archive("thread-1", ["imap-acc-1-INBOX-100", "imap-acc-1-INBOX-200"]);

      expect(settleMovedRows).toHaveBeenCalledWith("acc-1", "INBOX", "Archive", [100, 200], mapping, null);
    });

    it("passes the destination UIDVALIDITY through with the mapping", async () => {
      vi.mocked(imapMoveMessages).mockResolvedValue({
        expunged: true,
        mapping: [{ source_uid: 100, dest_uid: 7 }],
        dest_uidvalidity: 4242,
      });

      await provider.archive("thread-1", ["imap-acc-1-INBOX-100"]);

      expect(settleMovedRows).toHaveBeenCalledWith(
        "acc-1",
        "INBOX",
        "Archive",
        [100],
        [{ source_uid: 100, dest_uid: 7 }],
        4242,
      );
    });

    it("settles with a null mapping when the server gave none, so the rows are hidden rather than left stale", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Trash");
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: false, mapping: null, dest_uidvalidity: null });

      await provider.trash("thread-1", ["imap-acc-1-INBOX-100"]);

      expect(findSpecialFolder).toHaveBeenCalledWith("acc-1", "\\Trash");
      expect(settleMovedRows).toHaveBeenCalledWith("acc-1", "INBOX", "Trash", [100], null, null);
    });

    it("settles the rows even if raising the not-expunged notice throws, and still raises it after settling", async () => {
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: false, mapping: null, dest_uidvalidity: null });
      const order: string[] = [];
      vi.mocked(settleMovedRows).mockImplementation(async () => {
        order.push("settle");
      });
      const addNotice = useUIStore.getState().addNotice;
      useUIStore.setState({
        addNotice: (n) => {
          order.push("notice");
          addNotice(n);
        },
      });

      await provider.archive("thread-1", ["imap-acc-1-INBOX-100"]);

      expect(order).toEqual(["settle", "notice"]);
      useUIStore.setState({ addNotice });
    });

    it.each([
      ["spam", (ids: string[]) => provider.spam("t", ids, true), "Archive"],
      ["moveToFolder", (ids: string[]) => provider.moveToFolder("t", ids, "Projects"), "Projects"],
    ])("settles after %s", async (_name, run, destination) => {
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true, mapping: [], dest_uidvalidity: null });

      await run(["imap-acc-1-INBOX-5"]);

      expect(settleMovedRows).toHaveBeenCalledWith("acc-1", "INBOX", destination, [5], [], null);
    });

    it("does not settle a folder it skipped because the mail was already there", async () => {
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true, mapping: [] });

      await provider.archive("thread-1", ["imap-acc-1-Archive-100"]);

      expect(imapMoveMessages).not.toHaveBeenCalled();
      expect(settleMovedRows).not.toHaveBeenCalled();
    });

    it("drops ids whose local rows are tombstoned before touching the server", async () => {
      // The mock drops INBOX/100 as a tombstone — a COPY-fallback row whose
      // old folder/UID is the wrong target F-5 exists to stop acting on.
      vi.mocked(dropTombstonedMessageIds).mockResolvedValue(["imap-acc-1-INBOX-200"]);
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true, mapping: [] });

      await provider.archive("thread-1", ["imap-acc-1-INBOX-100", "imap-acc-1-INBOX-200"]);

      expect(dropTombstonedMessageIds).toHaveBeenCalledWith("acc-1", [
        "imap-acc-1-INBOX-100",
        "imap-acc-1-INBOX-200",
      ]);
      expect(imapMoveMessages).toHaveBeenCalledWith("test-session", "INBOX", [200], "Archive");
    });

    it("drops tombstoned ids from every action, not only the moves", async () => {
      // The requirement: a tombstone names a folder/UID the server no longer
      // has for this message, so no action may be sent for it.
      vi.mocked(dropTombstonedMessageIds).mockImplementation(async (_a, ids) =>
        ids.filter((id) => id !== "imap-acc-1-INBOX-1"),
      );
      vi.mocked(imapDeleteMessages).mockResolvedValue({ expunged: true });

      await provider.markRead("t", ["imap-acc-1-INBOX-1", "imap-acc-1-INBOX-2"], true);
      await provider.star("t", ["imap-acc-1-INBOX-1"], true);
      await provider.permanentDelete("t", ["imap-acc-1-INBOX-1", "imap-acc-1-INBOX-2"]);

      expect(imapSetFlags).toHaveBeenCalledTimes(1);
      expect(imapSetFlags).toHaveBeenCalledWith("test-session", "INBOX", [2], ["Seen"], true);
      expect(imapDeleteMessages).toHaveBeenCalledWith("test-session", "INBOX", [2]);
    });

    it("permanent delete still reaches the server when the local rows are already gone (Opus HIGH 1)", async () => {
      // `executeEmailAction` deletes the thread locally — cascading to its
      // messages — *before* calling the provider. The filter must therefore
      // pass ids with no local row through, or permanent delete becomes a
      // client-side no-op and the mail comes back on the next sync.
      vi.mocked(dropTombstonedMessageIds).mockImplementation(async (_a, ids) => ids);
      vi.mocked(imapDeleteMessages).mockResolvedValue({ expunged: true });

      await provider.permanentDelete("t", ["imap-acc-1-INBOX-7"]);

      expect(imapDeleteMessages).toHaveBeenCalledWith("test-session", "INBOX", [7]);
    });

    it("settles before moving on to the next folder, and still completes if settling is slow", async () => {
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true, mapping: [] });
      const order: string[] = [];
      vi.mocked(settleMovedRows).mockImplementation(async (_a, folder) => {
        order.push(`settle:${folder}`);
      });
      vi.mocked(imapMoveMessages).mockImplementation(async (_s, folder) => {
        order.push(`move:${folder}`);
        return { expunged: true, mapping: [] };
      });

      await provider.archive("thread-1", ["imap-acc-1-INBOX-1", "imap-acc-1-Sent-2"]);

      expect(order).toEqual(["move:INBOX", "settle:INBOX", "move:Sent", "settle:Sent"]);
    });
  });

  describe("archive", () => {
    it("moves messages to Archive folder", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Archive");
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true });

      await provider.archive("thread-1", [
        "imap-acc-1-INBOX-100",
        "imap-acc-1-INBOX-200",
      ]);

      expect(findSpecialFolder).toHaveBeenCalledWith("acc-1", "\\Archive");
      expect(imapMoveMessages).toHaveBeenCalledWith(
        "test-session",
        "INBOX",
        [100, 200],
        "Archive",
      );
    });

    it("skips messages already in Archive", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Archive");
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true });

      await provider.archive("thread-1", ["imap-acc-1-Archive-100"]);

      expect(imapMoveMessages).not.toHaveBeenCalled();
    });

    it("falls back to 'Archive' when special folder not found", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue(null);
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true });

      await provider.archive("thread-1", ["imap-acc-1-INBOX-100"]);

      expect(imapMoveMessages).toHaveBeenCalledWith(
        "test-session",
        "INBOX",
        [100],
        "Archive",
      );
    });
  });

  describe("trash", () => {
    it("moves messages to Trash folder", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Deleted Items");
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true });

      await provider.trash("thread-1", ["imap-acc-1-INBOX-100"]);

      expect(findSpecialFolder).toHaveBeenCalledWith("acc-1", "\\Trash");
      expect(imapMoveMessages).toHaveBeenCalledWith(
        "test-session",
        "INBOX",
        [100],
        "Deleted Items",
      );
    });
  });

  describe("permanentDelete", () => {
    it("calls imapDeleteMessages for each folder group", async () => {
      vi.mocked(imapDeleteMessages).mockResolvedValue({ expunged: true });

      await provider.permanentDelete("thread-1", [
        "imap-acc-1-INBOX-100",
        "imap-acc-1-Sent-200",
      ]);

      expect(imapDeleteMessages).toHaveBeenCalledTimes(2);
      expect(imapDeleteMessages).toHaveBeenCalledWith(
        "test-session",
        "INBOX",
        [100],
      );
      expect(imapDeleteMessages).toHaveBeenCalledWith(
        "test-session",
        "Sent",
        [200],
      );
    });
  });

  describe("markRead", () => {
    it("sets Seen flag when read=true", async () => {
      vi.mocked(imapSetFlags).mockResolvedValue(undefined);

      await provider.markRead("thread-1", ["imap-acc-1-INBOX-100"], true);

      expect(imapSetFlags).toHaveBeenCalledWith(
        "test-session",
        "INBOX",
        [100],
        ["Seen"],
        true,
      );
    });

    it("removes Seen flag when read=false", async () => {
      vi.mocked(imapSetFlags).mockResolvedValue(undefined);

      await provider.markRead("thread-1", ["imap-acc-1-INBOX-100"], false);

      expect(imapSetFlags).toHaveBeenCalledWith(
        "test-session",
        "INBOX",
        [100],
        ["Seen"],
        false,
      );
    });
  });

  describe("star", () => {
    it("sets Flagged flag when starred=true", async () => {
      vi.mocked(imapSetFlags).mockResolvedValue(undefined);

      await provider.star("thread-1", ["imap-acc-1-INBOX-100"], true);

      expect(imapSetFlags).toHaveBeenCalledWith(
        "test-session",
        "INBOX",
        [100],
        ["Flagged"],
        true,
      );
    });
  });

  describe("spam", () => {
    it("moves to Junk when isSpam=true", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Junk E-Mail");
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true });

      await provider.spam("thread-1", ["imap-acc-1-INBOX-100"], true);

      expect(imapMoveMessages).toHaveBeenCalledWith(
        "test-session",
        "INBOX",
        [100],
        "Junk E-Mail",
      );
    });

    it("moves to INBOX when isSpam=false", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Junk");
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true });

      await provider.spam("thread-1", ["imap-acc-1-Junk-100"], false);

      expect(imapMoveMessages).toHaveBeenCalledWith(
        "test-session",
        "Junk",
        [100],
        "INBOX",
      );
    });
  });

  describe("moveToFolder", () => {
    it("moves messages to specified folder", async () => {
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true });

      await provider.moveToFolder("thread-1", ["imap-acc-1-INBOX-100"], "Work");

      expect(imapMoveMessages).toHaveBeenCalledWith(
        "test-session",
        "INBOX",
        [100],
        "Work",
      );
    });

    it("skips messages already in target folder", async () => {
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true });

      await provider.moveToFolder(
        "thread-1",
        ["imap-acc-1-Work-100"],
        "Work",
      );

      expect(imapMoveMessages).not.toHaveBeenCalled();
    });
  });

  describe("addLabel / removeLabel", () => {
    it("addLabel does not throw (warns instead)", async () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await provider.addLabel("thread-1", "Label_1");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("removeLabel does not throw (warns instead)", async () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await provider.removeLabel("thread-1", "Label_1");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ---------- Send / Draft operations ----------

  describe("sendMessage", () => {
    // A valid base64url-encoded RFC 2822 email for testing
    const rawEmail = "From: user@example.com\r\nTo: bob@example.com\r\nSubject: Test\r\nDate: Thu, 20 Feb 2025 12:00:00 GMT\r\nMessage-ID: <test123@example.com>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nHello World";
    const rawBase64Url = btoa(rawEmail).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    it("sends via SMTP, saves locally, and copies to Sent folder", async () => {
      vi.mocked(smtpSendEmail).mockResolvedValue({
        success: true,
        message: "OK",
      });
      vi.mocked(findSpecialFolder).mockResolvedValue("Sent Items");
      vi.mocked(imapAppendMessage).mockResolvedValue(undefined);

      const result = await provider.sendMessage(rawBase64Url);

      expect(smtpSendEmail).toHaveBeenCalledWith(mockSmtpConfig, rawBase64Url);
      // Should save message to local DB
      expect(upsertThread).toHaveBeenCalled();
      expect(setThreadLabels).toHaveBeenCalledWith(
        "acc-1",
        expect.stringMatching(/^imap-sent-/),
        ["SENT"],
      );
      expect(upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-1",
          fromAddress: "user@example.com",
          toAddresses: "bob@example.com",
          subject: "Test",
          isRead: true,
        }),
      );
      // Should copy to server Sent folder
      expect(imapAppendMessage).toHaveBeenCalledWith(
        "test-session",
        "Sent Items",
        rawBase64Url,
        ["Seen"],
      );
      expect(result.id).toMatch(/^imap-sent-/);
    });

    it("adds SENT label to existing thread when replying", async () => {
      vi.mocked(smtpSendEmail).mockResolvedValue({
        success: true,
        message: "OK",
      });
      vi.mocked(findSpecialFolder).mockResolvedValue("Sent");
      vi.mocked(imapAppendMessage).mockResolvedValue(undefined);
      vi.mocked(getThreadLabelIds).mockResolvedValue(["INBOX"]);

      const result = await provider.sendMessage(rawBase64Url, "existing-thread-1");

      // Should add SENT to existing labels
      expect(setThreadLabels).toHaveBeenCalledWith(
        "acc-1",
        "existing-thread-1",
        ["INBOX", "SENT"],
      );
      // Should NOT create a new thread (reply uses existing thread)
      expect(upsertThread).not.toHaveBeenCalled();
      // Should save message with existing thread ID
      expect(upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "existing-thread-1",
        }),
      );
      expect(result.id).toMatch(/^imap-sent-/);
    });

    it("throws if SMTP send fails", async () => {
      vi.mocked(smtpSendEmail).mockResolvedValue({
        success: false,
        message: "Authentication failed",
      });

      await expect(provider.sendMessage(rawBase64Url)).rejects.toThrow(
        "SMTP send failed: Authentication failed",
      );
    });

    it("succeeds even if Sent folder copy fails", async () => {
      vi.mocked(smtpSendEmail).mockResolvedValue({
        success: true,
        message: "OK",
      });
      vi.mocked(findSpecialFolder).mockResolvedValue("Sent");
      vi.mocked(imapAppendMessage).mockRejectedValue(
        new Error("APPEND failed"),
      );

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await provider.sendMessage(rawBase64Url);
      expect(result.id).toMatch(/^imap-sent-/);
      // Should still have saved locally
      expect(upsertMessage).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("createDraft", () => {
    it("appends to Drafts folder with Draft flag", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("INBOX.Drafts");
      vi.mocked(imapAppendMessage).mockResolvedValue(undefined);

      const result = await provider.createDraft("base64data");

      expect(imapAppendMessage).toHaveBeenCalledWith(
        "test-session",
        "INBOX.Drafts",
        "base64data",
        ["Draft"],
      );
      expect(result.draftId).toMatch(/^imap-draft-/);
    });

    it("falls back to 'Drafts' when special folder not found", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue(null);
      vi.mocked(imapAppendMessage).mockResolvedValue(undefined);

      await provider.createDraft("base64data");

      expect(imapAppendMessage).toHaveBeenCalledWith(
        "test-session",
        "Drafts",
        "base64data",
        ["Draft"],
      );
    });
  });

  describe("updateDraft", () => {
    it("deletes old draft and creates new one", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Drafts");
      vi.mocked(imapDeleteMessages).mockResolvedValue({ expunged: true });
      vi.mocked(imapAppendMessage).mockResolvedValue(undefined);

      const result = await provider.updateDraft(
        "imap-acc-1-Drafts-500",
        "newBase64data",
      );

      // Should delete old draft
      expect(imapDeleteMessages).toHaveBeenCalledWith(
        "test-session",
        "Drafts",
        [500],
      );
      // Should create new draft
      expect(imapAppendMessage).toHaveBeenCalledWith(
        "test-session",
        "Drafts",
        "newBase64data",
        ["Draft"],
      );
      expect(result.draftId).toMatch(/^imap-draft-/);
    });
  });

  describe("deleteDraft", () => {
    it("deletes draft by parsed message ID", async () => {
      vi.mocked(imapDeleteMessages).mockResolvedValue({ expunged: true });

      await provider.deleteDraft("imap-acc-1-Drafts-500");

      expect(imapDeleteMessages).toHaveBeenCalledWith(
        "test-session",
        "Drafts",
        [500],
      );
    });

    it("warns for generated draft IDs that cannot be deleted", async () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await provider.deleteDraft("imap-draft-1234567890-abc");

      expect(imapDeleteMessages).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ---------- Connection / Profile ----------

  describe("testConnection", () => {
    it("tests both IMAP and SMTP", async () => {
      vi.mocked(imapTestConnection).mockResolvedValue("OK");
      vi.mocked(smtpTestConnection).mockResolvedValue({
        success: true,
        message: "OK",
      });

      const result = await provider.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toContain("Connected");
      expect(imapTestConnection).toHaveBeenCalledWith(mockImapConfig);
      expect(smtpTestConnection).toHaveBeenCalledWith(mockSmtpConfig);
    });

    it("reports SMTP failure even if IMAP succeeds", async () => {
      vi.mocked(imapTestConnection).mockResolvedValue("OK");
      vi.mocked(smtpTestConnection).mockResolvedValue({
        success: false,
        message: "Auth failed",
      });

      const result = await provider.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("SMTP failed");
    });

    it("reports IMAP failure", async () => {
      vi.mocked(imapTestConnection).mockRejectedValue(
        new Error("Connection refused"),
      );

      const result = await provider.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("IMAP connection failed");
    });
  });

  describe("getProfile", () => {
    it("returns email and name from DB account", async () => {
      const profile = await provider.getProfile();

      expect(profile.email).toBe("user@example.com");
      expect(profile.name).toBe("Test User");
    });

    it("throws if account not found", async () => {
      vi.mocked(getAccount).mockResolvedValue(null);

      await expect(provider.getProfile()).rejects.toThrow("not found");
    });
  });

  // ---------- Config caching ----------

  describe("config caching", () => {
    // These used to drive the cache through markRead. Under E2/P15 no message
    // operation builds a config any more — they take a pooled session id — so
    // `testConnection` is the only path left that does, and it is the right one:
    // it runs during account setup, before a session can exist.
    beforeEach(() => {
      vi.mocked(imapTestConnection).mockResolvedValue("ok");
      vi.mocked(smtpTestConnection).mockResolvedValue({ success: true, message: "ok" });
    });

    it("caches the IMAP config after the first build", async () => {
      await provider.testConnection();
      await provider.testConnection();

      expect(buildImapConfig).toHaveBeenCalledTimes(1);
    });

    it("clearConfigCache forces a rebuild", async () => {
      await provider.testConnection();
      provider.clearConfigCache();
      await provider.testConnection();

      expect(buildImapConfig).toHaveBeenCalledTimes(2);
    });

    it("clearConfigCache also drops the account's pooled sessions", async () => {
      // The credential changed; a session authenticated with the old one must
      // not keep being served. Fire-and-forget, so this asserts the call rather
      // than awaiting it.
      provider.clearConfigCache();

      expect(invalidateAccountCredentials).toHaveBeenCalledWith("acc-1");
    });

    it("no message operation builds a config any more", async () => {
      // The point of the pool: credentials cross the boundary once, at session
      // open, not on every archive.
      vi.mocked(imapSetFlags).mockResolvedValue(undefined);

      await provider.markRead("t1", ["imap-acc-1-INBOX-100"], true);

      expect(buildImapConfig).not.toHaveBeenCalled();
    });
  });

  // ---------- Message ID parsing ----------

  describe("groupByFolder (via actions)", () => {
    it("groups messages from different folders", async () => {
      vi.mocked(imapDeleteMessages).mockResolvedValue({ expunged: true });

      await provider.permanentDelete("thread-1", [
        "imap-acc-1-INBOX-100",
        "imap-acc-1-INBOX-200",
        "imap-acc-1-Sent-300",
      ]);

      expect(imapDeleteMessages).toHaveBeenCalledTimes(2);
      expect(imapDeleteMessages).toHaveBeenCalledWith(
        "test-session",
        "INBOX",
        [100, 200],
      );
      expect(imapDeleteMessages).toHaveBeenCalledWith(
        "test-session",
        "Sent",
        [300],
      );
    });

    it("handles folder names with hyphens", async () => {
      vi.mocked(imapDeleteMessages).mockResolvedValue({ expunged: true });

      await provider.permanentDelete("thread-1", [
        "imap-acc-1-INBOX.Sub-Folder-100",
      ]);

      expect(imapDeleteMessages).toHaveBeenCalledWith(
        "test-session",
        "INBOX.Sub-Folder",
        [100],
      );
    });

    it("skips invalid message IDs", async () => {
      vi.mocked(imapDeleteMessages).mockResolvedValue({ expunged: true });
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await provider.permanentDelete("thread-1", ["invalid-id"]);

      expect(imapDeleteMessages).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ---- REQ-4.2/4.3: a degraded delete must say so ----
  describe("non-UIDPLUS servers surface a notice", () => {
    // On a server without UIDPLUS there is no way to expunge a specific UID
    // set, so Velo flags the messages and stops. That is not a failure, but it
    // is not the completed deletion the UI would otherwise imply.
    beforeEach(() => {
      useUIStore.setState({ notices: [] });
    });

    it("warns when an archive left the mail on the server", async () => {
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: false });

      await provider.archive("t1", ["imap-acc-1-INBOX-1"]);

      const notices = useUIStore.getState().notices;
      expect(notices).toHaveLength(1);
      expect(notices[0]!.text).toContain("Marked for deletion");
      expect(notices[0]!.text).toContain("INBOX");
    });

    it("warns when a permanent delete left the mail on the server", async () => {
      vi.mocked(imapDeleteMessages).mockResolvedValue({ expunged: false });

      await provider.permanentDelete("t1", ["imap-acc-1-INBOX-1"]);

      expect(useUIStore.getState().notices).toHaveLength(1);
    });

    it("stays silent when the messages were actually removed", async () => {
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: true });

      await provider.archive("t1", ["imap-acc-1-INBOX-1"]);

      expect(useUIStore.getState().notices).toHaveLength(0);
    });

    it("does not turn the degraded case into a failure", async () => {
      // expunged:false is a partial success. Throwing here would revert the
      // optimistic UI update and tell the user the archive failed, when the
      // message really is in the destination folder.
      vi.mocked(imapMoveMessages).mockResolvedValue({ expunged: false });

      await expect(
        provider.archive("t1", ["imap-acc-1-INBOX-1"]),
      ).resolves.toBeUndefined();
    });
  });
});
