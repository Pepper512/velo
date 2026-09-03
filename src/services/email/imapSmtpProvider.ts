import { useUIStore } from "@/stores/uiStore";
import type { EmailProvider, EmailFolder, SyncResult } from "./types";
import type { ParsedMessage } from "../gmail/messageParser";
import { buildImapConfig, buildSmtpConfig } from "../imap/imapConfigBuilder";
import { imapInitialSync, imapDeltaSync, imapMessageToParsedMessage } from "../imap/imapSync";
import { mapFolderToLabel, getSyncableFolders } from "../imap/folderMapper";
import {
  imapListFolders,
  imapSetFlags,
  imapMoveMessages,
  imapDeleteMessages,
  imapFetchMessageBody,
  imapFetchAttachment,
  imapFetchRawMessage,
  imapTestConnection,
  imapAppendMessage,
  smtpSendEmail,
  smtpTestConnection,
  type ImapConfig,
  type MoveResult,
  type SmtpConfig,
} from "../imap/tauriCommands";
import { withSession, invalidateAccountCredentials } from "../imap/sessionManager";
import { getAccount, type DbAccount } from "../db/accounts";
import { findSpecialFolder, dropTombstonedMessageIds } from "../imap/messageHelper";
import { settleMovedRows } from "../imap/moveHygiene";
import { incrementFlaggedNotExpunged } from "../db/folderSyncState";
import { ensureFreshToken } from "../oauth/oauthTokenManager";
import { upsertMessage } from "../db/messages";
import { upsertThread, setThreadLabels, getThreadLabelIds } from "../db/threads";

/**
 * Decode base64url (Gmail/RFC 4648 URL-safe, no padding) to a UTF-8 string.
 */
