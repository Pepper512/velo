/**
 * The two negative criteria E2/P15 exists for (Done-when 2 and 5).
 *
 * These are deliberately written at the `invoke` boundary rather than against
 * the session manager, because that is the boundary the claims are about: what
 * actually crosses into Rust, and how many times. A test that mocked
 * `withSession` would assert the design instead of the behaviour, and both of
 * these criteria have already survived one refactor by being specific.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `vi.hoisted` because `vi.mock` factories are lifted above ordinary consts.
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

vi.mock("../db/accounts", () => ({ getAccount: vi.fn() }));
vi.mock("./imapConfigBuilder", () => ({ buildImapConfigWithFreshToken: vi.fn() }));

import { getAccount } from "../db/accounts";
import { buildImapConfigWithFreshToken } from "./imapConfigBuilder";
import {
  withSession,
  closeAllSessions,
  invalidateAccountCredentials,
} from "./sessionManager";
import {
  imapListFolders,
  imapSetFlags,
  imapFetchMessages,
  imapMoveMessages,
  imapAppendMessage,
  imapGetFolderStatus,
} from "./tauriCommands";

const PASSWORD = "correct-horse-battery-staple";

/** Commands allowed to carry a credential, and nothing else. */
const CREDENTIAL_COMMANDS = new Set([
  "imap_session_open",
  // Decision 4(a): the raw fallback cannot use a pooled session, so it carries
  // its own config. Named here rather than tolerated by a loose assertion.
  "imap_raw_fetch_messages",
  // Account setup, before a session can exist.
  "imap_test_connection",
]);

beforeEach(async () => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
  await closeAllSessions();
  mockInvoke.mockReset();

  vi.mocked(getAccount).mockResolvedValue({ id: "acc-1" } as never);
  vi.mocked(buildImapConfigWithFreshToken).mockResolvedValue({
    host: "imap.example.com",
    port: 993,
    security: "ssl",
    username: "user@example.com",
    password: PASSWORD,
    auth_method: "password",
  } as never);

  let n = 0;
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "imap_session_open") return `session-${++n}`;
    if (cmd === "imap_get_folder_status") {
      return { uidvalidity: 1, uidnext: 2, exists: 0, unseen: 0, highest_modseq: null };
    }
    return undefined;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Every `invoke` call that carried the password, by command name. */
function commandsCarryingTheCredential(): string[] {
  return mockInvoke.mock.calls
    .filter(([, args]) => JSON.stringify(args ?? {}).includes(PASSWORD))
    .map(([cmd]) => cmd as string);
}

describe("Done-when 5 — no credential crosses the boundary except where named", () => {
  it("a full round of mail operations sends the password exactly once", async () => {
    // Archive, flag, fetch, append: the operations a user generates constantly.
    await withSession("acc-1", "interactive", {}, (id) => imapListFolders(id));
    await withSession("acc-1", "interactive", {}, (id) =>
      imapSetFlags(id, "INBOX", [1], ["Seen"], true),
    );
    await withSession("acc-1", "interactive", {}, (id) =>
      imapMoveMessages(id, "INBOX", [1], "Archive"),
    );
    await withSession("acc-1", "interactive", {}, (id) =>
      imapAppendMessage(id, "Sent", "cmVhZA", ["Seen"]),
    );
    await withSession("acc-1", "sync", {}, (id) => imapFetchMessages(id, "INBOX", [1, 2]));

    const carriers = commandsCarryingTheCredential();

    // Two sessions were opened — one per kind — and nothing else saw it.
    expect(carriers).toEqual(["imap_session_open", "imap_session_open"]);
    for (const cmd of carriers) {
      expect(CREDENTIAL_COMMANDS.has(cmd)).toBe(true);
    }
  });

  it("no operation command receives a config field at all", async () => {
    await withSession("acc-1", "interactive", {}, (id) =>
      imapSetFlags(id, "INBOX", [1], ["Seen"], true),
    );

    const operationCalls = mockInvoke.mock.calls.filter(
      ([cmd]) => !CREDENTIAL_COMMANDS.has(cmd as string),
    );

    expect(operationCalls.length).toBeGreaterThan(0);
    for (const [cmd, args] of operationCalls) {
      expect(args, `${cmd} must not carry a config`).not.toHaveProperty("config");
      expect(args).toHaveProperty("sessionId");
    }
  });

  it("a credential rotation re-sends it exactly once, not once per command", async () => {
    await withSession("acc-1", "interactive", {}, (id) => imapListFolders(id));
    await invalidateAccountCredentials("acc-1");
    await withSession("acc-1", "interactive", {}, (id) => imapListFolders(id));
    await withSession("acc-1", "interactive", {}, (id) => imapListFolders(id));

    // One open before the rotation, one after. The third call reuses.
    expect(commandsCarryingTheCredential()).toEqual([
      "imap_session_open",
      "imap_session_open",
    ]);
  });
});

describe("Done-when 2 — a sync opens at most two sessions", () => {
  it("reuses one session across many commands rather than one per command", async () => {
    // Stands in for a delta sync: a status check and a fetch per folder, over
    // ten folders. Before pooling this was 2 + ceil(U/50) logins.
    for (let i = 0; i < 10; i++) {
      await withSession("acc-1", "sync", {}, (id) =>
        imapGetFolderStatus(id, `Folder${i}`),
      );
      await withSession("acc-1", "sync", {}, (id) =>
        imapFetchMessages(id, `Folder${i}`, [1, 2, 3]),
      );
    }

    const opens = mockInvoke.mock.calls.filter(([cmd]) => cmd === "imap_session_open");
    expect(opens).toHaveLength(1);
  });

  it("caps at two even when both session kinds are in play", async () => {
    for (let i = 0; i < 5; i++) {
      await withSession("acc-1", "sync", {}, (id) => imapListFolders(id));
      await withSession("acc-1", "interactive", {}, (id) => imapListFolders(id));
    }

    const opens = mockInvoke.mock.calls.filter(([cmd]) => cmd === "imap_session_open");
    expect(opens.length).toBeLessThanOrEqual(2);
    expect(opens).toHaveLength(2);
  });

  it("a lost session costs one reopen, not one per subsequent command", async () => {
    let calls = 0;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "imap_session_open") return `session-${++calls}`;
      if (cmd === "imap_list_folders" && calls === 1) {
        // The reaper took it between commands.
        throw new Error("NoSuchSession");
      }
      return undefined;
    });

    await withSession("acc-1", "sync", {}, (id) => imapListFolders(id));
    await withSession("acc-1", "sync", {}, (id) => imapListFolders(id));
    await withSession("acc-1", "sync", {}, (id) => imapListFolders(id));

    const opens = mockInvoke.mock.calls.filter(([cmd]) => cmd === "imap_session_open");
    expect(opens).toHaveLength(2);
  });
});
