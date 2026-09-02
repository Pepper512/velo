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
