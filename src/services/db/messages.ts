import { getDb, withTransaction } from "./connection";

export interface DbMessage {
  id: string;
  account_id: string;
  thread_id: string;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  bcc_addresses: string | null;
  reply_to: string | null;
  subject: string | null;
  snippet: string | null;
  date: number;
  is_read: number;
  is_starred: number;
  body_html: string | null;
  body_text: string | null;
  body_cached: number;
  raw_size: number | null;
  internal_date: number | null;
  list_unsubscribe: string | null;
  list_unsubscribe_post: string | null;
  auth_results: string | null;
  message_id_header: string | null;
  references_header: string | null;
  in_reply_to_header: string | null;
  imap_uid: number | null;
  imap_folder: string | null;
  /**
   * F-5 fallback: the folder an IMAP message was moved to when the server gave
   * no usable COPYUID to re-key the row with. Non-null means the row is stale —
   * it still carries its *source* folder and UID — and it is hidden from thread
   * views and provider actions until the destination sync inserts the fresh row
   * and `reapMovedTombstones` removes this one.
   */
  moved_to: string | null;
}

export async function getMessagesForThread(
  accountId: string,
  threadId: string,
): Promise<DbMessage[]> {
  const db = await getDb();
  // `moved_to IS NULL`: a tombstoned row is the same message the destination
  // folder is about to sync in under a new id, and both land in this thread
  // (same Message-ID). Showing both rendered the message twice — in the thread
  // view, in print, and in `.eml` export (brief F-5 rev 2).
  return db.select<DbMessage[]>(
    "SELECT * FROM messages WHERE account_id = $1 AND thread_id = $2 AND moved_to IS NULL ORDER BY date ASC",
    [accountId, threadId],
  );
}

