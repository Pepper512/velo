import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SPEC-F-1 REQ-1.1, REQ-1.2, REQ-2.1, NFR-1 — driven against real SQLite so the
 * production SQL in `setThreadLabels` and `getThreadsForAccount` is what runs.
 */
const harnessRef: { current: ReturnType<typeof createSqliteHarness> | null } = { current: null };

vi.mock("@/services/db/connection", () => ({
  getDb: () => Promise.resolve(harnessRef.current!.db),
  withTransaction: async (fn: (db: unknown) => Promise<void>) => fn(harnessRef.current!.db),
}));

import { createSqliteHarness } from "@/test/sqliteHarness";
import { runMigrations } from "./migrations";
import { setThreadLabels, getThreadsForAccount, getThreadLabelIds } from "./threads";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";

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
  opts: { snoozeUntil?: number; labels?: string[]; lastMessageAt?: number } = {},
) {
  // Raw seed: `upsertThread`'s ON CONFLICT clause reuses placeholders, which the
  // harness's translator rejects by design. Setup may bypass the production layer.
  await harnessRef.current!.db.execute(
    "INSERT INTO threads (id, account_id, subject, last_message_at, message_count) VALUES ($1, $2, $3, $4, 1)",
    [id, accountId, `Thread ${id}`, opts.lastMessageAt ?? 1_000],
  );
  if (opts.snoozeUntil !== undefined) {
    await harnessRef.current!.db.execute(
      "UPDATE threads SET is_snoozed = 1, snooze_until = $1 WHERE account_id = $2 AND id = $3",
      [opts.snoozeUntil, accountId, id],
    );
  }
  for (const label of opts.labels ?? []) {
    await harnessRef.current!.db.execute(
      "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
      [accountId, id, label],
    );
  }
}

describe("setThreadLabels with a snoozed thread (SPEC-F-1)", () => {
  let harness: ReturnType<typeof createSqliteHarness>;
  const now = getCurrentUnixTimestamp();

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

  it("keeps a not-yet-due snoozed thread out of INBOX when sync rewrites its labels (REQ-1.1)", async () => {
    await seedThread(ACC, "t1", { snoozeUntil: now + 3600, labels: ["SNOOZED"] });

    // What every sync path does: replace the label set with the server's.
    await setThreadLabels(ACC, "t1", ["INBOX", "IMPORTANT"]);

    const labels = await getThreadLabelIds(ACC, "t1");
    expect(labels).not.toContain("INBOX");
    expect(labels).toContain("SNOOZED");
    expect(labels).toContain("IMPORTANT");
  });

  it("stores the server's labels unchanged once the snooze is due (REQ-1.2, expiry race)", async () => {
    await seedThread(ACC, "t1", { snoozeUntil: now - 1, labels: ["SNOOZED"] });

    await setThreadLabels(ACC, "t1", ["INBOX"]);

    const labels = await getThreadLabelIds(ACC, "t1");
    expect(labels).toEqual(["INBOX"]);
  });

  it("stores labels exactly as given for a thread that is not snoozed", async () => {
    await seedThread(ACC, "t1", { labels: ["INBOX"] });

    await setThreadLabels(ACC, "t1", ["INBOX", "STARRED"]);

    expect((await getThreadLabelIds(ACC, "t1")).sort()).toEqual(["INBOX", "STARRED"]);
  });

  it("scopes the override to the account (NFR-1, multi-account)", async () => {
    await seedThread(ACC, "shared-id", { snoozeUntil: now + 3600, labels: ["SNOOZED"] });
    await seedThread(OTHER, "shared-id", { labels: ["INBOX"] });

    await setThreadLabels(OTHER, "shared-id", ["INBOX"]);
    await setThreadLabels(ACC, "shared-id", ["INBOX"]);

    expect(await getThreadLabelIds(OTHER, "shared-id")).toEqual(["INBOX"]);
    expect(await getThreadLabelIds(ACC, "shared-id")).toEqual(["SNOOZED"]);
  });
});

describe("Snoozed folder ordering (SPEC-F-1 REQ-2.1)", () => {
  let harness: ReturnType<typeof createSqliteHarness>;
  const now = getCurrentUnixTimestamp();

  beforeEach(async () => {
    harness = createSqliteHarness();
    harnessRef.current = harness;
    await runMigrations();
    await seedAccount(ACC, "me@example.com");
  });

  afterEach(() => {
    harness.close();
    harnessRef.current = null;
  });

  it("lists the Snoozed folder soonest-due first, regardless of last message time", async () => {
    await seedThread(ACC, "late", { snoozeUntil: now + 9000, labels: ["SNOOZED"], lastMessageAt: 3_000 });
    await seedThread(ACC, "soon", { snoozeUntil: now + 1000, labels: ["SNOOZED"], lastMessageAt: 1_000 });
    await seedThread(ACC, "mid", { snoozeUntil: now + 5000, labels: ["SNOOZED"], lastMessageAt: 2_000 });

    const rows = await getThreadsForAccount(ACC, "SNOOZED");
    expect(rows.map((r) => r.id)).toEqual(["soon", "mid", "late"]);
  });

  it("leaves other folders ordered by pinned then newest message", async () => {
    await seedThread(ACC, "older", { labels: ["INBOX"], lastMessageAt: 1_000 });
    await seedThread(ACC, "newer", { labels: ["INBOX"], lastMessageAt: 2_000 });

    const rows = await getThreadsForAccount(ACC, "INBOX");
    expect(rows.map((r) => r.id)).toEqual(["newer", "older"]);
  });
});
