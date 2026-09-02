import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * F-5 move-time row hygiene, Done-when 1–3 (frontend half) — driven against
 * real SQLite with the real migrations, so the production SQL, the composite
 * primary key, the `attachments` foreign key and the FTS triggers are all what
 * actually runs. `withTransaction` is re-implemented over the harness with a
 * real BEGIN/COMMIT/ROLLBACK (the production one reads its own module-internal
 * `getDb`, which a mock cannot reach) — the rollback tests depend on it being
 * a real transaction, not a pass-through.
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
  getMessagesForThread,
  rekeyMovedMessages,
  reapMovedTombstones,
} from "../db/messages";
import { keepLiveMessageIds } from "./messageHelper";
import { settleMovedRows } from "./moveHygiene";

const ACC = "acc-1";
const THREAD = "thread-1";
const A_OLD = `imap-${ACC}-INBOX-5`;
const B_OLD = `imap-${ACC}-INBOX-6`;
const A_HEADER = "<a@example.com>";
const B_HEADER = "<b@example.com>";

type MessageRow = {
  id: string;
  thread_id: string;
  imap_folder: string | null;
  imap_uid: number | null;
  moved_to: string | null;
};

function raw() {
  return harnessRef.current!.raw;
}

function messageRow(id: string): MessageRow | undefined {
  return raw()
    .prepare<[string, string], MessageRow>(
      "SELECT id, thread_id, imap_folder, imap_uid, moved_to FROM messages WHERE account_id = ? AND id = ?",
    )
    .get(ACC, id);
}

