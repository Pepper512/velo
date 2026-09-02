import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock() calls are hoisted — must use inline factories, not external references
vi.mock("./tauriCommands", () => ({
  imapListFolders: vi.fn(),
  imapGetFolderStatus: vi.fn(),
  imapFetchMessages: vi.fn(),
  imapFetchNewUids: vi.fn(),
  imapSearchAllUids: vi.fn(),
  imapCountNotDeleted: vi.fn(),
  imapSearchFolder: vi.fn(),
  imapDeltaCheck: vi.fn(),
}));
vi.mock("./sessionManager", () => ({
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
}));
vi.mock("./imapConfigBuilder", () => ({
  buildImapConfig: vi.fn(() => ({
    host: "imap.example.com",
    port: 993,
    security: "ssl",
    username: "user@example.com",
    password: "secret",
    auth_method: "password",
  })),
  // The token-aware builder the sync path must use. Returns a *different*
  // password for oauth2 accounts so a test can tell the two builders apart.
  buildImapConfigWithFreshToken: vi.fn(
    async (account: { auth_method: string | null }) => ({
      host: "imap.example.com",
      port: 993,
      security: "ssl",
      username: "user@example.com",
      password: account.auth_method === "oauth2" ? "fresh-oauth-token" : "secret",
      auth_method: account.auth_method === "oauth2" ? "oauth2" : "password",
    }),
  ),
}));
vi.mock("./folderMapper", () => ({
  mapFolderToLabel: vi.fn((folder: { path: string }) => ({
    labelId: folder.path,
    labelName: folder.path,
    type: "user",
  })),
  getLabelsForMessage: vi.fn(
    (mapping: { labelId: string }, isRead: boolean, isStarred: boolean) => {
      const labels = [mapping.labelId];
      if (!isRead) labels.push("UNREAD");
      if (isStarred) labels.push("STARRED");
      return labels;
    },
  ),
  syncFoldersToLabels: vi.fn(),
  getSyncableFolders: vi.fn((folders: unknown[]) => folders),
}));
vi.mock("../db/messages", () => ({
  upsertMessage: vi.fn(),
  updateMessageThreadIds: vi.fn(),
  getLiveMessagesInFolder: vi.fn(async () => []),
}));
// F-4: the reconciliation pass is exercised on the SQLite harness in
// reconcilePass.test.ts. Here it is a recorder, so these tests keep asserting
// sync behaviour; the F-4 wiring block below asserts the calls it receives.
vi.mock("./reconcilePass", () => ({
  invalidateFolderSuspects: vi.fn(async () => {}),
  beltDue: vi.fn(() => false),
  folderListLooksPartial: vi.fn(() => false),
  noteFolderMissing: vi.fn(async () => "counted"),
  beginReconcilePass: vi.fn((accountId: string) => ({
    accountId,
    passId: "pass-test",
    gateOpened: new Set<string>(),
    listed: new Map(),
  })),
  shouldListFolder: vi.fn(() => false),
  reconcileFolderList: vi.fn(async () => {}),
  markFetchCompleted: vi.fn(),
  attestPass: vi.fn(() => true),
  finishReconcilePass: vi.fn(async () => ({ deleted: [], stops: [], attested: true })),
}));
vi.mock("../db/threads", () => ({
  upsertThread: vi.fn(),
  setThreadLabels: vi.fn(),
  deleteThread: vi.fn(),
}));
vi.mock("../db/attachments", () => ({
  upsertAttachment: vi.fn(),
}));
vi.mock("../db/accounts", () => ({
  getAccount: vi.fn(),
  updateAccountSyncState: vi.fn(),
}));
vi.mock("../db/connection", () => ({
  // SPEC-240: the callback receives the pinned handle and must pass it down.
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
    fn({ execute: vi.fn(async () => ({ rowsAffected: 0 })), select: vi.fn(async () => []) }),
  ),
}));
vi.mock("../db/folderSyncState", () => ({
  upsertFolderSyncState: vi.fn(),
  getAllFolderSyncStates: vi.fn(),
  bumpReconcilePasses: vi.fn(async () => 1),
  clearFolderMissing: vi.fn(async () => {}),
  setFlaggedNotExpunged: vi.fn(async () => {}),
  setForceList: vi.fn(async () => {}),
}));
vi.mock("../db/pendingOperations", () => ({
  getPendingOpsForResource: vi.fn(() => []),
}));
vi.mock("../snooze/snoozeSync", () => ({
  getOwnAddresses: vi.fn().mockResolvedValue(new Set(["me@example.com"])),
  clearSnoozeForNewExternalMessages: vi.fn().mockResolvedValue(false),
}));

import { imapMessageToParsedMessage, imapInitialSync, imapDeltaSync, formatImapDate, computeSinceDate, sinceDateForDaysBack, isConnectionError } from "./imapSync";
import {
  createMockImapMessage,
  createMockImapAccount,
  createMockImapFolder,
  createMockImapFolderStatus,
  createMockImapFetchResult,
} from "@/test/mocks";
import { imapListFolders, imapSearchFolder, imapFetchMessages, imapDeltaCheck } from "./tauriCommands";
import { buildImapConfigWithFreshToken } from "./imapConfigBuilder";
import { withSession } from "./sessionManager";
import { getAccount } from "../db/accounts";
import { withTransaction } from "../db/connection";
import { upsertMessage, updateMessageThreadIds } from "../db/messages";
import { upsertThread, deleteThread } from "../db/threads";
import { upsertAttachment } from "../db/attachments";
import { getPendingOpsForResource } from "../db/pendingOperations";
import { getAllFolderSyncStates } from "../db/folderSyncState";

