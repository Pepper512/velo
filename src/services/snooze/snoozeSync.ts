import { getDb } from "../db/connection";
import { getAccount } from "../db/accounts";
import { getAliasesForAccount } from "../db/sendAsAliases";
import { getExistingMessageIds } from "../db/messages";

/**
 * SPEC-F-1 REQ-1.3 — the one case in which sync is allowed to end a snooze:
 * a message that is genuinely new (not yet in the local `messages` table) and
 * not from the user themself. A reply from someone else is a reason to look;
 * the user's own reply sent from another device is not.
 *
 * Called by the sync paths BEFORE `upsertThread`, because `upsertThread`
 * overwrites `last_message_at` and there is no stored snooze-creation time to
 * compare against (Kimi K3 review, R1).
 */

export interface IncomingMessageRef {
  id: string;
  fromAddress: string | null | undefined;
}

/** The account's own address plus every send-as alias, lower-cased. */
export async function getOwnAddresses(accountId: string): Promise<Set<string>> {
  const own = new Set<string>();
  const account = await getAccount(accountId);
  if (account?.email) own.add(account.email.toLowerCase());
  const aliases = await getAliasesForAccount(accountId);
  for (const alias of aliases) {
    if (alias.email) own.add(alias.email.toLowerCase());
  }
  return own;
}

/**
 * Clears the snooze on `threadId` if any of `incoming` is a new message from a
 * third party. Returns true when the snooze was cleared.
 */
export async function clearSnoozeForNewExternalMessages(
  accountId: string,
  threadId: string,
  incoming: IncomingMessageRef[],
  ownAddresses: Set<string>,
): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ is_snoozed: number }[]>(
    "SELECT is_snoozed FROM threads WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
  if (rows[0]?.is_snoozed !== 1) return false;

  const existing = await getExistingMessageIds(accountId, incoming.map((m) => m.id));
  const hasNewExternal = incoming.some(
    (m) =>
      !existing.has(m.id) &&
      !!m.fromAddress &&
      !ownAddresses.has(m.fromAddress.toLowerCase()),
  );
  if (!hasNewExternal) return false;

  await db.execute(
    "UPDATE threads SET is_snoozed = 0, snooze_until = NULL WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
  await db.execute(
    "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2 AND label_id = 'SNOOZED'",
    [accountId, threadId],
  );
  return true;
}
