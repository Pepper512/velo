import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SPEC-F-1 REQ-1.2, REQ-1.4 (expiry) and REQ-3.1–3.2 (Phase B, Gmail server
 * write) — production `snoozeThread` / `checkSnoozedThreads` against real SQLite.
 */
const harnessRef: { current: ReturnType<typeof createSqliteHarness> | null } = { current: null };

vi.mock("@/services/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/connection")>();
  const db = () => harnessRef.current!.db;
  return {
    ...actual,
    getDb: () => Promise.resolve(db()),
    withTransaction: async (fn: (db: unknown) => Promise<void>) => fn(db()),
    selectFirstBy: async <T,>(q: string, p: unknown[] = []) => (await db().select<T[]>(q, p))[0] ?? null,
    existsBy: async (q: string, p: unknown[] = []) =>
      ((await db().select<{ count: number }[]>(q, p))[0]?.count ?? 0) > 0,
  };
});

const mockProvider = {
  removeLabel: vi.fn().mockResolvedValue(undefined),
  addLabel: vi.fn().mockResolvedValue(undefined),
};
vi.mock("@/services/email/providerFactory", () => ({
  getEmailProvider: vi.fn(() => Promise.resolve(mockProvider)),
}));

import { createSqliteHarness } from "@/test/sqliteHarness";
import { runMigrations } from "@/services/db/migrations";
import { getThreadLabelIds } from "@/services/db/threads";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";
import { useUIStore } from "@/stores/uiStore";
import { snoozeThread, checkSnoozedThreads } from "./snoozeManager";

const GMAIL = "acc-gmail";
const IMAP = "acc-imap";

async function seedThread(accountId: string, id: string, labels: string[]) {
  // Raw seed: `upsertThread` reuses placeholders in its ON CONFLICT clause,
  // which the harness rejects by design. Setup may bypass the production layer.
  await harnessRef.current!.db.execute(
    "INSERT INTO threads (id, account_id, subject, last_message_at, message_count) VALUES ($1, $2, 's', 1000, 1)",
    [id, accountId],
  );
  for (const label of labels) {
    await harnessRef.current!.db.execute(
      "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
      [accountId, id, label],
    );
  }
}

async function pendingOps() {
  return harnessRef.current!.db.select<{ operation_type: string; resource_id: string; params: string }[]>(
    "SELECT operation_type, resource_id, params FROM pending_operations ORDER BY created_at",
    [],
  );
}

describe("snoozeManager (SPEC-F-1)", () => {
  let harness: ReturnType<typeof createSqliteHarness>;
  const now = getCurrentUnixTimestamp();

  beforeEach(async () => {
    vi.clearAllMocks();
    harness = createSqliteHarness();
    harnessRef.current = harness;
    await runMigrations();
    await harness.db.execute(
      "INSERT INTO accounts (id, email, provider) VALUES ($1, 'g@example.com', 'gmail_api')", [GMAIL],
    );
    await harness.db.execute(
      "INSERT INTO accounts (id, email, provider) VALUES ($1, 'i@example.com', 'imap')", [IMAP],
    );
    useUIStore.setState({ isOnline: true });
  });

  afterEach(() => {
    harness.close();
    harnessRef.current = null;
  });

  it("snoozeThread moves the thread from INBOX to SNOOZED locally", async () => {
    await seedThread(IMAP, "t1", ["INBOX"]);

    await snoozeThread(IMAP, "t1", now + 3600);

    expect(await getThreadLabelIds(IMAP, "t1")).toEqual(["SNOOZED"]);
  });

  it("checkSnoozedThreads restores INBOX and removes SNOOZED once due (REQ-1.2, REQ-1.4)", async () => {
    await seedThread(IMAP, "t1", ["INBOX"]);
    await snoozeThread(IMAP, "t1", now - 10);

    await checkSnoozedThreads();

    expect(await getThreadLabelIds(IMAP, "t1")).toEqual(["INBOX"]);
    const rows = await harness.db.select<{ is_snoozed: number }[]>(
      "SELECT is_snoozed FROM threads WHERE account_id = $1 AND id = $2", [IMAP, "t1"],
    );
    expect(rows[0]?.is_snoozed).toBe(0);
  });

  it("checkSnoozedThreads leaves a not-yet-due snooze alone", async () => {
    await seedThread(IMAP, "t1", ["INBOX"]);
    await snoozeThread(IMAP, "t1", now + 3600);

    await checkSnoozedThreads();

    expect(await getThreadLabelIds(IMAP, "t1")).toEqual(["SNOOZED"]);
  });

  describe("Phase B — Gmail server write (REQ-3)", () => {
    it("removes INBOX on the server when a Gmail thread is snoozed (REQ-3.1)", async () => {
      await seedThread(GMAIL, "t1", ["INBOX"]);

      await snoozeThread(GMAIL, "t1", now + 3600);

      expect(mockProvider.removeLabel).toHaveBeenCalledWith("t1", "INBOX");
      expect(await pendingOps()).toHaveLength(0);
    });

    it("adds INBOX back on the server when a Gmail snooze expires (REQ-3.1)", async () => {
      await seedThread(GMAIL, "t1", ["INBOX"]);
      await snoozeThread(GMAIL, "t1", now - 10);
      mockProvider.removeLabel.mockClear();

      await checkSnoozedThreads();

      expect(mockProvider.addLabel).toHaveBeenCalledWith("t1", "INBOX");
    });

    it("makes no server call for an IMAP account", async () => {
      await seedThread(IMAP, "t1", ["INBOX"]);

      await snoozeThread(IMAP, "t1", now + 3600);

      expect(mockProvider.removeLabel).not.toHaveBeenCalled();
      expect(await pendingOps()).toHaveLength(0);
    });

    it("queues the server change when offline, and local state is already correct (REQ-3.2)", async () => {
      useUIStore.setState({ isOnline: false });
      await seedThread(GMAIL, "t1", ["INBOX"]);

      await snoozeThread(GMAIL, "t1", now + 3600);

      expect(mockProvider.removeLabel).not.toHaveBeenCalled();
      const ops = await pendingOps();
      expect(ops).toHaveLength(1);
      expect(ops[0]?.operation_type).toBe("removeLabel");
      expect(ops[0]?.resource_id).toBe("t1");
      expect(JSON.parse(ops[0]!.params)).toEqual({ threadId: "t1", labelId: "INBOX" });
      expect(await getThreadLabelIds(GMAIL, "t1")).toEqual(["SNOOZED"]);
    });

    it("queues the server change when the provider call fails, so it is retried", async () => {
      mockProvider.removeLabel.mockRejectedValueOnce(new Error("network"));
      await seedThread(GMAIL, "t1", ["INBOX"]);

      await snoozeThread(GMAIL, "t1", now + 3600);

      const ops = await pendingOps();
      expect(ops).toHaveLength(1);
      expect(ops[0]?.operation_type).toBe("removeLabel");
    });
  });
});