export async function upsertMessage(msg: {
  id: string;
  accountId: string;
  threadId: string;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string | null;
  ccAddresses: string | null;
  bccAddresses: string | null;
  replyTo: string | null;
  subject: string | null;
  snippet: string | null;
  date: number;
  isRead: boolean;
  isStarred: boolean;
  bodyHtml: string | null;
  bodyText: string | null;
  rawSize: number | null;
  internalDate: number | null;
  listUnsubscribe?: string | null;
  listUnsubscribePost?: string | null;
  authResults?: string | null;
  messageIdHeader?: string | null;
  referencesHeader?: string | null;
  inReplyToHeader?: string | null;
  imapUid?: number | null;
  imapFolder?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, reply_to, subject, snippet, date, is_read, is_starred, body_html, body_text, body_cached, raw_size, internal_date, list_unsubscribe, list_unsubscribe_post, auth_results, message_id_header, references_header, in_reply_to_header, imap_uid, imap_folder)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
     ON CONFLICT(account_id, id) DO UPDATE SET
       from_address = $4, from_name = $5, to_addresses = $6, cc_addresses = $7,
       bcc_addresses = $8, reply_to = $9, subject = $10, snippet = $11,
       date = $12, is_read = $13, is_starred = $14,
       body_html = COALESCE($15, body_html), body_text = COALESCE($16, body_text),
       body_cached = CASE WHEN $15 IS NOT NULL THEN 1 ELSE body_cached END,
       raw_size = $18, internal_date = $19, list_unsubscribe = $20, list_unsubscribe_post = $21,
       auth_results = $22, message_id_header = COALESCE($23, message_id_header),
       references_header = COALESCE($24, references_header),
       in_reply_to_header = COALESCE($25, in_reply_to_header),
       imap_uid = COALESCE($26, imap_uid), imap_folder = COALESCE($27, imap_folder)`,
    [
      msg.id,
      msg.accountId,
      msg.threadId,
      msg.fromAddress,
      msg.fromName,
      msg.toAddresses,
      msg.ccAddresses,
      msg.bccAddresses,
      msg.replyTo,
      msg.subject,
      msg.snippet,
      msg.date,
      msg.isRead ? 1 : 0,
      msg.isStarred ? 1 : 0,
      msg.bodyHtml,
      msg.bodyText,
      msg.bodyHtml ? 1 : 0,
      msg.rawSize,
      msg.internalDate,
      msg.listUnsubscribe ?? null,
      msg.listUnsubscribePost ?? null,
      msg.authResults ?? null,
      msg.messageIdHeader ?? null,
      msg.referencesHeader ?? null,
      msg.inReplyToHeader ?? null,
      msg.imapUid ?? null,
      msg.imapFolder ?? null,
    ],
  );

  // An IMAP row arriving under a folder/UID id is what a tombstoned row was
  // waiting for: same Message-ID, fresh identity, *in the folder it was moved
  // to*. Reap the stale one now so the thread never holds both. Gmail rows
  // carry no folder and are never tombstoned, so they skip the extra
  // statement; an empty Message-ID matches nothing on purpose.
  if (
    msg.imapFolder != null &&
    msg.messageIdHeader != null &&
    msg.messageIdHeader.trim().length > 0
  ) {
    await reapMovedTombstones(msg.accountId, msg.messageIdHeader, msg.id, msg.imapFolder);
  }
}

// ---------------------------------------------------------------------------
// Move-time row hygiene (F-5)
// ---------------------------------------------------------------------------

/** One re-key: the row at `oldId` becomes the row at `newId`. */
export interface RekeyPair {
  oldId: string;
  newId: string;
  /** The destination folder — becomes `imap_folder`. */
  folder: string;
  /** The server-assigned UID in the destination — becomes `imap_uid`. */
  uid: number;
}

/** Which rows a `rekeyMovedMessages` call actually re-keyed. */
export interface RekeyOutcome {
  rekeyed: string[];
  /**
   * Old ids left untouched because a row already exists at their new id. The
   * caller tombstones these instead; the destination sync's upsert then hits
   * the existing row and this one is reaped.
   */
  skipped: string[];
}

const REKEY_CHUNK = 500;

/** The rows a re-key could not place, and where they went (see `rekeyMovedMessages`). */
export interface TombstoneFallback {
  /** Old ids the caller already knows cannot be re-keyed (no mapping entry). */
  ids: string[];
  /** The destination folder — becomes `moved_to`. */
  movedTo: string;
}

/**
 * Re-key moved IMAP rows to the identity the server gave them (F-5, option A).
 *
 * All pairs land in one transaction: `messages.id`, `imap_folder` and `imap_uid`
 * change together, `attachments` follow through the composite FK (both its
 * `message_id` and its `{messageId}_{part}` primary key, so the destination
 * sync's attachment upsert hits rather than duplicates), and the soft references
 * in `follow_up_reminders`, `link_scan_results`, `scheduled_emails` and
 * `local_drafts` are pointed at the new id. `thread_id` is never touched —
 * pins, mutes, labels and snoozes are thread state and survive unchanged.
 *
 * Foreign keys are deferred for the transaction: SQLite otherwise checks the
 * `attachments → messages` constraint per statement, and there is no statement
 * order in which a parent key can change under a child row. With deferral the
 * check runs at COMMIT, when both sides agree.
 *
 * A new id that already exists locally — or that an earlier pair in this batch
 * just took — is skipped, never overwritten. Should a collision still reach
 * the UPDATE (a race with sync), the composite primary key rejects it and the
 * whole transaction rolls back — every row is left exactly as it was, which is
 * the threat-pass requirement.
 *
 * `fallback` names the rows that cannot be re-keyed at all; they are
 * tombstoned in the *same* transaction as the re-keys, together with whatever
 * this call had to skip, so a crash between the two cannot leave a moved row
 * live under its stale id (Gemini L4).
 */
export async function rekeyMovedMessages(
  accountId: string,
  pairs: RekeyPair[],
  fallback?: TombstoneFallback,
): Promise<RekeyOutcome> {
  const outcome: RekeyOutcome = { rekeyed: [], skipped: [] };
  if (pairs.length === 0 && (fallback === undefined || fallback.ids.length === 0)) {
    return outcome;
  }

  await withTransaction(async (db) => {
    await db.execute("PRAGMA defer_foreign_keys = ON", []);

    const taken = new Set<string>();
    for (let i = 0; i < pairs.length; i += REKEY_CHUNK) {
      const chunk = pairs.slice(i, i + REKEY_CHUNK);
      const placeholders = chunk.map((_, j) => `$${j + 2}`).join(", ");
      const rows = await db.select<{ id: string }[]>(
        `SELECT id FROM messages WHERE account_id = $1 AND id IN (${placeholders})`,
        [accountId, ...chunk.map((p) => p.newId)],
      );
      for (const row of rows) taken.add(row.id);
    }

    for (const pair of pairs) {
      if (taken.has(pair.newId)) {
        outcome.skipped.push(pair.oldId);
        continue;
      }
      taken.add(pair.newId);

      await db.execute(
        `UPDATE messages SET id = $1, imap_folder = $2, imap_uid = $3, moved_to = NULL
         WHERE account_id = $4 AND id = $5`,
        [pair.newId, pair.folder, pair.uid, accountId, pair.oldId],
      );
      // Attachment ids are `${messageId}_${partId}` (imapSync). Rewrite the
      // prefix where it matches so the next sync's upsert lands on this row.
      // Each `$n` appears once, in order — the SQLite harness translator
      // depends on it.
      await db.execute(
        `UPDATE attachments
         SET message_id = $1,
             id = CASE WHEN substr(id, 1, length($2)) = $3 THEN $4 || substr(id, length($5) + 1) ELSE id END
         WHERE account_id = $6 AND message_id = $7`,
        [pair.newId, pair.oldId, pair.oldId, pair.newId, pair.oldId, accountId, pair.oldId],
      );
      await db.execute(
        "UPDATE follow_up_reminders SET message_id = $1 WHERE account_id = $2 AND message_id = $3",
        [pair.newId, accountId, pair.oldId],
      );
      await db.execute(
        "UPDATE OR REPLACE link_scan_results SET message_id = $1 WHERE account_id = $2 AND message_id = $3",
        [pair.newId, accountId, pair.oldId],
      );
      await db.execute(
        "UPDATE scheduled_emails SET reply_to_message_id = $1 WHERE account_id = $2 AND reply_to_message_id = $3",
        [pair.newId, accountId, pair.oldId],
      );
      await db.execute(
        "UPDATE local_drafts SET reply_to_message_id = $1 WHERE account_id = $2 AND reply_to_message_id = $3",
        [pair.newId, accountId, pair.oldId],
      );
      outcome.rekeyed.push(pair.oldId);
    }

    if (fallback !== undefined) {
      await tombstoneWithin(db, accountId, [...fallback.ids, ...outcome.skipped], fallback.movedTo);
    }
  });

  return outcome;
}

/**
 * Mark moved rows that could not be re-keyed (F-5, option B fallback).
 *
 * The rows stay in place — still under their source folder and UID — but
 * `moved_to` hides them from `getMessagesForThread` and from provider actions
 * (`keepLiveMessageIds`), so nothing acts on a folder/UID pair the server no
 * longer has. They are removed by `reapMovedTombstones` when the destination
 * folder syncs the message in.
 *
 * Standalone form, for when the re-key transaction itself failed; the re-key
 * path tombstones inside its own transaction instead.
 */
export async function tombstoneMovedMessages(
  accountId: string,
  messageIds: string[],
  movedTo: string,
): Promise<void> {
  if (messageIds.length === 0) return;
  const db = await getDb();
  await tombstoneWithin(db, accountId, messageIds, movedTo);
}

/**
 * The tombstone step itself. If the destination folder has *already* synced
 * this message in — a live row with the same Message-ID in `movedTo` — there
 * is nothing to wait for: the stale row is deleted now rather than tombstoned,
 * because `reapMovedTombstones` already ran for that arrival and will not run
 * again (Gemini M3's zombie). The rest are marked and wait for the reap.
 */
async function tombstoneWithin(
  db: Pick<Awaited<ReturnType<typeof getDb>>, "execute">,
  accountId: string,
  messageIds: string[],
  movedTo: string,
): Promise<void> {
  for (let i = 0; i < messageIds.length; i += REKEY_CHUNK) {
    const chunk = messageIds.slice(i, i + REKEY_CHUNK);
    const placeholders = chunk.map((_, j) => `$${j + 3}`).join(", ");
    await db.execute(
      `DELETE FROM messages
       WHERE account_id = $1
         AND EXISTS (
           SELECT 1 FROM messages fresh
           WHERE fresh.account_id = messages.account_id
             AND fresh.message_id_header = messages.message_id_header
             AND fresh.message_id_header <> ''
             AND fresh.imap_folder = $2
             AND fresh.moved_to IS NULL
             AND fresh.id <> messages.id
         )
         AND id IN (${placeholders})`,
      [accountId, movedTo, ...chunk],
    );
    await db.execute(
      `UPDATE messages SET moved_to = $1 WHERE account_id = $2 AND id IN (${placeholders})`,
      [movedTo, accountId, ...chunk],
    );
  }
}

/**
 * Remove tombstoned rows for a message that has just arrived under a fresh id.
 *
 * Keyed on `message_id_header` — what threads them together in the first place
 * — **and** on the folder the row was moved to: a copy of the same message
 * syncing in from some other folder (a filter that files to two places, a
 * shared-mailbox duplicate) must not reap a tombstone whose destination has not
 * synced yet, or the message and its cached attachments would vanish locally
 * until it does (Gemini H1). `id <> $3` protects the fresh row itself.
 */
export async function reapMovedTombstones(
  accountId: string,
  messageIdHeader: string,
  freshMessageId: string,
  arrivedIn: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM messages WHERE account_id = $1 AND message_id_header = $2 AND moved_to = $3 AND id <> $4",
    [accountId, messageIdHeader, arrivedIn, freshMessageId],
  );
}

export async function deleteMessage(
  accountId: string,
  messageId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM messages WHERE account_id = $1 AND id = $2",
    [accountId, messageId],
  );
}

export async function updateMessageThreadIds(
  accountId: string,
  messageIds: string[],
  threadId: string,
): Promise<void> {
  const db = await getDb();
  // SQLite variable limit is 999; process in chunks
  for (let i = 0; i < messageIds.length; i += 500) {
    const chunk = messageIds.slice(i, i + 500);
    const placeholders = chunk.map((_, idx) => `$${idx + 3}`).join(", ");
    await db.execute(
      `UPDATE messages SET thread_id = $1 WHERE account_id = $2 AND id IN (${placeholders})`,
      [threadId, accountId, ...chunk],
    );
  }
}

export async function deleteAllMessagesForAccount(
  accountId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM messages WHERE account_id = $1",
    [accountId],
  );
}

/**
 * Get recent sent messages for an account, matching from_address to account email.
 * Used for writing style analysis.
 */
export async function getRecentSentMessages(
  accountId: string,
  accountEmail: string,
  limit: number = 15,
): Promise<DbMessage[]> {
  const db = await getDb();
  return db.select<DbMessage[]>(
    `SELECT * FROM messages
     WHERE account_id = $1 AND LOWER(from_address) = LOWER($2)
       AND body_text IS NOT NULL AND LENGTH(body_text) > 50
     ORDER BY date DESC LIMIT $3`,
    [accountId, accountEmail, limit],
  );
}

/**
 * Which of `ids` are already stored for this account (SPEC-F-1 REQ-1.3 — lets
 * sync tell a genuinely new message from a re-fetched one). Chunked so a large
 * batch never exceeds SQLite's bound-parameter limit.
 */
export async function getExistingMessageIds(
  accountId: string,
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  if (ids.length === 0) return found;
  const db = await getDb();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map((_, j) => `$${j + 2}`).join(", ");
    const rows = await db.select<{ id: string }[]>(
      `SELECT id FROM messages WHERE account_id = $1 AND id IN (${placeholders})`,
      [accountId, ...chunk],
    );
    for (const row of rows) found.add(row.id);
  }
  return found;
}
