/**
 * Vanished-UID reconciliation — the substrate (SPEC-F-4 rev 5, part 1).
 *
 * When a message leaves a folder on the server by a route Velo did not
 * perform, sync should remove it locally — but never on a single observation,
 * never on a partial pass, never beyond a per-folder cap. This module holds
 * the pure decisions and the `reconcile_suspects` state machine (REQ-1.5).
 * Wiring into `imapDeltaSync` (the REQ-2 gate, the pass attestation, the
 * end-of-pass deletion) is part 2 and is not in this file.
 *
 * Everything here fails toward "keep".
 *
 * **Hard invariant for callers (part 2):** every successful `UID SEARCH ALL`
 * in a folder runs the whole trio — purge other generations, clear the UIDs
 * that are present, record the UIDs that are missing — atomically, under one
 * pass id that is stable for the entire account pass. `applySearchAll` is
 * that trio; calling the pieces separately is the unusual path. A skipped
 * gate or a folder error calls none of them (REQ-1.4, REQ-3.3).
 */
import { getDb, withTransaction } from "../db/connection";

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

/** UIDs present locally that the server's full list does not contain (REQ-1.1). Deduplicated, sorted. */
export function diffVanished(localUids: Iterable<number>, serverUids: Iterable<number>): number[] {
  const server = new Set(serverUids);
  const vanished = new Set<number>();
  for (const uid of localUids) {
    if (!server.has(uid)) vanished.add(uid);
  }
  return [...vanished].sort((a, b) => a - b);
}

/**
 * Per-folder, per-pass deletion cap: `min(500, max(10, ⌈10% of local rows⌉))`
 * (REQ-3.1). Binding at every folder size — the floor of 10 lets a small
 * folder clear fully in one pass, deliberately.
 */
export function deletionCap(localRows: number): number {
  return Math.min(500, Math.max(10, Math.ceil(localRows * 0.1)));
}

export interface DeletionPlan {
  /** How many confirmed suspects this pass may delete (oldest confirmation first). */
  budget: number;
  /**
   * The REQ-3.1 hard stop: confirmed suspects exceed 50% of the folder's local
   * rows *and* the folder has more than 10 rows. Delete nothing; a human
   * decides. The >10 qualifier is what lets the ≤10-row full clear execute.
   */
  stop: boolean;
}

/**
 * REQ-1.2(c) as a budget, never a precondition: with 15 confirmed over a cap
 * of 10 this returns 10, and the next pass returns 5 — the batching that
 * removed rev 3's deadlock. Batching cannot re-cross the stop from below:
 * (S−k)/(R−k) is strictly decreasing for S<R.
 */
export function planDeletions(localRows: number, confirmedCount: number): DeletionPlan {
  if (confirmedCount <= 0) return { budget: 0, stop: false };
  // Inconsistent inputs — more confirmed suspects than the folder has rows, or
  // no rows at all — are a miscount somewhere, and a miscount is a human
  // decision, not a budget (Grok L8).
  if (localRows <= 0 || confirmedCount > localRows) return { budget: 0, stop: true };
  if (localRows > 10 && confirmedCount * 2 > localRows) return { budget: 0, stop: true };
  return { budget: Math.min(deletionCap(localRows), confirmedCount, localRows), stop: false };
}

// ---------------------------------------------------------------------------
// Suspect state machine (REQ-1.5) — rows keyed (account, folder, uid, uidvalidity)
// ---------------------------------------------------------------------------

export type SuspectStatus = "suspect" | "confirmed_absent";

export interface SuspectRow {
  account_id: string;
  folder: string;
  uid: number;
  uidvalidity: number;
  message_row_id: string;
  status: SuspectStatus;
  first_pass_id: string;
  last_verified_pass_id: string | null;
  first_seen_at: number;
}

const CHUNK = 400;

