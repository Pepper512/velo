import { getDb } from "../db/connection";
import { withTransaction } from "../db/connection";
import { getAccount } from "../db/accounts";
import { enqueuePendingOperation } from "../db/pendingOperations";
import { getEmailProvider } from "../email/providerFactory";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";
import { createBackgroundChecker } from "../backgroundCheckers";
import { useUIStore } from "@/stores/uiStore";

/**
 * SPEC-F-1 Phase B (REQ-3): mirror a snooze on the server for Gmail accounts so
 * the thread does not sit in the Inbox on other devices. IMAP has no label to
 * change, so it stays local. Offline or on failure the change is queued through
 * `pending_operations`, exactly as `emailActions` queues an archive; the local
 * state is already correct either way.
 */
async function pushInboxLabelChange(
  accountId: string,
  threadId: string,
  op: "removeLabel" | "addLabel",
): Promise<void> {
  const account = await getAccount(accountId);
  if (!account || account.provider !== "gmail_api") return;

  const params = { threadId, labelId: "INBOX" };
  if (!useUIStore.getState().isOnline) {
    await enqueuePendingOperation(accountId, op, threadId, params);
    return;
  }
  try {
    const provider = await getEmailProvider(accountId);
    if (op === "removeLabel") {
      await provider.removeLabel(threadId, "INBOX");
    } else {
      await provider.addLabel(threadId, "INBOX");
    }
  } catch (err) {
    console.warn(`Snooze: server ${op} for thread ${threadId} failed, queued for retry:`, err);
    await enqueuePendingOperation(accountId, op, threadId, params);
  }
}

/**
 * Check for snoozed threads that should be un-snoozed (time has passed).
 * Moves them back to INBOX and out of the Snoozed folder (REQ-1.2, REQ-1.4).
 */
export async function checkSnoozedThreads(): Promise<void> {
  const db = await getDb();
  const now = getCurrentUnixTimestamp();

  // Find threads where snooze time has passed
  const snoozed = await db.select<
    { id: string; account_id: string }[]
  >(
    "SELECT id, account_id FROM threads WHERE is_snoozed = 1 AND snooze_until <= $1",
    [now],
  );

  if (snoozed.length > 0) {
    await withTransaction(async (txDb) => {
      for (const thread of snoozed) {
        // Un-snooze the thread
        await txDb.execute(
          "UPDATE threads SET is_snoozed = 0, snooze_until = NULL WHERE account_id = $1 AND id = $2",
          [thread.account_id, thread.id],
        );

        // Re-add INBOX label, drop SNOOZED — never in both folders at once
        await txDb.execute(
          "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, 'INBOX')",
          [thread.account_id, thread.id],
        );
        await txDb.execute(
          "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2 AND label_id = 'SNOOZED'",
          [thread.account_id, thread.id],
        );
      }
    });

    for (const thread of snoozed) {
      await pushInboxLabelChange(thread.account_id, thread.id, "addLabel");
    }

    // Notify the UI to refresh
    window.dispatchEvent(new Event("velo-sync-done"));
  }
}

/**
 * Snooze a thread: remove from INBOX, set snooze time. Sync keeps it out of the
 * Inbox until it is due (`setThreadLabels` honours `is_snoozed`, REQ-1.1).
 */
export async function snoozeThread(
  accountId: string,
  threadId: string,
  snoozeUntil: number,
): Promise<void> {
  await withTransaction(async (db) => {
    // Mark as snoozed in DB
    await db.execute(
      "UPDATE threads SET is_snoozed = 1, snooze_until = $1 WHERE account_id = $2 AND id = $3",
      [snoozeUntil, accountId, threadId],
    );

    // Remove INBOX label, add SNOOZED
    await db.execute(
      "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2 AND label_id = 'INBOX'",
      [accountId, threadId],
    );
    await db.execute(
      "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, 'SNOOZED')",
      [accountId, threadId],
    );
  });

  await pushInboxLabelChange(accountId, threadId, "removeLabel");
}

const snoozeChecker = createBackgroundChecker("Snooze", checkSnoozedThreads);
export const startSnoozeChecker = snoozeChecker.start;
export const stopSnoozeChecker = snoozeChecker.stop;
