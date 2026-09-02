import { invoke } from '@tauri-apps/api/core';

// ---------- IMAP types ----------

export interface ImapConfig {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  username: string;
  password: string; // plaintext password or OAuth2 access token
  auth_method: 'password' | 'oauth2';
  accept_invalid_certs?: boolean;
}

export interface ImapFolder {
  path: string;       // decoded UTF-8 display name
  raw_path: string;   // original modified UTF-7 path for IMAP commands
  name: string;       // decoded display name (last segment)
  delimiter: string;
  special_use: string | null;
  exists: number;
  unseen: number;
}

export interface ImapMessage {
  uid: number;
  folder: string;
  message_id: string | null;
  in_reply_to: string | null;
  references: string | null;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  bcc_addresses: string | null;
  reply_to: string | null;
  subject: string | null;
  date: number;
  is_read: boolean;
  is_starred: boolean;
  is_draft: boolean;
  body_html: string | null;
  body_text: string | null;
  snippet: string | null;
  raw_size: number;
  list_unsubscribe: string | null;
  list_unsubscribe_post: string | null;
  auth_results: string | null;
  attachments: ImapAttachment[];
}

export interface ImapAttachment {
  part_id: string;
  filename: string;
  mime_type: string;
  size: number;
  content_id: string | null;
  is_inline: boolean;
}

export interface ImapFolderStatus {
  uidvalidity: number;
  uidnext: number;
  exists: number;
  unseen: number;
  highest_modseq: number | null;
}

export interface ImapFetchResult {
  messages: ImapMessage[];
  folder_status: ImapFolderStatus;
}

// ---------- Folder search result (lightweight: UIDs + status only) ----------

export interface ImapFolderSearchResult {
  uids: number[];
  folder_status: ImapFolderStatus;
}

// ---------- Folder sync result (single-connection search + fetch) ----------

export interface ImapFolderSyncResult {
  uids: number[];
  messages: ImapMessage[];
  folder_status: ImapFolderStatus;
}

// ---------- Delta check types ----------

export interface DeltaCheckRequest {
  folder: string;
  last_uid: number;
  uidvalidity: number;
}

export interface DeltaCheckResult {
  folder: string;
  uidvalidity: number;
  new_uids: number[];
  uidvalidity_changed: boolean;
}

// ---------- SMTP types ----------

/**
 * What a move or delete actually did to the source folder.
 *
 * Mirrors `RemovalResult` in `src-tauri/src/imap/types.rs`. `expunged: false`
 * means the messages were flagged `\Deleted` but are still on the server,
 * because it does not advertise UIDPLUS and there is no way to expunge only
 * the messages the user selected. Callers must not report that as a completed
 * deletion.
 */
export interface RemovalResult {
  expunged: boolean;
}

/**
 * Validate a `RemovalResult` coming back across the Tauri IPC boundary.
 *
 * `CLAUDE.md` requires `invoke()` results to validate their own input. The
 * other IMAP wrappers in this file predate that rule and still cast blindly;
 * that gap is real but out of scope here.
 *
 * Degrades to `expunged: false` on anything unexpected — including a null or
 * non-object result, which would otherwise throw on property access and turn a
 * *successful* delete into a thrown error the caller might retry. Failing this
 * way over-warns the user, which is the harmless direction: it can only claim
 * that mail still needs removing, never that it is gone when it is not.
 */
function parseRemovalResult(value: unknown): RemovalResult {
  if (
    typeof value === "object" &&
    value !== null &&
    "expunged" in value &&
    typeof (value as { expunged: unknown }).expunged === "boolean"
  ) {
    return { expunged: (value as RemovalResult).expunged };
  }
  console.warn("Malformed RemovalResult from Rust; assuming not expunged", value);
  return { expunged: false };
}

export interface SmtpConfig {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  username: string;
  password: string;
  auth_method: 'password' | 'oauth2';
  accept_invalid_certs?: boolean;
}

export interface SmtpSendResult {
  success: boolean;
  message: string;
}

// ---------- IMAP commands ----------

/**
 * Test IMAP connectivity: connect, authenticate, list folders, logout.
 * Returns a success message string.
 */
export async function imapTestConnection(config: ImapConfig): Promise<string> {
  return invoke<string>('imap_test_connection', { config });
}

// ---------- Pooled session lifecycle (brief E2/P15) ----------

/**
 * Open an authenticated IMAP session and keep it in the Rust pool.
 *
 * The only command that carries a password, together with Decision 4(a)'s raw
 * fetch. Everything else takes the returned opaque session id.
 */
export async function imapSessionOpen(config: ImapConfig): Promise<string> {
  return invoke<string>('imap_session_open', { config });
}

