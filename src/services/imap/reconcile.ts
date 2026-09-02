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
 */
import { getDb } from "../db/connection";

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

/** UIDs present locally that the server's full list does not contain (REQ-1.1). */
export function diffVanished(localUids: Iterable<number>, serverUids: Iterable<number>): number[] {
  const server = new Set(serverUids);
  const vanished: number[] = [];
  for (const uid of localUids) {
    if (!server.has(uid)) vanished.push(uid);
  }
  return vanished.sort((a, b) => a - b);
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
  if (localRows > 10 && confirmedCount * 2 > localRows) return { budget: 0, stop: true };
  return { budget: Math.min(deletionCap(localRows), confirmedCount), stop: false };
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
 * `last_verified_pass_id = passId`; ones already confirmed are re-stamped so
 * the end-of-pass deletion (`confirmedOnPass`) sees them as verified *this*
 * pass. A UID first seen suspect on this same pass is not promoted: two
 * observations means two passes (REQ-1.2(a)).
 */
export async function recordMissing(
  accountId: string,
  folder: string,
  uidvalidity: number,
  passId: string,
  missing: { uid: number; messageRowId: string }[],
): Promise<void> {
  if (missing.length === 0) return;
  const db = await getDb();

  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    // Promote first: an INSERT OR IGNORE afterwards cannot touch these rows,
    // and a row inserted on this pass keeps first_pass_id = passId, which the
    // promotion below excludes.
    // `$n` once each, in order (the SQLite harness translator depends on it),
    // so the pass id is bound twice rather than referenced twice.
    const uidPlaceholders = chunk.map((_, j) => `$${j + 6}`).join(", ");
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

/**
 * A UID that reappears clears its suspect record (REQ-1.4). Called with the
 * UIDs a full server list *did* contain.
 */
export async function clearReappeared(
  accountId: string,
  folder: string,
  uidvalidity: number,
  presentUids: number[],
): Promise<void> {
  if (presentUids.length === 0) return;
  const db = await getDb();
  for (let i = 0; i < presentUids.length; i += CHUNK) {
    const chunk = presentUids.slice(i, i + CHUNK);
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

/**
 * The rows the end-of-pass deletion may touch: `confirmed_absent` AND verified
 * on *this* pass (REQ-1.5), oldest confirmation first (REQ-3.1's batching
 * order). Suspects in a folder the gate let skip this pass are not here.
 */
export async function confirmedOnPass(
  accountId: string,
  folder: string,
  passId: string,
): Promise<SuspectRow[]> {
  const db = await getDb();
  return db.select<SuspectRow[]>(
    `SELECT * FROM reconcile_suspects
     WHERE account_id = $1 AND folder = $2 AND status = 'confirmed_absent' AND last_verified_pass_id = $3
     ORDER BY first_seen_at ASC, uid ASC`,
    [accountId, folder, passId],
  );
}

/** Remove suspect records once their rows have been deleted (or on resync). */
export async function forgetSuspects(
  accountId: string,
  folder: string,
  uidvalidity: number,
  uids: number[],
): Promise<void> {
  await clearReappeared(accountId, folder, uidvalidity, uids);
}
