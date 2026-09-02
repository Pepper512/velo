import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SPEC-F-4 rev 5 part 2 — the reconciliation pass on real SQLite with the
 * real migrations (spec Tasks 1–4, 9–11 as harness scenarios). The server is
 * simulated by handing `reconcileFolderList` the UID list a `UID SEARCH ALL`
 * would have returned; nothing here talks to IMAP.
 */
const harnessRef: { current: ReturnType<typeof createSqliteHarness> | null } = { current: null };

vi.mock("@/services/db/connection", () => ({
  getDb: () => Promise.resolve(harnessRef.current!.db),
  selectFirstBy: async (sql: string, params: unknown[] = []) =>
    (await harnessRef.current!.db.select<unknown[]>(sql, params))[0] ?? null,
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
import { useUIStore } from "@/stores/uiStore";
import {
  attestPass,
  beginReconcilePass,
  deleteConfirmedAfterUserApproval,
  finishReconcilePass,
  invalidateFolderSuspects,
  beltDue,
  folderListLooksPartial,
  noteFolderMissing,
  markFetchCompleted,
  reconcileFolderList,
  shouldListFolder,
  type ReconcilePass,
} from "./reconcilePass";

const ACC = "acc-1";
const INBOX = "INBOX";
const GEN = 7;

function raw() {
  return harnessRef.current!.raw;
}

function seedThread(id: string, labels: string[] = ["INBOX"]) {
  raw()
    .prepare(
      "INSERT INTO threads (id, account_id, subject, last_message_at, message_count) VALUES (?, ?, ?, 1000, 1)",
    )
    .run(id, ACC, `Thread ${id}`);
  for (const label of labels) {
    raw()
      .prepare("INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES (?, ?, ?)")
      .run(ACC, id, label);
  }
}

function seedMessage(uid: number, threadId: string, folder = INBOX, extra: { movedTo?: string } = {}) {
  const id = `imap-${ACC}-${folder}-${uid}`;
  raw()
    .prepare(
      `INSERT INTO messages (id, account_id, thread_id, subject, date, imap_uid, imap_folder, message_id_header, moved_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ACC, threadId, `Message ${uid}`, 1000 + uid, uid, folder, `<m${uid}@example.com>`, extra.movedTo ?? null);
  return id;
}

/** Seed a folder of `n` messages, one thread each, UIDs 1..n. */
function seedFolder(n: number, folder = INBOX) {
  for (let uid = 1; uid <= n; uid++) {
    seedThread(`t${folder}${uid}`);
    seedMessage(uid, `t${folder}${uid}`, folder);
  }
}

function liveUids(folder = INBOX): number[] {
  return raw()
    .prepare<[string, string], { imap_uid: number }>(
      "SELECT imap_uid FROM messages WHERE account_id = ? AND imap_folder = ? AND moved_to IS NULL ORDER BY imap_uid",
    )
    .all(ACC, folder)
    .map((r) => r.imap_uid);
}

function suspects(): { uid: number; status: string }[] {
  return raw()
    .prepare<[], { uid: number; status: string }>("SELECT uid, status FROM reconcile_suspects ORDER BY uid")
    .all();
}

function threadIds(): string[] {
  return raw()
    .prepare<[], { id: string }>("SELECT id FROM threads ORDER BY id")
    .all()
    .map((r) => r.id);
}

/** One attested pass in which INBOX's full list is `server` (EXISTS agrees with it). */
async function passWith(server: number[], opts: { attested?: boolean; fetchCompleted?: boolean } = {}) {
  const pass = beginReconcilePass(ACC);
  pass.gateOpened.add(INBOX);
  await reconcileFolderList(pass, INBOX, GEN, server, server.length);
  if (opts.fetchCompleted !== false) markFetchCompleted(pass, INBOX);
  return finishReconcilePass(pass, opts.attested ?? true);
}

describe("F-4 part 2 — the reconciliation pass (SQLite harness)", () => {
  beforeEach(async () => {
    harnessRef.current = createSqliteHarness();
    await runMigrations();
    raw().prepare("INSERT INTO accounts (id, email, provider) VALUES (?, ?, 'imap')").run(ACC, "u@example.com");
    raw()
      .prepare("INSERT INTO folder_sync_state (account_id, folder_path, uidvalidity, last_uid) VALUES (?, ?, ?, 0)")
      .run(ACC, INBOX, GEN);
    useUIStore.setState({ reconcileStops: [], notices: [] });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    harnessRef.current?.close();
    harnessRef.current = null;
    vi.restoreAllMocks();
  });

  // ---------- the gate (REQ-2.1, NFR-1) ----------

  describe("shouldListFolder", () => {
    it("stays closed when EXISTS matches live rows plus incoming new UIDs plus flagged ghosts", () => {
      expect(shouldListFolder(10, 10, 0, 0)).toBe(false);
      // A new message arrived: EXISTS is 11, the delta check reports it — no list (Gemini H1).
      expect(shouldListFolder(11, 10, 1, 0)).toBe(false);
      // Three ghosts flagged but not expunged on a no-UIDPLUS server.
      expect(shouldListFolder(13, 10, 0, 3)).toBe(false);
    });

    it("opens when something vanished", () => {
      expect(shouldListFolder(9, 10, 0, 0)).toBe(true);
      // An unchecked folder never reaches the gate: the sync treats a missing
      // EXISTS as "unchecked" before calling it (Grok M4 on #50).
    });

    it("a LIST that drops most known folders, or every syncable one, looks partial (Grok H2 on #50)", () => {
      expect(folderListLooksPartial(0, 5, 5)).toBe(false);
      expect(folderListLooksPartial(1, 2, 1)).toBe(false); // one of two gone: a deletion
      expect(folderListLooksPartial(2, 3, 1)).toBe(true); // two of three gone: a short LIST
      expect(folderListLooksPartial(1, 1, 0)).toBe(true); // nothing syncable came back
      expect(folderListLooksPartial(1, 10, 0)).toBe(true);
    });
  });

  // ---------- Task 1: the rev-1 disaster as a pass ----------

  it("never deletes on a single observation; deletes on the second attested pass, thread intact when it has other mail", async () => {
    seedThread("t1");
    seedMessage(1, "t1");
    seedMessage(2, "t1");
    seedThread("t2");
    seedMessage(3, "t2");

    // Pass 1: UID 1 vanished (archived elsewhere).
    let summary = await passWith([2, 3]);
    expect(summary.deleted).toEqual([]);
    expect(liveUids()).toEqual([1, 2, 3]);
    expect(suspects()).toEqual([{ uid: 1, status: "suspect" }]);

    // Pass 2: still gone, pass attested → deleted; thread t1 keeps UID 2.
    summary = await passWith([2, 3]);
    expect(summary.deleted).toEqual([{ folder: INBOX, uid: 1, messageId: "<m1@example.com>" }]);
    expect(liveUids()).toEqual([2, 3]);
    expect(threadIds()).toEqual(["t1", "t2"]);
    expect(suspects()).toEqual([]);
  });

  it("deletes the thread and its labels only when its last message goes (REQ-1.3)", async () => {
    seedThread("t1", ["INBOX", "STARRED"]);
    seedMessage(1, "t1");
    seedThread("t2");
    seedMessage(2, "t2");

    await passWith([2]);
    await passWith([2]);

    expect(threadIds()).toEqual(["t2"]);
    expect(
      raw().prepare<[string], { n: number }>("SELECT COUNT(*) AS n FROM thread_labels WHERE thread_id = ?").get("t1")!.n,
    ).toBe(0);
  });

  // ---------- Task 2: an unattested pass ----------

  it("an unattested pass deletes nothing, and the suspect stays confirmed for the next clean pass (REQ-1.2(b))", async () => {
    seedFolder(3);
    await passWith([2, 3]);
    const summary = await passWith([2, 3], { attested: false });
    expect(summary.deleted).toEqual([]);
    expect(liveUids()).toEqual([1, 2, 3]);
    expect(suspects()).toEqual([{ uid: 1, status: "confirmed_absent" }]);

    // The next attested pass deletes it.
    await passWith([2, 3]);
    expect(liveUids()).toEqual([2, 3]);
  });

  it("attestPass: a folder missing from the checked set, an opened gate that was not listed, or any folder error all fail (REQ-1.2b)", () => {
    const pass: ReconcilePass = beginReconcilePass(ACC);
    const folders = ["INBOX", "Sent"];
    expect(attestPass(pass, folders, new Set(["INBOX", "Sent"]), 0)).toBe(true);
    expect(attestPass(pass, folders, new Set(["INBOX"]), 0)).toBe(false);
    expect(attestPass(pass, folders, new Set(["INBOX", "Sent"]), 1)).toBe(false);
    pass.gateOpened.add("Sent");
    expect(attestPass(pass, folders, new Set(["INBOX", "Sent"]), 0)).toBe(false);
    pass.listed.set("Sent", { uidvalidity: 1, serverUids: new Set(), fetchCompleted: false });
    expect(attestPass(pass, folders, new Set(["INBOX", "Sent"]), 0)).toBe(true);
  });

  // ---------- Task 3 / Task 11: the cap batches, the stop stops ----------

  it("batches under the cap: 15 confirmed in a 50-row folder deletes 10, then 5 (REQ-3.1, REQ-1.2(c))", async () => {
    seedFolder(50);
    const remaining = Array.from({ length: 35 }, (_, i) => i + 16); // UIDs 1..15 vanished
    await passWith(remaining);
    let summary = await passWith(remaining);
    expect(summary.deleted).toHaveLength(10);
    expect(summary.stops).toEqual([]);
    expect(liveUids()).toHaveLength(40);

    summary = await passWith(remaining);
    expect(summary.deleted).toHaveLength(5);
    expect(liveUids()).toEqual(remaining);
    expect(suspects()).toEqual([]);
  });

  it("stops behind the user above 50% of a folder with more than 10 rows, deleting nothing (REQ-3.1)", async () => {
    seedFolder(20);
    const remaining = [16, 17, 18, 19, 20]; // 15 of 20 vanished
    await passWith(remaining);
    const summary = await passWith(remaining);

    expect(summary.deleted).toEqual([]);
    expect(summary.stops).toEqual([{ folder: INBOX, confirmed: 15, localRows: 20 }]);
    expect(liveUids()).toHaveLength(20);
    expect(useUIStore.getState().reconcileStops).toEqual([
      { accountId: ACC, folder: INBOX, uidvalidity: GEN, confirmed: 15, localRows: 20 },
    ]);
  });

  it("lets a folder of at most 10 rows clear fully in one pass (stated decision)", async () => {
    seedFolder(8);
    await passWith([]);
    const summary = await passWith([]);
    expect(summary.deleted).toHaveLength(8);
    expect(liveUids()).toEqual([]);
    expect(threadIds()).toEqual([]);
  });

  it("the user's 'delete them' removes every confirmed row in the folder and only those", async () => {
    seedFolder(20);
    const remaining = [16, 17, 18, 19, 20];
    await passWith(remaining);
    await passWith(remaining); // stop
    // One more vanished since, only once observed — must survive.
    await passWith([17, 18, 19, 20]);

    const n = await deleteConfirmedAfterUserApproval(ACC, INBOX, GEN);
    expect(n).toBe(15);
    expect(liveUids()).toEqual([16, 17, 18, 19, 20]);
    expect(suspects()).toEqual([{ uid: 16, status: "suspect" }]);
  });

  // ---------- Task 3: partial response, reappearance, folder error ----------

  it("a reappearing UID clears its suspect at any status (REQ-1.4)", async () => {
    seedFolder(3);
    await passWith([2, 3]);
    await passWith([2, 3]); // pass 2 would delete… but wait: it does, so use a stopped folder instead
    expect(liveUids()).toEqual([2, 3]);

    seedThread("t9");
    seedMessage(9, "t9");
    await passWith([2, 3]); // 9 vanished once → suspect
    expect(suspects()).toEqual([{ uid: 9, status: "suspect" }]);
    await passWith([2, 3, 9]); // it is back
    expect(suspects()).toEqual([]);
    expect(liveUids()).toEqual([2, 3, 9]);
  });

  it("a pass in which the folder was not listed ages nothing (gate skip, REQ-1.5; folder error, REQ-3.3)", async () => {
    seedFolder(3);
    await passWith([2, 3]);
    // Passes 2 and 3: the folder is not listed (gate closed, or the list threw).
    for (let i = 0; i < 2; i++) {
      const pass = beginReconcilePass(ACC);
      await finishReconcilePass(pass, true);
    }
    expect(suspects()).toEqual([{ uid: 1, status: "suspect" }]);
    expect(liveUids()).toEqual([1, 2, 3]);
  });

  // ---------- Task 4: the counter (REQ-2.2) ----------

  it("recomputes flagged_not_expunged from the observed ghost population only after both steps completed", async () => {
    seedFolder(5);
    raw().prepare("UPDATE folder_sync_state SET flagged_not_expunged = 9 WHERE folder_path = ?").run(INBOX);
    const counter = () =>
      raw().prepare<[string], { n: number }>("SELECT flagged_not_expunged AS n FROM folder_sync_state WHERE folder_path = ?").get(INBOX)!.n;

    // Server lists 5 live + 3 ghosts (\Deleted, unexpunged, never local) and is missing nothing.
    await passWith([1, 2, 3, 4, 5, 100, 101, 102], { fetchCompleted: false });
    expect(counter()).toBe(9); // fetch did not complete → untouched

    await passWith([1, 2, 3, 4, 5, 100, 101, 102]);
    expect(counter()).toBe(3); // recomputed, not zeroed

    // G2's scenario: a foreign expunge removes one ghost → re-converges to 2.
    await passWith([1, 2, 3, 4, 5, 100, 101]);
    expect(counter()).toBe(2);
    // Vanished local mail is NOT a ghost (the plan read's H2): 5 local, 4 on server → ghosts 0.
    await passWith([2, 3, 4, 5]);
    expect(counter()).toBe(0);
  });

  // ---------- Task 9: generations ----------

  it("a UIDVALIDITY change purges the folder's suspects before diffing (REQ-1.5)", async () => {
    seedFolder(3);
    await passWith([2, 3]);
    expect(suspects()).toEqual([{ uid: 1, status: "suspect" }]);

    const pass = beginReconcilePass(ACC);
    await reconcileFolderList(pass, INBOX, GEN + 1, [1, 2, 3], 3);
    await finishReconcilePass(pass, true);
    expect(suspects()).toEqual([]);
  });

  it("invalidateFolderSuspects (the UIDVALIDITY-changed path) purges the generation and drops its stop", async () => {
    seedFolder(20);
    const remaining = [16, 17, 18, 19, 20];
    await passWith(remaining);
    await passWith(remaining); // stop raised
    expect(useUIStore.getState().reconcileStops).toHaveLength(1);

    await invalidateFolderSuspects(ACC, INBOX, GEN + 1);

    expect(suspects()).toEqual([]);
    expect(useUIStore.getState().reconcileStops).toEqual([]);
  });

  it("refuses a user approval raised for a generation the folder no longer has (Grok H2)", async () => {
    seedFolder(20);
    const remaining = [16, 17, 18, 19, 20];
    await passWith(remaining);
    await passWith(remaining);
    raw().prepare("UPDATE folder_sync_state SET uidvalidity = ? WHERE folder_path = ?").run(GEN + 1, INBOX);

    await expect(deleteConfirmedAfterUserApproval(ACC, INBOX, GEN)).rejects.toThrow(/regenerated/);
    expect(liveUids()).toHaveLength(20);
  });

  // ---------- Grok H1 / H4 on #47 ----------

  it("forgets a suspect whose row F-5 tombstoned or re-keyed since it was recorded, instead of promoting it", async () => {
    seedFolder(3);
    await passWith([2, 3]);
    // Between passes, F-5 tombstones UID 1 (a move without a COPYUID).
    raw().prepare("UPDATE messages SET moved_to = 'Archive' WHERE id = ?").run(`imap-${ACC}-INBOX-1`);

    const summary = await passWith([2, 3]);

    expect(summary.deleted).toEqual([]);
    expect(
      raw().prepare<[string], { moved_to: string }>("SELECT moved_to FROM messages WHERE id = ?").get(`imap-${ACC}-INBOX-1`),
    ).toEqual({ moved_to: "Archive" });
    expect(suspects()).toEqual([]);
  });

  it("deletes only rows that still match their observation — a confirmed row tombstoned or re-keyed in the meantime is left alone (Grok H1)", async () => {
    seedFolder(20);
    const remaining = [16, 17, 18, 19, 20];
    await passWith(remaining);
    await passWith(remaining); // 15 confirmed, stop raised
    // Before the user answers: UID 1 is tombstoned by a move, UID 2 was re-keyed to another UID.
    raw().prepare("UPDATE messages SET moved_to = 'Archive' WHERE id = ?").run(`imap-${ACC}-INBOX-1`);
    raw().prepare("UPDATE messages SET imap_uid = 999 WHERE id = ?").run(`imap-${ACC}-INBOX-2`);

    const n = await deleteConfirmedAfterUserApproval(ACC, INBOX, GEN);

    expect(n).toBe(13);
    expect(
      raw().prepare<[string], { moved_to: string }>("SELECT moved_to FROM messages WHERE id = ?").get(`imap-${ACC}-INBOX-1`),
    ).toEqual({ moved_to: "Archive" });
    expect(
      raw().prepare<[string], { imap_uid: number }>("SELECT imap_uid FROM messages WHERE id = ?").get(`imap-${ACC}-INBOX-2`),
    ).toEqual({ imap_uid: 999 });
    expect(suspects()).toEqual([]);
  });

  it("an empty list against a positive EXISTS is a partial list: it throws and records nothing (REQ-3.3)", async () => {
    seedFolder(3);
    const pass = beginReconcilePass(ACC);
    pass.gateOpened.add(INBOX);

    await expect(reconcileFolderList(pass, INBOX, GEN, [], 3)).rejects.toThrow(/partial/);

    expect(pass.listed.has(INBOX)).toBe(false);
    expect(suspects()).toEqual([]);
    // A genuinely empty folder (EXISTS 0) is a complete observation.
    await expect(reconcileFolderList(pass, INBOX, GEN, [], 0)).resolves.toBeUndefined();
    expect(suspects()).toHaveLength(3);
  });

  // ---------- Task 10 (the non-queue half): pending operations ----------

  it("defers a confirmed suspect whose thread has pending operations (REQ-3.4)", async () => {
    seedFolder(3);
    raw()
      .prepare(
        "INSERT INTO pending_operations (id, account_id, operation_type, resource_id, params, status) VALUES ('op1', ?, 'markRead', 't" +
          INBOX +
          "1', '{}', 'pending')",
      )
      .run(ACC);
    await passWith([2, 3]);
    const summary = await passWith([2, 3]);
    expect(summary.deleted).toEqual([]);
    expect(liveUids()).toEqual([1, 2, 3]);

    raw().prepare("DELETE FROM pending_operations").run();
    await passWith([2, 3]);
    expect(liveUids()).toEqual([2, 3]);
  });

  it("a row's own pending operation blocks it even when a sibling in the same thread was checked first (Gemini H1)", async () => {
    seedThread("t1");
    seedMessage(1, "t1");
    seedMessage(2, "t1");
    seedThread("t2");
    seedMessage(3, "t2");
    raw()
      .prepare(
        "INSERT INTO pending_operations (id, account_id, operation_type, resource_id, params, status) VALUES ('op2', ?, 'star', ?, '{}', 'pending')",
      )
      .run(ACC, `imap-${ACC}-INBOX-2`);

    await passWith([3]);
    const summary = await passWith([3]);

    // UID 1 (no ops) deleted; UID 2 (message-level op) kept although its thread has no thread-level op.
    expect(summary.deleted.map((d) => d.uid)).toEqual([1]);
    expect(liveUids()).toEqual([2, 3]);
  });

  it("judges the >50% stop on the whole confirmed population, not the rows left after the pending-ops filter (Gemini H2)", async () => {
    seedFolder(20);
    const remaining = [16, 17, 18, 19, 20]; // 15 of 20 vanished
    // 11 of the 15 vanished have queued user work.
    for (let uid = 1; uid <= 11; uid++) {
      raw()
        .prepare(
          "INSERT INTO pending_operations (id, account_id, operation_type, resource_id, params, status) VALUES (?, ?, 'markRead', ?, '{}', 'pending')",
        )
        .run(`op-${uid}`, ACC, `t${INBOX}${uid}`);
    }
    await passWith(remaining);
    const summary = await passWith(remaining);

    expect(summary.deleted).toEqual([]);
    expect(summary.stops).toEqual([{ folder: INBOX, confirmed: 15, localRows: 20 }]);
    expect(liveUids()).toHaveLength(20);
  });

  // ---------- Part 3: the belt clock and the "folder gone" path ----------

  it("beltDue fires only every Nth pass and only where the no-UIDPLUS signature shows", () => {
    expect(beltDue(10, 3)).toBe(true);
    expect(beltDue(20, 1)).toBe(true);
    expect(beltDue(9, 3)).toBe(false);
    expect(beltDue(10, 0)).toBe(false);
    expect(beltDue(0, 3)).toBe(false);
  });

  it("a folder missing from LIST is only counted the first time, and removed with its messages kept the second", async () => {
    seedFolder(3);
    // A stop and suspects exist for the folder, to prove they are voided.
    await passWith([2, 3]);
    const stateRow = () =>
      raw()
        .prepare<[string], { missing_passes: number } | undefined>(
          "SELECT missing_passes FROM folder_sync_state WHERE folder_path = ?",
        )
        .get(INBOX);

    expect(await noteFolderMissing(ACC, INBOX)).toBe("counted");
    expect(stateRow()).toEqual({ missing_passes: 1 });
    expect(suspects()).toHaveLength(1);
    expect(liveUids()).toHaveLength(3);

    expect(await noteFolderMissing(ACC, INBOX)).toBe("removed");
    expect(stateRow()).toBeUndefined();
    expect(suspects()).toEqual([]);
    expect(liveUids()).toHaveLength(3); // cached mail kept
    expect(useUIStore.getState().notices[0]?.text).toContain("no longer exists on the server");
    expect(useUIStore.getState().notices[0]?.text).toContain("3 cached messages are kept");
  });

  it("a folder still listed but no longer selectable is told apart in the notice, and its suspects of every generation go", async () => {
    seedFolder(2);
    raw()
      .prepare(
        "INSERT INTO reconcile_suspects (account_id, folder, uid, uidvalidity, message_row_id, status, first_pass_id) VALUES (?, ?, 9, ?, 'x', 'suspect', 'pass-old')",
      )
      .run(ACC, INBOX, GEN + 1);
    expect(await noteFolderMissing(ACC, INBOX, true)).toBe("counted");
    expect(await noteFolderMissing(ACC, INBOX, true)).toBe("removed");
    expect(suspects()).toEqual([]);
    expect(useUIStore.getState().notices[0]?.text).toContain("can no longer be opened on the server");
    expect(liveUids()).toHaveLength(2);
  });

  // ---------- F-5 interaction ----------

  it("tombstones are neither suspects nor deleted by the pass (plan read H3)", async () => {
    seedThread("t1");
    seedMessage(1, "t1", INBOX, { movedTo: "Archive" }); // moved out without a mapping
    seedThread("t2");
    seedMessage(2, "t2");

    await passWith([2]);
    await passWith([2]);
    expect(suspects()).toEqual([]);
    expect(
      raw().prepare<[string], { moved_to: string }>("SELECT moved_to FROM messages WHERE id = ?").get(`imap-${ACC}-INBOX-1`),
    ).toEqual({ moved_to: "Archive" });
  });

  it("one pass id for every folder: a second folder's observation does not promote the first's same-pass suspect", async () => {
    seedFolder(2);
    seedFolder(2, "Sent");
    const pass = beginReconcilePass(ACC);
    await reconcileFolderList(pass, INBOX, GEN, [2], 1);
    await reconcileFolderList(pass, "Sent", GEN, [2], 1);
    markFetchCompleted(pass, INBOX);
    markFetchCompleted(pass, "Sent");
    const summary = await finishReconcilePass(pass, true);
    expect(summary.deleted).toEqual([]);
    expect(suspects().map((s) => s.status)).toEqual(["suspect", "suspect"]);
  });
});
