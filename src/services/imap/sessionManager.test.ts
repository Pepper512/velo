/**
 * Pooled session lifecycle, frontend half (brief E2/P15, rev 4).
 *
 * These tests previously locked in a bug found in review: they asserted that a
 * `NoSuchSession` must not re-run a non-idempotent operation. But pool errors
 * are raised by `acquire` *before the connection is touched*, so the command
 * never reached the server and re-running it duplicates nothing. The old
 * assertion would have made the first archive after an idle reap fail in the
 * user's face.
 *
 * What actually protects against a duplicate in Sent is the **pass-through of
 * mid-operation errors** — an APPEND that may have landed server-side surfaces
 * as an ordinary IMAP error and is never retried. That is asserted below, and
 * it is what satisfies Done-when 6.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./tauriCommands", () => ({
  imapSessionOpen: vi.fn(),
  imapSessionClose: vi.fn(),
  imapSessionsInvalidate: vi.fn(),
}));

// The cross-window invalidation listener (SPEC-E2-3 REQ-3). The handler is
// captured so a test can deliver the event Rust would emit.
const { mockListen, listeners } = vi.hoisted(() => {
  const listeners: Array<{ name: string; handler: (event: { payload: unknown }) => void }> = [];
  const mockListen = vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.push({ name, handler });
    return () => {};
  });
  return { mockListen, listeners };
});
vi.mock("@tauri-apps/api/event", () => ({ listen: mockListen }));

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

/** The pool's errors arrive as plain `invoke` rejections carrying the sentinel. */
function poolError(name: string): Error {
  return new Error(`velo:pool:${name}`);
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

    const first = await withSession("acc-1", "sync", {}, op);
    const second = await withSession("acc-1", "sync", {}, op);

    expect(first).toBe("session-1");
    expect(second).toBe("session-1");
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps sync and interactive on separate sessions", async () => {
    // A 200-message fetch holds its session for seconds; an archive click must
    // not queue behind it.
    const op = vi.fn(async (id: string) => id);

    const sync = await withSession("acc-1", "sync", {}, op);
    const interactive = await withSession("acc-1", "interactive", {}, op);

    expect(sync).not.toBe(interactive);
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });

  it("sends the fresh OAuth token to imap_session_open, never an empty password", async () => {
    // Decision 3, asserted end-to-end. This assertion used to live in
    // imapSync.test.ts against imapListFolders; pooling moved the credential's
    // destination to session open, so the guard moved with it.
    mockGetAccount.mockResolvedValue({ id: "acc-1", auth_method: "oauth2" } as never);
    mockBuildConfig.mockResolvedValue({ ...CONFIG, password: "fresh-oauth-token" });

    await withSession("acc-1", "sync", {}, async (id) => id);

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

    await withSession("acc-1", "sync", {}, op);

    expect(op).toHaveBeenCalledWith("session-1");
    expect(JSON.stringify(op.mock.calls)).not.toContain("secret");
  });
});

