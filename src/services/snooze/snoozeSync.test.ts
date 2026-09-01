import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SPEC-F-1 REQ-1.3 — a genuinely new message from someone else un-snoozes a
 * thread; the user's own reply (account address or send-as alias) does not.
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

import { createSqliteHarness } from "@/test/sqliteHarness";
import { runMigrations } from "@/services/db/migrations";
import { getThreadLabelIds } from "@/services/db/threads";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";
import { getOwnAddresses, clearSnoozeForNewExternalMessages } from "./snoozeSync";

const ACC = "acc-1";
const THREAD = "t1";

async function seedSnoozedThread(untilOffset = 3600) {
  const db = harnessRef.current!.db;
  // Raw seeds: the production upserts reuse placeholders in ON CONFLICT clauses,
  // which the harness rejects by design. Setup may bypass the production layer.
  await db.execute(
    "INSERT INTO threads (id, account_id, subject, last_message_at, message_count) VALUES ($1, $2, 's', 1000, 1)",
    [THREAD, ACC],
  );
  await db.execute(
    "UPDATE threads SET is_snoozed = 1, snooze_until = $1 WHERE account_id = $2 AND id = $3",
    [getCurrentUnixTimestamp() + untilOffset, ACC, THREAD],
  );
  await db.execute(
    "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, 'SNOOZED')",
    [ACC, THREAD],
  );
  await db.execute(
    "INSERT INTO messages (id, account_id, thread_id, from_address, date) VALUES ('m1', $1, $2, 'them@corp.test', 1000)",
    [ACC, THREAD],
  );
}

async function snoozeState() {
  const rows = await harnessRef.current!.db.select<{ is_snoozed: number; snooze_until: number | null }[]>(
    "SELECT is_snoozed, snooze_until FROM threads WHERE account_id = $1 AND id = $2",
    [ACC, THREAD],
  );
  return rows[0]!;
}

describe("snoozeSync (SPEC-F-1 REQ-1.3)", () => {
  let harness: ReturnType<typeof createSqliteHarness>;

  beforeEach(async () => {
    harness = createSqliteHarness();
    harnessRef.current = harness;
    await runMigrations();
    await harness.db.execute(
      "INSERT INTO accounts (id, email, provider) VALUES ($1, $2, 'gmail_api')",
      [ACC, "Me@Example.com"],
    );
    await harness.db.execute(
      "INSERT INTO send_as_aliases (id, account_id, email) VALUES ('a1', $1, 'Alias@Example.com')",
      [ACC],
    );
  });

  afterEach(() => {
    harness.close();
    harnessRef.current = null;
  });

  it("getOwnAddresses returns the account address and every send-as alias, lower-cased", async () => {
    const own = await getOwnAddresses(ACC);
    expect(own).toEqual(new Set(["me@example.com", "alias@example.com"]));
  });

  it("un-snoozes when a message not yet stored arrives from someone else", async () => {
    await seedSnoozedThread();
    const own = await getOwnAddresses(ACC);

    const cleared = await clearSnoozeForNewExternalMessages(
      ACC, THREAD, [{ id: "m1", fromAddress: "them@corp.test" }, { id: "m2", fromAddress: "them@corp.test" }], own,
    );

    expect(cleared).toBe(true);
    expect(await snoozeState()).toEqual({ is_snoozed: 0, snooze_until: null });
    expect(await getThreadLabelIds(ACC, THREAD)).not.toContain("SNOOZED");
  });

  it("keeps the snooze when the only new message is the user's own reply", async () => {
    await seedSnoozedThread();
    const own = await getOwnAddresses(ACC);

    const cleared = await clearSnoozeForNewExternalMessages(
      ACC, THREAD, [{ id: "m2", fromAddress: "me@example.com" }], own,
    );

    expect(cleared).toBe(false);
    expect((await snoozeState()).is_snoozed).toBe(1);
    expect(await getThreadLabelIds(ACC, THREAD)).toContain("SNOOZED");
  });

  it("treats a send-as alias as the user's own address, case-insensitively", async () => {
    await seedSnoozedThread();
    const own = await getOwnAddresses(ACC);

    const cleared = await clearSnoozeForNewExternalMessages(
      ACC, THREAD, [{ id: "m2", fromAddress: "ALIAS@example.COM" }], own,
    );

    expect(cleared).toBe(false);
    expect((await snoozeState()).is_snoozed).toBe(1);
  });

  it("keeps the snooze when every incoming message is already stored", async () => {
    await seedSnoozedThread();
    const own = await getOwnAddresses(ACC);

    const cleared = await clearSnoozeForNewExternalMessages(
      ACC, THREAD, [{ id: "m1", fromAddress: "them@corp.test" }], own,
    );

    expect(cleared).toBe(false);
    expect((await snoozeState()).is_snoozed).toBe(1);
  });

  it("does nothing for a thread that is not snoozed", async () => {
    await seedSnoozedThread();
    await harness.db.execute("UPDATE threads SET is_snoozed = 0, snooze_until = NULL", []);
    const own = await getOwnAddresses(ACC);

    const cleared = await clearSnoozeForNewExternalMessages(
      ACC, THREAD, [{ id: "m9", fromAddress: "them@corp.test" }], own,
    );

    expect(cleared).toBe(false);
  });
});
