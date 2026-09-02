import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SPEC-F-4 rev 5, part 1 — the pure decisions (REQ-1.1, REQ-3.1, REQ-1.2(c))
 * and the suspect state machine (REQ-1.5, REQ-1.4) on real SQLite with the
 * real migrations.
 */
const harnessRef: { current: ReturnType<typeof createSqliteHarness> | null } = { current: null };

vi.mock("@/services/db/connection", () => ({
  getDb: () => Promise.resolve(harnessRef.current!.db),
  withTransaction: async (fn: (db: unknown) => Promise<void>) => {
    const db = harnessRef.current!.db;
    await db.execute("BEGIN TRANSACTION", []);
    try {
      await fn(db);
      await db.execute("COMMIT", []);
    } catch (err) {
      try {
        await db.execute("ROLLBACK", []);
      } catch {
        // already rolled back
      }
      throw err;
    }
  },
}));

import { createSqliteHarness } from "@/test/sqliteHarness";
import { runMigrations } from "../db/migrations";
import {
  diffVanished,
  deletionCap,
  planDeletions,
  recordMissing,
  clearReappeared,
  purgeOtherGenerations,
  confirmedOnPass,
  applySearchAll,
  type SuspectRow,
} from "./reconcile";

describe("F-4 pure decisions", () => {
  it("diffVanished lists local UIDs the server no longer has, sorted and deduplicated", () => {
    expect(diffVanished([5, 1, 9, 3], [1, 3, 7])).toEqual([5, 9]);
    expect(diffVanished([], [1])).toEqual([]);
    expect(diffVanished([1, 2], [])).toEqual([1, 2]);
    expect(diffVanished([9, 9, 5], [])).toEqual([5, 9]);
  });

  it("deletionCap binds at every folder size (REQ-3.1: min(500, max(10, ⌈10%⌉)))", () => {
    expect(deletionCap(0)).toBe(10);
    expect(deletionCap(50)).toBe(10);
    expect(deletionCap(101)).toBe(11);
    expect(deletionCap(2_500)).toBe(250);
    expect(deletionCap(100_000)).toBe(500);
  });

  it("planDeletions is a budget, never a precondition (rev 5 HIGH: 15 over a cap of 10 deletes 10, then 5)", () => {
    expect(planDeletions(50, 15)).toEqual({ budget: 10, stop: false });
    // next pass: 5 left over 40 rows
    expect(planDeletions(40, 5)).toEqual({ budget: 5, stop: false });
    expect(planDeletions(50, 0)).toEqual({ budget: 0, stop: false });
  });

  it("stops behind a human above 50% of a folder with more than 10 rows", () => {
    expect(planDeletions(11, 6)).toEqual({ budget: 0, stop: true });
    expect(planDeletions(100, 51)).toEqual({ budget: 0, stop: true });
    expect(planDeletions(100, 50)).toEqual({ budget: 10, stop: false });
  });

  it("lets a folder of at most 10 rows clear fully in one pass (stated decision, rev 5 MEDIUM)", () => {
    expect(planDeletions(10, 10)).toEqual({ budget: 10, stop: false });
    expect(planDeletions(6, 6)).toEqual({ budget: 6, stop: false });
  });

  it("treats inconsistent counts as a stop, never a budget (Grok L8)", () => {
    expect(planDeletions(0, 8)).toEqual({ budget: 0, stop: true });
    expect(planDeletions(-1, 1)).toEqual({ budget: 0, stop: true });
    expect(planDeletions(5, 8)).toEqual({ budget: 0, stop: true });
    expect(planDeletions(0, 0)).toEqual({ budget: 0, stop: false });
  });

  it("cannot re-cross the stop from below: batching strictly decreases the ratio", () => {
    // 20 confirmed of 50 rows → ratio 0.4; delete the budget of 10 → 10 of 40 = 0.25.
    const first = planDeletions(50, 20);
    expect(first).toEqual({ budget: 10, stop: false });
    expect(planDeletions(50 - first.budget, 20 - first.budget)).toEqual({ budget: 10, stop: false });
  });
});

