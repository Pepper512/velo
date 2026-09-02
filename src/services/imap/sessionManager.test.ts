/**
 * Pooled session lifecycle, frontend half (brief E2/P15, rev 4).
 *
 * The assertions that matter here are the ones about *not* retrying. A lost
 * session is easy to recover from and the temptation is to always re-run the
 * operation; for APPEND and for the COPY-fallback half of MOVE, re-running is
 * how a user ends up with two copies of the same mail. Done-when 6 exists
 * because rev 1 of the brief mandated exactly that bug.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./tauriCommands", () => ({
  imapSessionOpen: vi.fn(),
  imapSessionClose: vi.fn(),
  imapSessionsInvalidate: vi.fn(),
}));

vi.mock("../db/accounts", () => ({
  getAccount: vi.fn(),
}));

vi.mock("./imapConfigBuilder", () => ({
  buildImapConfigWithFreshToken: vi.fn(),
}));

import {
  imapSessionOpen,
  imapSessionClose,
  imapSessionsInvalidate,
} from "./tauriCommands";
import { getAccount } from "../db/accounts";
import { buildImapConfigWithFreshToken } from "./imapConfigBuilder";
import {
  withSession,
  closeSession,
  closeAccountSessions,
  closeAllSessions,
  invalidateAccountCredentials,
} from "./sessionManager";

const mockOpen = vi.mocked(imapSessionOpen);
const mockClose = vi.mocked(imapSessionClose);
const mockInvalidate = vi.mocked(imapSessionsInvalidate);
const mockGetAccount = vi.mocked(getAccount);
const mockBuildConfig = vi.mocked(buildImapConfigWithFreshToken);

const CONFIG = {
  host: "imap.example.com",
  port: 993,
  security: "ssl" as const,
  username: "user@example.com",
  password: "secret",
  auth_method: "password" as const,
};

/** The pool's errors arrive as plain `invoke` rejections carrying the name. */
function poolError(name: string): Error {
  return new Error(`${name}`);
}

beforeEach(async () => {
  // The module cache is real state; drain it between tests.
  mockClose.mockResolvedValue(undefined);
  await closeAllSessions();

  vi.clearAllMocks();
  mockClose.mockResolvedValue(undefined);
  mockInvalidate.mockResolvedValue(undefined);
  mockGetAccount.mockResolvedValue({ id: "acc-1", auth_method: "password" } as never);
  mockBuildConfig.mockResolvedValue({ ...CONFIG });
  let n = 0;
  mockOpen.mockImplementation(async () => `session-${++n}`);
});

describe("withSession", () => {
  it("opens a session lazily and reuses it for the same account and kind", async () => {
    const op = vi.fn(async (id: string) => id);

    const first = await withSession("acc-1", "sync", { idempotent: true }, op);
    const second = await withSession("acc-1", "sync", { idempotent: true }, op);

    expect(first).toBe("session-1");
    expect(second).toBe("session-1");
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps sync and interactive on separate sessions", async () => {
    // A 200-message fetch holds its session for seconds; an archive click must
    // not queue behind it.
    const op = vi.fn(async (id: string) => id);

    const sync = await withSession("acc-1", "sync", { idempotent: true }, op);
    const interactive = await withSession("acc-1", "interactive", { idempotent: true }, op);

    expect(sync).not.toBe(interactive);
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });

  it("sends the fresh OAuth token to imap_session_open, never an empty password", async () => {
    // Decision 3, asserted end-to-end. This assertion used to live in
    // imapSync.test.ts against imapListFolders; pooling moved the credential's
    // destination to session open, so the guard moved with it.
    mockGetAccount.mockResolvedValue({ id: "acc-1", auth_method: "oauth2" } as never);
    mockBuildConfig.mockResolvedValue({ ...CONFIG, password: "fresh-oauth-token" });

    await withSession("acc-1", "sync", { idempotent: true }, async (id) => id);

    expect(mockBuildConfig).toHaveBeenCalled();
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ password: "fresh-oauth-token" }),
    );
    expect(mockOpen).not.toHaveBeenCalledWith(expect.objectContaining({ password: "" }));
  });

  it("is the only place a credential is handed across the boundary", async () => {
    // Done-when 5, at this layer: the operation callback receives an opaque id
    // and nothing else. A password reaching an operation would mean the pool
    // bought nothing.
    const op = vi.fn(async (id: string) => id);

    await withSession("acc-1", "sync", { idempotent: true }, op);

    expect(op).toHaveBeenCalledWith("session-1");
    expect(JSON.stringify(op.mock.calls)).not.toContain("secret");
  });
});

