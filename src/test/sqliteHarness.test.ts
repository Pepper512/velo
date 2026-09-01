/**
 * Smoke test for the real-SQLite test harness dependency (ADR-001).
 *
 * Proves three things on every CI runner: the native module compiles/loads,
 * FTS5 is available (the app's search relies on it), and the trigram
 * tokenizer the migrations use is accepted. Real DB-backed tests for
 * migrations/search land in later batches (audit P6, P8); this only guards
 * the foundation they will stand on.
 */
import Database from "better-sqlite3";

describe("better-sqlite3 harness", () => {
  it("opens an in-memory database and round-trips a row", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
      const info = db.prepare("INSERT INTO t (v) VALUES (?)").run("hello");
      expect(info.changes).toBe(1);
      const row = db.prepare<{ v: string }>("SELECT v FROM t WHERE id = ?").get(1);
      expect(row?.v).toBe("hello");
    } finally {
      db.close();
    }
  });

  it("has FTS5 with the trigram tokenizer used by the messages index", () => {
    const db = new Database(":memory:");
    try {
      db.exec(
        "CREATE VIRTUAL TABLE fts USING fts5(body, tokenize = 'trigram')",
      );
      db.prepare("INSERT INTO fts (body) VALUES (?)").run("quarterly review meeting");
      const hits = db
        .prepare<{ body: string }>("SELECT body FROM fts WHERE fts MATCH ?")
        .all('"review"');
      expect(hits).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
