/**
 * Vanished-UID reconciliation — the pass (SPEC-F-4 rev 5, part 2).
 *
 * `imapDeltaSync` drives one of these per account pass:
 *
 * 1. `beginReconcilePass` mints the pass id — **one** per pass, used for every
 *    folder (a fresh id per folder would let one search reported twice promote
 *    on the second report).
 * 2. Per existing folder, after the delta check: `shouldListFolder` is the
 *    REQ-2.1 gate. When it opens, the caller fetches the folder's full UID list
 *    and hands it to `reconcileFolderList`, which diffs it against the live
 *    rows and applies the observation to the suspect table (REQ-1.1, REQ-1.4,
 *    REQ-1.5). When the folder's new-message fetch later completes,
 *    `markFetchCompleted` — REQ-2.2's counter is recomputed only for those.
 * 3. `finishReconcilePass` runs once, after the pass has stored its messages,
 *    with the attestation the caller computed (REQ-1.2b). Counters are
 *    recomputed; then, **only if attested**, confirmed suspects are deleted
 *    under the budget (REQ-1.2, REQ-1.3, REQ-3.1–3.4).
 *
 * Nothing here talks to the server. Every failure mode falls toward "keep":
 * a thrown list is a folder error, an unattested pass deletes nothing, a
 * stop deletes nothing until a person answers.
 */
import { withTransaction } from "../db/connection";
import {
  deleteObservedMessages,
  getLiveMessagesInFolder,
  getMessageRefsByIds,
  getTombstonesInFolder,
  type FolderMessageRef,
} from "../db/messages";
import { getThreadMessageCount } from "../db/threads";
import { getPendingOpsForResource } from "../db/pendingOperations";
import {
  bumpFolderMissing,
  deleteFolderSyncState,
  getFolderSyncState,
  setFlaggedNotExpunged,
} from "../db/folderSyncState";
import { useUIStore } from "@/stores/uiStore";
import {
  applySearchAll,
  confirmedInFolder,
  confirmedOnPass,
  diffVanished,
  forgetSuspects,
  forgetSuspectsWithin,
  planDeletions,
  purgeOtherGenerations,
  suspectsInFolder,
  type SuspectRow,
} from "./reconcile";

interface ListedFolder {
  uidvalidity: number;
  serverUids: Set<number>;
  fetchCompleted: boolean;
}

export interface ReconcilePass {
  accountId: string;
  passId: string;
  /** Folders whose gate opened this pass, whether or not the list succeeded. */
  gateOpened: Set<string>;
  /** Folders whose full list was fetched and applied this pass. */
  listed: Map<string, ListedFolder>;
}

export interface ReconcileSummary {
  deleted: { folder: string; uid: number; messageId: string | null }[];
  stops: { folder: string; confirmed: number; localRows: number }[];
  attested: boolean;
}

export function beginReconcilePass(accountId: string): ReconcilePass {
  return {
    accountId,
    passId: crypto.randomUUID(),
    gateOpened: new Set(),
    listed: new Map(),
  };
}

/**
 * REQ-2.1: fetch the full list only when the server's EXISTS disagrees with
 * what Velo believes is there — its live rows, plus the new UIDs this very
 * delta check just reported and is about to fetch (they are already in
 * EXISTS), plus the mail it flagged but could not expunge. An unchecked
 * folder (`exists` null) never lists. (Gemini plan read, H1: without the
 * new-UID term every incoming message tripped the gate.)
 */
export function shouldListFolder(
  exists: number | null,
  localLiveCount: number,
  incomingNewUids: number,
  flaggedNotExpunged: number,
): boolean {
  if (exists === null) return false;
  return exists !== localLiveCount + incomingNewUids + Math.max(0, flaggedNotExpunged);
}

/**
 * Apply a folder's full server list. `serverUids` must be the validated
 * answer of `imapSearchAllUids` — a throw there is a folder error and this is
 * never reached (REQ-3.3).
 *
 * `exists` is the count the delta check SELECTed moments earlier. It is not
 * used as a hard equality (mail can arrive or leave between the two
 * commands), but an **empty** list against a positive EXISTS is never a
 * complete folder: it is treated as partial, nothing is recorded, and the
 * caller gets a folder error (Grok H4 on #47).
 */