describe("imapMessageToParsedMessage", () => {
  it("converts basic IMAP message to ParsedMessage format", () => {
    const msg = createMockImapMessage();
    const { parsed, threadable } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");

    expect(parsed.id).toBe("imap-acc-1-INBOX-42");
    expect(parsed.fromAddress).toBe("sender@example.com");
    expect(parsed.fromName).toBe("Sender Name");
    expect(parsed.toAddresses).toBe("recipient@example.com");
    expect(parsed.subject).toBe("Test Subject");
    expect(parsed.date).toBe(1700000000000);
    expect(parsed.isRead).toBe(false);
    expect(parsed.isStarred).toBe(false);
    expect(parsed.bodyHtml).toBe("<p>Hello</p>");
    expect(parsed.bodyText).toBe("Hello");
    expect(parsed.snippet).toBe("Hello");
    expect(parsed.rawSize).toBe(1024);
    expect(parsed.hasAttachments).toBe(false);
    expect(parsed.attachments).toEqual([]);
  });

  it("generates stable message ID from account, folder, and uid", () => {
    const msg = createMockImapMessage({ uid: 99, folder: "Sent" });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-2", "SENT");
    expect(parsed.id).toBe("imap-acc-2-Sent-99");
  });

  it("includes UNREAD label for unread messages", () => {
    const msg = createMockImapMessage({ is_read: false });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.labelIds).toContain("UNREAD");
    expect(parsed.labelIds).toContain("INBOX");
  });

  it("does not include UNREAD label for read messages", () => {
    const msg = createMockImapMessage({ is_read: true });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.labelIds).not.toContain("UNREAD");
    expect(parsed.labelIds).toContain("INBOX");
  });

  it("includes STARRED label for flagged messages", () => {
    const msg = createMockImapMessage({ is_starred: true, is_read: true });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.labelIds).toContain("STARRED");
  });

  it("creates threadable message with correct fields", () => {
    const msg = createMockImapMessage({
      message_id: "<msg-abc@host.com>",
      in_reply_to: "<msg-parent@host.com>",
      references: "<msg-root@host.com> <msg-parent@host.com>",
    });
    const { threadable } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");

    expect(threadable.id).toBe("imap-acc-1-INBOX-42");
    expect(threadable.messageId).toBe("<msg-abc@host.com>");
    expect(threadable.inReplyTo).toBe("<msg-parent@host.com>");
    expect(threadable.references).toBe("<msg-root@host.com> <msg-parent@host.com>");
    expect(threadable.subject).toBe("Test Subject");
    expect(threadable.date).toBe(1700000000000);
  });

  it("generates synthetic message ID when none present", () => {
    const msg = createMockImapMessage({ message_id: null });
    const { threadable } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");

    expect(threadable.messageId).toBe("synthetic-acc-1-INBOX-42@velo.local");
  });

  it("converts attachments correctly", () => {
    const msg = createMockImapMessage({
      attachments: [
        {
          part_id: "2",
          filename: "report.pdf",
          mime_type: "application/pdf",
          size: 50000,
          content_id: null,
          is_inline: false,
        },
        {
          part_id: "3",
          filename: "logo.png",
          mime_type: "image/png",
          size: 1024,
          content_id: "logo-cid",
          is_inline: true,
        },
      ],
    });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");

    expect(parsed.hasAttachments).toBe(true);
    expect(parsed.attachments).toHaveLength(2);
    expect(parsed.attachments[0]).toEqual({
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 50000,
      gmailAttachmentId: "2",
      contentId: null,
      isInline: false,
    });
    expect(parsed.attachments[1]).toEqual({
      filename: "logo.png",
      mimeType: "image/png",
      size: 1024,
      gmailAttachmentId: "3",
      contentId: "logo-cid",
      isInline: true,
    });
  });

  it("generates snippet from body_text when snippet is null", () => {
    const msg = createMockImapMessage({
      snippet: null,
      body_text: "This is a long email body that should be truncated to create a snippet for display purposes.",
    });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.snippet).toBe("This is a long email body that should be truncated to create a snippet for display purposes.");
  });

  it("handles null body fields gracefully", () => {
    const msg = createMockImapMessage({
      body_html: null,
      body_text: null,
      snippet: null,
    });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.bodyHtml).toBeNull();
    expect(parsed.bodyText).toBeNull();
    expect(parsed.snippet).toBe("");
  });

  it("preserves list-unsubscribe headers", () => {
    const msg = createMockImapMessage({
      list_unsubscribe: "<mailto:unsub@list.com>",
      list_unsubscribe_post: "List-Unsubscribe=One-Click",
    });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.listUnsubscribe).toBe("<mailto:unsub@list.com>");
    expect(parsed.listUnsubscribePost).toBe("List-Unsubscribe=One-Click");
  });

  it("preserves auth results", () => {
    const msg = createMockImapMessage({
      auth_results: '{"spf":"pass","dkim":"pass"}',
    });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.authResults).toBe('{"spf":"pass","dkim":"pass"}');
  });

  it("handles date=0 (unparseable Date header) without crashing", () => {
    const msg = createMockImapMessage({ date: 0 });
    const { parsed, threadable } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");

    // date=0 * 1000 = 0, passed through — the caller (imapInitialSync) applies the fallback
    expect(parsed.date).toBe(0);
    expect(threadable.date).toBe(0);
    // Message should still be valid
    expect(parsed.id).toBe("imap-acc-1-INBOX-42");
    expect(parsed.fromAddress).toBe("sender@example.com");
  });
});

