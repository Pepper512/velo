/**
 * UI adapter over `services/emailActions` (audit P13(b)).
 *
 * # Why this exists
 *
 * `emailActions.ts` used to import `@/router/navigate` and navigate directly.
 * That single edge put the whole page tree into the import graph of every
 * service that touches email — a Gmail delta sync transitively imported
 * `App.tsx`. The audit measured **one strongly-connected component of 40 files
 * and 54 simple cycles**, all running through
 * `router/navigate → router/index → routeTree → App`.
 *
 * The service now *reports* what should happen (`ActionResult.nextThreadId`) and
 * this adapter performs it. The direction of the dependency is the point: the UI
 * knows about services, services do not know about the UI.
 *
 * Anything that is not a React component — the offline queue processor, sync,
 * background checkers — calls the service directly and simply ignores
 * `nextThreadId`, which is meaningless without a visible selection.
 */
import { useCallback } from "react";
import {
  executeEmailAction,
  type ActionResult,
  type EmailAction,
} from "@/services/emailActions";
import { navigateToThread, getSelectedThreadId } from "@/router/navigate";

/**
 * Run an email action and apply any navigation it asks for.
 *
 * Supplies the currently selected thread (which the service can no longer read
 * for itself) and navigates when the action removed the open thread.
 */
export function useEmailAction(): (
  accountId: string,
  action: EmailAction,
) => Promise<ActionResult> {
  return useCallback(async (accountId: string, action: EmailAction) => {
    const result = await executeEmailAction(
      accountId,
      action,
      getSelectedThreadId(),
    );

    if (result.nextThreadId) {
      navigateToThread(result.nextThreadId);
    }

    return result;
  }, []);
}

/**
 * Non-hook form, for callbacks outside a component body (context menus,
 * keyboard handlers) that still run in the UI and want the same behaviour.
 */
export async function runEmailAction(
  accountId: string,
  action: EmailAction,
): Promise<ActionResult> {
  const result = await executeEmailAction(
    accountId,
    action,
    getSelectedThreadId(),
  );

  if (result.nextThreadId) {
    navigateToThread(result.nextThreadId);
  }

  return result;
}

// ---------------------------------------------------------------------------
// UI-facing wrappers
//
// Same names and signatures as the `services/emailActions` wrappers, so a
// component switches by changing its import line and nothing else. These are the
// actions that can remove the open thread, and therefore the ones that need to
// navigate afterwards. Everything else (star, markRead, labels) has no
// navigation consequence and should keep importing the service directly.
// ---------------------------------------------------------------------------

export function archiveThread(
  accountId: string,
  threadId: string,
  messageIds: string[],
): Promise<ActionResult> {
  return runEmailAction(accountId, { type: "archive", threadId, messageIds });
}

export function trashThread(
  accountId: string,
  threadId: string,
  messageIds: string[],
): Promise<ActionResult> {
  return runEmailAction(accountId, { type: "trash", threadId, messageIds });
}

export function permanentDeleteThread(
  accountId: string,
  threadId: string,
  messageIds: string[],
): Promise<ActionResult> {
  return runEmailAction(accountId, { type: "permanentDelete", threadId, messageIds });
}

export function spamThread(
  accountId: string,
  threadId: string,
  messageIds: string[],
  isSpam: boolean,
): Promise<ActionResult> {
  return runEmailAction(accountId, { type: "spam", threadId, messageIds, isSpam });
}

export function moveThread(
  accountId: string,
  threadId: string,
  messageIds: string[],
  folderPath: string,
): Promise<ActionResult> {
  return runEmailAction(accountId, {
    type: "moveToFolder",
    threadId,
    messageIds,
    folderPath,
  });
}