describe("withSession — NoSuchSession", () => {
  it("reopens and retries, because the command never reached the server", async () => {
    // Done-when 7: after an eviction the next operation opens a fresh
    // connection and succeeds.
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValueOnce(poolError("NoSuchSession"))
      .mockResolvedValueOnce("ok");

    const result = await withSession("acc-1", "sync", {}, op);

    expect(result).toBe("ok");
    expect(mockOpen).toHaveBeenCalledTimes(2);
    expect(op).toHaveBeenNthCalledWith(1, "session-1");
    expect(op).toHaveBeenNthCalledWith(2, "session-2");
  });

  it("retries even an APPEND, because acquire runs before any I/O", async () => {
    // The corrected behaviour. `NoSuchSession` means checkout failed on a
    // HashMap — no bytes were sent — so re-running APPEND cannot duplicate a
    // Sent copy. Refusing here would fail the user's first send after a reap
    // while protecting nothing.
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValueOnce(poolError("NoSuchSession"))
      .mockResolvedValueOnce("appended");

    await expect(withSession("acc-1", "sync", {}, op)).resolves.toBe("appended");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("refuses to re-run a caller that wraps more than one command", async () => {
    // The one case where a retry really would duplicate: `fn` is not a single
    // command, so re-running it re-runs whatever already succeeded inside it.
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValue(poolError("NoSuchSession"));

    await expect(
      withSession("acc-1", "sync", { retrySafe: false }, op),
    ).rejects.toThrow("NoSuchSession");

    expect(op).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });

  it("leaves the reopened session cached for the next caller", async () => {
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValueOnce(poolError("NoSuchSession"))
      .mockResolvedValue("ok");

    await withSession("acc-1", "sync", {}, op);
    await withSession("acc-1", "sync", {}, op);

    // Two opens total: the original and the one reopen. Not three.
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });
});

describe("a server cannot spell a sentinel and steer the retry", () => {
  // Cross-vendor review finding 2 on PR #39, and the one that undercut the
  // pre-I/O retry argument rather than nitpicking it. Pool errors and operation
  // errors share one Result<T, String> channel, and the operation half carries
  // server-supplied text. If membership in that channel were decided by
  // substring, a mailbox named after a sentinel — or a server echoing one in a
  // NO response — would let the remote end decide whether Velo retries. For
  // APPEND, that is a duplicate in Sent.
  it("does not treat an IMAP error mentioning a sentinel as a pool error", async () => {
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValue(
        new Error('APPEND failed: NO [CANNOT] mailbox "velo:pool:NoSuchSession" is read-only'),
      );

    await expect(withSession("acc-1", "sync", {}, op)).rejects.toThrow("APPEND failed");

    // Surfaced, not retried, and no reopen.
    expect(op).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("does not treat a trailing-sentinel error as a pool error either", async () => {
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValue(new Error("SELECT failed: velo:pool:SessionBusy"));

    await expect(withSession("acc-1", "sync", {}, op)).rejects.toThrow("SELECT failed");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("still recognises the sentinel when it is the whole message", async () => {
    // The fix must not break detection — exact, but tolerant of whitespace.
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("  velo:pool:NoSuchSession  "))
      .mockResolvedValueOnce("ok");

    await expect(withSession("acc-1", "sync", {}, op)).resolves.toBe("ok");
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

    const result = await withSession("acc-1", "sync", {}, op);

    expect(result).toBe("ok");
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenNthCalledWith(2, "session-1");
  });

  it("surfaces to a multi-command caller rather than retrying", async () => {
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValue(poolError("SessionBusy"));

    await expect(
      withSession("acc-1", "sync", { retrySafe: false }, op),
    ).rejects.toThrow("SessionBusy");

    expect(op).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});

describe("withSession — TooManySessions", () => {
  it("gives up its own slot and retries the open", async () => {
    // Raised by the pool's `insert`, so it surfaces from `imap_session_open` —
    // never from the operation. The first version of this test faked it by
    // making `op` throw, which reached the branch by a path the pool cannot
    // produce, and so asserted nothing about real behaviour.
    let opens = 0;
    mockOpen.mockImplementation(async () => {
      opens += 1;
      if (opens === 1) throw poolError("TooManySessions");
      return `session-${opens}`;
    });
    // A cached session for this realm exists, so there is a slot to give up.
    const op = vi.fn(async (id: string) => id);

    const result = await withSession("acc-1", "sync", {}, op);

    expect(result).toBe("session-2");
    expect(opens).toBe(2);
  });

  it("surfaces if the retried open is refused too", async () => {
    mockOpen.mockRejectedValue(poolError("TooManySessions"));

    await expect(
      withSession("acc-1", "sync", {}, async (id) => id),
    ).rejects.toThrow("TooManySessions");
  });
});

describe("withSession — other errors", () => {
  it("never retries a mid-operation failure — this is the APPEND guard", async () => {
    // Done-when 6. A connection that dies mid-APPEND may have landed the
    // message server-side; the error is an ordinary IMAP/transport failure, not
    // a pool error, and re-running it is what would put a second copy in Sent.
    // The guard is this pass-through, not a flag on the pool errors.
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValue(new Error("APPEND failed: Broken pipe (os error 32)"));

    await expect(withSession("acc-1", "sync", {}, op)).rejects.toThrow("Broken pipe");

    expect(op).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("passes an ordinary IMAP failure straight through", async () => {
    // Only pool errors mean anything about the session. A NO response is the
    // operation's business, and retrying it silently would hide real failures.
    const op = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValue(new Error("SELECT failed: NO Mailbox doesn't exist"));

    await expect(
      withSession("acc-1", "sync", {}, op),
    ).rejects.toThrow("Mailbox doesn't exist");

    expect(op).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});

describe("closing", () => {
  it("closes one kind and leaves the other alone", async () => {
    await withSession("acc-1", "sync", {}, async (id) => id);
    await withSession("acc-1", "interactive", {}, async (id) => id);

    await closeSession("acc-1", "sync");

    expect(mockClose).toHaveBeenCalledExactlyOnceWith("session-1");
  });

  it("closing an account closes both of its sessions", async () => {
    await withSession("acc-1", "sync", {}, async (id) => id);
    await withSession("acc-1", "interactive", {}, async (id) => id);

    await closeAccountSessions("acc-1");

    expect(mockClose).toHaveBeenCalledTimes(2);
  });

  it("closing a session we do not hold is a no-op, not an error", async () => {
    await expect(closeSession("acc-unknown", "sync")).resolves.toBeUndefined();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("re-opens after a close rather than reusing the closed id", async () => {
    await withSession("acc-1", "sync", {}, async (id) => id);
    await closeSession("acc-1", "sync");

    const id = await withSession("acc-1", "sync", {}, async (i) => i);

    expect(id).toBe("session-2");
  });
});

describe("credential invalidation", () => {
  it("tells the pool to drop every session for the account's identity", async () => {
    // Revocation: a pooled session outlives the token that opened it, so this
    // has to reach Rust explicitly or the connection keeps working after the
    // user revoked it. Identity rather than session id, because other windows
    // hold sessions this one never saw.
    await withSession("acc-1", "sync", {}, async (id) => id);

    await invalidateAccountCredentials("acc-1");

    expect(mockInvalidate).toHaveBeenCalledWith("user@example.com", "imap.example.com");
  });

  it("forgets the cached ids so the next call reopens", async () => {
    await withSession("acc-1", "sync", {}, async (id) => id);
    await invalidateAccountCredentials("acc-1");

    const id = await withSession("acc-1", "sync", {}, async (i) => i);

    expect(id).toBe("session-2");
  });

  it("does nothing for an account whose identity was never learned", async () => {
    await invalidateAccountCredentials("acc-never-opened");
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});

describe("an open waits for this window's pending invalidation (SPEC-E2-3 REQ-2.4)", () => {
  it("does not open until the invalidation has been answered", async () => {
    await withSession("acc-1", "sync", {}, async (id) => id);

    let settleInvalidate!: () => void;
    mockInvalidate.mockImplementation(
      () => new Promise<void>((resolve) => (settleInvalidate = resolve)),
    );
    // Fire-and-forget, as `clearConfigCache` does.
    void invalidateAccountCredentials("acc-1");

    const opened = withSession("acc-1", "sync", {}, async (id) => id);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockOpen).toHaveBeenCalledTimes(1);

    settleInvalidate();
    expect(await opened).toBe("session-2");
    expect(mockOpen).toHaveBeenCalledTimes(2);
    // Order on the wire: the bump reached Rust before the open did.
    expect(mockInvalidate.mock.invocationCallOrder[0]).toBeLessThan(
      mockOpen.mock.invocationCallOrder[1]!,
    );
  });

  it("still opens when the invalidation itself fails", async () => {
    // A failed invalidation only costs a stale session the reaper takes; it
    // must not wedge every later open for the account.
    await withSession("acc-1", "sync", {}, async (id) => id);
    mockInvalidate.mockRejectedValueOnce(new Error("ipc down"));
    await expect(invalidateAccountCredentials("acc-1")).rejects.toThrow("ipc down");

    const id = await withSession("acc-1", "sync", {}, async (i) => i);

    expect(id).toBe("session-2");
  });
});

describe("a stale credential generation at open (SPEC-E2-3 REQ-2.2)", () => {
  it("rebuilds the config and opens exactly once more", async () => {
    // Rust refused to pool the session: a bump landed during the open's round
    // trip. The reopen must carry a freshly built config, not the one that
    // may hold the retired credential.
    mockBuildConfig
      .mockResolvedValueOnce({ ...CONFIG, password: "retired" })
      .mockResolvedValueOnce({ ...CONFIG, password: "current" });
    mockOpen
      .mockRejectedValueOnce(poolError("StaleCredential"))
      .mockResolvedValueOnce("session-fresh");

    const id = await withSession("acc-1", "sync", {}, async (i) => i);

    expect(id).toBe("session-fresh");
    expect(mockOpen).toHaveBeenCalledTimes(2);
    expect(mockOpen).toHaveBeenLastCalledWith(expect.objectContaining({ password: "current" }));
    expect(mockBuildConfig).toHaveBeenCalledTimes(2);
  });

  it("surfaces a second refusal rather than looping", async () => {
    mockOpen.mockRejectedValue(poolError("StaleCredential"));

    await expect(withSession("acc-1", "sync", {}, async (i) => i)).rejects.toThrow(
      "velo:pool:StaleCredential",
    );
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });

  it("does not mistake an IMAP error that mentions the sentinel for a refusal", async () => {
    mockOpen.mockRejectedValueOnce(new Error("LOGIN failed: velo:pool:StaleCredential"));

    await expect(withSession("acc-1", "sync", {}, async (i) => i)).rejects.toThrow(
      "LOGIN failed",
    );
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});

describe("another window's invalidation (SPEC-E2-3 REQ-3)", () => {
  function deliver(payload: { username: string; host: string }): void {
    const registered = listeners.filter((l) => l.name === "velo-imap-sessions-invalidated");
    expect(registered.length).toBeGreaterThan(0);
    for (const l of registered) l.handler({ payload });
  }

  it("registers the listener once per window, on first use", async () => {
    await withSession("acc-1", "sync", {}, async (id) => id);
    await withSession("acc-1", "interactive", {}, async (id) => id);

    const names = listeners.map((l) => l.name);
    expect(names.filter((n) => n === "velo-imap-sessions-invalidated")).toHaveLength(1);
  });

  it("forgets both of the matching account's ids, so the next call reopens", async () => {
    await withSession("acc-1", "sync", {}, async (id) => id);
    await withSession("acc-1", "interactive", {}, async (id) => id);
    expect(mockOpen).toHaveBeenCalledTimes(2);

    deliver({ username: "user@example.com", host: "imap.example.com" });

    await withSession("acc-1", "sync", {}, async (id) => id);
    await withSession("acc-1", "interactive", {}, async (id) => id);
    expect(mockOpen).toHaveBeenCalledTimes(4);
    // Forgotten, not closed: Rust already logged the sessions out.
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("leaves accounts with a different identity alone", async () => {
    mockGetAccount.mockImplementation(async (id: string) => ({ id, auth_method: "password" }) as never);
    mockBuildConfig.mockImplementation(async (account: { id: string }) => ({
      ...CONFIG,
      username: `${account.id}@example.com`,
    }));
    await withSession("acc-1", "sync", {}, async (id) => id);
    await withSession("acc-2", "sync", {}, async (id) => id);
    expect(mockOpen).toHaveBeenCalledTimes(2);

    deliver({ username: "acc-1@example.com", host: "imap.example.com" });

    await withSession("acc-2", "sync", {}, async (id) => id);
    expect(mockOpen).toHaveBeenCalledTimes(2);
    await withSession("acc-1", "sync", {}, async (id) => id);
    expect(mockOpen).toHaveBeenCalledTimes(3);
  });

  it("ignores an identity this window never opened", async () => {
    await withSession("acc-1", "sync", {}, async (id) => id);

    deliver({ username: "stranger@example.com", host: "imap.example.com" });

    await withSession("acc-1", "sync", {}, async (id) => id);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});