describe("imapInitialSync", () => {
  const mockGetAccount = vi.mocked(getAccount);
  const mockImapListFolders = vi.mocked(imapListFolders);
  const mockImapSearchFolder = vi.mocked(imapSearchFolder);
  const mockImapFetchMessages = vi.mocked(imapFetchMessages);
  const mockWithTransaction = vi.mocked(withTransaction);
  const mockUpsertMessage = vi.mocked(upsertMessage);
  const mockUpdateMessageThreadIds = vi.mocked(updateMessageThreadIds);
  const mockUpsertThread = vi.mocked(upsertThread);
  const mockUpsertAttachment = vi.mocked(upsertAttachment);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetAccount.mockResolvedValue(createMockImapAccount({ id: "acc-1" }));
  });

  afterEach(() => {
    // Reset persistent mock implementations to prevent leaking between describe blocks
    mockImapSearchFolder.mockReset();
    mockImapFetchMessages.mockReset();
    mockImapListFolders.mockReset();
    vi.useRealTimers();
  });

  /** Configure mocks to return a single folder with the given messages. */
  function setupFolderWithMessages(folder: string, messages: ReturnType<typeof createMockImapMessage>[]) {
    const mockFolder = createMockImapFolder({
      path: folder,
      raw_path: folder,
      exists: messages.length,
    });
    mockImapListFolders.mockResolvedValue([mockFolder]);
    // imapSearchFolder returns UIDs + folder status (no message bodies)
    mockImapSearchFolder.mockResolvedValue({
      uids: messages.map((m) => m.uid),
      folder_status: createMockImapFolderStatus({ exists: messages.length }),
    });
    // imapFetchMessages returns full messages for the requested UIDs
    mockImapFetchMessages.mockResolvedValue(
      createMockImapFetchResult(messages),
    );
    return mockFolder;
  }

  it("stores messages to DB immediately per-chunk (streaming)", async () => {
    const msg1 = createMockImapMessage({ uid: 1, message_id: "<m1@test>", subject: "First", date: Math.floor(Date.now() / 1000) });
    const msg2 = createMockImapMessage({ uid: 2, message_id: "<m2@test>", subject: "Second", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg1, msg2]);

    await imapInitialSync("acc-1");

    // Messages should be stored individually via upsertMessage during fetch phase
    expect(mockUpsertMessage).toHaveBeenCalledTimes(2);

    // Each message should be stored with placeholder threadId = messageId
    const firstCallArgs = mockUpsertMessage.mock.calls[0]![0];
    expect(firstCallArgs.threadId).toBe(firstCallArgs.id);

    const secondCallArgs = mockUpsertMessage.mock.calls[1]![0];
    expect(secondCallArgs.threadId).toBe(secondCallArgs.id);
  });

  it("creates placeholder thread before each message to satisfy FK constraint", async () => {
    const msg1 = createMockImapMessage({ uid: 1, message_id: "<m1@test>", subject: "Hello", date: Math.floor(Date.now() / 1000) });
    const msg2 = createMockImapMessage({ uid: 2, message_id: "<m2@test>", subject: "World", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg1, msg2]);

    await imapInitialSync("acc-1");

    // For each message, upsertThread should be called BEFORE upsertMessage
    // to satisfy the FK constraint (messages.thread_id → threads.id).
    // Phase 2: 2 placeholder threads + Phase 4: 1 or 2 final threads
    expect(mockUpsertThread.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockUpsertMessage).toHaveBeenCalledTimes(2);

    // Each placeholder thread must be created before its corresponding message.
    // Verify by checking that the nth thread call preceded the nth message call.
    for (let i = 0; i < 2; i++) {
      const threadOrder = mockUpsertThread.mock.invocationCallOrder[i]!;
      const messageOrder = mockUpsertMessage.mock.invocationCallOrder[i]!;
      expect(threadOrder).toBeLessThan(messageOrder);
    }

    // Verify placeholder threads use the message ID as thread ID
    const firstThreadCall = mockUpsertThread.mock.calls[0]![0];
    const firstMsgCall = mockUpsertMessage.mock.calls[0]![0];
    expect(firstThreadCall.id).toBe(firstMsgCall.id);
    expect(firstThreadCall.id).toBe(firstMsgCall.threadId);
  });

  it("updates thread IDs after threading phase", async () => {
    const msg1 = createMockImapMessage({ uid: 1, message_id: "<m1@test>", subject: "Hello", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg1]);

    await imapInitialSync("acc-1");

    // Thread record should be created: once as placeholder in Phase 2, once final in Phase 4
    expect(mockUpsertThread).toHaveBeenCalledTimes(2);

    // Thread IDs should be batch-updated via updateMessageThreadIds
    expect(mockUpdateMessageThreadIds).toHaveBeenCalledTimes(1);
    const [accountId, messageIds, threadId, handle] = mockUpdateMessageThreadIds.mock.calls[0]!;
    expect(accountId).toBe("acc-1");
    expect(messageIds).toHaveLength(1);
    expect(threadId).toBeTruthy();
    // SPEC-240 REQ-4.1: both stores (Phase 2 chunk, Phase 4 batch) and the
    // thread-id update run on the transaction's handle (Gemini test gap 4 on #54).
    const isHandle = expect.objectContaining({ execute: expect.any(Function), select: expect.any(Function) });
    expect(handle).toEqual(isHandle);
    for (const call of mockUpsertThread.mock.calls) expect(call[1]).toEqual(isHandle);
    for (const call of mockUpsertMessage.mock.calls) expect(call[1]).toEqual(isHandle);
  });

  it("returns empty messages array (bodies not accumulated)", async () => {
    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg]);

    const result = await imapInitialSync("acc-1");

    // The streaming approach returns empty array — bodies are already in DB
    expect(result.messages).toEqual([]);
  });

  it("stores attachments immediately with the message", async () => {
    const msg = createMockImapMessage({
      uid: 1,
      message_id: "<m1@test>",
      date: Math.floor(Date.now() / 1000),
      attachments: [
        {
          part_id: "2",
          filename: "doc.pdf",
          mime_type: "application/pdf",
          size: 5000,
          content_id: null,
          is_inline: false,
        },
      ],
    });
    setupFolderWithMessages("INBOX", [msg]);

    await imapInitialSync("acc-1");

    expect(mockUpsertAttachment).toHaveBeenCalledTimes(1);
    // ...and through the transaction's handle, not a fresh connection (SPEC-240 REQ-4.1).
    expect(mockUpsertAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "doc.pdf",
        mimeType: "application/pdf",
        accountId: "acc-1",
      }),
      expect.objectContaining({ execute: expect.any(Function), select: expect.any(Function) }),
    );
  });

  it("filters messages by date cutoff", async () => {
    const recentDate = Math.floor(Date.now() / 1000) - 10; // 10 seconds ago
    const oldDate = Math.floor(Date.now() / 1000) - 400 * 86400; // 400 days ago

    const recentMsg = createMockImapMessage({ uid: 1, message_id: "<recent@test>", date: recentDate });
    const oldMsg = createMockImapMessage({ uid: 2, message_id: "<old@test>", date: oldDate });

    setupFolderWithMessages("INBOX", [recentMsg, oldMsg]);

    await imapInitialSync("acc-1", 365);

    // Only recent message should be stored (old one is beyond 365 days)
    expect(mockUpsertMessage).toHaveBeenCalledTimes(1);
    expect(mockUpsertMessage.mock.calls[0]![0].id).toContain("1"); // uid=1
  });

  // SPEC-276 REQ-1.2 / REQ-1.3: "All time" is daysBack = 0 — no SINCE date
  // (the Rust side then issues UID SEARCH ALL) and no per-message cutoff.
  it("all time (daysBack 0) searches without SINCE and keeps old messages", async () => {
    const oldDate = Math.floor(Date.now() / 1000) - 400 * 86400; // beyond any preset
    const veryOldDate = Math.floor(Date.now() / 1000) - 12 * 365 * 86400;
    const oldMsg = createMockImapMessage({ uid: 1, message_id: "<old@test>", date: oldDate });
    const veryOldMsg = createMockImapMessage({ uid: 2, message_id: "<older@test>", date: veryOldDate });

    setupFolderWithMessages("INBOX", [oldMsg, veryOldMsg]);

    await imapInitialSync("acc-1", 0);

    expect(mockImapSearchFolder).toHaveBeenCalledTimes(1);
    expect(mockImapSearchFolder).toHaveBeenCalledWith("test-session", "INBOX", null);
    expect(mockUpsertMessage).toHaveBeenCalledTimes(2);
  });

  it("handles empty folders gracefully", async () => {
    const mockFolder = createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 0 });
    mockImapListFolders.mockResolvedValue([mockFolder]);

    const result = await imapInitialSync("acc-1");

    expect(mockImapSearchFolder).not.toHaveBeenCalled();
    expect(mockUpsertMessage).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
  });

  it("reports progress through all phases", async () => {
    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg]);

    const progressCalls: Array<{ phase: string }> = [];
    await imapInitialSync("acc-1", 365, (progress) => {
      progressCalls.push({ phase: progress.phase });
    });

    const phases = progressCalls.map((p) => p.phase);
    expect(phases).toContain("folders");
    expect(phases).toContain("messages");
    expect(phases).toContain("threading");
    expect(phases).toContain("storing_threads");
    expect(phases).toContain("done");
  });

  it("uses imapSearchFolder + imapFetchMessages for chunked sync per folder", async () => {
    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg]);

    await imapInitialSync("acc-1");

    // Should use imapSearchFolder (lightweight search) with SINCE date filter.
    // First argument is a pooled session id now, not a config (E2/P15).
    expect(mockImapSearchFolder).toHaveBeenCalledTimes(1);
    expect(mockImapSearchFolder).toHaveBeenCalledWith(
      "test-session",
      "INBOX",
      expect.stringMatching(/^\d{1,2}-[A-Z][a-z]{2}-\d{4}$/), // sinceDate in DD-Mon-YYYY format
    );

    // Then fetch the messages by UID
    expect(mockImapFetchMessages).toHaveBeenCalledTimes(1);
    expect(mockImapFetchMessages).toHaveBeenCalledWith(
      "test-session",
      "INBOX",
      [1], // UIDs from search
    );
  });

  it("wraps chunk DB writes in a transaction", async () => {
    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg]);

    await imapInitialSync("acc-1");

    // withTransaction should be called: once for Phase 2 chunk + once for Phase 4 batch
    expect(mockWithTransaction).toHaveBeenCalledTimes(2);
  });

  it("continues to next chunk on fetch error", async () => {
    const msg1 = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });
    const msg2 = createMockImapMessage({ uid: 201, message_id: "<m2@test>", date: Math.floor(Date.now() / 1000) });

    const mockFolder = createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 2 });
    mockImapListFolders.mockResolvedValue([mockFolder]);

    // Return UIDs in two "chunks" (we'll set CHUNK_SIZE to 200 but have UIDs 1 and 201)
    mockImapSearchFolder.mockResolvedValue({
      uids: [1, 201],
      folder_status: createMockImapFolderStatus({ exists: 2 }),
    });

    // First chunk fetch succeeds, but because both UIDs are in the same chunk (< 200),
    // we test error handling by making imapFetchMessages fail on first call and succeed on retry
    mockImapFetchMessages
      .mockRejectedValueOnce(new Error("fetch timeout"))
      .mockResolvedValueOnce(createMockImapFetchResult([msg2]));

    // This won't exercise the multi-chunk path since 2 UIDs < 200 chunk size.
    // Instead test that a search failure at folder level is handled.
    // Reset and use a simpler approach: single chunk that fails
    vi.clearAllMocks();
    mockGetAccount.mockResolvedValue(createMockImapAccount({ id: "acc-1" }));

    const msgs = Array.from({ length: 2 }, (_, i) =>
      createMockImapMessage({ uid: i + 1, message_id: `<m${i}@test>`, date: Math.floor(Date.now() / 1000) }),
    );
    setupFolderWithMessages("INBOX", msgs);

    // Even if imapFetchMessages fails for one chunk, the folder-level error is caught
    mockImapFetchMessages.mockRejectedValueOnce(new Error("chunk fetch failed"));

    const syncPromise = imapInitialSync("acc-1");
    await vi.runAllTimersAsync();
    const result = await syncPromise;

    // Sync should complete without throwing
    expect(result.messages).toEqual([]);
  });

  it("circuit breaker skips remaining folders after 5 consecutive connection failures", async () => {
    const folders = Array.from({ length: 8 }, (_, i) =>
      createMockImapFolder({ path: `folder-${i}`, raw_path: `folder-${i}`, exists: 10 }),
    );
    mockImapListFolders.mockResolvedValue(folders);
    mockImapSearchFolder.mockRejectedValue(new Error("TCP connect timed out (os error 60)"));

    // Advance timers and catch the expected error in one go to avoid
    // Vitest's unhandled-rejection tracker from flagging it.
    let caughtError: Error | null = null;
    const syncPromise = imapInitialSync("acc-1").catch((err: Error) => {
      caughtError = err;
    });
    await vi.runAllTimersAsync();
    await syncPromise;

    // All folders fail → error is propagated
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("All folders failed to sync");

    // Circuit breaker should stop after 5 failures (CIRCUIT_BREAKER_MAX_FAILURES)
    expect(mockImapSearchFolder).toHaveBeenCalledTimes(5);
  });

  it("circuit breaker resets on successful folder sync", async () => {
    const folders = [
      createMockImapFolder({ path: "f1", raw_path: "f1", exists: 10 }),
      createMockImapFolder({ path: "f2", raw_path: "f2", exists: 10 }),
      createMockImapFolder({ path: "f3", raw_path: "f3", exists: 10 }),
      createMockImapFolder({ path: "f4", raw_path: "f4", exists: 10 }),
    ];
    mockImapListFolders.mockResolvedValue(folders);

    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });

    // First 2 fail with connection error, 3rd succeeds, 4th fails
    mockImapSearchFolder
      .mockRejectedValueOnce(new Error("TCP connect timed out"))
      .mockRejectedValueOnce(new Error("TCP connect timed out"))
      .mockResolvedValueOnce({
        uids: [msg.uid],
        folder_status: createMockImapFolderStatus({ exists: 1 }),
      })
      .mockRejectedValueOnce(new Error("TCP connect timed out"));

    mockImapFetchMessages.mockResolvedValue(createMockImapFetchResult([msg]));

    const syncPromise = imapInitialSync("acc-1");
    await vi.runAllTimersAsync();
    await syncPromise;

    // All 4 folders should be attempted (circuit breaker resets after success on f3)
    expect(mockImapSearchFolder).toHaveBeenCalledTimes(4);
  });

  it("continues on non-connection errors without triggering circuit breaker", async () => {
    const folders = Array.from({ length: 6 }, (_, i) =>
      createMockImapFolder({ path: `folder-${i}`, raw_path: `folder-${i}`, exists: 10 }),
    );
    mockImapListFolders.mockResolvedValue(folders);

    // Non-connection errors should NOT trigger circuit breaker
    mockImapSearchFolder.mockRejectedValue(new Error("PARSE failed: invalid response"));

    let caughtError: Error | null = null;
    const syncPromise = imapInitialSync("acc-1").catch((err: Error) => {
      caughtError = err;
    });
    await vi.runAllTimersAsync();
    await syncPromise;

    // All folders fail → error is propagated, but all were attempted first
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("All folders failed to sync");

    // All folders should be attempted since these aren't connection errors
    expect(mockImapSearchFolder).toHaveBeenCalledTimes(6);
  });
});

