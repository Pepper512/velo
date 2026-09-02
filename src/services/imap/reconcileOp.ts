/**
 * The `reconcile` queue op (SPEC-F-4 rev 5 REQ-4, part 3).
 *
 * When a move or delete ends with `VELO_OUTCOME_UNKNOWN:` — the server may or
 * may not have done it — nothing used to look again. This op is the later
 * observer: a targeted `UID SEARCH UID <set>` in the source folder. It is a
 * **read-repair borrowing the write queue** and it never deletes anything
 * itself:
 *
 * - a UID the server no longer lists is inserted as a *suspect* (REQ-4.5) —
 *   never promoted; the ordinary two-list-pass reconciliation confirms and
 *   deletes it;
 * - a UID the server still lists means the operation did not take effect —
 *   the user is told, the op completes.
 *
 * The op carries the folder's UIDVALIDITY from enqueue time. If the mailbox
 * regenerated in between, the UIDs mean nothing any more and the op is
 * dropped — the resync of the new generation is the observation (Grok H3 on
 * #50).
 *
 * Three strikes (`max_retries` 3) and the op degrades to "list this folder in
 * full on the next pass" plus a notice (REQ-4.3) — it never vanishes silently.
 */
import { enqueuePendingOperation } from "../db/pendingOperations";
import { getFolderSyncState, setForceList } from "../db/folderSyncState";
import { getLiveMessagesInFolder } from "../db/messages";
import { useUIStore } from "@/stores/uiStore";
import { withSession } from "./sessionManager";
import { imapSearchUidsPresent } from "./tauriCommands";
import { RECONCILE_OP_PASS_PREFIX, insertSuspects } from "./reconcile";

export const RECONCILE_OP = "reconcile";
export const RECONCILE_MAX_RETRIES = 3;
const RESOURCE_PREFIX = "reconcile:";

export interface ReconcileParams {
  folder: string;
  uids: number[];
  /** The folder's UIDVALIDITY when the op was queued; 0 when it had no sync state. */
  uidvalidity: number;
  /** REQ-4.4: a repair, not a user action — for any queue surface that lists ops. */
  kind: "repair";
}

export function reconcileResourceId(folder: string): string {
  return `${RESOURCE_PREFIX}${folder}`;
}

function folderFromResourceId(resourceId: string | undefined): string | null {
  if (!resourceId?.startsWith(RESOURCE_PREFIX)) return null;
  const folder = resourceId.slice(RESOURCE_PREFIX.length);
  return folder.length > 0 ? folder : null;
}

/**
 * Group IMAP message ids (`imap-{accountId}-{folder}-{uid}`) by folder. The
 * folder may contain hyphens; the UID is what follows the last one.
 */
export function groupImapIdsByFolder(accountId: string, messageIds: string[]): Map<string, number[]> {
  const prefix = `imap-${accountId}-`;
  const out = new Map<string, number[]>();
  for (const id of messageIds) {
    if (!id.startsWith(prefix)) continue;
    const rest = id.slice(prefix.length);
    const cut = rest.lastIndexOf("-");
    if (cut <= 0) continue;
    const folder = rest.slice(0, cut);
    const uid = Number(rest.slice(cut + 1));
    if (!Number.isInteger(uid) || uid < 1) continue;
    const list = out.get(folder) ?? [];
    list.push(uid);
    out.set(folder, list);
  }
  return out;
}

/** REQ-4.1: one op per source folder, three attempts. Returns how many were enqueued. */
export async function enqueueReconcileOps(accountId: string, messageIds: string[]): Promise<number> {
  let n = 0;
  for (const [folder, uids] of groupImapIdsByFolder(accountId, messageIds)) {
    const state = await getFolderSyncState(accountId, folder);
    const params: ReconcileParams = { folder, uids, uidvalidity: state?.uidvalidity ?? 0, kind: "repair" };
    await enqueuePendingOperation(
      accountId,
      RECONCILE_OP,
      reconcileResourceId(folder),
      params as unknown as Record<string, unknown>,
      RECONCILE_MAX_RETRIES,
    );
    n += 1;
  }
  return n;
}