/**
 * A `UID SEARCH ALL` in `folder` on pass `passId` did not list these UIDs.
 *
 * Newly missing UIDs are inserted as `suspect`. UIDs that were already
 * suspect from an *earlier* pass are promoted to `confirmed_absent` with
 * `last_verified_pass_id = passId`. Ones already confirmed are **re-stamped**
 * with this pass id — that is required, not incidental: REQ-3.1's budget
 * leaves confirmed leftovers for the next pass, and `confirmedOnPass(N)` only
 * returns rows verified on pass N, so a leftover that is still missing must
 * be re-verified each pass to stay eligible. A confirmed row that is *not*
 * reported missing this pass is left alone (and, if it reappeared, the
 * caller's `clearReappeared` removes it). A UID first seen suspect on this
 * same pass is not promoted: two observations means two passes (REQ-1.2(a)).
 */
export async function recordMissing(
  accountId: string,
  folder: string,
  uidvalidity: number,
  passId: string,
  missing: { uid: number; messageRowId: string }[],
): Promise<void> {
  if (missing.length === 0) return;

  // One transaction: a bulk server-side removal reports hundreds of UIDs, and
  // the record must be all-or-nothing — a half-recorded pass would confirm
  // some suspects on the next pass and not others (Gemini L4).
  await withTransaction(async (db) => {
    await recordMissingWithin(db, accountId, folder, uidvalidity, passId, missing);
  });
}

async function recordMissingWithin(
  db: Pick<Awaited<ReturnType<typeof getDb>>, "execute">,
  accountId: string,
  folder: string,
  uidvalidity: number,
  passId: string,
  missing: { uid: number; messageRowId: string }[],
): Promise<void> {
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    // Promote first: an INSERT OR IGNORE afterwards cannot touch these rows,
    // and a row inserted on this pass keeps first_pass_id = passId, which the
    // promotion below excludes. `$n` once each, in order (the SQLite harness
    // translator depends on it), so the pass id is bound twice.
    const uidPlaceholders = chunk.map((_, j) => `$${j + 6}`).join(", ");
    // Adopt rows a reconcile op inserted (`insertSuspects`): this list is
    // their first *list* observation, so they take this pass id and the
    // promotion below leaves them as suspects (Grok H1 on #50).
    await db.execute(
      `UPDATE reconcile_suspects
       SET first_pass_id = $1
       WHERE account_id = $2 AND folder = $3 AND uidvalidity = $4
         AND first_pass_id LIKE $5
         AND uid IN (${uidPlaceholders})`,
      [passId, accountId, folder, uidvalidity, `${RECONCILE_OP_PASS_PREFIX}%`, ...chunk.map((m) => m.uid)],
    );
    await db.execute(
      `UPDATE reconcile_suspects
       SET status = 'confirmed_absent', last_verified_pass_id = $1
       WHERE account_id = $2 AND folder = $3 AND uidvalidity = $4
         AND first_pass_id <> $5
         AND uid IN (${uidPlaceholders})`,
      [passId, accountId, folder, uidvalidity, passId, ...chunk.map((m) => m.uid)],
    );
    for (const m of chunk) {
      await db.execute(
        `INSERT OR IGNORE INTO reconcile_suspects
           (account_id, folder, uid, uidvalidity, message_row_id, status, first_pass_id)
         VALUES ($1, $2, $3, $4, $5, 'suspect', $6)`,
        [accountId, folder, m.uid, uidvalidity, m.messageRowId, passId],
      );
    }
  }
}

/** Prefix of the source id `insertSuspects` writes as `first_pass_id`. */
export const RECONCILE_OP_PASS_PREFIX = "reconcile:";

/**
 * The reconcile op's write (REQ-4.5): insert as `suspect`, nothing else. It
 * never promotes, and a row that already exists — from a list pass or an
 * earlier op — is left exactly as it is. `sourceId` must carry
 * `RECONCILE_OP_PASS_PREFIX`, which `recordMissing` recognises: the first
 * full list that still reports the UID *adopts* the row as its own first
 * sight and the list after that confirms it. A targeted `UID SEARCH` therefore
 * never stands in for one of the two list observations, and two ops in a row
 * confirm nothing (Grok H1 on #50).
 */