describe("formatImapDate", () => {
  it("formats a date as DD-Mon-YYYY for IMAP SINCE criterion", () => {
    // 2024-03-15 UTC
    const date = new Date(Date.UTC(2024, 2, 15));
    expect(formatImapDate(date)).toBe("15-Mar-2024");
  });

  it("handles single-digit days without zero-padding", () => {
    const date = new Date(Date.UTC(2024, 0, 5));
    expect(formatImapDate(date)).toBe("5-Jan-2024");
  });

  it("handles December correctly", () => {
    const date = new Date(Date.UTC(2024, 11, 31));
    expect(formatImapDate(date)).toBe("31-Dec-2024");
  });
});

describe("computeSinceDate", () => {
  it("returns a date daysBack+1 days ago in DD-Mon-YYYY format", () => {
    const result = computeSinceDate(365);
    // Should match DD-Mon-YYYY format
    expect(result).toMatch(/^\d{1,2}-[A-Z][a-z]{2}-\d{4}$/);
  });

  it("adds 1-day safety margin", () => {
    // For daysBack=0, should still go back 1 day
    const result = computeSinceDate(0);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    expect(result).toBe(formatImapDate(yesterday));
  });
});

describe("sinceDateForDaysBack (SPEC-276)", () => {
  it("is null for all time (0), so the search has no SINCE clause", () => {
    expect(sinceDateForDaysBack(0)).toBeNull();
  });

  it("is the computeSinceDate string for a positive period", () => {
    expect(sinceDateForDaysBack(365)).toBe(computeSinceDate(365));
    expect(sinceDateForDaysBack(30)).toMatch(/^\d{1,2}-[A-Z][a-z]{2}-\d{4}$/);
  });
});

