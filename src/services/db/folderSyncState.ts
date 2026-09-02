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
    `UPDATE folder_sync_state SET flagged_not_expunged = flagged_not_expunged + $1
     WHERE account_id = $2 AND folder_path = $3`,
    [n, accountId, folderPath],
  );
}

/**
 * F-4 REQ-2.2: recompute, never zero — set to the ghost population a full
 * list actually observed (`|server − local|`).
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
