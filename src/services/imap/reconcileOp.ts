/**
 * The `reconcile` queue op (SPEC-F-4 rev 5 REQ-4, part 3).
 *
 * When a move or delete ends with `VELO_OUTCOME_UNKNOWN:` — the server may or
 * may not have done it — nothing used to look again. This op is the later
 * observer: a targeted `UID SEARCH UID <set>` in the source folder on a fresh
 * session. It is a **read-repair borrowing the write queue** and it never
 * deletes anything itself:
 *
 * - a UID the server no longer lists is recorded as a *suspect* (REQ-4.5) and
 *   the ordinary two-pass reconciliation confirms and deletes it;
 * - a UID the server still lists means the operation did not take effect —
 *   the user is told, the op completes.
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
import { recordMissing } from "./reconcile";

export const RECONCILE_OP = "reconcile";
export const RECONCILE_MAX_RETRIES = 3;

export interface ReconcileParams {
  folder: string;
  uids: number[];
  /** REQ-4.4: a repair, not a user action — for any queue surface that lists ops. */
  kind: "repair";
}

export function reconcileResourceId(folder: string): string {
  return `reconcile:${folder}`;
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
    const params: ReconcileParams = { folder, uids, kind: "repair" };
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
  const { folder, uids } = params as { folder?: unknown; uids?: unknown };
  if (typeof folder !== "string" || folder.length === 0) return null;
  if (!Array.isArray(uids) || !uids.every((u) => Number.isInteger(u) && u >= 1)) return null;
  return { folder, uids: uids as number[], kind: "repair" };
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
  const { folder, uids } = params;

  const present = new Set(
    await withSession(accountId, "interactive", {}, (id) => imapSearchUidsPresent(id, folder, uids)),
  );
  const absent = uids.filter((u) => !present.has(u));

  if (absent.length > 0) {
    // Only rows that are live here can be suspects; a UID with no local row
    // (already re-keyed, tombstoned, or never stored) has nothing to protect.
    const state = await getFolderSyncState(accountId, folder);
    const uidvalidity = state?.uidvalidity ?? 0;
    if (uidvalidity > 0) {
      const live = new Map(
        (await getLiveMessagesInFolder(accountId, folder)).map((m) => [m.imap_uid, m.id]),
      );
      const missing = absent
        .filter((u) => live.has(u))
        .map((uid) => ({ uid, messageRowId: live.get(uid)! }));
      if (missing.length > 0) {
        await recordMissing(accountId, folder, uidvalidity, `reconcile:${crypto.randomUUID()}`, missing);
      }
      console.info(
        `[reconcileOp] ${folder}: ${missing.length} of ${absent.length} absent UID(s) recorded as suspects; the next two passes confirm`,
      );
    } else {
      console.info(`[reconcileOp] ${folder}: ${absent.length} absent UID(s) but no synced generation to record against`);
    }
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
 */
export async function degradeReconcileOp(accountId: string, rawParams: unknown): Promise<void> {
  const params = parseParams(rawParams);
  if (params === null) return;
  await setForceList(accountId, params.folder, true);
  useUIStore.getState().addNotice({
    text: `Could not verify ${params.uids.length} message${params.uids.length === 1 ? "" : "s"} in ${params.folder} — Velo will re-check the whole folder on the next sync`,
  });
}