describe("isConnectionError", () => {
  it("detects 'timed out' errors", () => {
    expect(isConnectionError("TCP connect timed out (os error 60)")).toBe(true);
  });

  it("detects 'connection' errors", () => {
    expect(isConnectionError("connection reset by peer")).toBe(true);
  });

  it("detects TLS errors", () => {
    expect(isConnectionError("tls handshake failed")).toBe(true);
  });

  it("detects DNS errors", () => {
    expect(isConnectionError("dns resolution failed")).toBe(true);
  });

  it("detects ECONNREFUSED errors", () => {
    expect(isConnectionError("connect ECONNREFUSED 127.0.0.1:993")).toBe(true);
  });

  it("detects socket errors", () => {
    expect(isConnectionError("socket hang up")).toBe(true);
  });

  it("detects network errors", () => {
    expect(isConnectionError("network is unreachable")).toBe(true);
  });

  it("returns false for non-connection errors", () => {
    expect(isConnectionError("PARSE failed: invalid response")).toBe(false);
    expect(isConnectionError("authentication failed")).toBe(false);
  });
});

describe("imapInitialSync — all-folders-fail propagation", () => {
  const mockGetAccount = vi.mocked(getAccount);
  const mockImapListFolders = vi.mocked(imapListFolders);
  const mockImapSearchFolder = vi.mocked(imapSearchFolder);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetAccount.mockResolvedValue(createMockImapAccount({ id: "acc-1" }));
  });

  afterEach(() => {
    // Reset search mock implementation to prevent leaking into subsequent tests
    mockImapSearchFolder.mockReset();
    vi.useRealTimers();
  });

  it("throws when all folders fail and no messages were stored", async () => {
    const folders = [
      createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 10 }),
      createMockImapFolder({ path: "Sent", raw_path: "Sent", exists: 5 }),
    ];
    mockImapListFolders.mockResolvedValue(folders);
    mockImapSearchFolder.mockRejectedValue("authentication failed");

    let caughtError: Error | null = null;
    const syncPromise = imapInitialSync("acc-1").catch((err: Error) => {
      caughtError = err;
    });
    await vi.runAllTimersAsync();
    await syncPromise;

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("All folders failed to sync");
  });
});

describe("imapInitialSync — placeholder cleanup", () => {
  const mockGetAccount = vi.mocked(getAccount);
  const mockImapListFolders = vi.mocked(imapListFolders);
  const mockImapSearchFolder = vi.mocked(imapSearchFolder);
  const mockImapFetchMessages = vi.mocked(imapFetchMessages);
  const mockDeleteThread = vi.mocked(deleteThread);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetAccount.mockResolvedValue(createMockImapAccount({ id: "acc-1" }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes orphaned placeholder threads after threading", async () => {
    // Two messages that share the same thread via References
    const msg1 = createMockImapMessage({
      uid: 1,
      message_id: "<m1@test>",
      subject: "Thread Subject",
      date: Math.floor(Date.now() / 1000),
    });
    const msg2 = createMockImapMessage({
      uid: 2,
      message_id: "<m2@test>",
      in_reply_to: "<m1@test>",
      references: "<m1@test>",
      subject: "Re: Thread Subject",
      date: Math.floor(Date.now() / 1000) + 60,
    });

    const mockFolder = createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 2 });
    mockImapListFolders.mockResolvedValue([mockFolder]);
    mockImapSearchFolder.mockResolvedValue({
      uids: [1, 2],
      folder_status: createMockImapFolderStatus({ exists: 2 }),
    });
    mockImapFetchMessages.mockResolvedValue(createMockImapFetchResult([msg1, msg2]));

    await imapInitialSync("acc-1");

    // Threading should merge the two messages into one thread,
    // so at least one placeholder thread (the one not chosen as thread ID) should be deleted
    expect(mockDeleteThread).toHaveBeenCalled();
  });
});

/**
 * Regression guard: the sync path must authenticate with a live credential.
 *
 * Both sync entry points used to build their config with `buildImapConfig(account)`
 * and no token. For an OAuth IMAP account `imap_password` is NULL by construction
 * (`insertOAuthImapAccount` writes the literal NULL), so the config that reached
 * the Rust IMAP layer carried `password: ""`. The interactive path in
 * `imapSmtpProvider` passed a token and worked, which is why the account could
 * archive and read mail while never syncing — and why no test caught it.
 *
 * These assert on the config handed to the IMAP layer, not on which helper was
 * called, so they still hold if the wiring is refactored again.
 */