export async function reconcileFolderList(
  pass: ReconcilePass,
  folder: string,
  uidvalidity: number,
  serverUids: number[],
  exists: number | null,
): Promise<void> {
  const { accountId, passId } = pass;
  if (serverUids.length === 0 && exists !== null && exists > 0) {
    throw new Error(
      `UID SEARCH ALL in ${folder} returned no UIDs while EXISTS was ${exists}; treating the list as partial`,
    );
  }
  const server = new Set(serverUids);

  // Tombstones — rows F-5 already knows left this folder — are not part of
  // the diff: `getLiveMessagesInFolder` excludes them, so they are never
  // suspects. They are also **not** deleted here, even when the server no
  // longer lists their UID: the tombstone holds the only cached copy until
  // the destination folder syncs the message in and the F-5 reap removes it
  // (Gemini plan read, H3). A tombstone whose destination never syncs is a
  // F-5 follow-up, not a reconciliation deletion.
  const tombstones = await getTombstonesInFolder(accountId, folder);
  if (tombstones.length > 0) {
    console.debug(`[reconcile] ${folder}: ${tombstones.length} tombstone(s) excluded from the diff`);
  }

  const live = await getLiveMessagesInFolder(accountId, folder);
  const byUid = new Map(live.map((m) => [m.imap_uid, m]));
  const missing = diffVanished(byUid.keys(), server).map((uid) => ({
    uid,
    messageRowId: byUid.get(uid)!.id,
  }));

  await applySearchAll({ accountId, folder, uidvalidity, passId, presentUids: server, missing });

  // A suspect whose local row is no longer live in this folder — tombstoned
  // or re-keyed by F-5 since it was recorded — has nothing left to protect
  // and nothing left to delete. Forget it rather than let it linger, or be
  // promoted against a row that is not there (Grok H1 on #47).
  const stale = (await suspectsInFolder(accountId, folder, uidvalidity))
    .filter((s) => !byUid.has(s.uid))
    .map((s) => s.uid);
  if (stale.length > 0) {
    await forgetSuspects(accountId, folder, uidvalidity, stale);
  }

  pass.listed.set(folder, { uidvalidity, serverUids: server, fetchCompleted: false });
}

/** The folder's new-message fetch completed this pass (REQ-2.2's both-steps clause). */
export function markFetchCompleted(pass: ReconcilePass, folder: string): void {
  const entry = pass.listed.get(folder);
  if (entry) entry.fetchCompleted = true;
}

/** REQ-2.3: the belt runs once every N passes, only where the no-UIDPLUS signature shows. */
export const BELT_EVERY_N_PASSES = 10;

export function beltDue(passNumber: number, flaggedNotExpunged: number): boolean {
  return flaggedNotExpunged > 0 && passNumber > 0 && passNumber % BELT_EVERY_N_PASSES === 0;
}

/**
 * The "folder gone" path (part 3, plan §C). Called for every folder that has
 * sync state but that this pass's LIST did not return. The first miss only
 * counts (the folder is unchecked this pass, so nothing deletes); the second
 * consecutive miss takes the folder as gone on the server: its sync state row
 * goes (so attestation resumes), its suspects and any stop are voided, and the
 * user is told. **Its cached messages are kept** — deleting them on LIST
 * evidence alone would be the mass removal REQ-1 forbids.
 */
export async function noteFolderMissing(
  accountId: string,
  folder: string,
): Promise<"counted" | "removed"> {
  const misses = await bumpFolderMissing(accountId, folder);
  if (misses < 2) {
    console.warn(`[reconcile] ${folder} was not in the server's folder list (miss ${misses} of 2)`);
    return "counted";
  }
  const kept = (await getLiveMessagesInFolder(accountId, folder)).length;
  await deleteFolderSyncState(accountId, folder);
  await purgeOtherGenerations(accountId, folder, 0);
  useUIStore.getState().clearReconcileStop(accountId, folder);
  useUIStore.getState().addNotice({
    text: `${folder} no longer exists on the server; its ${kept} cached message${kept === 1 ? "" : "s"} ${kept === 1 ? "is" : "are"} kept`,
  });
  console.warn(`[reconcile] ${folder} taken as gone on the server after two consecutive misses; sync state removed, ${kept} message(s) kept`);
  return "removed";
}

/**
 * A UIDVALIDITY change voids every suspect recorded for the folder and any
 * stop raised on them (REQ-1.4, REQ-1.5): a regenerated mailbox reuses UIDs.
 * Called by the sync as soon as the delta check reports the change, before
 * the full resync — the gate does not run for that folder this pass.
 */
