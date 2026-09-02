import { getDb, selectFirstBy } from "./connection";

export interface FolderSyncState {
  account_id: string;
  folder_path: string;
  uidvalidity: number | null;
  last_uid: number;
  modseq: number | null;
  last_sync_at: number | null;
  /**
   * F-4 REQ-2.2: how many messages in this folder Velo flagged `\Deleted` but
   * could not expunge (no UIDPLUS). They still count toward the server's
   * `EXISTS`, so the gate adds them to the local count before comparing.
   * Optional on the type because `upsertFolderSyncState` never writes it (the
   * column defaults to 0 and the upsert leaves it alone); rows read from the
   * database always carry it.
   */
  flagged_not_expunged?: number;
  /** F-4 part 3 (migration 27): delta passes run for this folder — REQ-2.3's belt clock. */
  reconcile_passes?: number;
  /** F-4 part 3: a `reconcile` op gave up (REQ-4.3); the next pass lists the folder regardless of the gate. */
  force_list?: number;
  /** F-4 part 3: consecutive passes on which the server's LIST omitted this folder. */
  missing_passes?: number;
}

/**
 * F-4 part 3: bump the folder's pass counter and return the new value, so the
 * REQ-2.3 belt can run "once every N passes" without in-memory state.
 */
export async function bumpReconcilePasses(accountId: string, folderPath: string): Promise<number> {
  const db = await getDb();
  await db.execute(
    `UPDATE folder_sync_state SET reconcile_passes = COALESCE(reconcile_passes, 0) + 1
     WHERE account_id = $1 AND folder_path = $2`,
    [accountId, folderPath],
  );
  const rows = await db.select<{ n: number }[]>(
    "SELECT reconcile_passes AS n FROM folder_sync_state WHERE account_id = $1 AND folder_path = $2",
    [accountId, folderPath],
  );
  return rows[0]?.n ?? 0;
}

/** F-4 REQ-4.3: a reconcile op exhausted its attempts — the next pass must list this folder. */
export async function setForceList(accountId: string, folderPath: string, on: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE folder_sync_state SET force_list = $1 WHERE account_id = $2 AND folder_path = $3",
    [on ? 1 : 0, accountId, folderPath],
  );
}

/**
 * F-4 part 3, the "folder gone" path: count a pass on which LIST omitted the
 * folder. Returns the new consecutive count. `clearFolderMissing` resets it
 * when the folder is listed again.
 */
export async function bumpFolderMissing(accountId: string, folderPath: string): Promise<number> {
  const db = await getDb();
  await db.execute(
    `UPDATE folder_sync_state SET missing_passes = COALESCE(missing_passes, 0) + 1
     WHERE account_id = $1 AND folder_path = $2`,
    [accountId, folderPath],
  );
  const rows = await db.select<{ n: number }[]>(
    "SELECT missing_passes AS n FROM folder_sync_state WHERE account_id = $1 AND folder_path = $2",
    [accountId, folderPath],
  );
  return rows[0]?.n ?? 0;
}

export async function clearFolderMissing(accountId: string, folderPath: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE folder_sync_state SET missing_passes = 0 WHERE account_id = $1 AND folder_path = $2 AND missing_passes <> 0",
    [accountId, folderPath],
  );
}

export async function getFolderSyncState(
  accountId: string,
  folderPath: string,
): Promise<FolderSyncState | null> {
  return selectFirstBy<FolderSyncState>(
    "SELECT * FROM folder_sync_state WHERE account_id = $1 AND folder_path = $2",
    [accountId, folderPath],
  );
}

export async function upsertFolderSyncState(
  state: FolderSyncState,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO folder_sync_state (account_id, folder_path, uidvalidity, last_uid, modseq, last_sync_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(account_id, folder_path) DO UPDATE SET
       uidvalidity = $3, last_uid = $4, modseq = $5, last_sync_at = $6`,
    [
      state.account_id,
      state.folder_path,
      state.uidvalidity,
      state.last_uid,
      state.modseq,
      state.last_sync_at,
    ],
  );
}

/**
 * F-4 REQ-2.2: a removal that left `n` messages flagged but unexpunged. A
 * folder with no sync state row is not synced, so there is nothing to keep in
 * step with; the UPDATE simply matches nothing.
 */
export async function incrementFlaggedNotExpunged(
  accountId: string,
  folderPath: string,
  n: number,
): Promise<void> {
  if (n <= 0) return;
  const db = await getDb();
  await db.execute(
    `UPDATE folder_sync_state SET flagged_not_expunged = COALESCE(flagged_not_expunged, 0) + $1
     WHERE account_id = $2 AND folder_path = $3`,
    [n, accountId, folderPath],
  );
}

/**
 * F-4 REQ-2.2: recompute from the observation — the server UIDs with no live
 * local row after a full list — which may well be zero. What the spec forbids
 * is *resetting* the counter blindly on every list; the value itself follows
 * what was seen.
 */
export async function setFlaggedNotExpunged(
  accountId: string,
  folderPath: string,
  n: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE folder_sync_state SET flagged_not_expunged = $1
     WHERE account_id = $2 AND folder_path = $3`,
    [Math.max(0, n), accountId, folderPath],
  );
}

export async function deleteFolderSyncState(
  accountId: string,
  folderPath: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM folder_sync_state WHERE account_id = $1 AND folder_path = $2",
    [accountId, folderPath],
  );
}

export async function clearAllFolderSyncStates(
  accountId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM folder_sync_state WHERE account_id = $1",
    [accountId],
  );
}

export async function getAllFolderSyncStates(
  accountId: string,
): Promise<FolderSyncState[]> {
  const db = await getDb();
  return db.select<FolderSyncState[]>(
    "SELECT * FROM folder_sync_state WHERE account_id = $1 ORDER BY folder_path ASC",
    [accountId],
  );
}