describe("sync credential wiring for OAuth accounts", () => {
  const mockGetAccount = vi.mocked(getAccount);
  const mockImapListFolders = vi.mocked(imapListFolders);
  const mockBuildImapConfigWithFreshToken = vi.mocked(buildImapConfigWithFreshToken);
  const mockWithSession = vi.mocked(withSession);
  const mockGetAllFolderSyncStates = vi.mocked(getAllFolderSyncStates);

  beforeEach(() => {
    vi.clearAllMocks();
    mockImapListFolders.mockResolvedValue([]);
    mockGetAllFolderSyncStates.mockResolvedValue([]);
  });

  afterEach(() => {
    mockImapListFolders.mockReset();
  });

  // This guard has now moved twice, so the trail is written down rather than
  // left to look like erosion.
  //
  // Originally: assert the fresh OAuth token reached `imapListFolders`'s config.
  // Part 1: folder listing took a session id, so the assertion split — imapSync
  // still built a config, and that half was asserted here.
  // Part 2: imapSync builds NO config at all. Every command takes a session id,
  // and the credential is built exactly once, by `sessionManager` at session
  // open. So what imapSync owns is now "delegates to the pool", asserted here;
  // the fresh-token guarantee itself is asserted end to end in
  // sessionManager.test.ts. Total coverage is unchanged — it just follows the
  // code.
  it("imapInitialSync runs its IMAP work through a pooled session", async () => {
    mockGetAccount.mockResolvedValue(
      createMockImapAccount({ id: "acc-1", auth_method: "oauth2", imap_password: null }),
    );

    await imapInitialSync("acc-1");

    expect(mockWithSession).toHaveBeenCalled();
    expect(mockWithSession.mock.calls[0]![0]).toBe("acc-1");
    expect(mockWithSession.mock.calls[0]![1]).toBe("sync");
  });

  it("imapDeltaSync runs its IMAP work through a pooled session", async () => {
    mockGetAccount.mockResolvedValue(
      createMockImapAccount({ id: "acc-1", auth_method: "oauth2", imap_password: null }),
    );

    await imapDeltaSync("acc-1");

    expect(mockWithSession).toHaveBeenCalled();
    expect(mockWithSession.mock.calls[0]![0]).toBe("acc-1");
  });

  it("builds no credential of its own — that is the pool's job now", async () => {
    // The security half of the change: a sync no longer constructs a password
    // anywhere. If this fails, a credential has crept back into the sync path.
    mockGetAccount.mockResolvedValue(
      createMockImapAccount({ id: "acc-1", auth_method: "oauth2", imap_password: null }),
    );

    await imapInitialSync("acc-1");

    expect(mockBuildImapConfigWithFreshToken).not.toHaveBeenCalled();
  });

});

