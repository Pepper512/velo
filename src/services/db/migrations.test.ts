import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The production function, not a copy. The previous version of this file
// contained a 38-line mirror of `splitStatements` and tested that -- which
// proved only that the mirror worked (audit P6).
import { splitStatements } from "./migrations";

describe("splitStatements", () => {
  it("splits simple statements", () => {
    const result = splitStatements("CREATE TABLE foo (id INT); CREATE TABLE bar (id INT);");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("CREATE TABLE foo (id INT)");
    expect(result[1]).toBe("CREATE TABLE bar (id INT)");
  });

  it("keeps trigger body intact", () => {
    const sql = `
      CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, subject) VALUES (new.rowid, new.subject);
      END;
    `;
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("BEGIN");
    expect(result[0]).toContain("END");
    expect(result[0]).toContain("INSERT INTO messages_fts");
  });

  it("handles multiple triggers", () => {
    const sql = `
      CREATE TABLE foo (id INT);

      CREATE TRIGGER t1 AFTER INSERT ON foo BEGIN
        INSERT INTO bar VALUES (new.id);
      END;

      CREATE TRIGGER t2 AFTER DELETE ON foo BEGIN
        DELETE FROM bar WHERE id = old.id;
      END;
    `;
    const result = splitStatements(sql);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("CREATE TABLE");
    expect(result[1]).toContain("CREATE TRIGGER t1");
    expect(result[2]).toContain("CREATE TRIGGER t2");
  });

  it("handles trigger with multiple statements inside BEGIN...END", () => {
    const sql = `
      CREATE TRIGGER t1 AFTER UPDATE ON messages BEGIN
        INSERT INTO fts(fts, rowid, subject) VALUES ('delete', old.rowid, old.subject);
        INSERT INTO fts(rowid, subject) VALUES (new.rowid, new.subject);
      END;
    `;
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("BEGIN");
    expect(result[0]).toContain("END");
  });

  it("handles empty input", () => {
    expect(splitStatements("")).toHaveLength(0);
    expect(splitStatements("   ")).toHaveLength(0);
  });

  it("does not match END inside words like BACKEND", () => {
    const sql = "CREATE TABLE backend (id INT); CREATE TABLE foo (id INT);";
    const result = splitStatements(sql);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Real-SQL tests (audit P6 + P12).
//
// These drive the PRODUCTION `runMigrations` against a real in-memory SQLite
// database. Before this, nothing in the suite executed SQL, which is how a
// destructive one-shot repair shipped untested.
// ---------------------------------------------------------------------------

const harnessRef: { current: ReturnType<typeof createSqliteHarness> | null } = {
  current: null,
};

// `runMigrations` calls `getDb()` internally; point that at the harness rather
// than changing the production signature for the benefit of a test.
vi.mock("./connection", () => ({
  getDb: () => Promise.resolve(harnessRef.current!.db),
  // SPEC-240: production's `withTransaction` pins a connection in Rust; on
  // the harness a real BEGIN/COMMIT on the single better-sqlite3 connection
  // is the same guarantee.
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

import { createSqliteHarness } from "../../test/sqliteHarness";
import { runMigrations } from "./migrations";

describe("runMigrations against real SQLite", () => {
  let harness: ReturnType<typeof createSqliteHarness>;

  beforeEach(() => {
    harness = createSqliteHarness();
    harnessRef.current = harness;
  });

  afterEach(() => {
    harness.close();
    harnessRef.current = null;
  });

  function appliedVersions(): number[] {
    return harness.raw
      .prepare<{ version: number }>("SELECT version FROM _migrations ORDER BY version")
      .all()
      .map((r) => r.version);
  }

  it("applies every migration to a fresh database", async () => {
    await runMigrations();

    const versions = appliedVersions();
    expect(versions.length).toBeGreaterThan(0);
    // Contiguous from 1, no gaps and no duplicates.
    expect(versions).toEqual(
      Array.from({ length: versions.length }, (_, i) => i + 1),
    );

    // Spot-check that real schema exists, not just ledger rows.
    const tables = harness.raw
      .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    expect(tables).toContain("accounts");
    expect(tables).toContain("messages");
    expect(tables).toContain("settings");
  });

  it("adds the separate SMTP credential columns (SPEC-252, migration 28)", async () => {
    await runMigrations();
    const columns = harness.raw
      .prepare<{ name: string }>("PRAGMA table_info(accounts)")
      .all()
      .map((c) => c.name);
    expect(columns).toContain("smtp_username");
    expect(columns).toContain("smtp_password");
    expect(appliedVersions()).toContain(28);

    // A row written the pre-28 way (no SMTP columns named) reads back NULL for
    // both — the fallback to the IMAP credentials depends on it (Grok L6 on #59).
    harness.raw
      .prepare("INSERT INTO accounts (id, email, provider) VALUES ('pre-28', 'u@x', 'imap')")
      .run();
    const row = harness.raw
      .prepare<{ smtp_username: string | null; smtp_password: string | null }>(
        "SELECT smtp_username, smtp_password FROM accounts WHERE id = 'pre-28'",
      )
      .get();
    expect(row).toEqual({ smtp_username: null, smtp_password: null });
  });

  it("is idempotent — a second run applies nothing", async () => {
    await runMigrations();
    const first = appliedVersions();

    harness.statements.length = 0;
    await runMigrations();

    expect(appliedVersions()).toEqual(first);
    // No migration should have been re-executed.
    expect(harness.statements.some((s) => s.startsWith("BEGIN"))).toBe(false);
  });

  it("creates the FTS index and its triggers", async () => {
    await runMigrations();
    const objects = harness.raw
      .prepare<{ name: string }>("SELECT name FROM sqlite_master")
      .all()
      .map((r) => r.name);
    expect(objects).toContain("messages_fts");
    expect(objects).toContain("messages_ai");
  });
});

// SPEC-FUI: migration 29 makes "one pending follow-up reminder per thread" the
// database's rule. #88 already holds it in one pinned transaction; the index is
// the backstop for a future caller that writes the table without it.
describe("the pending follow-up reminder index (SPEC-FUI, migration 29)", () => {
  let harness: ReturnType<typeof createSqliteHarness>;

  beforeEach(() => {
    harness = createSqliteHarness();
    harnessRef.current = harness;
  });

  afterEach(() => {
    harness.close();
    harnessRef.current = null;
  });

  /** Bring the database to the state just before 29, with rows already in place. */
  function seedBefore29(): void {
    harness.raw.exec("DELETE FROM _migrations WHERE version = 29");
    harness.raw.exec("DROP INDEX IF EXISTS idx_followup_pending_unique");
    harness.raw.exec(`
      INSERT INTO accounts (id, email, provider) VALUES ('acct-1', 'a@example.com', 'imap');
      INSERT INTO accounts (id, email, provider) VALUES ('acct-b', 'b@example.com', 'imap');
      INSERT INTO threads (id, account_id) VALUES ('t1', 'acct-1');
      INSERT INTO threads (id, account_id) VALUES ('t2', 'acct-1');
      INSERT INTO threads (id, account_id) VALUES ('t1', 'acct-b');
    `);
  }

  it("demotes an older duplicate pending row and leaves the newest pending", async () => {
    await runMigrations();
    seedBefore29();

    // The state the index forbids: two pending rows for one thread, plus a
    // cancelled row that is history and must survive untouched. `r-cross` is
    // another account's row for the *same* thread id — it must be left alone,
    // which an index that forgot `account_id` would not do. `r-null` has no
    // status: outside the index and outside the demotion.
    harness.raw.exec(`
      INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status, created_at)
        VALUES ('r-old',  'acct-1', 't1', 'm1', 100, 'pending',   10),
               ('r-new',  'acct-1', 't1', 'm2', 200, 'pending',   20),
               ('r-hist', 'acct-1', 't1', 'm0',  50, 'cancelled',  5),
               ('r-other','acct-1', 't2', 'm3', 300, 'pending',   30),
               ('r-cross','acct-b', 't1', 'm4', 400, 'pending',   40),
               ('r-null', 'acct-1', 't2', 'm5', 500, NULL,        50);
    `);

    await runMigrations();

    const rows = harness.raw
      .prepare<{ id: string; status: string }>(
        "SELECT id, status FROM follow_up_reminders ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      { id: "r-cross", status: "pending" },
      { id: "r-hist", status: "cancelled" },
      { id: "r-new", status: "pending" },
      { id: "r-null", status: null },
      { id: "r-old", status: "cancelled" },
      { id: "r-other", status: "pending" },
    ]);

    // The index exists *and* is unique — a same-named non-unique leftover would
    // satisfy a name lookup alone (Grok F2), so prove it by its effect, in the
    // same sequence that just demoted.
    expect(() =>
      harness.raw.exec(`
        INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status)
          VALUES ('r-again', 'acct-1', 't1', 'm9', 900, 'pending');
      `),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("breaks a created_at tie by insertion order, and survives a NULL id (Gemini SEC-FUI-01/02)", async () => {
    await runMigrations();
    seedBefore29();

    // Same created_at on every row: only `rowid DESC` can decide, so the last
    // one inserted is the survivor. One row carries a NULL id — SQLite allows
    // it through a TEXT PRIMARY KEY, and it must not poison the predicate.
    harness.raw.exec(`
      INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status, created_at)
        VALUES (NULL,   'acct-1', 't1', 'm1', 100, 'pending', 77),
               ('mid',  'acct-1', 't1', 'm2', 200, 'pending', 77),
               ('last', 'acct-1', 't1', 'm3', 300, 'pending', 77);
    `);

    await runMigrations();

    const pending = harness.raw
      .prepare<{ id: string | null }>(
        "SELECT id FROM follow_up_reminders WHERE status = 'pending' ORDER BY rowid",
      )
      .all();
    expect(pending).toEqual([{ id: "last" }]);
    expect(
      harness.raw
        .prepare<{ n: number }>("SELECT COUNT(*) AS n FROM follow_up_reminders WHERE status = 'cancelled'")
        .get()!.n,
    ).toBe(2);
  });

  it("refuses a second pending row for a thread, but not a second cancelled one", async () => {
    await runMigrations();
    harness.raw.exec(`
      INSERT INTO accounts (id, email, provider) VALUES ('acct-2', 'b@example.com', 'imap');
      INSERT INTO threads (id, account_id) VALUES ('t9', 'acct-2');
      INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status)
        VALUES ('p1', 'acct-2', 't9', 'm1', 100, 'pending');
    `);

    expect(() =>
      harness.raw.exec(`
        INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status)
          VALUES ('p2', 'acct-2', 't9', 'm2', 200, 'pending');
      `),
    ).toThrow(/UNIQUE constraint failed: follow_up_reminders\.account_id, follow_up_reminders\.thread_id/);

    // History is not constrained: any number of cancelled/triggered rows may sit
    // beside the one pending row.
    harness.raw.exec(`
      INSERT INTO follow_up_reminders (id, account_id, thread_id, message_id, remind_at, status)
        VALUES ('c1', 'acct-2', 't9', 'm3', 300, 'cancelled'),
               ('c2', 'acct-2', 't9', 'm4', 400, 'cancelled'),
               ('g1', 'acct-2', 't9', 'm5', 500, 'triggered');
    `);
    const n = harness.raw
      .prepare<{ n: number }>("SELECT COUNT(*) AS n FROM follow_up_reminders WHERE thread_id = 't9'")
      .get()!.n;
    expect(n).toBe(4);
  });

  it("applies to a database with no reminders at all (the expected case)", async () => {
    await runMigrations();
    expect(
      harness.raw
        .prepare<{ n: number }>("SELECT COUNT(*) AS n FROM _migrations WHERE version = 29")
        .get()!.n,
    ).toBe(1);
    expect(
      harness.raw
        .prepare<{ n: number }>("SELECT COUNT(*) AS n FROM follow_up_reminders")
        .get()!.n,
    ).toBe(0);
  });
});

describe("the IMAP attachment repair (audit P6)", () => {
  let harness: ReturnType<typeof createSqliteHarness>;

  beforeEach(() => {
    harness = createSqliteHarness();
    harnessRef.current = harness;
  });

  afterEach(() => {
    harness.close();
    harnessRef.current = null;
  });

  it("runs as a numbered migration, not an unguarded post-migration step", async () => {
    await runMigrations();

    const repair = harness.raw
      .prepare<{ version: number; description: string }>(
        "SELECT version, description FROM _migrations WHERE description LIKE '%attachment resync%'",
      )
      .get();

    expect(repair).toBeDefined();
    expect(repair!.version).toBe(24);

    // It still writes the legacy settings flag, so a client that already ran the
    // old repair sees no behaviour change.
    const flag = harness.raw
      .prepare<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'imap_attachment_repair_v1'",
      )
      .get();
    expect(flag?.value).toBe("1");
  });

  it("leaves NOTHING deleted if the repair fails partway", async () => {
    // Bring the DB to the state just before the repair migration.
    await runMigrations();
    harness.raw.exec("DELETE FROM _migrations WHERE version = 24");
    harness.raw.exec("DELETE FROM settings WHERE key = 'imap_attachment_repair_v1'");

    // Seed an IMAP account with an attachment and sync state — the rows the
    // repair deletes.
    harness.raw.exec(`
      INSERT INTO accounts (id, email, provider, history_id)
        VALUES ('acct-1', 'a@example.com', 'imap', 'h1');
      INSERT INTO threads (id, account_id) VALUES ('t1', 'acct-1');
      INSERT INTO messages (id, account_id, thread_id, date)
        VALUES ('m1', 'acct-1', 't1', 1);
      INSERT INTO attachments (id, message_id, account_id, filename)
        VALUES ('att-1', 'm1', 'acct-1', 'invoice.pdf');
    `);

    const attachmentsBefore = harness.raw
      .prepare<{ n: number }>("SELECT COUNT(*) AS n FROM attachments")
      .get()!.n;
    expect(attachmentsBefore).toBe(1);

    // Fail the migration at its LAST statement — the flag write. This is exactly
    // the window that used to leave the deletes committed and the flag unset,
    // causing the repair to re-run and re-delete on every subsequent launch.
    const realExecute = harness.db.execute.bind(harness.db);
    let failed = false;
    harness.db.execute = (sql: string, params?: unknown[]) => {
      if (!failed && sql.includes("imap_attachment_repair_v1")) {
        failed = true;
        return Promise.reject(new Error("simulated crash before the flag write"));
      }
      return realExecute(sql, params);
    };

    await expect(runMigrations()).rejects.toThrow("simulated crash");

    // The whole migration rolled back: the attachment survives, and the ledger
    // has no row for v24, so it will be retried cleanly next launch.
    const attachmentsAfter = harness.raw
      .prepare<{ n: number }>("SELECT COUNT(*) AS n FROM attachments")
      .get()!.n;
    expect(attachmentsAfter).toBe(1);

    const ledger = harness.raw
      .prepare<{ n: number }>("SELECT COUNT(*) AS n FROM _migrations WHERE version = 24")
      .get()!.n;
    expect(ledger).toBe(0);

    const flag = harness.raw
      .prepare<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'imap_attachment_repair_v1'",
      )
      .get();
    expect(flag).toBeUndefined();
  });
});
