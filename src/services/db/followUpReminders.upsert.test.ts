import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SPEC-FUR — the follow-up reminder insert on real SQLite. Found while
 * verifying a review finding on #87: the original `INSERT … ON CONFLICT
 * (account_id, thread_id)` failed with "ON CONFLICT clause does not match any
 * PRIMARY KEY or UNIQUE constraint" because migration v6 created a plain index
 * on those columns, not a unique one — so no follow-up reminder, manual or
 * automatic, could ever be inserted. These cases pin the repaired behaviour:
 * one pending reminder per thread, replaced on a second set, a cancelled or
 * triggered one left as history.
 */

const harnessRef: { current: ReturnType<typeof createSqliteHarness> | null } = { current: null };
vi.mock("@/services/db/connection", () => ({
  getDb: () => Promise.resolve(harnessRef.current!.db),
  withTransaction: async (fn: (db: unknown) => Promise<void>) => fn(harnessRef.current!.db),
  // The real helper reaches for the real getDb; route it to the harness too.
  selectFirstBy: async (sql: string, params: unknown[] = []) => {
    const rows = await harnessRef.current!.db.select<unknown[]>(sql, params);
    return rows[0] ?? null;
  },
}));

import { createSqliteHarness } from "@/test/sqliteHarness";
import { runMigrations } from "./migrations";
import {
  insertFollowUpReminder,
  getFollowUpForThread,
  cancelFollowUpForThread,
  getPendingFollowUpReminders,
} from "./followUpReminders";

const ACC = "acc-1";

async function seed() {
  await harnessRef.current!.db.execute(
    "INSERT INTO accounts (id, email, provider) VALUES ($1, 'me@example.com', 'gmail_api')",
    [ACC],
  );
  for (const id of ["t1", "t2"]) {
    await harnessRef.current!.db.execute(
      "INSERT INTO threads (id, account_id, subject, last_message_at, message_count, is_read) VALUES ($1, $2, 's', 1, 1, 0)",
      [id, ACC],
    );
  }
}

async function rows(): Promise<{ thread_id: string; message_id: string; remind_at: number; status: string }[]> {
  return harnessRef.current!.db.select(
    "SELECT thread_id, message_id, remind_at, status FROM follow_up_reminders WHERE account_id = $1 ORDER BY thread_id, remind_at",
    [ACC],
  );
}

describe("insertFollowUpReminder on real SQLite (SPEC-FUR)", () => {
  let harness: ReturnType<typeof createSqliteHarness>;

  beforeEach(async () => {
    harness = createSqliteHarness();
    harnessRef.current = harness;
    await runMigrations();
    await seed();
  });

  afterEach(() => {
    harness.close();
    harnessRef.current = null;
  });

  it("inserts a pending reminder on the production schema — the bug this pins", async () => {
    await insertFollowUpReminder(ACC, "t1", "m1", 1000);
    const pending = await getFollowUpForThread(ACC, "t1");
    expect(pending).toMatchObject({ thread_id: "t1", message_id: "m1", remind_at: 1000, status: "pending" });
    expect((await getPendingFollowUpReminders()).map((r) => r.thread_id)).toEqual(["t1"]);
  });

  it("setting a reminder again on the same thread replaces the pending one rather than adding a second", async () => {
    await insertFollowUpReminder(ACC, "t1", "m1", 1000);
    await insertFollowUpReminder(ACC, "t1", "m2", 2000);
    expect(await rows()).toEqual([{ thread_id: "t1", message_id: "m2", remind_at: 2000, status: "pending" }]);
  });

  it("a cancelled reminder stays as history and a new one can be set beside it", async () => {
    await insertFollowUpReminder(ACC, "t1", "m1", 1000);
    await cancelFollowUpForThread(ACC, "t1");
    await insertFollowUpReminder(ACC, "t1", "m2", 2000);
    expect(await rows()).toEqual([
      { thread_id: "t1", message_id: "m1", remind_at: 1000, status: "cancelled" },
      { thread_id: "t1", message_id: "m2", remind_at: 2000, status: "pending" },
    ]);
    expect((await getFollowUpForThread(ACC, "t1"))?.message_id).toBe("m2");
  });

  it("a triggered reminder — the checker's write — stays as history too, and a new one sits beside it (Grok L1)", async () => {
    await insertFollowUpReminder(ACC, "t1", "m1", 1000);
    await harness.db.execute("UPDATE follow_up_reminders SET status = 'triggered' WHERE thread_id = 't1'");
    await insertFollowUpReminder(ACC, "t1", "m2", 2000);
    expect(await rows()).toEqual([
      { thread_id: "t1", message_id: "m1", remind_at: 1000, status: "triggered" },
      { thread_id: "t1", message_id: "m2", remind_at: 2000, status: "pending" },
    ]);
  });

  it("setting the very same reminder again changes nothing and inserts nothing — existence is decided by a SELECT, not by rows changed (Grok L2)", async () => {
    await insertFollowUpReminder(ACC, "t1", "m1", 1000);
    await insertFollowUpReminder(ACC, "t1", "m1", 1000);
    expect(await rows()).toEqual([{ thread_id: "t1", message_id: "m1", remind_at: 1000, status: "pending" }]);
  });

  it("threads do not share reminders", async () => {
    await insertFollowUpReminder(ACC, "t1", "m1", 1000);
    await insertFollowUpReminder(ACC, "t2", "m2", 500);
    expect((await rows()).map((r) => r.thread_id)).toEqual(["t1", "t2"]);
  });
});