/** Close a pooled session. Idempotent: an unknown id is not an error. */
export async function imapSessionClose(sessionId: string): Promise<void> {
  return invoke<void>('imap_session_close', { sessionId });
}

/**
 * Drop every pooled session for an account after its credential changed.
 *
 * Takes the account's identity rather than a session id because the point is to
 * catch sessions this window does not know about — other windows' `interactive`
 * sessions included.
 */
export async function imapSessionsInvalidate(
  username: string,
  host: string,
): Promise<void> {
  return invoke<void>('imap_sessions_invalidate', { username, host });
}

/**
 * List all IMAP folders/mailboxes on the server.
 *
 * Takes a pooled session id (E2/P15): no password crosses the boundary here.
 */
export async function imapListFolders(sessionId: string): Promise<ImapFolder[]> {
  return invoke<ImapFolder[]>('imap_list_folders', { sessionId });
}

/**
 * Fetch messages from a folder by UID list.
 * Returns parsed messages along with folder status metadata.
 */
export async function imapFetchMessages(
  sessionId: string,
  folder: string,
  uids: number[]
): Promise<ImapFetchResult> {
  return invoke<ImapFetchResult>('imap_fetch_messages', { sessionId, folder, uids });
}

/**
 * Sentinel `imap_fetch_messages` returns when `async-imap` yielded nothing for a
 * folder the server did have data in.
 *
 * Decision 4(a): the raw-TCP fallback needs a credential and the pool holds
 * none, so the frontend re-issues the fetch through `imapRawFetchMessages`
 * rather than the command keeping a password for the rare case.
 */
export const NEED_RAW_FALLBACK = 'velo:fetch:NeedRawFallback';

/**
 * Exact match, deliberately. This sentinel shares its channel with
 * server-supplied IMAP error text, so a substring test would let a server with
 * a mailbox named after it push Velo down the credential-carrying fallback
 * path. Cross-vendor review finding 1 on PR #39.
 */
export function isNeedRawFallback(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.trim() === NEED_RAW_FALLBACK;
}

/**
 * Decision 4(a)'s escape hatch: a raw-TCP fetch carrying its own credential.
 *
 * One of only two commands that receives a password, and named explicitly in
 * the Done-when 5 exemption so the "no credential crosses this boundary" test
 * stays honest instead of quietly widening.
 */
export async function imapRawFetchMessages(
  config: ImapConfig,
  folder: string,
  uids: number[]
): Promise<ImapFetchResult> {
  return invoke<ImapFetchResult>('imap_raw_fetch_messages', { config, folder, uids });
}

/**
 * Get UIDs of messages newer than `sinceUid` in the given folder.
 */
export async function imapFetchNewUids(
  sessionId: string,
  folder: string,
  sinceUid: number
): Promise<number[]> {
  return invoke<number[]>('imap_fetch_new_uids', { sessionId, folder, sinceUid });
}

/**
 * Search for all UIDs in a folder using UID SEARCH ALL.
 * Returns real UIDs — avoids the sparse UID gap problem with generateUidRange.
 */
export async function imapSearchAllUids(
  sessionId: string,
  folder: string
): Promise<number[]> {
  return invoke<number[]>('imap_search_all_uids', { sessionId, folder });
}

/**
 * Fetch a single message with full body by UID.
 */
export async function imapFetchMessageBody(
  sessionId: string,
  folder: string,
  uid: number
): Promise<ImapMessage> {
  return invoke<ImapMessage>('imap_fetch_message_body', { sessionId, folder, uid });
}

/**
 * Set or remove flags on messages.
 * @param flags - Flag names (e.g. "Seen", "Flagged", "Draft"). Backslash prefix is added automatically.
 * @param add - true to add flags, false to remove them.
 */
export async function imapSetFlags(
  sessionId: string,
  folder: string,
  uids: number[],
  flags: string[],
  add: boolean
): Promise<void> {
  return invoke<void>('imap_set_flags', { sessionId, folder, uids, flags, add });
}

/**
 * Move messages from one folder to another.
 * Uses MOVE extension if available, falls back to COPY+DELETE.
 */
export async function imapMoveMessages(
  sessionId: string,
  folder: string,
  uids: number[],
  destination: string
): Promise<RemovalResult> {
  return parseRemovalResult(
    await invoke('imap_move_messages', { sessionId, folder, uids, destination })
  );
}

/**
 * Permanently delete messages (flag as Deleted + EXPUNGE).
 */
export async function imapDeleteMessages(
  sessionId: string,
  folder: string,
  uids: number[]
): Promise<RemovalResult> {
  return parseRemovalResult(
    await invoke('imap_delete_messages', { sessionId, folder, uids })
  );
}

