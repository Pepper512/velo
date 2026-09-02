/**
 * Move-time row hygiene (F-5): make the local row follow the message.
 *
 * After Velo moves, archives, trashes or spam-files an IMAP message, the local
 * `messages` row used to keep identifying it by its *source* folder and UID.
 * Every provider action derives its target from that id, so a later action on
 * the moved message went to the wrong folder; and when the destination folder
 * synced, the message arrived under a new id and the thread rendered it twice.
 *
 * Two outcomes, decided per UID:
 *
 * - **Re-key (option A).** The server's `COPYUID` names the new UID; the row's
 *   `id`, `imap_folder` and `imap_uid` are rewritten in one transaction and the
 *   destination sync's upsert then *hits* it. Identity preserved, no window.
 * - **Tombstone (option B fallback).** No usable mapping for this UID, or a
 *   local row already sits at the new id. The row is marked `moved_to`, hidden
 *   from thread views and provider actions, and reaped when the destination
 *   sync inserts the fresh row.
 *
 * This runs *after* the server has completed the move, outside the IMAP
 * session. Nothing here may throw back to the caller: the server is the source
 * of truth and a thrown error would read as a failed move, which the queue
 * would retry — and a retried COPY fallback duplicates mail. Local failures are
 * logged and the next sync corrects the rows.
 */
import { rekeyMovedMessages, tombstoneMovedMessages, type RekeyPair } from "../db/messages";
import { getFolderSyncState } from "../db/folderSyncState";
import type { UidMapping } from "./tauriCommands";

/** The id format sync assigns (`imapSync.ts`) and `groupByFolder` parses. */
function imapMessageId(accountId: string, folder: string, uid: number): string {
  return `imap-${accountId}-${folder}-${uid}`;
}

/**
 * Is the mapping's destination generation the one this account has synced?
 *
 * Destination UIDs are only meaningful for the UIDVALIDITY they were issued
 * under (RFC 4315 §3). If the folder has been synced before and its recorded
 * UIDVALIDITY differs from the one in the `COPYUID`, the ids the re-key would
 * produce belong to a different generation of that mailbox: they might be
 * free, or they might be someone else's. Either way the mapping is refused
 * and the rows fall back to tombstones (Grok L9). A folder never synced has
 * no recorded generation to disagree with; sync will record this one.
 */
async function generationMatches(
  accountId: string,
  destFolder: string,
  destUidvalidity: number | null,
): Promise<boolean> {
  if (destUidvalidity === null) return false;
  const state = await getFolderSyncState(accountId, destFolder);
  if (state === null || state.uidvalidity === null || state.uidvalidity === 0) return true;
  return state.uidvalidity === destUidvalidity;
}

/**
 * Settle the local rows for `uids`, which the server has just moved from
 * `sourceFolder` to `destFolder`.
 */
export async function settleMovedRows(
  accountId: string,
  sourceFolder: string,
  destFolder: string,
  uids: number[],
  mapping: UidMapping[] | null,
  destUidvalidity: number | null,
): Promise<void> {
  if (uids.length === 0) return;

  const oldIdFor = (uid: number) => imapMessageId(accountId, sourceFolder, uid);
  const toTombstone: string[] = uids.map(oldIdFor);

  if (mapping !== null && !(await generationMatches(accountId, destFolder, destUidvalidity))) {
    console.warn(
      `[moveHygiene] COPYUID for ${destFolder} carries UIDVALIDITY ${destUidvalidity}, not the synced one; hiding ${uids.length} row(s) until the folder syncs`,
    );
    mapping = null;
  }

  if (mapping !== null) {
    const destUidFor = new Map(mapping.map((m) => [m.source_uid, m.dest_uid]));
    const pairs: RekeyPair[] = [];
    const unmapped: string[] = [];
    for (const uid of uids) {
      const destUid = destUidFor.get(uid);
      if (destUid === undefined) {
        unmapped.push(oldIdFor(uid));
      } else {
        pairs.push({
          oldId: oldIdFor(uid),
          newId: imapMessageId(accountId, destFolder, destUid),
          folder: destFolder,
          uid: destUid,
        });
      }
    }

    try {
      // Re-keys and the tombstones for everything else commit together: a
      // crash between them could otherwise leave an unmapped row live under
      // its stale id.
      await rekeyMovedMessages(accountId, pairs, { ids: unmapped, movedTo: destFolder });
      return;
    } catch (err) {
      // The transaction rolled back: every row is as it was. Fall back to
      // hiding all of them rather than leaving stale pointers live.
      console.error(
        `[moveHygiene] Re-key of ${pairs.length} row(s) ${sourceFolder} -> ${destFolder} failed; tombstoning instead:`,
        err,
      );
    }
  }

  if (toTombstone.length === 0) return;
  try {
    await tombstoneMovedMessages(accountId, toTombstone, destFolder);
  } catch (err) {
    console.error(
      `[moveHygiene] Could not tombstone ${toTombstone.length} moved row(s) in ${sourceFolder}; the next sync will correct them:`,
      err,
    );
  }
}