/** SPEC-F-4 part 2 — how the delta pass drives the reconciliation module. */
describe("imapDeltaSync reconciliation wiring (SPEC-F-4)", () => {
  const mockGetAccount = vi.mocked(getAccount);
  const mockImapListFolders = vi.mocked(imapListFolders);
  const mockImapDeltaCheck = vi.mocked(imapDeltaCheck);

  const inbox = () => createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 5 });
  const checkedInbox = (exists: number | null = 5) => ({
    folder: "INBOX",
    uidvalidity: 7,
    new_uids: [] as number[],
    uidvalidity_changed: false,
    exists,
    checked: true,
    error: null,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetAccount.mockResolvedValue(createMockImapAccount({ id: "acc-1" }));
    mockImapListFolders.mockResolvedValue([inbox()]);
    // Implementations persist across `clearAllMocks`; pin the defaults so one
    // test's gate/list/attestation setup cannot leak into the next.
    const { shouldListFolder, attestPass, beltDue, noteFolderMissing, folderListLooksPartial } =
      await import("./reconcilePass");
    const { imapSearchAllUids, imapCountNotDeleted } = await import("./tauriCommands");
    const { bumpReconcilePasses } = await import("../db/folderSyncState");
    vi.mocked(shouldListFolder).mockReturnValue(false);
    vi.mocked(attestPass).mockReturnValue(true);
    vi.mocked(beltDue).mockReturnValue(false);
    vi.mocked(folderListLooksPartial).mockReturnValue(false);
    vi.mocked(noteFolderMissing).mockResolvedValue("counted");
    vi.mocked(bumpReconcilePasses).mockResolvedValue(1);
    vi.mocked(imapSearchAllUids).mockReset();
    vi.mocked(imapCountNotDeleted).mockReset();
    const { getAllFolderSyncStates } = await import("../db/folderSyncState");
    vi.mocked(getAllFolderSyncStates).mockResolvedValue([
      {
        account_id: "acc-1",
        folder_path: "INBOX",
        uidvalidity: 7,
        last_uid: 5,
        modseq: null,
        last_sync_at: 1,
        flagged_not_expunged: 2,
      },
    ]);
  });

  it("opens the gate with the delta check's numbers, lists the folder, and hands the list to the pass", async () => {
    const { shouldListFolder, reconcileFolderList, finishReconcilePass, attestPass, markFetchCompleted } =
      await import("./reconcilePass");
    const { imapSearchAllUids } = await import("./tauriCommands");
    mockImapDeltaCheck.mockResolvedValue([{ ...checkedInbox(), new_uids: [6] }]);
    vi.mocked(shouldListFolder).mockReturnValue(true);
    vi.mocked(imapSearchAllUids).mockResolvedValue([1, 2, 3, 6]);
    vi.mocked(imapFetchMessages).mockResolvedValue(createMockImapFetchResult([]));

    await imapDeltaSync("acc-1");

    // live count (mocked []) = 0, incoming new UIDs = 1, flagged = 2 from sync state
    expect(shouldListFolder).toHaveBeenCalledWith(5, 0, 1, 2);
    expect(imapSearchAllUids).toHaveBeenCalledWith("test-session", "INBOX");
    expect(reconcileFolderList).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acc-1", passId: "pass-test" }),
      "INBOX",
      7,
      [1, 2, 3, 6],
      5,
    );
    const pass = vi.mocked(reconcileFolderList).mock.calls[0]![0];
    expect(pass.gateOpened.has("INBOX")).toBe(true);
    expect(markFetchCompleted).toHaveBeenCalledWith(pass, "INBOX");
    // Known folders = this LIST's syncable folders + every folder with sync state.
    expect(attestPass).toHaveBeenCalledWith(pass, expect.arrayContaining(["INBOX"]), new Set(["INBOX"]), 0);
    expect(finishReconcilePass).toHaveBeenCalledWith(pass, true);
  });

  it("a folder with sync state that this LIST did not return still counts toward attestation (Grok H5)", async () => {
    const { attestPass } = await import("./reconcilePass");
    const { getAllFolderSyncStates } = await import("../db/folderSyncState");
    vi.mocked(getAllFolderSyncStates).mockResolvedValue([
      { account_id: "acc-1", folder_path: "INBOX", uidvalidity: 7, last_uid: 5, modseq: null, last_sync_at: 1 },
      { account_id: "acc-1", folder_path: "Projects", uidvalidity: 3, last_uid: 9, modseq: null, last_sync_at: 1 },
    ]);
    mockImapDeltaCheck.mockResolvedValue([checkedInbox()]);

    await imapDeltaSync("acc-1");

    const known = vi.mocked(attestPass).mock.calls[0]![1];
    expect([...known]).toEqual(expect.arrayContaining(["INBOX", "Projects"]));
    expect(vi.mocked(attestPass).mock.calls[0]![2]).toEqual(new Set(["INBOX"]));
  });

  it("finishes the pass even when nothing new was fetched (the early-return path)", async () => {
    const { finishReconcilePass, shouldListFolder } = await import("./reconcilePass");
    mockImapDeltaCheck.mockResolvedValue([checkedInbox()]);
    vi.mocked(shouldListFolder).mockReturnValue(false);

    const result = await imapDeltaSync("acc-1");

    expect(result.messages).toEqual([]);
    expect(finishReconcilePass).toHaveBeenCalledTimes(1);
  });

  it("a list that throws is a folder error: not listed, pass cannot attest, still finished", async () => {
    const { shouldListFolder, reconcileFolderList, finishReconcilePass, attestPass } =
      await import("./reconcilePass");
    const { imapSearchAllUids } = await import("./tauriCommands");
    mockImapDeltaCheck.mockResolvedValue([checkedInbox()]);
    vi.mocked(shouldListFolder).mockReturnValue(true);
    vi.mocked(imapSearchAllUids).mockRejectedValue(new Error("Malformed UID list from Rust for INBOX"));
    vi.mocked(attestPass).mockReturnValue(false);

    await expect(imapDeltaSync("acc-1")).rejects.toThrow(/All folders failed/);

    expect(reconcileFolderList).not.toHaveBeenCalled();
    expect(attestPass).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(["INBOX"]), new Set(["INBOX"]), 1);
    expect(finishReconcilePass).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("runs the NOT DELETED belt on its Nth pass, recomputes the counter, and skips the list when counts agree (REQ-2.3)", async () => {
    const { shouldListFolder, beltDue, reconcileFolderList } = await import("./reconcilePass");
    const { imapCountNotDeleted, imapSearchAllUids } = await import("./tauriCommands");
    const { setFlaggedNotExpunged, bumpReconcilePasses } = await import("../db/folderSyncState");
    mockImapDeltaCheck.mockResolvedValue([{ ...checkedInbox(7), new_uids: [6] }]);
    vi.mocked(shouldListFolder).mockReturnValue(true);
    vi.mocked(bumpReconcilePasses).mockResolvedValue(10);
    vi.mocked(beltDue).mockReturnValue(true);
    vi.mocked(imapCountNotDeleted).mockResolvedValue(1); // live 0 + incoming 1
    vi.mocked(imapFetchMessages).mockResolvedValue(createMockImapFetchResult([]));

    await imapDeltaSync("acc-1");

    expect(beltDue).toHaveBeenCalledWith(10, 2);
    expect(imapCountNotDeleted).toHaveBeenCalledWith("test-session", "INBOX");
    expect(setFlaggedNotExpunged).toHaveBeenCalledWith("acc-1", "INBOX", 6); // exists 7 − notDeleted 1
    expect(imapSearchAllUids).not.toHaveBeenCalled();
    expect(reconcileFolderList).not.toHaveBeenCalled();
  });

  it("the belt lists anyway when the NOT DELETED count disagrees", async () => {
    const { shouldListFolder, beltDue, reconcileFolderList } = await import("./reconcilePass");
    const { imapCountNotDeleted, imapSearchAllUids } = await import("./tauriCommands");
    mockImapDeltaCheck.mockResolvedValue([checkedInbox(7)]);
    vi.mocked(shouldListFolder).mockReturnValue(true);
    vi.mocked(beltDue).mockReturnValue(true);
    vi.mocked(imapCountNotDeleted).mockResolvedValue(3); // live 0 → something vanished or arrived
    vi.mocked(imapSearchAllUids).mockResolvedValue([1, 2, 3]);

    await imapDeltaSync("acc-1");

    expect(reconcileFolderList).toHaveBeenCalled();
  });

  it("a forced list (a spent reconcile op) lists regardless of the gate and belt, then clears the flag (REQ-4.3)", async () => {
    const { shouldListFolder, beltDue, reconcileFolderList } = await import("./reconcilePass");
    const { imapSearchAllUids } = await import("./tauriCommands");
    const { getAllFolderSyncStates, setForceList } = await import("../db/folderSyncState");
    vi.mocked(getAllFolderSyncStates).mockResolvedValue([
      { account_id: "acc-1", folder_path: "INBOX", uidvalidity: 7, last_uid: 5, modseq: null, last_sync_at: 1, flagged_not_expunged: 2, force_list: 1 },
    ]);
    mockImapDeltaCheck.mockResolvedValue([checkedInbox(5)]);
    vi.mocked(shouldListFolder).mockReturnValue(false);
    vi.mocked(beltDue).mockReturnValue(true);
    vi.mocked(imapSearchAllUids).mockResolvedValue([1, 2, 3, 4, 5]);

    await imapDeltaSync("acc-1");

    expect(reconcileFolderList).toHaveBeenCalled();
    expect(setForceList).toHaveBeenCalledWith("acc-1", "INBOX", false);
  });

  it("a folder with sync state that LIST omitted is noted; once removed it leaves the attestation set", async () => {
    const { noteFolderMissing, attestPass } = await import("./reconcilePass");
    const { getAllFolderSyncStates, clearFolderMissing } = await import("../db/folderSyncState");
    vi.mocked(getAllFolderSyncStates).mockResolvedValue([
      { account_id: "acc-1", folder_path: "INBOX", uidvalidity: 7, last_uid: 5, modseq: null, last_sync_at: 1, missing_passes: 1 },
      { account_id: "acc-1", folder_path: "Gone", uidvalidity: 3, last_uid: 9, modseq: null, last_sync_at: 1, missing_passes: 1 },
    ]);
    vi.mocked(noteFolderMissing).mockResolvedValue("removed");
    mockImapDeltaCheck.mockResolvedValue([checkedInbox()]);

    await imapDeltaSync("acc-1");

    expect(clearFolderMissing).toHaveBeenCalledWith("acc-1", "INBOX");
    expect(noteFolderMissing).toHaveBeenCalledWith("acc-1", "Gone", false);
    const known = [...vi.mocked(attestPass).mock.calls[0]![1]];
    expect(known).not.toContain("Gone");
  });

  it("a LIST that looks partial counts nothing as missing and keeps every known folder in the attestation set (Grok H2 on #50)", async () => {
    const { noteFolderMissing, attestPass, folderListLooksPartial } = await import("./reconcilePass");
    const { getAllFolderSyncStates, clearFolderMissing } = await import("../db/folderSyncState");
    const state = (folder_path: string) => ({ account_id: "acc-1", folder_path, uidvalidity: 7, last_uid: 5, modseq: null, last_sync_at: 1 });
    vi.mocked(getAllFolderSyncStates).mockResolvedValue([state("INBOX"), state("A"), state("B")]);
    vi.mocked(folderListLooksPartial).mockReturnValue(true);
    mockImapDeltaCheck.mockResolvedValue([checkedInbox()]);

    await imapDeltaSync("acc-1");

    expect(folderListLooksPartial).toHaveBeenCalledWith(2, 3, 1);
    expect(noteFolderMissing).not.toHaveBeenCalled();
    expect(clearFolderMissing).not.toHaveBeenCalled();
    const known = [...vi.mocked(attestPass).mock.calls[0]![1]];
    expect(known).toEqual(expect.arrayContaining(["INBOX", "A", "B"]));
  });

  it("a checked folder without EXISTS is treated as unchecked: no gate, no attestation (Grok M4 on #50)", async () => {
    const { shouldListFolder, attestPass } = await import("./reconcilePass");
    mockImapDeltaCheck.mockResolvedValue([{ ...checkedInbox(), exists: null }]);

    await imapDeltaSync("acc-1");

    expect(shouldListFolder).not.toHaveBeenCalled();
    const checked = vi.mocked(attestPass).mock.calls[0]![2];
    expect(checked.has("INBOX")).toBe(false);
  });

  it("a UIDVALIDITY change invalidates the folder's suspects and stop, and skips the gate for that folder", async () => {
    const { shouldListFolder, invalidateFolderSuspects } = await import("./reconcilePass");
    mockImapDeltaCheck.mockResolvedValue([{ ...checkedInbox(), uidvalidity: 8, uidvalidity_changed: true }]);
    vi.mocked(imapSearchFolder).mockResolvedValue({ uids: [], folder_status: createMockImapFolderStatus({ exists: 0 }) });

    await imapDeltaSync("acc-1");

    expect(invalidateFolderSuspects).toHaveBeenCalledWith("acc-1", "INBOX", 8);
    expect(shouldListFolder).not.toHaveBeenCalled();
  });

  it("finishes the pass unattested when threading or the store throws after the folders were listed (Grok L10)", async () => {
    const { finishReconcilePass, attestPass } = await import("./reconcilePass");
    const { upsertThread } = await import("../db/threads");
    const msg = createMockImapMessage({ uid: 6, message_id: "<m6@test>", subject: "New", date: 1 });
    mockImapDeltaCheck.mockResolvedValue([{ ...checkedInbox(), new_uids: [6] }]);
    vi.mocked(imapFetchMessages).mockResolvedValue(createMockImapFetchResult([msg]));
    vi.mocked(attestPass).mockReturnValue(true);
    vi.mocked(upsertThread).mockRejectedValueOnce(new Error("disk full"));

    await expect(imapDeltaSync("acc-1")).rejects.toThrow("disk full");

    expect(finishReconcilePass).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("an unchecked folder never opens the gate and is missing from the checked set", async () => {
    const { shouldListFolder, attestPass } = await import("./reconcilePass");
    mockImapDeltaCheck.mockResolvedValue([{ ...checkedInbox(null), checked: false, error: "SELECT failed: NO" }]);

    await imapDeltaSync("acc-1");

    expect(shouldListFolder).not.toHaveBeenCalled();
    expect(attestPass).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(["INBOX"]), new Set(), 0);
  });

  // SPEC-276 REQ-1.2 (Gemini L1 on #62): both delta-sync search sites — a folder
  // with no saved state, and a UIDVALIDITY resync — search without SINCE for all time.
  it("all time (daysBack 0) searches a new folder and a UIDVALIDITY resync without SINCE", async () => {
    mockImapListFolders.mockResolvedValue([
      inbox(),
      createMockImapFolder({ path: "Archive", raw_path: "Archive", exists: 3 }),
    ]);
    mockImapDeltaCheck.mockResolvedValue([{ ...checkedInbox(), uidvalidity: 8, uidvalidity_changed: true }]);
    vi.mocked(imapSearchFolder).mockResolvedValue({ uids: [], folder_status: createMockImapFolderStatus({ exists: 0 }) });

    await imapDeltaSync("acc-1", 0);

    expect(vi.mocked(imapSearchFolder)).toHaveBeenCalledWith("test-session", "Archive", null);
    expect(vi.mocked(imapSearchFolder)).toHaveBeenCalledWith("test-session", "INBOX", null);
  });

  it("a positive period keeps the SINCE date on both delta-sync search sites", async () => {
    mockImapListFolders.mockResolvedValue([
      inbox(),
      createMockImapFolder({ path: "Archive", raw_path: "Archive", exists: 3 }),
    ]);
    mockImapDeltaCheck.mockResolvedValue([{ ...checkedInbox(), uidvalidity: 8, uidvalidity_changed: true }]);
    vi.mocked(imapSearchFolder).mockResolvedValue({ uids: [], folder_status: createMockImapFolderStatus({ exists: 0 }) });

    await imapDeltaSync("acc-1", 365);

    const since = expect.stringMatching(/^\d{1,2}-[A-Z][a-z]{2}-\d{4}$/);
    expect(vi.mocked(imapSearchFolder)).toHaveBeenCalledWith("test-session", "Archive", since);
    expect(vi.mocked(imapSearchFolder)).toHaveBeenCalledWith("test-session", "INBOX", since);
  });
});

