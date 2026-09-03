import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SPEC-SIT REQ-2.2, 2.3, 2.4, 3.1 — the split inbox's label and Reminders
 * tabs, and the per-tab counts, driven against real SQLite so the production
 * joins are what run.
 */

const harnessRef: { current: ReturnType<typeof createSqliteHarness> | null } = { current: null };
vi.mock("@/services/db/connection", () => ({
  getDb: () => Promise.resolve(harnessRef.current!.db),
  withTransaction: async (fn: (db: unknown) => Promise<void>) => fn(harnessRef.current!.db),
}));

import { createSqliteHarness } from "@/test/sqliteHarness";
import { runMigrations } from "./migrations";
import { getInboxThreadsForLabel, getThreadsWithPendingReminders } from "./threads";
import { getSplitTabCounts } from "./splitTabCounts";

const ACC = "acc-1";
const OTHER = "acc-2";

async function seedAccount(id: string, email: string) {
  await harnessRef.current!.db.execute(
    "INSERT INTO accounts (id, email, provider) VALUES ($1, $2, 'gmail_api')",
    [id, email],
  );
}

async function seedThread(
  accountId: string,
  id: string,
  opts: { read?: boolean; pinned?: boolean; at?: number; labels?: string[] } = {},
) {
  await harnessRef.current!.db.execute(
    "INSERT INTO threads (id, account_id, subject, last_message_at, message_count, is_read, is_pinned) VALUES ($1, $2, $3, $4, 1, $5, $6)",
    [id, accountId, `Thread ${id}`, opts.at ?? 1000, opts.read ? 1 : 0, opts.pinned ? 1 : 0],
  );
  for (const label of opts.labels ?? []) {
    await harnessRef.current!.db.execute(
      "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
      [accountId, id, label],
    );
  }
}

// The production helpers upsert with reused placeholders, which the harness
// refuses; the rows are seeded directly.
async function seedReminder(accountId: string, threadId: string, remindAt: number, status = "pending") {
  await harnessRef.current!.db.execute(
    "INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status) VALUES ($1, $2, $3, $4, $5, $6)",
    [`fu-${accountId}-${threadId}`, accountId, threadId, `m-${threadId}`, remindAt, status],
  );
}

async function seedCategory(accountId: string, threadId: string, category: string) {
  await harnessRef.current!.db.execute(
    "INSERT INTO thread_categories (account_id, thread_id, category, is_manual) VALUES ($1, $2, $3, 0)",
    [accountId, threadId, category],
  );
}