export async function insertSuspects(
  accountId: string,
  folder: string,
  uidvalidity: number,
  sourceId: string,
  missing: { uid: number; messageRowId: string }[],
): Promise<void> {
  if (missing.length === 0) return;
  if (!sourceId.startsWith(RECONCILE_OP_PASS_PREFIX)) {
    throw new Error(`insertSuspects: source id must start with ${RECONCILE_OP_PASS_PREFIX}`);
  }
  await withTransaction(async (db) => {
    for (const m of missing) {
      await db.execute(
        `INSERT OR IGNORE INTO reconcile_suspects
           (account_id, folder, uid, uidvalidity, message_row_id, status, first_pass_id)
         VALUES ($1, $2, $3, $4, $5, 'suspect', $6)`,
        [accountId, folder, m.uid, uidvalidity, m.messageRowId, sourceId],
      );
    }
  });
}

/**
 * A UID that reappears clears its suspect record (REQ-1.4). Called with the
 * UIDs a full server list *did* contain.
 *
 * Reads the folder's few suspect rows and intersects in memory, rather than
 * pushing the whole server list (tens of thousands of UIDs on a big folder)
 * through chunked DELETEs — the common case is zero suspects and zero writes
 * (Gemini M2).
 */
export async function clearReappeared(
  accountId: string,
  folder: string,
  uidvalidity: number,
  presentUids: Iterable<number>,
): Promise<void> {
  const db = await getDb();
  const suspects = await db.select<{ uid: number }[]>(
    "SELECT uid FROM reconcile_suspects WHERE account_id = $1 AND folder = $2 AND uidvalidity = $3",
    [accountId, folder, uidvalidity],
  );
  if (suspects.length === 0) return;

  const present = new Set(presentUids);
  const reappeared = suspects.map((s) => s.uid).filter((uid) => present.has(uid));
  await deleteSuspects(db, accountId, folder, uidvalidity, reappeared);
}

async function deleteSuspects(
  db: Pick<Awaited<ReturnType<typeof getDb>>, "execute">,
  accountId: string,
  folder: string,
  uidvalidity: number,
  uids: number[],
): Promise<void> {
  for (let i = 0; i < uids.length; i += CHUNK) {
    const chunk = uids.slice(i, i + CHUNK);
    const placeholders = chunk.map((_, j) => `$${j + 4}`).join(", ");
    await db.execute(
      `DELETE FROM reconcile_suspects
       WHERE account_id = $1 AND folder = $2 AND uidvalidity = $3 AND uid IN (${placeholders})`,
      [accountId, folder, uidvalidity, ...chunk],
    );
  }
}

/**
 * Before diffing a folder whose UIDVALIDITY is `current`: purge every suspect
 * recorded under another generation (REQ-1.5). A regenerated mailbox reuses
 * UIDs, and a stale suspect must not shoot the new tenant.
 */
export async function purgeOtherGenerations(
  accountId: string,
  folder: string,
  current: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM reconcile_suspects WHERE account_id = $1 AND folder = $2 AND uidvalidity <> $3",
    [accountId, folder, current],
  );
}

/** Every suspect of a folder, whatever its generation — for a folder that is gone. */
export async function purgeAllSuspects(accountId: string, folder: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM reconcile_suspects WHERE account_id = $1 AND folder = $2", [
    accountId,
    folder,
  ]);
}

/**
 * The rows the end-of-pass deletion may touch: `confirmed_absent`, in the
 * folder's *current* generation, AND verified on *this* pass (REQ-1.5), oldest
 * confirmation first (REQ-3.1's batching order). Suspects in a folder the
 * gate let skip this pass are not here; neither is anything from another
 * UIDVALIDITY, whatever pass id it carries (Grok M4).
 */
export async function confirmedOnPass(
  accountId: string,
  folder: string,
  uidvalidity: number,
  passId: string,
): Promise<SuspectRow[]> {
  const db = await getDb();
  return db.select<SuspectRow[]>(
    `SELECT * FROM reconcile_suspects
     WHERE account_id = $1 AND folder = $2 AND uidvalidity = $3
       AND status = 'confirmed_absent' AND last_verified_pass_id = $4
     ORDER BY first_seen_at ASC, uid ASC`,
    [accountId, folder, uidvalidity, passId],
  );
}