describe("withSession — NoSuchSession", () => {
  it("reopens and retries an idempotent operation", async () => {
    // Done-when 7: after an eviction the next operation opens a fresh
    // connection and succeeds.
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValueOnce(poolError("NoSuchSession"))
      .mockResolvedValueOnce("ok");

    const result = await withSession("acc-1", "sync", { idempotent: true }, op);

    expect(result).toBe("ok");
    expect(mockOpen).toHaveBeenCalledTimes(2);
    expect(op).toHaveBeenNthCalledWith(1, "session-1");
    expect(op).toHaveBeenNthCalledWith(2, "session-2");
  });

  it("reopens but does NOT re-run a non-idempotent operation", async () => {
    // Done-when 6, the APPEND case: exactly one reopen and no second APPEND,
    // with the error surfaced. A retry here is a duplicate in Sent.
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValue(poolError("NoSuchSession"));

    await expect(
      withSession("acc-1", "sync", { idempotent: false }, op),
    ).rejects.toThrow("NoSuchSession");

    expect(op).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });

  it("leaves the reopened session cached for the next caller", async () => {
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValueOnce(poolError("NoSuchSession"))
      .mockResolvedValue("ok");

    await withSession("acc-1", "sync", { idempotent: true }, op);
    await withSession("acc-1", "sync", { idempotent: true }, op);

    // Two opens total: the original and the one reopen. Not three.
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });
});

describe("withSession — SessionBusy", () => {
  it("retries on the same session without reopening", async () => {
    // Rev 4: checkout removes the entry, so a concurrent operation is refused
    // rather than queued. The session is alive — reopening it would be wrong.
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValueOnce(poolError("SessionBusy"))
      .mockResolvedValueOnce("ok");

    const result = await withSession("acc-1", "sync", { idempotent: true }, op);

    expect(result).toBe("ok");
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenNthCalledWith(2, "session-1");
  });

  it("surfaces to a non-idempotent caller rather than retrying", async () => {
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValue(poolError("SessionBusy"));

    await expect(
      withSession("acc-1", "sync", { idempotent: false }, op),
    ).rejects.toThrow("SessionBusy");

    expect(op).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});

describe("withSession — TooManySessions", () => {
  it("gives up its own slot and retries once", async () => {
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValueOnce(poolError("TooManySessions"))
      .mockResolvedValueOnce("ok");

    const result = await withSession("acc-1", "sync", { idempotent: true }, op);

    expect(result).toBe("ok");
    expect(mockClose).toHaveBeenCalledWith("session-1");
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });
});

describe("withSession — other errors", () => {
  it("passes an ordinary IMAP failure straight through", async () => {
    // Only pool errors mean anything about the session. A NO response is the
    // operation's business, and retrying it silently would hide real failures.
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValue(new Error("SELECT failed: NO Mailbox doesn't exist"));

    await expect(
      withSession("acc-1", "sync", { idempotent: true }, op),
    ).rejects.toThrow("Mailbox doesn't exist");

    expect(op).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});

describe("closing", () => {
  it("closes one kind and leaves the other alone", async () => {
    await withSession("acc-1", "sync", { idempotent: true }, async (id) => id);
    await withSession("acc-1", "interactive", { idempotent: true }, async (id) => id);

    await closeSession("acc-1", "sync");

    expect(mockClose).toHaveBeenCalledExactlyOnceWith("session-1");
  });

  it("closing an account closes both of its sessions", async () => {
    await withSession("acc-1", "sync", { idempotent: true }, async (id) => id);
    await withSession("acc-1", "interactive", { idempotent: true }, async (id) => id);

    await closeAccountSessions("acc-1");

    expect(mockClose).toHaveBeenCalledTimes(2);
  });

  it("closing a session we do not hold is a no-op, not an error", async () => {
    await expect(closeSession("acc-unknown", "sync")).resolves.toBeUndefined();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("re-opens after a close rather than reusing the closed id", async () => {
    await withSession("acc-1", "sync", { idempotent: true }, async (id) => id);
    await closeSession("acc-1", "sync");

    const id = await withSession("acc-1", "sync", { idempotent: true }, async (i) => i);

    expect(id).toBe("session-2");
  });
});

describe("credential invalidation", () => {
  it("tells the pool to drop every session for the account's identity", async () => {
    // Revocation: a pooled session outlives the token that opened it, so this
    // has to reach Rust explicitly or the connection keeps working after the
    // user revoked it. Identity rather than session id, because other windows
    // hold sessions this one never saw.
    await withSession("acc-1", "sync", { idempotent: true }, async (id) => id);

    await invalidateAccountCredentials("acc-1");

    expect(mockInvalidate).toHaveBeenCalledWith("user@example.com", "imap.example.com");
  });

  it("forgets the cached ids so the next call reopens", async () => {
    await withSession("acc-1", "sync", { idempotent: true }, async (id) => id);
    await invalidateAccountCredentials("acc-1");

    const id = await withSession("acc-1", "sync", { idempotent: true }, async (i) => i);

    expect(id).toBe("session-2");
  });

  it("does nothing for an account whose identity was never learned", async () => {
    await invalidateAccountCredentials("acc-never-opened");
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