describe("F-4 suspect state machine (SQLite harness)", () => {
  const ACC = "acc-1";
  const F = "INBOX";
  const GEN = 7;

  function rows(): SuspectRow[] {
    return harnessRef.current!.raw
      .prepare<[], SuspectRow>("SELECT * FROM reconcile_suspects ORDER BY uid")
      .all();
  }

  beforeEach(async () => {
    harnessRef.current = createSqliteHarness();
    await runMigrations();
    harnessRef.current.raw
      .prepare("INSERT INTO accounts (id, email, provider) VALUES (?, ?, 'imap')")
      .run(ACC, "user@example.com");
  });

  afterEach(() => {
    harnessRef.current?.close();
    harnessRef.current = null;
  });

  it("migration 26 adds the counter column with a default of 0", () => {
    harnessRef.current!.raw
      .prepare("INSERT INTO folder_sync_state (account_id, folder_path, last_uid) VALUES (?, ?, 0)")
      .run(ACC, F);
    const [row] = harnessRef.current!.raw
      .prepare<[], { flagged_not_expunged: number }>("SELECT flagged_not_expunged FROM folder_sync_state")
      .all();
    expect(row!.flagged_not_expunged).toBe(0);
  });

  it("records a newly missing UID as suspect, never confirmed, on first sight (REQ-1.1)", async () => {
    await recordMissing(ACC, F, GEN, "pass-1", [{ uid: 5, messageRowId: "m5" }]);

    expect(rows()).toMatchObject([
      { uid: 5, status: "suspect", first_pass_id: "pass-1", last_verified_pass_id: null },
    ]);
    await expect(confirmedOnPass(ACC, F, GEN, "pass-1")).resolves.toEqual([]);
  });

  it("does not promote on the same pass that first recorded it, even if reported twice", async () => {
    await recordMissing(ACC, F, GEN, "pass-1", [{ uid: 5, messageRowId: "m5" }]);
    await recordMissing(ACC, F, GEN, "pass-1", [{ uid: 5, messageRowId: "m5" }]);

    expect(rows()).toMatchObject([{ uid: 5, status: "suspect" }]);
  });

  it("promotes to confirmed_absent only on a later pass that searched the folder again (REQ-1.2(a), REQ-1.5)", async () => {
    await recordMissing(ACC, F, GEN, "pass-1", [{ uid: 5, messageRowId: "m5" }]);
    await recordMissing(ACC, F, GEN, "pass-2", [
      { uid: 5, messageRowId: "m5" },
      { uid: 6, messageRowId: "m6" },
    ]);

    expect(rows()).toMatchObject([
      { uid: 5, status: "confirmed_absent", last_verified_pass_id: "pass-2" },
      { uid: 6, status: "suspect", first_pass_id: "pass-2" },
    ]);
    const confirmed = await confirmedOnPass(ACC, F, GEN, "pass-2");
    expect(confirmed.map((r) => r.uid)).toEqual([5]);
  });

  it("the end-of-pass deletion set is only what this pass verified (G3's masking arrival)", async () => {
    await recordMissing(ACC, F, GEN, "pass-1", [{ uid: 5, messageRowId: "m5" }]);
    await recordMissing(ACC, F, GEN, "pass-2", [{ uid: 5, messageRowId: "m5" }]);
    // pass-3: the gate skipped this folder's search — nothing recorded.
    await expect(confirmedOnPass(ACC, F, GEN, "pass-3")).resolves.toEqual([]);
    // pass-4 searches again and still does not list it: verified this pass.
    await recordMissing(ACC, F, GEN, "pass-4", [{ uid: 5, messageRowId: "m5" }]);
    expect((await confirmedOnPass(ACC, F, GEN, "pass-4")).map((r) => r.uid)).toEqual([5]);
  });

  it("a reappearing UID clears its record at any status (REQ-1.4)", async () => {
    await recordMissing(ACC, F, GEN, "pass-1", [
      { uid: 5, messageRowId: "m5" },
      { uid: 6, messageRowId: "m6" },
    ]);
    await recordMissing(ACC, F, GEN, "pass-2", [{ uid: 5, messageRowId: "m5" }]);
    await clearReappeared(ACC, F, GEN, [5, 6]);
    expect(rows()).toEqual([]);
  });

  it("clearReappeared consults the folder's suspects, not the server list: zero suspects means zero writes", async () => {
    const before = harnessRef.current!.statements.length;
    const bigServerList = Array.from({ length: 20_000 }, (_, i) => i + 1);
    await clearReappeared(ACC, F, GEN, bigServerList);

    const ran = harnessRef.current!.statements.slice(before);
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatch(/^SELECT uid FROM reconcile_suspects/);
  });

  it("recordMissing is one transaction: a bulk removal is recorded whole or not at all", async () => {
    const before = harnessRef.current!.statements.length;
    await recordMissing(
      ACC,
      F,
      GEN,
      "pass-1",
      Array.from({ length: 900 }, (_, i) => ({ uid: i + 1, messageRowId: `m${i + 1}` })),
    );
    const ran = harnessRef.current!.statements.slice(before);
    expect(ran.filter((s) => s.startsWith("BEGIN"))).toHaveLength(1);
    expect(ran.filter((s) => s.startsWith("COMMIT"))).toHaveLength(1);
    expect(rows()).toHaveLength(900);
  });

  it("re-stamps a budget leftover on the next search so it stays eligible, and leaves a confirmed row alone when not reported (Grok NIT 10)", async () => {
    await recordMissing(ACC, F, GEN, "pass-1", [
      { uid: 5, messageRowId: "m5" },
      { uid: 6, messageRowId: "m6" },
    ]);
    await recordMissing(ACC, F, GEN, "pass-2", [
      { uid: 5, messageRowId: "m5" },
      { uid: 6, messageRowId: "m6" },
    ]);
    // pass-3: the budget deleted 5 last time (simulated by forgetting nothing —
    // 5 is still confirmed); the search still misses 6 only.
    await recordMissing(ACC, F, GEN, "pass-3", [{ uid: 6, messageRowId: "m6" }]);

    expect((await confirmedOnPass(ACC, F, GEN, "pass-3")).map((r) => r.uid)).toEqual([6]);
    expect(rows()).toMatchObject([
      { uid: 5, status: "confirmed_absent", last_verified_pass_id: "pass-2" },
      { uid: 6, status: "confirmed_absent", last_verified_pass_id: "pass-3" },
    ]);
  });

  it("scopes the deletion set to the current generation even when pass ids collide (Grok M4)", async () => {
    await recordMissing(ACC, F, 6, "pass-1", [{ uid: 5, messageRowId: "m5" }]);
    await recordMissing(ACC, F, 6, "pass-2", [{ uid: 5, messageRowId: "m5" }]);
    expect(await confirmedOnPass(ACC, F, GEN, "pass-2")).toEqual([]);
    expect((await confirmedOnPass(ACC, F, 6, "pass-2")).map((r) => r.uid)).toEqual([5]);
  });

  it("applySearchAll runs purge → clear → record atomically, and a resurrected UID needs two fresh observations again (Grok M4)", async () => {
    const obs = (passId: string, present: number[], missing: number[]) =>
      applySearchAll({
        accountId: ACC,
        folder: F,
        uidvalidity: GEN,
        passId,
        presentUids: present,
        missing: missing.map((uid) => ({ uid, messageRowId: `m${uid}` })),
      });

    await recordMissing(ACC, F, 6, "pass-0", [{ uid: 5, messageRowId: "m5" }]); // stale generation
    await obs("pass-1", [1, 2], [5]);
    expect(rows()).toMatchObject([{ uid: 5, uidvalidity: GEN, status: "suspect" }]); // purged gen 6
    await obs("pass-2", [1, 2], [5]);
    expect((await confirmedOnPass(ACC, F, GEN, "pass-2")).map((r) => r.uid)).toEqual([5]);

    // It comes back (moved back by another client), then vanishes once more.
    await obs("pass-3", [1, 2, 5], []);
    expect(rows()).toEqual([]);
    await obs("pass-4", [1, 2], [5]);
    expect(rows()).toMatchObject([{ uid: 5, status: "suspect", first_pass_id: "pass-4" }]);
    expect(await confirmedOnPass(ACC, F, GEN, "pass-4")).toEqual([]);

    const s = harnessRef.current!.statements;
    const lastBegin = s.lastIndexOf("BEGIN TRANSACTION");
    expect(s.slice(lastBegin).filter((x) => x.startsWith("COMMIT"))).toHaveLength(1);
  });

  it("a folder error clears nothing: suspects persist un-aged when no search runs (REQ-1.4, REQ-3.3)", async () => {
    await recordMissing(ACC, F, GEN, "pass-1", [{ uid: 5, messageRowId: "m5" }]);
    // Nothing is called for pass-2 (the folder errored). The row is untouched.
    expect(rows()).toMatchObject([{ uid: 5, status: "suspect", first_pass_id: "pass-1" }]);
  });

  it("purges suspects from another UIDVALIDITY generation before diffing (REQ-1.5, G6)", async () => {
    await recordMissing(ACC, F, 6, "pass-1", [{ uid: 5, messageRowId: "m5" }]);
    await recordMissing(ACC, F, GEN, "pass-1", [{ uid: 9, messageRowId: "m9" }]);
    await purgeOtherGenerations(ACC, F, GEN);
    expect(rows()).toMatchObject([{ uid: 9, uidvalidity: GEN }]);
  });

  it("keys per folder and account: the same UID elsewhere is a different suspect", async () => {
    await recordMissing(ACC, F, GEN, "pass-1", [{ uid: 5, messageRowId: "m5" }]);
    await recordMissing(ACC, "Sent", GEN, "pass-1", [{ uid: 5, messageRowId: "s5" }]);
    await recordMissing(ACC, F, GEN, "pass-2", [{ uid: 5, messageRowId: "m5" }]);

    expect((await confirmedOnPass(ACC, F, GEN, "pass-2")).map((r) => r.folder)).toEqual([F]);
    expect(await confirmedOnPass(ACC, "Sent", GEN, "pass-2")).toEqual([]);
  });

  it("orders confirmed rows oldest-first for the batching cap (REQ-3.1)", async () => {
    harnessRef.current!.raw
      .prepare(
        `INSERT INTO reconcile_suspects (account_id, folder, uid, uidvalidity, message_row_id, status, first_pass_id, last_verified_pass_id, first_seen_at)
         VALUES (?, ?, ?, ?, ?, 'confirmed_absent', 'p0', 'p9', ?)`,
      )
      .run(ACC, F, 20, GEN, "m20", 200);
    harnessRef.current!.raw
      .prepare(
        `INSERT INTO reconcile_suspects (account_id, folder, uid, uidvalidity, message_row_id, status, first_pass_id, last_verified_pass_id, first_seen_at)
         VALUES (?, ?, ?, ?, ?, 'confirmed_absent', 'p0', 'p9', ?)`,
      )
      .run(ACC, F, 10, GEN, "m10", 100);

    expect((await confirmedOnPass(ACC, F, GEN, "p9")).map((r) => r.uid)).toEqual([10, 20]);
  });
});