function parseParams(params: unknown): ReconcileParams | null {
  if (typeof params !== "object" || params === null) return null;
  const { folder, uids, uidvalidity } = params as { folder?: unknown; uids?: unknown; uidvalidity?: unknown };
  if (typeof folder !== "string" || folder.length === 0) return null;
  if (!Array.isArray(uids) || !uids.every((u) => Number.isInteger(u) && u >= 1)) return null;
  // A row without a generation (older shape) is treated as unknown: it can
  // never be recorded against, so the handler drops it.
  const gen = Number.isInteger(uidvalidity) && (uidvalidity as number) >= 0 ? (uidvalidity as number) : 0;
  return { folder, uids: uids as number[], uidvalidity: gen, kind: "repair" };
}

/**
 * REQ-4.5: the handler. Runs from the queue processor; throws only for
 * transport errors (which the queue retries under its 3-strike rule).
 */
export async function runReconcileOp(accountId: string, rawParams: unknown): Promise<void> {
  const params = parseParams(rawParams);
  if (params === null) {
    // Nothing sensible to check; the op is consumed rather than retried forever.
    console.warn("[reconcileOp] Malformed reconcile op params; dropping it", rawParams);
    return;
  }
  const { folder, uids, uidvalidity } = params;

  // The UIDs only mean something in the generation they were queued under.
  const state = await getFolderSyncState(accountId, folder);
  const current = state?.uidvalidity ?? 0;
  if (uidvalidity === 0 || current !== uidvalidity) {
    console.info(
      `[reconcileOp] ${folder}: generation changed since the op was queued (${uidvalidity} → ${current}); dropping it — that folder's resync is the observation`,
    );
    return;
  }

  const present = new Set(
    await withSession(accountId, "interactive", {}, (id) => imapSearchUidsPresent(id, folder, uids)),
  );
  const absent = uids.filter((u) => !present.has(u));

  if (absent.length > 0) {
    // Only rows that are live here can be suspects; a UID with no local row
    // (already re-keyed, tombstoned, or never stored) has nothing to protect.
    const live = new Map((await getLiveMessagesInFolder(accountId, folder)).map((m) => [m.imap_uid, m.id]));
    const missing = absent.filter((u) => live.has(u)).map((uid) => ({ uid, messageRowId: live.get(uid)! }));
    if (missing.length > 0) {
      await insertSuspects(accountId, folder, current, `${RECONCILE_OP_PASS_PREFIX}${crypto.randomUUID()}`, missing);
    }
    console.info(
      `[reconcileOp] ${folder}: ${missing.length} of ${absent.length} absent UID(s) inserted as suspects; two later list passes confirm`,
    );
  }

  if (present.size > 0) {
    useUIStore.getState().addNotice({
      text: `${present.size} message${present.size === 1 ? "" : "s"} in ${folder} ${present.size === 1 ? "was" : "were"} not moved or deleted — the server still has ${present.size === 1 ? "it" : "them"}`,
    });
  }
}

/**
 * REQ-4.3: the op gave up. Do not let the inconsistency go unobserved: the
 * next delta pass lists the folder regardless of the gate, and the user hears.
 * The folder comes from the resource id when the params do not parse, so a
 * malformed row still degrades rather than vanishing (Grok M6 on #50).
 */
export async function degradeReconcileOp(
  accountId: string,
  rawParams: unknown,
  resourceId?: string,
): Promise<void> {
  const params = parseParams(rawParams);
  const folder = params?.folder ?? folderFromResourceId(resourceId);
  if (folder === null) return;
  await setForceList(accountId, folder, true);
  const count = params?.uids.length ?? 0;
  const what = count > 0 ? `${count} message${count === 1 ? "" : "s"}` : "some messages";
  useUIStore.getState().addNotice({
    text: `Could not verify ${what} in ${folder} — Velo will re-check the whole folder on the next sync`,
  });
}