function seedMessage(id: string, folder: string, uid: number, header: string, subject: string) {
  raw()
    .prepare(
      `INSERT INTO messages (id, account_id, thread_id, subject, date, imap_uid, imap_folder, message_id_header)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ACC, THREAD, subject, 1_000, uid, folder, header);
}

function seedAttachment(messageId: string, part: string) {
  raw()
    .prepare("INSERT INTO attachments (id, message_id, account_id, filename) VALUES (?, ?, ?, ?)")
    .run(`${messageId}_${part}`, messageId, ACC, `${part}.pdf`);
}

describe("F-5 move-time row hygiene (SQLite harness)", () => {
  beforeEach(async () => {
    harnessRef.current = createSqliteHarness();
    await runMigrations();
    raw()
      .prepare("INSERT INTO accounts (id, email, provider) VALUES (?, ?, 'imap')")
      .run(ACC, "user@example.com");
    raw()
      .prepare(
        "INSERT INTO threads (id, account_id, subject, last_message_at, message_count) VALUES (?, ?, ?, ?, 2)",
      )
      .run(THREAD, ACC, "Quarterly numbers", 1_000);
    raw()
      .prepare("INSERT INTO thread_labels (account_id, thread_id, label_id) VALUES (?, ?, ?)")
      .run(ACC, THREAD, "STARRED");
    seedMessage(A_OLD, "INBOX", 5, A_HEADER, "Quarterly numbers");
    seedMessage(B_OLD, "INBOX", 6, B_HEADER, "Re: Quarterly numbers");
    seedAttachment(A_OLD, "p1");
    raw()
      .prepare("INSERT INTO link_scan_results (message_id, account_id, result_json) VALUES (?, ?, '{}')")
      .run(A_OLD, ACC);
    raw()
      .prepare(
        "INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at) VALUES ('fu-1', ?, ?, ?, 5)",
      )
      .run(ACC, THREAD, A_OLD);
  });

  afterEach(() => {
    harnessRef.current?.close();
    harnessRef.current = null;
  });

  it("enforces foreign keys, so the attachment FK below is a real constraint", () => {
    const [{ foreign_keys }] = raw()
      .prepare<[], { foreign_keys: number }>("PRAGMA foreign_keys")
      .all();
    expect(foreign_keys).toBe(1);
  });

  // ---------- Done-when 1: re-key on COPYUID ----------

  it("re-keys the moved row to the server's UID in one transaction; attachments and soft references follow; thread state is untouched", async () => {
    await settleMovedRows(ACC, "INBOX", "Archive", [5], [{ source_uid: 5, dest_uid: 3 }]);

    const A_NEW = `imap-${ACC}-Archive-3`;
    expect(messageRow(A_OLD)).toBeUndefined();
    expect(messageRow(A_NEW)).toEqual({
      id: A_NEW,
      thread_id: THREAD,
      imap_folder: "Archive",
      imap_uid: 3,
      moved_to: null,
    });

    // attachments: FK column and the `{messageId}_{part}` primary key both follow.
    const attachments = raw()
      .prepare<[string], { id: string; message_id: string }>(
        "SELECT id, message_id FROM attachments WHERE account_id = ?",
      )
      .all(ACC);
    expect(attachments).toEqual([{ id: `${A_NEW}_p1`, message_id: A_NEW }]);

    // soft references
    expect(
      raw().prepare<[string], { message_id: string }>("SELECT message_id FROM link_scan_results WHERE account_id = ?").all(ACC),
    ).toEqual([{ message_id: A_NEW }]);
    expect(
      raw().prepare<[string], { message_id: string }>("SELECT message_id FROM follow_up_reminders WHERE account_id = ?").all(ACC),
    ).toEqual([{ message_id: A_NEW }]);

    // thread state: same thread, same labels, both messages still listed.
    expect(
      raw().prepare<[string], { label_id: string }>("SELECT label_id FROM thread_labels WHERE thread_id = ?").all(THREAD),
    ).toEqual([{ label_id: "STARRED" }]);
    const listed = await getMessagesForThread(ACC, THREAD);
    expect(listed.map((m) => m.id)).toEqual([A_NEW, B_OLD]);
  });

  it("keeps the full-text index consistent through the re-key", async () => {
    await settleMovedRows(ACC, "INBOX", "Archive", [5], [{ source_uid: 5, dest_uid: 3 }]);

    const hits = raw()
      .prepare<[string], { subject: string }>(
        "SELECT subject FROM messages_fts WHERE messages_fts MATCH ?",
      )
      .all("Quarterly");
    // Both rows still match exactly once: the AFTER UPDATE trigger deleted the
    // old index entry and inserted the new one for the same rowid.
    expect(hits).toHaveLength(2);
  });

  it("gives the row the exact id the destination sync will generate, so the upsert hits instead of inserting a second row", async () => {
    await settleMovedRows(ACC, "INBOX", "Archive", [5], [{ source_uid: 5, dest_uid: 3 }]);

    // imapSync: `imap-${accountId}-${msg.folder}-${msg.uid}`.
    const syncId = `imap-${ACC}-Archive-3`;
    expect(messageRow(syncId)).toBeDefined();
    // A plain INSERT under that id now violates the composite PK — which is the
    // branch `upsertMessage`'s ON CONFLICT(account_id, id) takes.
    expect(() =>
      raw()
        .prepare("INSERT INTO messages (id, account_id, thread_id, date) VALUES (?, ?, ?, 1)")
        .run(syncId, ACC, THREAD),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
  });

  // ---------- Done-when 2: no mapping → hidden until the destination syncs ----------

  it("tombstones a UID the mapping does not cover and hides it from the thread and from actions", async () => {
    await settleMovedRows(ACC, "INBOX", "Archive", [5, 6], [{ source_uid: 5, dest_uid: 3 }]);

    expect(messageRow(B_OLD)).toMatchObject({ imap_folder: "INBOX", imap_uid: 6, moved_to: "Archive" });

    const listed = await getMessagesForThread(ACC, THREAD);
    expect(listed.map((m) => m.id)).toEqual([`imap-${ACC}-Archive-3`]);

    // Provider actions: the re-keyed id is live, the tombstone and an unknown id are not.
    await expect(
      keepLiveMessageIds(ACC, [`imap-${ACC}-Archive-3`, B_OLD, A_OLD, "imap-acc-1-INBOX-999"]),
    ).resolves.toEqual([`imap-${ACC}-Archive-3`]);
  });

  it("tombstones everything when no mapping arrived at all (non-UIDPLUS server, COPY fallback, dropped response)", async () => {
    await settleMovedRows(ACC, "INBOX", "Trash", [5, 6], null);

    expect(messageRow(A_OLD)?.moved_to).toBe("Trash");
    expect(messageRow(B_OLD)?.moved_to).toBe("Trash");
    await expect(getMessagesForThread(ACC, THREAD)).resolves.toEqual([]);
  });

  it("reaps the tombstone when the destination sync inserts the fresh row, cascading its attachments", async () => {
    seedAttachment(B_OLD, "p9");
    await settleMovedRows(ACC, "INBOX", "Archive", [6], null);
    expect(messageRow(B_OLD)?.moved_to).toBe("Archive");

    // The destination folder syncs the same message in under its new id.
    const fresh = `imap-${ACC}-Archive-11`;
    seedMessage(fresh, "Archive", 11, B_HEADER, "Re: Quarterly numbers");
    await reapMovedTombstones(ACC, B_HEADER, fresh);

    expect(messageRow(B_OLD)).toBeUndefined();
    expect(messageRow(fresh)).toMatchObject({ moved_to: null });
    expect(
      raw().prepare<[string], { id: string }>("SELECT id FROM attachments WHERE message_id = ?").all(B_OLD),
    ).toEqual([]);
    // A is unrelated and untouched.
    expect(messageRow(A_OLD)).toBeDefined();
  });

  // ---------- Done-when 3 (last case): a colliding destination id ----------

  it("skips a re-key whose new id already exists locally, leaves both rows as they were, and tombstones the source instead", async () => {
    const occupied = `imap-${ACC}-Archive-3`;
    seedMessage(occupied, "Archive", 3, "<other@example.com>", "Unrelated");

    await settleMovedRows(ACC, "INBOX", "Archive", [5], [{ source_uid: 5, dest_uid: 3 }]);

    expect(messageRow(occupied)).toMatchObject({ imap_folder: "Archive", imap_uid: 3, moved_to: null });
    expect(messageRow(A_OLD)).toMatchObject({ imap_folder: "INBOX", imap_uid: 5, moved_to: "Archive" });
    // The attachment stayed with its (still-existing) parent.
    expect(
      raw().prepare<[string], { message_id: string }>("SELECT message_id FROM attachments WHERE account_id = ?").all(ACC),
    ).toEqual([{ message_id: A_OLD }]);
  });

  it("rolls the whole transaction back when a collision reaches the UPDATE, leaving every row untouched", async () => {
    // Two sources mapped to one destination id: the pre-check sees neither as
    // taken, the first UPDATE succeeds, the second hits the composite PK.
    const clash = `imap-${ACC}-Archive-9`;
    await expect(
      rekeyMovedMessages(ACC, [
        { oldId: A_OLD, newId: clash, folder: "Archive", uid: 9 },
        { oldId: B_OLD, newId: clash, folder: "Archive", uid: 9 },
      ]),
    ).rejects.toThrow();

    expect(messageRow(clash)).toBeUndefined();
    expect(messageRow(A_OLD)).toMatchObject({ imap_folder: "INBOX", imap_uid: 5, moved_to: null });
    expect(messageRow(B_OLD)).toMatchObject({ imap_folder: "INBOX", imap_uid: 6, moved_to: null });
    expect(
      raw().prepare<[string], { id: string; message_id: string }>("SELECT id, message_id FROM attachments WHERE account_id = ?").all(ACC),
    ).toEqual([{ id: `${A_OLD}_p1`, message_id: A_OLD }]);
    expect(
      raw().prepare<[string], { message_id: string }>("SELECT message_id FROM link_scan_results WHERE account_id = ?").all(ACC),
    ).toEqual([{ message_id: A_OLD }]);
  });

  it("never throws back to the move: a failed re-key degrades to tombstones", async () => {
    // Make the re-key fail inside its transaction by removing the table the
    // soft-reference update needs; the server-side move has already happened.
    raw().exec("DROP TABLE link_scan_results");

    await expect(
      settleMovedRows(ACC, "INBOX", "Archive", [5], [{ source_uid: 5, dest_uid: 3 }]),
    ).resolves.toBeUndefined();

    expect(messageRow(`imap-${ACC}-Archive-3`)).toBeUndefined();
    expect(messageRow(A_OLD)).toMatchObject({ imap_uid: 5, moved_to: "Archive" });
  });

  it("does nothing for an empty UID list", async () => {
    const before = harnessRef.current!.statements.length;
    await settleMovedRows(ACC, "INBOX", "Archive", [], []);
    expect(harnessRef.current!.statements).toHaveLength(before);
  });
});
