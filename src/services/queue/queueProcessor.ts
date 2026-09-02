import { createBackgroundChecker, type BackgroundChecker } from "../backgroundCheckers";
import { useUIStore } from "@/stores/uiStore";
import {
  getPendingOperations,
  updateOperationStatus,
  deleteOperation,
  incrementRetry,
  getPendingOpsCount,
  compactQueue,
} from "../db/pendingOperations";
import { executeQueuedAction } from "../emailActions";
import { RECONCILE_OP, degradeReconcileOp } from "../imap/reconcileOp";
import { classifyError } from "@/utils/networkErrors";

const BATCH_SIZE = 50;

let checker: BackgroundChecker | null = null;

async function processQueue(): Promise<void> {
  // Skip if offline
  if (!useUIStore.getState().isOnline) return;

  // Compact first to eliminate redundant ops
  await compactQueue();

  // Get pending operations
  const ops = await getPendingOperations(undefined, BATCH_SIZE);
  if (ops.length === 0) {
    await updatePendingCount();
    return;
  }

  for (const op of ops) {
    try {
      // Mark as executing
      await updateOperationStatus(op.id, "executing");

      // Parse params and execute
      const params = JSON.parse(op.params) as Record<string, unknown>;
      await executeQueuedAction(op.account_id, op.operation_type, params);

      // Success — delete from queue
      await deleteOperation(op.id);
    } catch (err) {
      const classified = classifyError(err);
      // Reconcile ops carry their own strike rule (three, REQ-4.3) and must
      // degrade visibly when spent; user ops keep `incrementRetry`'s handling.
      const exhausted = op.operation_type === RECONCILE_OP && op.retry_count + 1 >= op.max_retries;

      if (classified.isRetryable && !exhausted) {
        // Increment retry with exponential backoff
        await updateOperationStatus(op.id, "pending", classified.message);
        await incrementRetry(op.id);
      } else {
        // F-4 REQ-4.3: a reconcile op that gives up must not vanish — the
        // folder gets a forced full list on the next pass and the user hears.
        // Degrade *before* the row is marked failed, with the folder taken
        // from the resource id when the params do not parse (Grok M6 on #50).
        if (op.operation_type === RECONCILE_OP) {
          try {
            await degradeReconcileOp(op.account_id, safeParse(op.params), op.resource_id);
          } catch (degradeErr) {
            console.error("[queueProcessor] Could not degrade a reconcile op; marking it failed regardless:", degradeErr);
          }
        }
        // Permanent failure
        await updateOperationStatus(op.id, "failed", classified.message);
      }
    }
  }

  await updatePendingCount();
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function updatePendingCount(): Promise<void> {
  const count = await getPendingOpsCount();
  useUIStore.getState().setPendingOpsCount(count);
}

export function startQueueProcessor(): void {
  if (checker) return;
  checker = createBackgroundChecker("QueueProcessor", processQueue, 30_000);
  checker.start();
}

export function stopQueueProcessor(): void {
  checker?.stop();
  checker = null;
}

/**
 * Trigger an immediate queue flush (e.g., when coming back online).
 * Returns a promise that resolves when processing completes.
 */
export async function triggerQueueFlush(): Promise<void> {
  try {
    await processQueue();
  } catch (err) {
    console.error("[QueueProcessor] flush failed:", err);
  }
}