export async function invalidateFolderSuspects(
  accountId: string,
  folder: string,
  newUidvalidity: number,
): Promise<void> {
  await purgeOtherGenerations(accountId, folder, newUidvalidity);
  useUIStore.getState().clearReconcileStop(accountId, folder);
}

/**
 * Attestation (REQ-1.2b): every folder Velo knows about — the ones this LIST
 * returned **and** the ones it has sync state for — produced an observation;
 * every folder whose gate opened was actually listed; and no folder failed
 * anywhere in the pass. A folder missing from `checkedFolders` counts as
 * unchecked, never as "not requested"; a folder that a short or filtered LIST
 * dropped is therefore not quietly removed from the universe (Grok H5 on
 * #47). The price: a folder deleted on the server blocks attestation until
 * its sync state row is removed — recorded as a follow-up.
 */
export function attestPass(
  pass: ReconcilePass,
  knownFolders: Iterable<string>,
  checkedFolders: Set<string>,
  folderErrorCount: number,
): boolean {
  if (folderErrorCount > 0) return false;
  for (const folder of new Set(knownFolders)) {
    if (!checkedFolders.has(folder)) return false;
    if (pass.gateOpened.has(folder) && !pass.listed.has(folder)) return false;
  }
  return true;
}

/**
 * End of pass. Recompute counters for folders that completed both steps, then
 * — only if attested — delete what this pass confirmed, under the budget.
 */
export async function finishReconcilePass(
  pass: ReconcilePass,
  attested: boolean,
): Promise<ReconcileSummary> {
  const { accountId, passId } = pass;
  const summary: ReconcileSummary = { deleted: [], stops: [], attested };

  for (const [folder, entry] of pass.listed) {
    const live = await getLiveMessagesInFolder(accountId, folder);

    if (entry.fetchCompleted) {
      // REQ-2.2: the ghost population actually observed — server UIDs with no
      // live local row — after this pass's new mail has been stored. Vanished
      // local mail is not a ghost; the count is directional.
      const liveUids = new Set(live.map((m) => m.imap_uid));
      let ghosts = 0;
      for (const uid of entry.serverUids) if (!liveUids.has(uid)) ghosts += 1;
      await setFlaggedNotExpunged(accountId, folder, ghosts);
    }

    if (!attested) continue;

    const confirmed = await confirmedOnPass(accountId, folder, entry.uidvalidity, passId);
    if (confirmed.length === 0) continue;

    // The stop is judged on the WHOLE confirmed population — a folder where
    // most of the mail vanished is a human decision even if queued user work
    // happens to shield most of those rows this pass (Gemini H2). The budget
    // is then spent on the rows that are actually eligible.
    const localRows = live.length;
    const plan = planDeletions(localRows, confirmed.length);

    if (plan.stop) {
      // REQ-3.1: a catastrophic mismatch is a human decision. Nothing deleted;
      // suspects stay confirmed and the dialog asks.
      summary.stops.push({ folder, confirmed: confirmed.length, localRows });
      console.warn(
        `[reconcile] ${folder}: ${confirmed.length} of ${localRows} local messages confirmed absent on the server — stopped, asking the user`,
      );
      useUIStore.getState().pushReconcileStop({
        accountId,
        folder,
        uidvalidity: entry.uidvalidity,
        confirmed: confirmed.length,
        localRows,
      });
      continue;
    }

    const eligible = await withoutPendingOps(accountId, confirmed);
    const batch = eligible.slice(0, plan.budget);
    summary.deleted.push(...(await deleteConfirmed(accountId, folder, entry.uidvalidity, batch)));
  }

  return summary;
}

/**
 * The user answered REQ-3.1's stop with "delete them": remove every confirmed
 * suspect in that folder's current generation, in **one transaction** — all
 * or nothing, so a failure really does mean nothing changed (Grok H6 on #47).
 * The cap rate-limits *unattended* passes; a person has just confirmed a mass
 * removal. Rows with pending operations are still skipped.
 *
 * Refuses when the folder's synced UIDVALIDITY is no longer the one the stop
 * was raised for: the suspects the user was asked about belong to a mailbox
 * generation that no longer exists (Grok H2 on #47).
 */