export interface SearchAllObservation {
  accountId: string;
  folder: string;
  /** The folder's UIDVALIDITY as SELECTed for this search. */
  uidvalidity: number;
  /** Stable for the whole account pass. */
  passId: string;
  /** Every UID the server listed. */
  presentUids: Iterable<number>;
  /** Local UIDs the list did not contain, with their row ids. */
  missing: { uid: number; messageRowId: string }[];
}

/**
 * Apply one successful `UID SEARCH ALL` to the suspect table, atomically:
 * purge suspects from other generations, clear the ones that reappeared,
 * record the ones still missing. This is the entry point part 2 calls; the
 * three pieces are exported for tests and for resync paths, not for routine
 * use (Grok M4 — calling them separately makes two-pass confirmation and
 * generation isolation caller-optional).
 */
export async function applySearchAll(obs: SearchAllObservation): Promise<void> {
  const { accountId, folder, uidvalidity, passId, presentUids, missing } = obs;
  await withTransaction(async (db) => {
    await db.execute(
      "DELETE FROM reconcile_suspects WHERE account_id = $1 AND folder = $2 AND uidvalidity <> $3",
      [accountId, folder, uidvalidity],
    );

    const suspects = await db.select<{ uid: number }[]>(
      "SELECT uid FROM reconcile_suspects WHERE account_id = $1 AND folder = $2 AND uidvalidity = $3",
      [accountId, folder, uidvalidity],
    );
    if (suspects.length > 0) {
      const present = new Set(presentUids);
      const reappeared = suspects.map((s) => s.uid).filter((uid) => present.has(uid));
      await deleteSuspects(db, accountId, folder, uidvalidity, reappeared);
    }

    await recordMissingWithin(db, accountId, folder, uidvalidity, passId, missing);
  });
}

/**
 * Every `confirmed_absent` row in a folder's current generation, regardless of
 * pass — the set the REQ-3.1 stop asked the user about. Only the explicit
 * user confirmation reads this; unattended passes use `confirmedOnPass`.
 */
export async function confirmedInFolder(
  accountId: string,
  folder: string,
  uidvalidity: number,
): Promise<SuspectRow[]> {
  const db = await getDb();
  return db.select<SuspectRow[]>(
    `SELECT * FROM reconcile_suspects
     WHERE account_id = $1 AND folder = $2 AND uidvalidity = $3 AND status = 'confirmed_absent'
     ORDER BY first_seen_at ASC, uid ASC`,
    [accountId, folder, uidvalidity],
  );
}

/** Every suspect record in a folder's generation, whatever its status. */
export async function suspectsInFolder(
  accountId: string,
  folder: string,
  uidvalidity: number,
): Promise<SuspectRow[]> {
  const db = await getDb();
  return db.select<SuspectRow[]>(
    "SELECT * FROM reconcile_suspects WHERE account_id = $1 AND folder = $2 AND uidvalidity = $3 ORDER BY uid ASC",
    [accountId, folder, uidvalidity],
  );
}

/** Remove suspect records once their rows have been deleted (or on resync). */
export async function forgetSuspects(
  accountId: string,
  folder: string,
  uidvalidity: number,
  uids: number[],
): Promise<void> {
  if (uids.length === 0) return;
  await deleteSuspects(await getDb(), accountId, folder, uidvalidity, uids);
}

/** `forgetSuspects` on the caller's transaction, so the rows and their records go together. */
export async function forgetSuspectsWithin(
  db: Pick<Awaited<ReturnType<typeof getDb>>, "execute">,
  accountId: string,
  folder: string,
  uidvalidity: number,
  uids: number[],
): Promise<void> {
  if (uids.length === 0) return;
  await deleteSuspects(db, accountId, folder, uidvalidity, uids);
}
