import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SPEC-F-4 rev 5 REQ-4 (part 3) — the reconcile queue op, on the SQLite
 * harness with the IMAP session mocked.
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
vi.mock("./sessionManager", () => ({
  withSession: vi.fn(
    async (_a: string, _k: string, _o: unknown, fn: (id: string) => Promise<unknown>) => fn("s"),
  ),
}));
vi.mock("./tauriCommands", () => ({
  imapSearchUidsPresent: vi.fn(),
}));

import { createSqliteHarness } from "@/test/sqliteHarness";
import { runMigrations } from "../db/migrations";
import { useUIStore } from "@/stores/uiStore";
import { imapSearchUidsPresent } from "./tauriCommands";
import {
  RECONCILE_MAX_RETRIES,
  RECONCILE_OP,
  degradeReconcileOp,
  enqueueReconcileOps,
  groupImapIdsByFolder,
  reconcileResourceId,
  runReconcileOp,
} from "./reconcileOp";

const ACC = "acc-1";

function raw() {
  return harnessRef.current!.raw;
}

function seedMessage(uid: number, folder = "INBOX") {
  raw().prepare("INSERT OR IGNORE INTO threads (id, account_id, subject, last_message_at) VALUES (?, ?, 't', 1)").run(`t${uid}`, ACC);
  raw()
    .prepare(
      "INSERT INTO messages (id, account_id, thread_id, date, imap_uid, imap_folder, message_id_header) VALUES (?, ?, ?, 1, ?, ?, ?)",
    )
    .run(`imap-${ACC}-${folder}-${uid}`, ACC, `t${uid}`, uid, folder, `<m${uid}@x>`);
}

describe("reconcile op (F-4 REQ-4)", () => {
  beforeEach(async () => {
    harnessRef.current = createSqliteHarness();
    await runMigrations();
    raw().prepare("INSERT INTO accounts (id, email, provider) VALUES (?, 'u@x', 'imap')").run(ACC);
    raw()
      .prepare("INSERT INTO folder_sync_state (account_id, folder_path, uidvalidity, last_uid) VALUES (?, 'INBOX', 7, 0)")
      .run(ACC);
    useUIStore.setState({ notices: [] });
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    harnessRef.current?.close();
    harnessRef.current = null;
    vi.restoreAllMocks();
  });

  it("groups IMAP ids by folder, keeping hyphenated folder names intact", () => {
    const grouped = groupImapIdsByFolder(ACC, [
      `imap-${ACC}-INBOX-5`,
      `imap-${ACC}-Projects-2026-Q3-9`,
      `imap-${ACC}-INBOX-6`,
      "gmail-abc",
      `imap-${ACC}-INBOX-0`,
    ]);
    expect([...grouped]).toEqual([
      ["INBOX", [5, 6]],
      ["Projects-2026-Q3", [9]],
    ]);
  });

  it("enqueues one op per source folder with three attempts (REQ-4.1)", async () => {
    const n = await enqueueReconcileOps(ACC, [`imap-${ACC}-INBOX-5`, `imap-${ACC}-Sent-2`, `imap-${ACC}-INBOX-6`]);
    expect(n).toBe(2);
    const ops = raw()
      .prepare<[], { operation_type: string; resource_id: string; params: string; max_retries: number }>(
        "SELECT operation_type, resource_id, params, max_retries FROM pending_operations ORDER BY resource_id",
      )
      .all();
    expect(ops).toEqual([
      { operation_type: RECONCILE_OP, resource_id: reconcileResourceId("INBOX"), params: JSON.stringify({ folder: "INBOX", uids: [5, 6], kind: "repair" }), max_retries: RECONCILE_MAX_RETRIES },
      { operation_type: RECONCILE_OP, resource_id: reconcileResourceId("Sent"), params: JSON.stringify({ folder: "Sent", uids: [2], kind: "repair" }), max_retries: RECONCILE_MAX_RETRIES },
    ]);
  });

  it("records absent UIDs as suspects — never deletes — and notices about present ones (REQ-4.5)", async () => {
    seedMessage(5);
    seedMessage(6);
    seedMessage(7);
    vi.mocked(imapSearchUidsPresent).mockResolvedValue([6]);

    await runReconcileOp(ACC, { folder: "INBOX", uids: [5, 6, 7], kind: "repair" });

    expect(imapSearchUidsPresent).toHaveBeenCalledWith("s", "INBOX", [5, 6, 7]);
    const suspects = raw().prepare<[], { uid: number; status: string }>("SELECT uid, status FROM reconcile_suspects ORDER BY uid").all();
    expect(suspects).toEqual([
      { uid: 5, status: "suspect" },
      { uid: 7, status: "suspect" },
    ]);
    expect(raw().prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM messages").get()!.n).toBe(3);
    expect(useUIStore.getState().notices[0]?.text).toContain("1 message in INBOX was not moved or deleted");
  });

  it("ignores absent UIDs with no live local row, and drops malformed params instead of retrying", async () => {
    vi.mocked(imapSearchUidsPresent).mockResolvedValue([]);
    await runReconcileOp(ACC, { folder: "INBOX", uids: [99], kind: "repair" });
    expect(raw().prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM reconcile_suspects").get()!.n).toBe(0);

    await runReconcileOp(ACC, { folder: "", uids: "nope" });
    expect(imapSearchUidsPresent).toHaveBeenCalledTimes(1);
  });

  it("degrades a spent op to a forced full list plus a notice (REQ-4.3)", async () => {
    await degradeReconcileOp(ACC, { folder: "INBOX", uids: [5], kind: "repair" });
    expect(
      raw().prepare<[], { force_list: number }>("SELECT force_list FROM folder_sync_state WHERE folder_path = 'INBOX'").get(),
    ).toEqual({ force_list: 1 });
    expect(useUIStore.getState().notices[0]?.text).toContain("re-check the whole folder");
  });
});