function base64UrlDecode(input: string): string {
  // Convert base64url to standard base64
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Parse basic RFC 2822 headers from a raw email string.
 * Returns a map of header name (lowercase) → header value.
 */
function parseBasicHeaders(raw: string): Map<string, string> {
  const headers = new Map<string, string>();
  // Headers end at the first blank line
  const headerEnd = raw.indexOf("\r\n\r\n");
  const headerSection = headerEnd !== -1 ? raw.slice(0, headerEnd) : raw;

  // Unfold continuation lines (lines starting with space/tab are continuations)
  const unfolded = headerSection.replace(/\r\n([ \t])/g, " ");

  for (const line of unfolded.split("\r\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const name = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    headers.set(name, value);
  }

  return headers;
}

/**
 * Extract a plain-text snippet from a raw RFC 2822 email body.
 */
function extractSnippet(raw: string, maxLen = 200): string {
  const bodyStart = raw.indexOf("\r\n\r\n");
  if (bodyStart === -1) return "";

  let body = raw.slice(bodyStart + 4);

  // For multipart messages, try to find the text/plain part
  const contentType = parseBasicHeaders(raw).get("content-type") ?? "";
  const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1]!;
    const parts = body.split(`--${boundary}`);
    for (const part of parts) {
      if (part.toLowerCase().includes("content-type: text/plain")) {
        const partBodyStart = part.indexOf("\r\n\r\n");
        if (partBodyStart !== -1) {
          body = part.slice(partBodyStart + 4);
          break;
        }
      }
    }
  }

  // Strip HTML tags if present, trim, and truncate
  return body
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/**
 * EmailProvider adapter for IMAP/SMTP accounts.
 * Delegates to Tauri IMAP/SMTP commands via the imapSync engine.
 */
/**
 * Tell the user when mail was flagged for deletion but not actually removed
 * (brief REQ-4.2/4.3).
 *
 * A server without UIDPLUS cannot expunge a specific UID set, so Velo declines
 * to expunge at all rather than removing messages the user did not select. The
 * operation is not a failure, but it is not the completed deletion the UI would
 * otherwise imply — "permanently" may degrade to "eventually" only when the app
 * says so out loud.
 *
 * Raised here rather than through `EmailProvider`, whose methods return
 * `Promise<void>` and are shared with the Gmail path, where none of this
 * applies. Calling the store directly from a service is the established pattern
 * (`services/links/openLink.ts`, `emailActions.ts`, `queueProcessor.ts`).
 */
function noticeIfNotExpunged(result: { expunged: boolean }, sourceFolder: string): void {
  if (result.expunged) return;
  useUIStore.getState().addNotice({
    text: `Marked for deletion in ${sourceFolder} — the server will remove it later`,
  });
}

export class ImapSmtpProvider implements EmailProvider {
  readonly accountId: string;
  readonly type = "imap" as const;

  private _imapConfig: ImapConfig | null = null;
  private _smtpConfig: SmtpConfig | null = null;

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  private async getAccount(): Promise<DbAccount> {
    const account = await getAccount(this.accountId);
    if (!account) {
      throw new Error(`Account ${this.accountId} not found`);
    }
    return account;
  }

  private async getImapConfig(): Promise<ImapConfig> {
    const account = await this.getAccount();
    if (account.auth_method === "oauth2") {
      // OAuth accounts need a fresh token every time
      const token = await ensureFreshToken(account);
      return buildImapConfig(account, token);
    }
    if (!this._imapConfig) {
      this._imapConfig = buildImapConfig(account);
    }
    return this._imapConfig;
  }

  private async getSmtpConfig(): Promise<SmtpConfig> {
    const account = await this.getAccount();
    if (account.auth_method === "oauth2") {
      const token = await ensureFreshToken(account);
      return buildSmtpConfig(account, token);
    }
    if (!this._smtpConfig) {
      this._smtpConfig = buildSmtpConfig(account);
    }
    return this._smtpConfig;
  }

  /**
   * Run one IMAP command against this account's pooled `interactive` session.
   *
   * One command per call, deliberately: that is the precondition that makes a
   * pool error safe to retry (they are raised before any I/O). A caller that
   * needs two server-visible commands in one session must pass
   * `retrySafe: false` and think about what a re-run would repeat.
   */
  private withImapSession<T>(fn: (sessionId: string) => Promise<T>): Promise<T> {
    return withSession(this.accountId, "interactive", {}, fn);
  }

  /**
   * Invalidate cached configs and pooled sessions (e.g. after a password change).
   */
  clearConfigCache(): void {
    this._imapConfig = null;
    this._smtpConfig = null;

    // The credential changed, so pooled sessions authenticated with the old one
    // must go too (E2/P15). Without this the pool keeps serving the superseded
    // credential — fine until the server stops tolerating it, and in the
    // revocation case the connection keeps working after the user revoked it.
    // Fire-and-forget: clearing a cache must not become an async call for every
    // existing caller, and a failure here only costs a stale session that the
    // reaper will take.
    void invalidateAccountCredentials(this.accountId).catch((err: unknown) => {
      console.warn(
        `[imapSmtpProvider] Failed to invalidate pooled sessions for ${this.accountId}:`,
        err,
      );
    });
  }

  // ---- Folder/Label operations ----

  async listFolders(): Promise<EmailFolder[]> {
    // One command per `withSession`, so a pool error is always safe to retry.
    const imapFolders = await withSession(this.accountId, "interactive", {}, (id) =>
      imapListFolders(id),
    );
    const syncable = getSyncableFolders(imapFolders);

    return syncable.map((f) => {
      const mapping = mapFolderToLabel(f);
      return {
        id: mapping.labelId,
        name: mapping.labelName,
        path: f.path,
        type: mapping.type as "system" | "user",
        specialUse: f.special_use,
        delimiter: f.delimiter,
        messageCount: f.exists,
        unreadCount: f.unseen,
      };
    });
  }

  async createFolder(
    _name: string,
    _parentPath?: string,
  ): Promise<EmailFolder> {
    throw new Error(
      "Creating folders is not supported for IMAP accounts via the current command set. " +
        "Please create the folder directly on the mail server.",
    );
  }

  async deleteFolder(_path: string): Promise<void> {
    throw new Error(
      "Deleting folders is not supported for IMAP accounts via the current command set. " +
        "Please delete the folder directly on the mail server.",
    );
  }

  async renameFolder(_path: string, _newName: string): Promise<void> {
    throw new Error(
      "Renaming folders is not supported for IMAP accounts via the current command set. " +
        "Please rename the folder directly on the mail server.",
    );
  }

  // ---- Sync operations ----

  async initialSync(
    daysBack: number,
    onProgress?: (phase: string, current: number, total: number) => void,
  ): Promise<SyncResult> {
    return imapInitialSync(this.accountId, daysBack, onProgress ? (p) => {
      onProgress(p.phase, p.current, p.total);
    } : undefined);
  }

  async deltaSync(_syncToken: string): Promise<SyncResult> {
    return imapDeltaSync(this.accountId);
  }

  // ---- Message operations ----

  async fetchMessage(messageId: string): Promise<ParsedMessage> {
    const { folder, uid } = this.parseImapMessageId(messageId);

    if (uid === null || !folder) {
      throw new Error(`Invalid IMAP message ID format: ${messageId}`);
    }

    const imapMsg = await this.withImapSession((id) => imapFetchMessageBody(id, folder, uid));

    const { parsed } = imapMessageToParsedMessage(
      imapMsg,
      this.accountId,
      folder,
    );
    parsed.id = messageId;

    return parsed;
  }

  async fetchAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: string; size: number }> {
    const { folder, uid } = this.parseImapMessageId(messageId);

    if (uid === null || !folder) {
      throw new Error(`Invalid IMAP message ID format: ${messageId}`);
    }

    const data = await this.withImapSession((id) => imapFetchAttachment(id, folder, uid, attachmentId));
    return { data, size: data.length };
  }

  async fetchRawMessage(messageId: string): Promise<string> {
    const { folder, uid } = this.parseImapMessageId(messageId);

    if (uid === null || !folder) {
      throw new Error(`Invalid IMAP message ID format: ${messageId}`);
    }

    return this.withImapSession((id) => imapFetchRawMessage(id, folder, uid));
  }

  // ---- Actions ----
  //
  // Every action targets the folder/UID pair embedded in each message id, so
  // each one first drops ids whose local row is a tombstone — see
  // `dropTombstonedMessageIds` (ids with no local row pass through: permanent
  // delete removes its rows locally before calling here). The four that move
  // mail then settle the local rows to wherever the server put them (F-5).

  async archive(
    _threadId: string,
    _messageIds: string[],
  ): Promise<void> {
    const grouped = await this.groupNonTombstonedByFolder(_messageIds);
    const archiveFolder =
      (await findSpecialFolder(this.accountId, "\\Archive")) ?? "Archive";

    for (const [folder, uids] of grouped) {
      if (folder === archiveFolder) continue;
      const result = await this.withImapSession((id) => imapMoveMessages(id, folder, uids, archiveFolder));
      await this.settle(folder, archiveFolder, uids, result);
    }
  }

  async trash(
    _threadId: string,
    _messageIds: string[],
  ): Promise<void> {
    const grouped = await this.groupNonTombstonedByFolder(_messageIds);
    const trashFolder =
      (await findSpecialFolder(this.accountId, "\\Trash")) ?? "Trash";

    for (const [folder, uids] of grouped) {
      if (folder === trashFolder) continue;
      const result = await this.withImapSession((id) => imapMoveMessages(id, folder, uids, trashFolder));
      await this.settle(folder, trashFolder, uids, result);
    }
  }

  async permanentDelete(
    _threadId: string,
    _messageIds: string[],
  ): Promise<void> {
    const grouped = await this.groupNonTombstonedByFolder(_messageIds);

    for (const [folder, uids] of grouped) {
      const result = await this.withImapSession((id) => imapDeleteMessages(id, folder, uids));
      await this.countFlaggedNotExpunged(folder, uids.length, result);
      noticeIfNotExpunged(result, folder);
    }
  }

  async markRead(
    _threadId: string,
    _messageIds: string[],
    read: boolean,
  ): Promise<void> {
    const grouped = await this.groupNonTombstonedByFolder(_messageIds);

    for (const [folder, uids] of grouped) {
      await this.withImapSession((id) => imapSetFlags(id, folder, uids, ["Seen"], read));
    }
  }

  async star(
    _threadId: string,
    _messageIds: string[],
    starred: boolean,
  ): Promise<void> {
    const grouped = await this.groupNonTombstonedByFolder(_messageIds);

    for (const [folder, uids] of grouped) {
      await this.withImapSession((id) => imapSetFlags(id, folder, uids, ["Flagged"], starred));
    }
  }

  async spam(
    _threadId: string,
    _messageIds: string[],
    isSpam: boolean,
  ): Promise<void> {
    const grouped = await this.groupNonTombstonedByFolder(_messageIds);
    const junkFolder =
      (await findSpecialFolder(this.accountId, "\\Junk")) ?? "Junk";
    const destination = isSpam ? junkFolder : "INBOX";

    for (const [folder, uids] of grouped) {
      if (folder === destination) continue;
      const result = await this.withImapSession((id) => imapMoveMessages(id, folder, uids, destination));
      await this.settle(folder, destination, uids, result);
    }
  }

  async moveToFolder(
    _threadId: string,
    _messageIds: string[],
    folderPath: string,
  ): Promise<void> {
    const grouped = await this.groupNonTombstonedByFolder(_messageIds);

    for (const [folder, uids] of grouped) {
      if (folder === folderPath) continue;
      const result = await this.withImapSession((id) => imapMoveMessages(id, folder, uids, folderPath));
      await this.settle(folder, folderPath, uids, result);
    }
  }

  async addLabel(
    _threadId: string,
    _labelId: string,
  ): Promise<void> {
    // IMAP doesn't have native labels — this would require COPY to another folder
    // or using IMAP keywords (if server supports them).
    // For now, this is a no-op with a warning.
    console.warn(
      "IMAP does not natively support labels. " +
        "Use moveToFolder() to move messages between folders instead.",
    );
  }

  async removeLabel(
    _threadId: string,
    _labelId: string,
  ): Promise<void> {
    // IMAP doesn't have native labels.
    console.warn(
      "IMAP does not natively support labels. " +
        "Use moveToFolder() to move messages between folders instead.",
    );
  }

  // ---- Send/Draft operations ----

  async sendMessage(
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ id: string; threadId?: string }> {
    const smtpConfig = await this.getSmtpConfig();
    const result = await smtpSendEmail(smtpConfig, rawBase64Url);
    if (!result.success) {
      throw new Error(`SMTP send failed: ${result.message}`);
    }

    const messageId = `imap-sent-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Save sent message to local DB so it appears in Sent folder immediately.
    // The thread it lands in is reported back (SPEC-AR); if the save fails
    // the reply's thread is still known, a new message's is not.
    let sentThreadId: string | undefined = _threadId;
    try {
      sentThreadId = await this.saveSentMessageLocally(rawBase64Url, messageId, _threadId);
    } catch (err) {
      console.warn("[IMAP] Failed to save sent message to local DB:", err);
    }

    // Copy sent message to Sent folder on IMAP server
    try {
      const sentFolder =
        (await findSpecialFolder(this.accountId, "\\Sent")) ?? "Sent";
      await this.withImapSession((id) =>
        imapAppendMessage(id, sentFolder, rawBase64Url, ["Seen"]),
      );
    } catch (err) {
      // Non-fatal: message was sent successfully, just not copied to server Sent folder
      console.error(
        "[IMAP] Failed to copy sent message to Sent folder on server:",
        err,
      );
    }

    return { id: messageId, threadId: sentThreadId };
  }

  /**
   * Save a sent message to the local SQLite DB with the SENT label.
   * This ensures the message appears in the Sent folder view immediately
   * without waiting for the next IMAP delta sync. Returns the thread the
   * message was saved under: the reply's thread, or the new message's own id.
   */
  private async saveSentMessageLocally(
    rawBase64Url: string,
    messageId: string,
    threadId?: string,
  ): Promise<string> {
    const raw = base64UrlDecode(rawBase64Url);
    const headers = parseBasicHeaders(raw);
    const snippet = extractSnippet(raw);

    const from = headers.get("from") ?? "";
    const to = headers.get("to") ?? "";
    const cc = headers.get("cc") ?? null;
    const subject = headers.get("subject") ?? null;
    const messageIdHeader = headers.get("message-id") ?? null;
    const inReplyTo = headers.get("in-reply-to") ?? null;
    const references = headers.get("references") ?? null;
    const now = Date.now();

    // For replies, add the SENT label to the existing thread.
    // For new compositions, create a new thread.
    const effectiveThreadId = threadId ?? messageId;

    if (threadId) {
      // Reply: add SENT label to existing thread
      const existingLabels = await getThreadLabelIds(this.accountId, threadId);
      if (!existingLabels.includes("SENT")) {
        await setThreadLabels(this.accountId, threadId, [...existingLabels, "SENT"]);
      }
    } else {
      // New thread: create thread record
      await upsertThread({
        id: effectiveThreadId,
        accountId: this.accountId,
        subject,
        snippet,
        lastMessageAt: now,
        messageCount: 1,
        isRead: true,
        isStarred: false,
        isImportant: false,
        hasAttachments: false,
      });
      await setThreadLabels(this.accountId, effectiveThreadId, ["SENT"]);
    }

    // Extract sender name from "Name <email>" format
    const fromNameMatch = from.match(/^([^<]*)<[^>]+>/);
    const fromName = fromNameMatch ? fromNameMatch[1]!.trim() : null;
    const fromAddress = from.replace(/.*<([^>]+)>.*/, "$1").trim();

    // Parse body for HTML and text
    const bodyStart = raw.indexOf("\r\n\r\n");
    const bodyHtml = bodyStart !== -1 ? raw.slice(bodyStart + 4) : null;

    await upsertMessage({
      id: messageId,
      accountId: this.accountId,
      threadId: effectiveThreadId,
      fromAddress,
      fromName,
      toAddresses: to,
      ccAddresses: cc,
      bccAddresses: null, // BCC is intentionally omitted from stored messages
      replyTo: null,
      subject,
      snippet,
      date: now,
      isRead: true,
      isStarred: false,
      bodyHtml: bodyHtml ? bodyHtml.slice(0, 50000) : null, // Limit stored body size
      bodyText: snippet,
      rawSize: raw.length,
      internalDate: now,
      messageIdHeader,
      referencesHeader: references,
      inReplyToHeader: inReplyTo,
    });

    return effectiveThreadId;
  }

  async createDraft(
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ draftId: string }> {
    const draftsFolder =
      (await findSpecialFolder(this.accountId, "\\Drafts")) ?? "Drafts";

    await this.withImapSession((id) => imapAppendMessage(id, draftsFolder, rawBase64Url, ["Draft"]));

    // IMAP APPEND does not return the new UID, so generate a pseudo draft ID
    const draftId = `imap-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return { draftId };
  }

  async updateDraft(
    draftId: string,
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ draftId: string }> {
    // Delete the old draft first, then create a new one
    try {
      await this.deleteDraft(draftId);
    } catch {
      // Old draft may already be gone; continue with creating the new one
    }

    return this.createDraft(rawBase64Url, _threadId);
  }

  async deleteDraft(draftId: string): Promise<void> {
    // Try to parse draft ID to get folder + UID info
    // Draft IDs from IMAP are in message ID format: imap-{accountId}-{folder}-{uid}
    const { folder, uid } = this.parseImapMessageId(draftId);

    if (uid !== null && folder) {
      const result = await this.withImapSession((id) => imapDeleteMessages(id, folder, [uid]));
      noticeIfNotExpunged(result, folder);
    } else {
      // Generated draft IDs (imap-draft-...) can't be mapped back to a server UID
      console.warn(
        `Draft ${draftId} has a generated ID and cannot be deleted from server. ` +
          "It will be cleaned up on next sync.",
      );
    }
  }

  // ---- Connection ----

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const imapConfig = await this.getImapConfig();
      const imapResult = await imapTestConnection(imapConfig);

      // Also test SMTP connectivity
      try {
        const smtpConfig = await this.getSmtpConfig();
        const smtpResult = await smtpTestConnection(smtpConfig);
        if (!smtpResult.success) {
          return {
            success: false,
            message: `IMAP OK, but SMTP failed: ${smtpResult.message}`,
          };
        }
      } catch (err) {
        return {
          success: false,
          message: `IMAP OK, but SMTP failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      return { success: true, message: `Connected: ${imapResult}` };
    } catch (err) {
      return {
        success: false,
        message: `IMAP connection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async getProfile(): Promise<{ email: string; name?: string }> {
    const account = await this.getAccount();
    return {
      email: account.email,
      name: account.display_name ?? undefined,
    };
  }

  // ---- Helpers ----

  /** `groupByFolder` over the ids that are not tombstoned locally. */
  private async groupNonTombstonedByFolder(messageIds: string[]): Promise<Map<string, number[]>> {
    return this.groupByFolder(await dropTombstonedMessageIds(this.accountId, messageIds));
  }

  /**
   * After the server completed a move: settle the local rows first, then
   * raise the not-expunged notice. The rows are the part that must not be
   * skipped — the notice is a toast, and the settle must not depend on it
   * (Grok M7).
   */
  private async settle(
    sourceFolder: string,
    destFolder: string,
    uids: number[],
    result: MoveResult,
  ): Promise<void> {
    try {
      await settleMovedRows(
        this.accountId,
        sourceFolder,
        destFolder,
        uids,
        result.mapping,
        result.dest_uidvalidity ?? null,
      );
      await this.countFlaggedNotExpunged(sourceFolder, uids.length, result);
    } finally {
      noticeIfNotExpunged(result, sourceFolder);
    }
  }

  /**
   * F-4 REQ-2.2: mail flagged `\Deleted` but left on the server (no UIDPLUS)
   * still counts toward the folder's EXISTS. Keep the per-folder counter in
   * step so the reconciliation gate does not fire on every pass. Never fails
   * the action: the counter is self-correcting on the next full list.
   */
  private async countFlaggedNotExpunged(
    folder: string,
    n: number,
    result: { expunged: boolean },
  ): Promise<void> {
    if (result.expunged) return;
    try {
      await incrementFlaggedNotExpunged(this.accountId, folder, n);
    } catch (err) {
      console.warn(`[imapSmtpProvider] Could not update the flagged-not-expunged count for ${folder}:`, err);
    }
  }

  /**
   * Parse IMAP message IDs and group UIDs by folder.
   * Message ID format: imap-{accountId}-{folder}-{uid}
   * Since accountId can contain hyphens, we strip the known prefix
   * "imap-{this.accountId}-" and then parse the remaining "{folder}-{uid}".
   */
  private groupByFolder(messageIds: string[]): Map<string, number[]> {
    const grouped = new Map<string, number[]>();
    const prefix = `imap-${this.accountId}-`;

    for (const messageId of messageIds) {
      const { folder, uid } = this.parseImapMessageId(messageId, prefix);

      if (uid === null || !folder) {
        console.warn(`Skipping invalid IMAP message ID: ${messageId}`);
        continue;
      }

      const existing = grouped.get(folder);
      if (existing) {
        existing.push(uid);
      } else {
        grouped.set(folder, [uid]);
      }
    }

    return grouped;
  }

  /**
   * Parse an IMAP message ID into folder and uid.
   * Returns { folder, uid } or { folder: null, uid: null } if invalid.
   */
  private parseImapMessageId(
    messageId: string,
    prefix?: string,
  ): { folder: string | null; uid: number | null } {
    const p = prefix ?? `imap-${this.accountId}-`;

    if (!messageId.startsWith(p)) {
      return { folder: null, uid: null };
    }

    // After stripping prefix, remainder is "{folder}-{uid}"
    const remainder = messageId.slice(p.length);
    const lastDash = remainder.lastIndexOf("-");
    if (lastDash === -1) {
      return { folder: null, uid: null };
    }

    const folder = remainder.slice(0, lastDash);
    const uid = parseInt(remainder.slice(lastDash + 1), 10);

    if (!folder || isNaN(uid)) {
      return { folder: null, uid: null };
    }

    return { folder, uid };
  }
}