export async function deleteConfirmedAfterUserApproval(
  accountId: string,
  folder: string,
  uidvalidity: number,
): Promise<number> {
  const state = await getFolderSyncState(accountId, folder);
  if (state !== null && state.uidvalidity !== null && state.uidvalidity !== uidvalidity) {
    throw new Error(
      `${folder} has been regenerated on the server since this was asked (UIDVALIDITY ${state.uidvalidity}, not ${uidvalidity}); nothing was deleted`,
    );
  }
  const confirmed = await confirmedInFolder(accountId, folder, uidvalidity);
  const eligible = await withoutPendingOps(accountId, confirmed);
  const deleted = await deleteConfirmed(accountId, folder, uidvalidity, eligible);
  return deleted.length;
}

/** REQ-3.4: a suspect whose message or thread has queued user work waits. */
async function withoutPendingOps(accountId: string, rows: SuspectRow[]): Promise<SuspectRow[]> {
  if (rows.length === 0) return rows;
  const refs = await getMessageRefsByIds(
    accountId,
    rows.map((r) => r.message_row_id),
  );
  const threadOf = new Map(refs.map((r) => [r.id, r.thread_id]));
  // Thread-level ops are cached per thread; message-level ops are checked
  // per row — caching the combined answer under the thread let a sibling's
  // clean result hide a row's own queued work (Gemini H1).
  const threadBlocked = new Map<string, boolean>();
  const out: SuspectRow[] = [];
  for (const row of rows) {
    const threadId = threadOf.get(row.message_row_id);
    if (threadId === undefined) {
      // The row is already gone locally; nothing to delete, nothing to block.
      continue;
    }
    let byThread = threadBlocked.get(threadId);
    if (byThread === undefined) {
      byThread = (await getPendingOpsForResource(accountId, threadId)).length > 0;
      threadBlocked.set(threadId, byThread);
    }
    if (byThread) continue;
    const msgOps = await getPendingOpsForResource(accountId, row.message_row_id);
    if (msgOps.length === 0) out.push(row);
  }
  return out;
}

/**
 * Delete confirmed rows (REQ-1.3) in one transaction: the message rows —
 * each only if it still is the row that was observed: same id, still in this
 * folder under this UID, and live — then any thread left with no messages
 * together with its labels, then the suspect records. A row that no longer
 * matches (re-keyed, tombstoned or replaced since the observation) is left
 * alone; its suspect record is forgotten too, since it no longer describes a
 * live row in this folder. Each deletion is logged with folder, UID and
 * Message-ID (REQ-3.2).
 */
async function deleteConfirmed(
  accountId: string,
  folder: string,
  uidvalidity: number,
  rows: SuspectRow[],
): Promise<ReconcileSummary["deleted"]> {
  if (rows.length === 0) return [];
  const refs = await getMessageRefsByIds(
    accountId,
    rows.map((r) => r.message_row_id),
  );
  const refById = new Map<string, FolderMessageRef>(refs.map((r) => [r.id, r]));
  const deleted: ReconcileSummary["deleted"] = [];

  await withTransaction(async (db) => {
    const removedIds = new Set(
      await deleteObservedMessages(
        db,
        accountId,
        folder,
        rows.map((r) => ({ id: r.message_row_id, uid: r.uid })),
      ),
    );
    const threads = new Set<string>();
    for (const r of rows) {
      if (!removedIds.has(r.message_row_id)) continue;
      const ref = refById.get(r.message_row_id);
      if (ref) threads.add(ref.thread_id);
      deleted.push({ folder, uid: r.uid, messageId: ref?.message_id_header ?? null });
    }
    for (const threadId of threads) {
      if ((await getThreadMessageCount(db, accountId, threadId)) === 0) {
        await db.execute(
          "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2",
          [accountId, threadId],
        );
        await db.execute("DELETE FROM threads WHERE account_id = $1 AND id = $2", [
          accountId,
          threadId,
        ]);
      }
    }
    await forgetSuspectsWithin(
      db,
      accountId,
      folder,
      uidvalidity,
      rows.map((r) => r.uid),
    );
  });

  for (const d of deleted) {
    console.info(
      `[reconcile] deleted ${d.folder}/${d.uid} (${d.messageId ?? "no Message-ID"}): confirmed absent on the server`,
    );
  }
  const skipped = rows.length - deleted.length;
  if (skipped > 0) {
    console.info(
      `[reconcile] ${folder}: ${skipped} confirmed row(s) no longer matched their observation and were left alone`,
    );
  }
  return deleted;
}
