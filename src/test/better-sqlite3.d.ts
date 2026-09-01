/**
 * Minimal ambient typing for `better-sqlite3` — test-only usage.
 *
 * Deliberately hand-written instead of adding `@types/better-sqlite3`: the
 * dependency rule (CLAUDE.md, ADR-001) says no package where a few lines
 * suffice. Extend this surface as the real-SQLite test harness grows; keep
 * it to what tests actually call.
 */
declare module "better-sqlite3" {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement<Row = unknown> {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Row | undefined;
    all(...params: unknown[]): Row[];
  }

  interface Database {
    exec(sql: string): this;
    prepare<Row = unknown>(sql: string): Statement<Row>;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    close(): void;
    readonly open: boolean;
    readonly memory: boolean;
  }

  interface DatabaseConstructor {
    new (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean }): Database;
    (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean }): Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
