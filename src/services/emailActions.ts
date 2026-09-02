import { useUIStore } from "@/stores/uiStore";
import { useThreadStore } from "@/stores/threadStore";
import { getEmailProvider } from "@/services/email/providerFactory";
import { enqueuePendingOperation } from "@/services/db/pendingOperations";
import { RECONCILE_OP, enqueueReconcileOps, runReconcileOp } from "@/services/imap/reconcileOp";
import { classifyError } from "@/utils/networkErrors";
import { getDb } from "@/services/db/connection";
import { dispatchVeloEvent } from "@/constants/events";

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type EmailAction =
  | { type: "archive"; threadId: string; messageIds: string[] }
  | { type: "trash"; threadId: string; messageIds: string[] }
  | { type: "permanentDelete"; threadId: string; messageIds: string[] }
  | {
      type: "markRead";
      threadId: string;
      messageIds: string[];
      read: boolean;
    }
  | {
      type: "star";
      threadId: string;
      messageIds: string[];
      starred: boolean;
    }
  | {
      type: "spam";
      threadId: string;
      messageIds: string[];
      isSpam: boolean;
    }
  | {
      type: "moveToFolder";
      threadId: string;
      messageIds: string[];
      folderPath: string;
    }
  | { type: "addLabel"; threadId: string; labelId: string }
  | { type: "removeLabel"; threadId: string; labelId: string }
  | {
      type: "sendMessage";
      rawBase64Url: string;
      threadId?: string;
    }
  | {
      type: "createDraft";
      rawBase64Url: string;
      threadId?: string;
    }
  | {
      type: "updateDraft";
      draftId: string;
      rawBase64Url: string;
      threadId?: string;
    }
  | { type: "deleteDraft"; draftId: string };

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ActionResult {
  success: boolean;
  queued?: boolean;
  error?: string;
  data?: unknown;
  /**
   * The thread the UI should select next, when this action removed the one that
   * was open. **The service does not navigate** (audit P13(a)) — it reports what
   * should happen and the caller decides.
   *
   * Importing `@/router/navigate` from here put the entire page tree in the
   * import graph of every service that touches email: a Gmail delta sync
   * transitively imported `App.tsx`. That was 54 simple cycles through one
   * 40-file strongly-connected component, and it is why services could not be
   * tested without the router.
   */
  nextThreadId?: string;
}

// ---------------------------------------------------------------------------
// Optimistic UI helpers
// ---------------------------------------------------------------------------

function getNextThreadId(currentId: string, selectedThreadId: string | null): string | null {
  // Only auto-advance if the removed thread is the one being viewed
  // Selection is passed in, not read from the router: this function used to
  // call `getSelectedThreadId()` from `@/router/navigate` (audit P13(a)).
  if (selectedThreadId !== currentId) return null;
  const { threads } = useThreadStore.getState();
  const idx = threads.findIndex((t) => t.id === currentId);
  if (idx === -1) return null;
  // Prefer next thread, fall back to previous
  const next = threads[idx + 1];
  if (next) return next.id;
  const prev = threads[idx - 1];
  if (prev) return prev.id;
  return null;
}

function applyOptimisticUpdate(
  action: EmailAction,
  selectedThreadId: string | null,
): { nextThreadId?: string } {
  const store = useThreadStore.getState();
  switch (action.type) {
    case "archive":
    case "trash":
    case "permanentDelete":
    case "spam":
    case "moveToFolder": {
      const nextId = getNextThreadId(action.threadId, selectedThreadId);
      store.removeThread(action.threadId);
      // Reported, not performed -- see ActionResult.nextThreadId.
      return nextId ? { nextThreadId: nextId } : {};
    }
    case "markRead":
      store.updateThread(action.threadId, { isRead: action.read });
      break;
    case "star":
      store.updateThread(action.threadId, { isStarred: action.starred });
      break;
    case "addLabel":
    case "removeLabel":
    case "sendMessage":
    case "createDraft":
    case "updateDraft":
    case "deleteDraft":
      // No universal optimistic update for these
      break;
  }
  return {};
}

