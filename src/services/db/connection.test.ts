import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * SPEC-240: `withTransaction` runs on one Rust-held connection through the
 * `db_tx_*` commands. `invoke` is mocked; the tests pin the command sequence,
 * the id threading, the rollback path and the boundary validation.
 */
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect };
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: vi.fn(() => Promise.resolve(mockDb)),
  },
}));

// Use dynamic import so mocks are in place
const { withTransaction, getDb, TX_EXPIRED } = await import("./connection");

/** A stand-in for the Rust side: answers begin/execute/select/commit/rollback and records the calls. */
function fakeRust(log: string[], opts: { failRollback?: string } = {}) {
  let n = 0;
  mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "db_tx_begin":
        n += 1;
        log.push(`begin`);
        return `tx-${n}`;
      case "db_tx_execute":
        log.push(`execute ${args?.id} ${args?.sql}`);
        return [1, 7];
      case "db_tx_select":
        log.push(`select ${args?.id} ${args?.sql}`);
        return [{ id: "row-1" }];
      case "db_tx_commit":
        log.push(`commit ${args?.id}`);
        return null;
      case "db_tx_rollback":
        log.push(`rollback ${args?.id}`);
        if (opts.failRollback) throw new Error(opts.failRollback);
        return null;
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
}

describe("withTransaction (pinned, SPEC-240)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("begins, routes every statement of the callback through the same id, and commits", async () => {
    const log: string[] = [];
    fakeRust(log);

    await withTransaction(async (tx) => {
      const result = await tx.execute("INSERT INTO t VALUES ($1)", ["a"]);
      expect(result).toEqual({ rowsAffected: 1, lastInsertId: 7 });
      const rows = await tx.select<{ id: string }[]>("SELECT id FROM t");
      expect(rows).toEqual([{ id: "row-1" }]);
    });

    expect(log).toEqual([
      "begin",
      "execute tx-1 INSERT INTO t VALUES ($1)",
      "select tx-1 SELECT id FROM t",
      "commit tx-1",
    ]);
    // Values are passed through untouched, and an omitted list becomes an empty one.
    expect(mockInvoke).toHaveBeenCalledWith("db_tx_execute", { id: "tx-1", sql: "INSERT INTO t VALUES ($1)", values: ["a"] });
    expect(mockInvoke).toHaveBeenCalledWith("db_tx_select", { id: "tx-1", sql: "SELECT id FROM t", values: [] });
    // Nothing went through the plugin's pooled connection.
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("rolls back on the same id when the callback throws, and rethrows the original error", async () => {
    const log: string[] = [];
    fakeRust(log);

    await expect(
      withTransaction(async (tx) => {
        await tx.execute("UPDATE t SET v = 1");
        throw new Error("callback failed");
      }),
    ).rejects.toThrow("callback failed");

    expect(log).toEqual(["begin", "execute tx-1 UPDATE t SET v = 1", "rollback tx-1"]);
  });

  it("reports a failed commit without a rollback — Rust has already closed that connection (Gemini M3 on #54)", async () => {
    const log: string[] = [];
    fakeRust(log);
    mockInvoke.mockImplementationOnce(async () => "tx-9").mockImplementationOnce(async () => {
      throw new Error("COMMIT failed: disk I/O error");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(withTransaction(async () => {})).rejects.toThrow("COMMIT failed");

    expect(mockInvoke).toHaveBeenLastCalledWith("db_tx_commit", { id: "tx-9" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("gives up on VELO_TX_BUSY after the retry budget and surfaces it (Gemini test gap 3 on #54)", async () => {
    vi.useFakeTimers();
    try {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "db_tx_begin") throw new Error("VELO_TX_BUSY: a transaction is already open");
        return null;
      });
      const run = withTransaction(async () => {});
      const outcome = run.then(
        () => "resolved",
        (e: unknown) => String(e),
      );
      await vi.advanceTimersByTimeAsync(100 * 60);
      expect(await outcome).toContain("VELO_TX_BUSY");
      expect(mockInvoke).toHaveBeenCalledTimes(51);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet when the rollback fails only because the watchdog already reaped the transaction", async () => {
    const log: string[] = [];
    fakeRust(log, { failRollback: `${TX_EXPIRED}: idle` });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      withTransaction(async () => {
        throw new Error("original error");
      }),
    ).rejects.toThrow("original error");

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns, but still reports the original error, when the rollback fails for another reason", async () => {
    const log: string[] = [];
    fakeRust(log, { failRollback: "ROLLBACK failed: locked" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      withTransaction(async () => {
        throw new Error("original error");
      }),
    ).rejects.toThrow("original error");

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("serialises concurrent transactions: the second begins only after the first commits", async () => {
    const log: string[] = [];
    fakeRust(log);

    const tx1 = withTransaction(async (tx) => {
      await tx.execute("tx1-work");
      await new Promise((r) => setTimeout(r, 10));
      await tx.execute("tx1-done");
    });
    const tx2 = withTransaction(async (tx) => {
      await tx.execute("tx2-work");
    });
    await Promise.all([tx1, tx2]);

    expect(log).toEqual([
      "begin",
      "execute tx-1 tx1-work",
      "execute tx-1 tx1-done",
      "commit tx-1",
      "begin",
      "execute tx-2 tx2-work",
      "commit tx-2",
    ]);
  });

  it("unblocks the next transaction even if the current one fails", async () => {
    const log: string[] = [];
    fakeRust(log);

    const tx1 = withTransaction(async () => {
      throw new Error("tx1 failed");
    }).catch(() => {
      /* expected */
    });
    let tx2Ran = false;
    const tx2 = withTransaction(async () => {
      tx2Ran = true;
    });
    await Promise.all([tx1, tx2]);

    expect(tx2Ran).toBe(true);
    expect(log).toEqual(["begin", "rollback tx-1", "begin", "commit tx-2"]);
  });

  it("unblocks the queue when begin itself is refused", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("VELO_TX_NO_DB: sqlite:velo.db is not loaded"));
    await expect(withTransaction(async () => {})).rejects.toThrow("VELO_TX_NO_DB");

    const log: string[] = [];
    fakeRust(log);
    await withTransaction(async () => {});
    expect(log).toEqual(["begin", "commit tx-1"]);
  });

  it("returns the callback's value (Gemini NIT 6 on #54)", async () => {
    const log: string[] = [];
    fakeRust(log);
    const rows = await withTransaction(async (tx) => tx.select<{ id: string }[]>("SELECT id FROM t"));
    expect(rows).toEqual([{ id: "row-1" }]);
    expect(log).toEqual(["begin", "select tx-1 SELECT id FROM t", "commit tx-1"]);
  });

  it("waits out VELO_TX_BUSY from another window's transaction instead of failing (Gemini M4 on #54)", async () => {
    vi.useFakeTimers();
    try {
      const log: string[] = [];
      let refusals = 2;
      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "db_tx_begin") {
          if (refusals > 0) {
            refusals -= 1;
            log.push("busy");
            throw new Error("VELO_TX_BUSY: a transaction is already open");
          }
          log.push("begin");
          return "tx-1";
        }
        log.push(`${cmd.replace("db_tx_", "")} ${args?.id}`);
        return null;
      });

      const run = withTransaction(async () => {});
      await vi.advanceTimersByTimeAsync(250);
      await run;

      expect(log).toEqual(["busy", "busy", "begin", "commit tx-1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates VELO_TX_EXPIRED from a statement and does not warn about the rollback that follows", async () => {
    const log: string[] = [];
    fakeRust(log, { failRollback: `${TX_EXPIRED}: idle` });
    mockInvoke.mockImplementationOnce(async () => "tx-1").mockImplementationOnce(async () => {
      throw new Error(`${TX_EXPIRED}: the transaction was idle for more than 30s and was rolled back`);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      withTransaction(async (tx) => {
        await tx.execute("UPDATE t SET v = 1");
      }),
    ).rejects.toThrow(TX_EXPIRED);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("validates what comes back over IPC (ADR-000 boundary)", async () => {
    mockInvoke.mockResolvedValueOnce(42);
    await expect(withTransaction(async () => {})).rejects.toThrow("invalid id");

    const log: string[] = [];
    fakeRust(log);
    mockInvoke.mockImplementationOnce(async () => "tx-1").mockImplementationOnce(async () => [-1, 0]);
    await expect(
      withTransaction(async (tx) => {
        await tx.execute("x");
      }),
    ).rejects.toThrow("invalid result");

    fakeRust(log);
    mockInvoke.mockImplementationOnce(async () => "tx-2").mockImplementationOnce(async () => "not rows");
    await expect(
      withTransaction(async (tx) => {
        await tx.select("x");
      }),
    ).rejects.toThrow("array of rows");
  });
});

describe("getDb", () => {
  it("returns the same instance on repeated calls", async () => {
    const db1 = await getDb();
    const db2 = await getDb();
    expect(db1).toBe(db2);
  });
});
