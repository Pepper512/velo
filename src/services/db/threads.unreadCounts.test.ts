import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SPEC-243 REQ-1.2, REQ-2.3, REQ-3 — the sidebar's unread counts, driven
 * against real SQLite so the production join is what runs. The count must
 * agree with what `getThreadsForAccount(account, label)` lists, so both are
 * asserted from the same seed.
 */

const harnessRef: { current: ReturnType<typeof createSqliteHarness> | null } = { current: null };
vi.mock("@/services/db/connection", () => ({
  getDb: () => Promise.resolve(harnessRef.current!.db),
  withTransaction: async (fn: (db: unknown) => Promise<void>) => fn(harnessRef.current!.db),
}));

import { createSqliteHarness } from "@/test/sqliteHarness";
import { runMigrations } from "./migrations";
import { getThreadsForAccount, getUnreadCountsByLabel } from "./threads";

const ACC = "acc-1";
const OTHER = "acc-2";

async function seedAccount(id: string, email: string) {
  await harnessRef.current!.db.execute(
    "INSERT INTO accounts (id, email, provider) VALUES ($1, $2, 'gmail_api')",
    [id, email],
  );
}

async function seedThread(accountId: string, id: string, isRead: boolean, labels: string[]) {
  await harnessRef.current!.db.execute(
    "INSERT INTO threads (id, account_id, subject, last_message_at, message_count, is_read) VALUES ($1, $2, $3, 1000, 1, $4)",
    [id, accountId, `Thread ${id}`, isRead ? 1 : 0],
  );
  for (const label of labels) {
    await harnessRef.current!.db.execute(
      "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
      [accountId, id, label],
    );
  }
}

describe("getUnreadCountsByLabel (SPEC-243)", () => {
  let harness: ReturnType<typeof createSqliteHarness>;

  beforeEach(async () => {
    harness = createSqliteHarness();
    harnessRef.current = harness;
    await runMigrations();
    await seedAccount(ACC, "me@example.com");
    await seedAccount(OTHER, "other@example.com");
  });

  afterEach(() => {
    harness.close();
    harnessRef.current = null;
  });

  it("counts unread threads once per label, for one account only (REQ-1.2, REQ-2.3)", async () => {
    await seedThread(ACC, "t1", false, ["INBOX", "Label_work"]);
    await seedThread(ACC, "t2", false, ["INBOX"]);
    await seedThread(ACC, "t3", true, ["INBOX", "Label_work"]); // read: counted nowhere
    await seedThread(ACC, "t4", false, ["Label_work", "SPAM"]);
    await seedThread(OTHER, "t9", false, ["INBOX", "Label_work"]); // other account

    const counts = await getUnreadCountsByLabel(ACC);

    expect(counts).toEqual({ INBOX: 2, Label_work: 2, SPAM: 1 });
  });

  it("agrees with what the folder lists (REQ-1.2)", async () => {
    await seedThread(ACC, "t1", false, ["INBOX"]);
    await seedThread(ACC, "t2", true, ["INBOX"]);
    await seedThread(ACC, "t3", false, ["INBOX", "SPAM"]);

    const counts = await getUnreadCountsByLabel(ACC);
    const inboxUnread = (await getThreadsForAccount(ACC, "INBOX")).filter((t) => t.is_read === 0);

    expect(counts["INBOX"]).toBe(inboxUnread.length);
    expect(counts["INBOX"]).toBe(2);
  });

  it("is an empty map for an account with no unread mail (REQ-1.1: nothing to show)", async () => {
    await seedThread(ACC, "t1", true, ["INBOX"]);

    expect(await getUnreadCountsByLabel(ACC)).toEqual({});
    expect(await getUnreadCountsByLabel("nobody")).toEqual({});
  });
});