function revertOptimisticUpdate(action: EmailAction): void {
  const store = useThreadStore.getState();
  switch (action.type) {
    case "markRead":
      store.updateThread(action.threadId, { isRead: !action.read });
      break;
    case "star":
      store.updateThread(action.threadId, { isStarred: !action.starred });
      break;
    // For removes (archive/trash/spam/move), we can't easily restore the thread
    // to the list from here. The next sync will fix it.
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Local DB updates (so offline reads reflect changes)
// ---------------------------------------------------------------------------

async function applyLocalDbUpdate(
  accountId: string,
  action: EmailAction,
): Promise<void> {
  const db = await getDb();
  switch (action.type) {
    case "markRead":
      await db.execute(
        "UPDATE threads SET is_read = $1 WHERE account_id = $2 AND id = $3",
        [action.read ? 1 : 0, accountId, action.threadId],
      );
      break;
    case "star":
      await db.execute(
        "UPDATE threads SET is_starred = $1 WHERE account_id = $2 AND id = $3",
        [action.starred ? 1 : 0, accountId, action.threadId],
      );
      if (action.starred) {
        await db.execute(
          "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, 'STARRED')",
          [accountId, action.threadId],
        );
      } else {
        await db.execute(
          "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2 AND label_id = 'STARRED'",
          [accountId, action.threadId],
        );
      }
      break;
    case "archive":
      await db.execute(
        "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2 AND label_id = 'INBOX'",
        [accountId, action.threadId],
      );
      break;
    case "trash":
      await db.execute(
        "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2 AND label_id = 'INBOX'",
        [accountId, action.threadId],
      );
      await db.execute(
        "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, 'TRASH')",
        [accountId, action.threadId],
      );
      break;
    case "permanentDelete":
      await db.execute(
        "DELETE FROM threads WHERE account_id = $1 AND id = $2",
        [accountId, action.threadId],
      );
      break;
    case "spam":
      if (action.isSpam) {
        await db.execute(
          "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2 AND label_id = 'INBOX'",
          [accountId, action.threadId],
        );
        await db.execute(
          "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, 'SPAM')",
          [accountId, action.threadId],
        );
      } else {
        await db.execute(
          "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2 AND label_id = 'SPAM'",
          [accountId, action.threadId],
        );
        await db.execute(
          "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, 'INBOX')",
          [accountId, action.threadId],
        );
      }
      break;
    case "addLabel":
      await db.execute(
        "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
        [accountId, action.threadId, action.labelId],
      );
      break;
    case "removeLabel":
      await db.execute(
        "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2 AND label_id = $3",
        [accountId, action.threadId, action.labelId],
      );
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Core execution
// ---------------------------------------------------------------------------

function getResourceId(action: EmailAction): string {
  if ("threadId" in action && action.threadId) return action.threadId;
  if ("draftId" in action) return action.draftId;
  return crypto.randomUUID();
}

function actionToParams(action: EmailAction): Record<string, unknown> {
  // Strip the type field — it's stored separately as operation_type
  const { type: _, ...rest } = action;
  return rest;
}

async function executeViaProvider(
  accountId: string,
  action: EmailAction,
): Promise<unknown> {
  const provider = await getEmailProvider(accountId);
  switch (action.type) {
    case "archive":
      return provider.archive(action.threadId, action.messageIds);
    case "trash":
      return provider.trash(action.threadId, action.messageIds);
    case "permanentDelete":
      return provider.permanentDelete(action.threadId, action.messageIds);
    case "markRead":
      return provider.markRead(
        action.threadId,
        action.messageIds,
        action.read,
      );
    case "star":
      return provider.star(
        action.threadId,
        action.messageIds,
        action.starred,
      );
    case "spam":
      return provider.spam(
        action.threadId,
        action.messageIds,
        action.isSpam,
      );
    case "moveToFolder":
      return provider.moveToFolder(
        action.threadId,
        action.messageIds,
        action.folderPath,
      );
    case "addLabel":
      return provider.addLabel(action.threadId, action.labelId);
    case "removeLabel":
      return provider.removeLabel(action.threadId, action.labelId);
    case "sendMessage":
      return provider.sendMessage(action.rawBase64Url, action.threadId);
    case "createDraft":
      return provider.createDraft(action.rawBase64Url, action.threadId);
    case "updateDraft":
      return provider.updateDraft(
        action.draftId,
        action.rawBase64Url,
        action.threadId,
      );
    case "deleteDraft":
      return provider.deleteDraft(action.draftId);
  }
}

export async function executeEmailAction(
  accountId: string,
  action: EmailAction,
  /**
   * The thread currently open in the UI, if any. Supplied by the caller so this
   * service does not read router state (audit P13(a)). Omitted by non-UI callers
   * such as the offline queue, for which "what to select next" is meaningless.
   */
  selectedThreadId: string | null = null,
): Promise<ActionResult> {
  // 1. Optimistic UI update. Returns what the UI should select next; it does
  //    not navigate.
  const { nextThreadId } = applyOptimisticUpdate(action, selectedThreadId);

  // 2. Local DB update
  try {
    await applyLocalDbUpdate(accountId, action);
  } catch (err) {
    console.warn("Local DB update failed:", err);
  }
  // Counts read from the database (sidebar unread pills, SPEC-243) refresh on
  // this rather than on the next sync. Fired whatever happens below: the
  // optimistic store and the local rows have already changed.
  dispatchVeloEvent("velo-threads-changed");

  // 3. If offline, queue
  if (!useUIStore.getState().isOnline) {
    await enqueuePendingOperation(
      accountId,
      action.type,
      getResourceId(action),
      actionToParams(action),
    );
    return { success: true, queued: true, nextThreadId };
  }

  // 4. Try online execution
  try {
    const data = await executeViaProvider(accountId, action);
    return { success: true, data, nextThreadId };
  } catch (err) {
    const classified = classifyError(err);

    if (classified.isRetryable) {
      // Queue for retry
      await enqueuePendingOperation(
        accountId,
        action.type,
        getResourceId(action),
        actionToParams(action),
      );
      return { success: true, queued: true, nextThreadId };
    }

    // F-4 REQ-4.1: the server may or may not have done it. Never retry (that
    // duplicates mail); instead queue a targeted look at the source folder so
    // the inconsistency gets an observer. Interleaves with the notice path.
    if (classified.type === "indeterminate" && isMoveOrDelete(action)) {
      try {
        await enqueueReconcileOps(accountId, action.messageIds);
      } catch (queueErr) {
        console.warn("[emailActions] Could not queue a reconcile op:", queueErr);
      }
    }

    // Permanent error — revert optimistic update
    revertOptimisticUpdate(action);
    console.error(`Email action ${action.type} failed permanently:`, err);
    return { success: false, error: classified.message };
  }
}

function isMoveOrDelete(
  action: EmailAction,
): action is Extract<EmailAction, { messageIds: string[] }> & {
  type: "archive" | "trash" | "permanentDelete" | "spam" | "moveToFolder";
} {
  return (
    (action.type === "archive" ||
      action.type === "trash" ||
      action.type === "permanentDelete" ||
      action.type === "spam" ||
      action.type === "moveToFolder") &&
    "messageIds" in action
  );
}

// ---------------------------------------------------------------------------
// Execute a queued operation (used by queue processor)
// ---------------------------------------------------------------------------

export async function executeQueuedAction(
  accountId: string,
  operationType: string,
  params: Record<string, unknown>,
): Promise<void> {
  // F-4 REQ-4.5: a reconcile op is a read-repair, not a provider action.
  if (operationType === RECONCILE_OP) {
    await runReconcileOp(accountId, params);
    return;
  }
  const action = { type: operationType, ...params } as EmailAction;
  try {
    await executeViaProvider(accountId, action);
  } catch (err) {
    // F-4 REQ-4.1 on the queued path too (Grok M5 on #50): a queued move or
    // delete whose outcome is unknown gets the same observer as an online
    // one. The error still propagates — it is not retryable, so the queue
    // fails the op once and never replays the move.
    if (classifyError(err).type === "indeterminate" && isMoveOrDelete(action)) {
      try {
        await enqueueReconcileOps(accountId, action.messageIds);
      } catch (queueErr) {
        console.warn("[emailActions] Could not queue a reconcile op:", queueErr);
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

export function archiveThread(
  accountId: string,
  threadId: string,
  messageIds: string[],
): Promise<ActionResult> {
  return executeEmailAction(accountId, {
    type: "archive",
    threadId,
    messageIds,
  });
}

export function trashThread(
  accountId: string,
  threadId: string,
  messageIds: string[],
): Promise<ActionResult> {
  return executeEmailAction(accountId, {
    type: "trash",
    threadId,
    messageIds,
  });
}

export function permanentDeleteThread(
  accountId: string,
  threadId: string,
  messageIds: string[],
): Promise<ActionResult> {
  return executeEmailAction(accountId, {
    type: "permanentDelete",
    threadId,
    messageIds,
  });
}

export function markThreadRead(
  accountId: string,
  threadId: string,
  messageIds: string[],
  read: boolean,
): Promise<ActionResult> {
  return executeEmailAction(accountId, {
    type: "markRead",
    threadId,
    messageIds,
    read,
  });
}

export function starThread(
  accountId: string,
  threadId: string,
  messageIds: string[],
  starred: boolean,
): Promise<ActionResult> {
  return executeEmailAction(accountId, {
    type: "star",
    threadId,
    messageIds,
    starred,
  });
}

export function spamThread(
  accountId: string,
  threadId: string,
  messageIds: string[],
  isSpam: boolean,
): Promise<ActionResult> {
  return executeEmailAction(accountId, {
    type: "spam",
    threadId,
    messageIds,
    isSpam,
  });
}

export function moveThread(
  accountId: string,
  threadId: string,
  messageIds: string[],
  folderPath: string,
): Promise<ActionResult> {
  return executeEmailAction(accountId, {
    type: "moveToFolder",
    threadId,
    messageIds,
    folderPath,
  });
}

export function addThreadLabel(
  accountId: string,
  threadId: string,
  labelId: string,
): Promise<ActionResult> {
  return executeEmailAction(accountId, {
    type: "addLabel",
    threadId,
    labelId,
  });
}

export function removeThreadLabel(
  accountId: string,
  threadId: string,
  labelId: string,
): Promise<ActionResult> {
  return executeEmailAction(accountId, {
    type: "removeLabel",
    threadId,
    labelId,
  });
}

export async function sendEmail(
  accountId: string,
  rawBase64Url: string,
  threadId?: string,
): Promise<ActionResult> {
  const result = await executeEmailAction(accountId, {
    type: "sendMessage",
    rawBase64Url,
    threadId,
  });

  // Notify the UI to refresh (so sent message appears in Sent folder)
  if (result.success) {
    window.dispatchEvent(new Event("velo-sync-done"));
  }

  return result;
}

export function createDraft(
  accountId: string,
  rawBase64Url: string,
  threadId?: string,
): Promise<ActionResult> {
  return executeEmailAction(accountId, {
    type: "createDraft",
    rawBase64Url,
    threadId,
  });
}

export function updateDraft(
  accountId: string,
  draftId: string,
  rawBase64Url: string,
  threadId?: string,
): Promise<ActionResult> {
  return executeEmailAction(accountId, {
    type: "updateDraft",
    draftId,
    rawBase64Url,
    threadId,
  });
}

export function deleteDraft(
  accountId: string,
  draftId: string,
): Promise<ActionResult> {
  return executeEmailAction(accountId, { type: "deleteDraft", draftId });
}
