import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:velo.db");
  }
  return db;
}

/**
 * What a query helper needs from a connection. `getDb()` satisfies it, and so
 * does the handle `withTransaction` hands its callback — a helper that accepts
 * one of these can run inside a pinned transaction (SPEC-240 REQ-4.1).
 */
export type DbExecutor = Pick<Database, "execute" | "select">;

/**
 * Build a dynamic SQL UPDATE statement from a set of field updates.
 * Returns null if no fields to update.
 */
export function buildDynamicUpdate(
  table: string,
  idColumn: string,
  id: unknown,
  fields: [string, unknown][],
): { sql: string; params: unknown[] } | null {
  if (fields.length === 0) return null;

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const [column, value] of fields) {
    sets.push(`${column} = $${idx++}`);
    params.push(value);
  }

  params.push(id);
  return {
    sql: `UPDATE ${table} SET ${sets.join(", ")} WHERE ${idColumn} = $${idx}`,
    params,
  };
}

// ---------------------------------------------------------------------------
// Transactions (SPEC-240) — one connection, held in Rust
// ---------------------------------------------------------------------------

/**
 * Error prefixes the Rust side returns. Must stay identical to the constants in
 * `src-tauri/src/db/tx.rs`.
 */
export const TX_BUSY = "VELO_TX_BUSY";
export const TX_EXPIRED = "VELO_TX_EXPIRED";
export const TX_UNKNOWN = "VELO_TX_UNKNOWN";

/**
 * Simple async mutex so transactions run one at a time. The Rust side refuses
 * a second `BEGIN` on its own (`VELO_TX_BUSY`); this queue is what keeps
 * callers from ever hitting that refusal.
 */
let txQueue: Promise<void> = Promise.resolve();

/**
 * Run `fn` inside one SQLite transaction.
 *
 * Before SPEC-240 this sent `BEGIN`, the callback's statements and `COMMIT` as
 * separate IPC calls to `tauri-plugin-sql`, which serves each call from a pool
 * of up to ten connections — so nothing guaranteed they landed on the same one,
 * and the moment a UI read ran concurrently they did not. Now Rust holds one
 * connection for the whole transaction and every statement issued through the
 * handle passed to `fn` goes to it. Statements issued through `getDb()` inside
 * `fn` are **not** part of the transaction; pass the handle down.
 */
export async function withTransaction<T = void>(fn: (db: DbExecutor) => Promise<T>): Promise<T> {
  // Queue this transaction behind any currently-running one.
  const prev = txQueue;
  let resolve!: () => void;
  txQueue = new Promise<void>((r) => {
    resolve = r;
  });

  try {
    await prev; // wait for previous transaction to finish
  } catch {
    // previous transaction errored — that's fine, we can still proceed
  }

  try {
    const id = expectTxId(await beginWithRetry());
    const handle = transactionHandle(id);
    let result: T;
    try {
      result = await fn(handle);
    } catch (err) {
      // Roll back on the same connection. A rollback that fails because the
      // transaction is already gone — reaped by the watchdog, or reaped and
      // then superseded — is not the error to report (Grok L6 on #54).
      try {
        await invoke("db_tx_rollback", { id });
      } catch (rollbackErr) {
        const text = String(rollbackErr);
        if (!text.includes(TX_EXPIRED) && !text.includes(TX_UNKNOWN)) {
          console.warn("[db] ROLLBACK failed after a transaction error:", rollbackErr);
        }
      }
      throw err;
    }
    // A COMMIT that fails has already released its connection on the Rust
    // side (closed, not returned); there is nothing left to roll back
    // (Gemini M3 on #54).
    await invoke("db_tx_commit", { id });
    return result;
  } finally {
    resolve(); // always unblock the next queued transaction
  }
}

/**
 * The queue above lives in one webview. A thread pop-out window has its own,
 * so it can meet the Rust side's single-transaction rule while the main window
 * is mid-sync. That is a wait, not an error: retry `VELO_TX_BUSY` with a
 * bounded backoff before giving up (Gemini M4 on #54).
 */
const BUSY_RETRY_DELAY_MS = 100;
// A sync batch or an F-5 re-key can hold the writer for longer than a few
// seconds; the wait tracks the 30 s idle watchdog, after which the holder is
// reaped anyway (Grok M3 on #54).
const BUSY_RETRY_LIMIT = 300;

async function beginWithRetry(): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await invoke("db_tx_begin");
    } catch (err) {
      if (!String(err).includes(TX_BUSY) || attempt >= BUSY_RETRY_LIMIT) throw err;
      await new Promise((r) => setTimeout(r, BUSY_RETRY_DELAY_MS));
    }
  }
}

function transactionHandle(id: string): DbExecutor {
  return {
    async execute(sql: string, values?: unknown[]) {
      const result = expectExecuteResult(await invoke("db_tx_execute", { id, sql, values: values ?? [] }));
      return { rowsAffected: result[0], lastInsertId: result[1] };
    },
    async select<T>(sql: string, values?: unknown[]) {
      return expectRows(await invoke("db_tx_select", { id, sql, values: values ?? [] })) as T;
    },
  };
}

// Results of `invoke()` are validated at the boundary (ADR-000).

function expectTxId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`db_tx_begin returned an invalid id: ${JSON.stringify(value)}`);
  }
  return value;
}

function expectExecuteResult(value: unknown): [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !Number.isInteger(value[0]) ||
    (value[0] as number) < 0 ||
    !Number.isInteger(value[1])
  ) {
    throw new Error(`db_tx_execute returned an invalid result: ${JSON.stringify(value)}`);
  }
  return [value[0] as number, value[1] as number];
}

function expectRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))) {
    throw new Error("db_tx_select returned something other than an array of rows");
  }
  return value as Record<string, unknown>[];
}

/**
 * Execute a SELECT query and return the first result or null.
 */
export async function selectFirstBy<T>(
  query: string,
  params: unknown[] = [],
): Promise<T | null> {
  const db = await getDb();
  const rows = await db.select<T[]>(query, params);
  return rows[0] ?? null;
}

/**
 * Execute a COUNT(*) query and return whether any rows exist.
 */
export async function existsBy(
  query: string,
  params: unknown[] = [],
): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(query, params);
  return (rows[0]?.count ?? 0) > 0;
}

/**
 * Convert a boolean to SQLite integer (0 or 1).
 */
export function boolToInt(value: boolean | undefined | null): number {
  return value ? 1 : 0;
}
