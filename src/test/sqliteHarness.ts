/**
 * Real-SQLite test harness (audit P12, pulled forward into Batch B by Jim).
 *
 * # Why this exists
 *
 * Every DB module in this project is tested against mocks — 53 of 133 test files
 * mock `services/db/*`, and before this harness **no test executed a single line
 * of SQL**. That is how `runMigrations` came to ship a destructive one-shot repair
 * (audit P6) that deletes IMAP attachments and sync state on every launch until a
 * separate flag write succeeds, with nothing verifying it.
 *
 * # The one rule
 *
 * This harness exists so tests can drive the **production** function. Point
 * `runMigrations` at `harness.db` — never copy migration logic into a test. A test
 * that re-implements the thing it is testing (as `migrations.test.ts` did with its
 * own copy of `splitStatements`) proves only that the copy works.
 *
 * # What it emulates
 *
 * `@tauri-apps/plugin-sql`'s `Database`, narrowed to the two methods the DB layer
 * actually calls:
 *
 * - `execute(sql, params?)` → `{ rowsAffected, lastInsertId }`
 * - `select<T>(sql, params?)` → rows
 *
 * Both are async there and synchronous here, so they are wrapped in promises.
 *
 * ## Placeholder translation
 *
 * `tauri-plugin-sql` uses Postgres-style `$1, $2`; `better-sqlite3` uses `?`.
 * Production SQL is written with `$n`, so it is rewritten here. Rewriting happens
 * **outside** string literals so a `$1` inside quoted SQL text is left alone.
 */
import Database from "better-sqlite3";

/** The concrete better-sqlite3 handle, for assertions that bypass production code. */
type RawDatabase = ReturnType<typeof Database>;

/** The subset of `@tauri-apps/plugin-sql`'s `Database` that the DB layer uses. */
export interface SqlDatabase {
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

export interface SqliteHarness {
  /** Pass this to production code in place of `getDb()`'s result. */
  db: SqlDatabase;
  /** The underlying database, for assertions that bypass the production layer. */
  raw: RawDatabase;
  /** Every statement executed, in order — lets a test assert on SQL that ran. */
  statements: string[];
  close(): void;
}

/**
 * Rewrite `$1`-style placeholders to `?`, ignoring anything inside a string
 * literal.
 *
 * SQLite positional `?` binds in order of appearance, whereas `$n` is explicitly
 * numbered. Every `$n` in this codebase appears in ascending order exactly once,
 * which is why a positional rewrite is sound; a query that reused `$1` twice, or
 * ordered them `$2, $1`, would bind wrongly — so that case throws rather than
 * silently producing wrong results.
 */
export function translatePlaceholders(sql: string): string {
  let out = "";
  let quote: string | null = null;
  const seen: number[] = [];

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;

    if (quote) {
      out += ch;
      // Doubled quote inside a literal is an escaped quote, not a terminator.
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          out += sql[i + 1];
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === "$" && /\d/.test(sql[i + 1] ?? "")) {
      let j = i + 1;
      let digits = "";
      while (j < sql.length && /\d/.test(sql[j]!)) digits += sql[j++];
      seen.push(Number(digits));
      out += "?";
      i = j - 1;
      continue;
    }

    out += ch;
  }

  for (let k = 0; k < seen.length; k++) {
    if (seen[k] !== k + 1) {
      throw new Error(
        `sqliteHarness: placeholders must appear once, in ascending order; got ` +
          `${seen.map((n) => `$${n}`).join(", ")} in: ${sql.slice(0, 120)}`,
      );
    }
  }

  return out;
}

/**
 * Open an in-memory SQLite database behind the `plugin-sql` interface.
 *
 * Always `close()` it — `better-sqlite3` holds a native handle, and a leaked one
 * will outlive the test file.
 */
export function createSqliteHarness(): SqliteHarness {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");

  const statements: string[] = [];

  const db: SqlDatabase = {
    execute(sql, params = []) {
      statements.push(sql);
      try {
        const translated = translatePlaceholders(sql);
        // `run` rejects multi-statement SQL; the migration runner already splits
        // on `;` via `splitStatements`, but bare DDL blocks still arrive whole.
        if (params.length === 0) {
          raw.exec(translated);
          return Promise.resolve({ rowsAffected: 0, lastInsertId: 0 });
        }
        const info = raw.prepare(translated).run(...params);
        return Promise.resolve({
          rowsAffected: info.changes,
          lastInsertId: Number(info.lastInsertRowid),
        });
      } catch (err) {
        return Promise.reject(err);
      }
    },

    select<T>(sql: string, params: unknown[] = []) {
      statements.push(sql);
      try {
        const rows = raw.prepare(translatePlaceholders(sql)).all(...params);
        return Promise.resolve(rows as T);
      } catch (err) {
        return Promise.reject(err as Error);
      }
    },
  };

  return {
    db,
    raw,
    statements,
    close() {
      raw.close();
    },
  };
}