describe("split-inbox tab queries (SPEC-SIT)", () => {
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

  it("a label tab lists INBOX threads with the label, pinned first then newest, paged (REQ-2.2)", async () => {
    await seedThread(ACC, "t1", { at: 300, labels: ["INBOX", "Label_inv"] });
    await seedThread(ACC, "t2", { at: 200, labels: ["INBOX", "Label_inv"], pinned: true });
    await seedThread(ACC, "t3", { at: 100, labels: ["INBOX", "Label_inv"] });
    await seedThread(ACC, "t4", { at: 400, labels: ["Label_inv"] }); // archived: not in the inbox
    await seedThread(ACC, "t5", { at: 500, labels: ["INBOX"] }); // no label
    await seedThread(OTHER, "t9", { at: 600, labels: ["INBOX", "Label_inv"] }); // other account

    const page1 = await getInboxThreadsForLabel(ACC, "Label_inv", 2, 0);
    const page2 = await getInboxThreadsForLabel(ACC, "Label_inv", 2, 2);
    expect(page1.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(page2.map((t) => t.id)).toEqual(["t3"]);
  });

  it("the Reminders tab lists every thread with a pending reminder, inbox or not, soonest due first (REQ-2.3)", async () => {
    await seedThread(ACC, "sent-1", { at: 100, labels: ["SENT"] });
    await seedThread(ACC, "inbox-1", { at: 200, labels: ["INBOX"] });
    await seedThread(ACC, "done-1", { at: 300, labels: ["SENT"] });
    await seedThread(ACC, "none-1", { at: 400, labels: ["INBOX"] });
    await seedThread(OTHER, "other-1", { at: 500, labels: ["SENT"] });
    await seedReminder(ACC, "sent-1", 5000);
    await seedReminder(ACC, "inbox-1", 4000);
    await seedReminder(ACC, "done-1", 1000, "triggered");
    await seedReminder(OTHER, "other-1", 10);

    const threads = await getThreadsWithPendingReminders(ACC, 50, 0);
    expect(threads.map((t) => t.id)).toEqual(["inbox-1", "sent-1"]);
  });

  it("counts total and unread per tab in one pass: categories (uncategorised → Primary), labels, reminders (REQ-2.4, 3.1)", async () => {
    await seedThread(ACC, "p1", { labels: ["INBOX"] }); // uncategorised, unread → Primary
    await seedThread(ACC, "p2", { labels: ["INBOX", "Label_inv"], read: true });
    await seedCategory(ACC, "p2", "Primary");
    await seedThread(ACC, "u1", { labels: ["INBOX", "Label_inv"] });
    await seedCategory(ACC, "u1", "Updates");
    await seedThread(ACC, "a1", { labels: ["Label_inv"] }); // archived: no label-tab count
    await seedThread(ACC, "s1", { labels: ["SENT"], read: true });
    await seedReminder(ACC, "s1", 100);
    await seedReminder(ACC, "u1", 200);
    await seedThread(OTHER, "o1", { labels: ["INBOX", "Label_inv"] });
    await seedReminder(OTHER, "o1", 300);

    const counts = await getSplitTabCounts(ACC, {
      categories: ["Primary", "Updates", "Promotions"],
      labelIds: ["Label_inv", "Label_none"],
      reminders: true,
    });

    expect(counts.get("Primary")).toEqual({ total: 2, unread: 1 });
    expect(counts.get("Updates")).toEqual({ total: 1, unread: 1 });
    expect(counts.get("Promotions")).toEqual({ total: 0, unread: 0 });
    expect(counts.get("label:Label_inv")).toEqual({ total: 2, unread: 1 });
    expect(counts.get("label:Label_none")).toEqual({ total: 0, unread: 0 });
    expect(counts.get("reminders")).toEqual({ total: 2, unread: 1 });
  });

  it("counts a thread once however many pending reminders it carries, and lists it once (Gemini H1)", async () => {
    await seedThread(ACC, "twice", { labels: ["SENT"] });
    await harness.db.execute(
      "INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status) VALUES ('fu-a', $1, 'twice', 'm-a', 500, 'pending')",
      [ACC],
    );
    await harness.db.execute(
      "INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status) VALUES ('fu-b', $1, 'twice', 'm-b', 100, 'pending')",
      [ACC],
    );
    const counts = await getSplitTabCounts(ACC, { categories: [], labelIds: [], reminders: true });
    expect(counts.get("reminders")).toEqual({ total: 1, unread: 1 });
    expect((await getThreadsWithPendingReminders(ACC, 50, 0)).map((t) => t.id)).toEqual(["twice"]);
  });

  it("uncategorised threads count under Primary only when Primary is a tab; otherwise they count nowhere (Gemini N1)", async () => {
    await seedThread(ACC, "p1", { labels: ["INBOX"] });
    const withPrimary = await getSplitTabCounts(ACC, { categories: ["Primary", "Updates"], labelIds: [], reminders: false });
    expect(withPrimary.get("Primary")).toEqual({ total: 1, unread: 1 });
    const without = await getSplitTabCounts(ACC, { categories: ["Updates"], labelIds: [], reminders: false });
    expect(without.get("Updates")).toEqual({ total: 0, unread: 0 });
    expect(without.has("Primary")).toBe(false);
  });

  it("asks for nothing it was not given: no categories, no labels, no reminders → an empty map", async () => {
    expect((await getSplitTabCounts(ACC, { categories: [], labelIds: [], reminders: false })).size).toBe(0);
  });
});