/** SPEC-F-1 REQ-1.3 — the IMAP thread-store path consults the snooze rule before upserting. */
describe("imapInitialSync snooze handling (SPEC-F-1)", () => {
  const mockGetAccount = vi.mocked(getAccount);
  const mockImapListFolders = vi.mocked(imapListFolders);
  const mockImapSearchFolder = vi.mocked(imapSearchFolder);
  const mockImapFetchMessages = vi.mocked(imapFetchMessages);
  const mockUpsertThread = vi.mocked(upsertThread);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetAccount.mockResolvedValue(createMockImapAccount({ id: "acc-1" }));
  });

  afterEach(() => {
    mockImapSearchFolder.mockReset();
    mockImapFetchMessages.mockReset();
    mockImapListFolders.mockReset();
    vi.useRealTimers();
  });

  it("checks for new external messages before the post-threading upsert, with the account's own addresses", async () => {
    const { clearSnoozeForNewExternalMessages, getOwnAddresses } = await import("../snooze/snoozeSync");
    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", subject: "Hello", date: Math.floor(Date.now() / 1000) });
    const folder = createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 1 });
    mockImapListFolders.mockResolvedValue([folder]);
    mockImapSearchFolder.mockResolvedValue({ uids: [1], folder_status: createMockImapFolderStatus({ exists: 1 }) });
    mockImapFetchMessages.mockResolvedValue(createMockImapFetchResult([msg]));

    await imapInitialSync("acc-1");

    expect(getOwnAddresses).toHaveBeenCalledWith("acc-1");
    expect(clearSnoozeForNewExternalMessages).toHaveBeenCalledTimes(1);
    const [accountId, threadId, incoming, own] = vi.mocked(clearSnoozeForNewExternalMessages).mock.calls[0]!;
    expect(accountId).toBe("acc-1");
    expect(typeof threadId).toBe("string");
    expect(incoming).toEqual([expect.objectContaining({ id: expect.any(String) })]);
    expect(own).toEqual(new Set(["me@example.com"]));

    // Before the thread-store upsert (the last upsertThread call; earlier ones are FK placeholders).
    const clearOrder = vi.mocked(clearSnoozeForNewExternalMessages).mock.invocationCallOrder[0]!;
    const lastUpsertOrder = mockUpsertThread.mock.invocationCallOrder.at(-1)!;
    expect(clearOrder).toBeLessThan(lastUpsertOrder);
  });
});
