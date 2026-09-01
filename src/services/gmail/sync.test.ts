import { describe, it, expect, vi, beforeEach } from "vitest";
import { deltaSync } from "./sync";
import { GmailClient } from "./client";

// Mock all DB modules
vi.mock("../db/threads", () => ({
  upsertThread: vi.fn(),
  setThreadLabels: vi.fn(),
  getMutedThreadIds: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock("../db/messages", () => ({
  upsertMessage: vi.fn(),
}));
vi.mock("../db/attachments", () => ({
  upsertAttachment: vi.fn(),
}));
vi.mock("../db/accounts", () => ({
  updateAccountSyncState: vi.fn(),
}));
vi.mock("../db/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));
vi.mock("../db/threadCategories", () => ({
  getThreadCategoryWithManual: vi.fn().mockResolvedValue(null),
  setThreadCategory: vi.fn(),
  getThreadCategory: vi.fn().mockResolvedValue(null),
}));
vi.mock("../db/notificationVips", () => ({
  getVipSenders: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock("@/services/categorization/ruleEngine", () => ({
  categorizeByRules: vi.fn().mockReturnValue("Primary"),
}));
vi.mock("../filters/filterEngine", () => ({
  applyFiltersToMessages: vi.fn(),
}));
vi.mock("@/services/ai/categorizationManager", () => ({
  categorizeNewThreads: vi.fn(),
}));
vi.mock("@/services/db/bundleRules", () => ({
  getBundleRule: vi.fn().mockResolvedValue(null),
  holdThread: vi.fn(),
  getNextDeliveryTime: vi.fn(),
}));
vi.mock("@/services/db/pendingOperations", () => ({
  getPendingOpsForResource: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/services/snooze/snoozeSync", () => ({
  getOwnAddresses: vi.fn().mockResolvedValue(new Set(["me@example.com"])),
  clearSnoozeForNewExternalMessages: vi.fn().mockResolvedValue(false),
}));

const mockNotify = vi.fn();
const mockShouldNotify = vi.fn().mockReturnValue(true);
vi.mock("../notifications/notificationManager", () => ({
  queueNewEmailNotification: (...args: unknown[]) => mockNotify(...args),
  shouldNotifyForMessage: (...args: unknown[]) => mockShouldNotify(...args),
}));

// Mock parseGmailMessage
vi.mock("./messageParser", () => ({
  parseGmailMessage: (msg: { id: string; threadId: string; labelIds: string[] }) => ({
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds ?? [],
    fromAddress: "sender@example.com",
    fromName: "Sender",
    toAddresses: "me@example.com",
    ccAddresses: "",
    bccAddresses: "",
    replyTo: "",
    subject: `Subject for ${msg.id}`,
    snippet: "snippet",
    date: "2024-01-01T00:00:00Z",
    isRead: !msg.labelIds?.includes("UNREAD"),
    isStarred: false,
    bodyHtml: "<p>test</p>",
    bodyText: "test",
    rawSize: 100,
    internalDate: "1704067200000",
    hasAttachments: false,
    attachments: [],
  }),
}));

function createMockClient(historyItems: unknown[]): GmailClient {
  return {
    getHistory: vi.fn().mockResolvedValue({
      history: historyItems,
      historyId: "200",
    }),
    getThread: vi.fn().mockImplementation((threadId: string) =>
      Promise.resolve({
        id: threadId,
        historyId: "200",
        messages: [
          {
            id: `msg-${threadId}`,
            threadId,
            labelIds: ["INBOX", "UNREAD"],
            snippet: "test",
            historyId: "200",
            internalDate: "1704067200000",
            payload: { partId: "", mimeType: "text/plain", filename: "", headers: [], body: { size: 0 } },
            sizeEstimate: 100,
          },
        ],
      }),
    ),
  } as unknown as GmailClient;
}

describe("deltaSync notifications", () => {
  beforeEach(() => {
    mockNotify.mockClear();
    mockShouldNotify.mockClear();
    mockShouldNotify.mockReturnValue(true);
  });

  it("sends notification for new unread inbox message", async () => {
    const client = createMockClient([
      {
        id: "100",
        messagesAdded: [
          {
            message: {
              id: "msg-thread-1",
              threadId: "thread-1",
              labelIds: ["INBOX", "UNREAD"],
            },
          },
        ],
      },
    ]);

    await deltaSync(client, "account-1", "99");

    expect(mockNotify).toHaveBeenCalledWith(
      "Sender",
      "Subject for msg-thread-1",
      "thread-1",
      "account-1",
      "sender@example.com",
    );
  });

  it("does not send notification for read messages", async () => {
    const client = createMockClient([
      {
        id: "100",
        messagesAdded: [
          {
            message: {
              id: "msg-thread-2",
              threadId: "thread-2",
              labelIds: ["INBOX"], // no UNREAD
            },
          },
        ],
      },
    ]);

    await deltaSync(client, "account-1", "99");

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not send notification for sent messages", async () => {
    const client = createMockClient([
      {
        id: "100",
        messagesAdded: [
          {
            message: {
              id: "msg-thread-3",
              threadId: "thread-3",
              labelIds: ["SENT"],
            },
          },
        ],
      },
    ]);

    await deltaSync(client, "account-1", "99");

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

/** SPEC-F-1 REQ-1.3 — sync consults the snooze rule before it touches the thread row. */
describe("deltaSync snooze handling (SPEC-F-1)", () => {
  it("checks for new external messages BEFORE upserting the thread, with the account's own addresses", async () => {
    const { clearSnoozeForNewExternalMessages, getOwnAddresses } = await import("@/services/snooze/snoozeSync");
    const { upsertThread } = await import("../db/threads");
    vi.mocked(clearSnoozeForNewExternalMessages).mockClear();
    vi.mocked(upsertThread).mockClear();

    const client = createMockClient([
      { id: "100", messagesAdded: [{ message: { id: "msg-thread-1", threadId: "thread-1", labelIds: ["INBOX", "UNREAD"] } }] },
    ]);

    await deltaSync(client, "account-1", "99");

    expect(getOwnAddresses).toHaveBeenCalledWith("account-1");
    expect(clearSnoozeForNewExternalMessages).toHaveBeenCalledWith(
      "account-1",
      "thread-1",
      [{ id: "msg-thread-1", fromAddress: "sender@example.com" }],
      new Set(["me@example.com"]),
    );
    const clearOrder = vi.mocked(clearSnoozeForNewExternalMessages).mock.invocationCallOrder[0]!;
    const upsertOrder = vi.mocked(upsertThread).mock.invocationCallOrder[0]!;
    expect(clearOrder).toBeLessThan(upsertOrder);
  });
});