/**
 * Append a raw message to a folder (for saving sent mail or drafts).
 * @param rawMessage - The full email message encoded as base64url.
 * @param flags - Optional IMAP flag names, with or without the leading backslash
 *   (e.g. ["Seen"], ["Draft"]). Rendering to the wire form `(\\Seen)` happens in
 *   Rust against an allowlist, so an unvalidated flag string never reaches the
 *   IMAP session (audit P1).
 */
export async function imapAppendMessage(
  sessionId: string,
  folder: string,
  rawMessage: string,
  flags?: string[]
): Promise<void> {
  return invoke<void>('imap_append_message', { sessionId, folder, flags: flags ?? null, rawMessage });
}

/**
 * Get folder status (UIDVALIDITY, UIDNEXT, message count, unseen count).
 */
export async function imapGetFolderStatus(
  sessionId: string,
  folder: string
): Promise<ImapFolderStatus> {
  return invoke<ImapFolderStatus>('imap_get_folder_status', { sessionId, folder });
}

/**
 * Fetch a specific MIME part (attachment) by UID and part ID.
 * Returns the attachment data as a base64-encoded string.
 */
export async function imapFetchAttachment(
  sessionId: string,
  folder: string,
  uid: number,
  partId: string
): Promise<string> {
  return invoke<string>('imap_fetch_attachment', { sessionId, folder, uid, partId });
}

/**
 * Fetch the raw RFC822 source of a single message by UID.
 * Returns the full message as a UTF-8 string.
 */
export async function imapFetchRawMessage(
  sessionId: string,
  folder: string,
  uid: number
): Promise<string> {
  return invoke<string>('imap_fetch_raw_message', { sessionId, folder, uid });
}

/**
 * Check multiple folders for new UIDs in a single IMAP connection.
 * Replaces N separate imapGetFolderStatus + imapFetchNewUids calls with one round-trip.
 */
export async function imapDeltaCheck(
  sessionId: string,
  folders: DeltaCheckRequest[]
): Promise<DeltaCheckResult[]> {
  return invoke<DeltaCheckResult[]>('imap_delta_check', { sessionId, folders });
}

/**
 * Sync a folder in a single IMAP connection: SELECT → UID SEARCH → batched UID FETCH.
 * When `sinceDate` is provided (format `DD-Mon-YYYY`), uses `UID SEARCH SINCE <date>`
 * to only fetch messages from that date onward, avoiding timeouts on large folders.
 */
export async function imapSyncFolder(
  sessionId: string,
  folder: string,
  batchSize: number,
  sinceDate?: string | null,
): Promise<ImapFolderSyncResult> {
  return invoke<ImapFolderSyncResult>('imap_sync_folder', { sessionId, folder, batchSize, sinceDate: sinceDate ?? null });
}

/**
 * Search a folder for UIDs without fetching message bodies.
 * Returns UIDs and folder status — lightweight alternative to `imapSyncFolder`
 * for callers that fetch messages in smaller IPC-friendly chunks.
 */
export async function imapSearchFolder(
  sessionId: string,
  folder: string,
  sinceDate?: string | null,
): Promise<ImapFolderSearchResult> {
  return invoke<ImapFolderSearchResult>('imap_search_folder', { sessionId, folder, sinceDate: sinceDate ?? null });
}

/**
 * Raw IMAP diagnostic: bypasses async-imap to show raw server responses.
 *
 * **Development builds only.** The Rust command is gated on
 * `#[cfg(debug_assertions)]` (audit P3) because the transcript it returns is a live
 * authenticated IMAP session and can contain credential material echoed back by the
 * server. In a release build the command is not registered at all, so fail with a
 * clear message here rather than surfacing Tauri's "command not found".
 */
export async function imapRawFetchDiagnostic(
  config: ImapConfig,
  folder: string,
  uidRange: string,
): Promise<string> {
  if (!import.meta.env.DEV) {
    throw new Error('The raw IMAP diagnostic is only available in development builds.');
  }
  return invoke<string>('imap_raw_fetch_diagnostic', { config, folder, uidRange });
}

// ---------- SMTP commands ----------

/**
 * Send a pre-built RFC 2822 email via SMTP.
 * @param rawEmail - The full email message encoded as base64url.
 */
export async function smtpSendEmail(
  config: SmtpConfig,
  rawEmail: string
): Promise<SmtpSendResult> {
  return invoke<SmtpSendResult>('smtp_send_email', { config, rawEmail });
}

/**
 * Test SMTP connectivity by connecting and authenticating.
 */
export async function smtpTestConnection(config: SmtpConfig): Promise<SmtpSendResult> {
  return invoke<SmtpSendResult>('smtp_test_connection', { config });
}
