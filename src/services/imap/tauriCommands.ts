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

/**
 * One folder's answer from the batch delta check. Mirrors `DeltaCheckResult`
 * in `src-tauri/src/imap/types.rs`.
 *
 * F-4 REQ-1.2b: every requested folder comes back, `checked: false` with an
 * `error` when the check did not produce a usable observation. `checked` is
 * NOT "a `UID SEARCH ALL` ran" — part 2's attestation keeps a separate
 * per-folder bit for that and evaluates it against the syncable-folder set,
 * treating a folder missing from the results as unchecked.
 */
export interface DeltaCheckResult {
  folder: string;
  uidvalidity: number;
  new_uids: number[];
  uidvalidity_changed: boolean;
  /** The server's EXISTS at SELECT (F-4 REQ-2.1 gate input); `null` when unchecked. */
  exists: number | null;
  checked: boolean;
  error: string | null;
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

/**
 * One entry of a `COPYUID` mapping (RFC 4315 §3): the UID a message had in the
 * source folder and the UID the server gave it in the destination.
 * Mirrors `UidMapping` in `src-tauri/src/imap/types.rs`.
 */
export interface UidMapping {
  source_uid: number;
  dest_uid: number;
}

/**
 * What a move did to the source folder, plus where the messages went (F-5).
 *
 * Mirrors `MoveResult` in `src-tauri/src/imap/types.rs`. `mapping` is `null`
 * when the server gave no usable `COPYUID` — no UIDPLUS, the COPY fallback, or a
 * dropped response — and the caller falls back to hiding the stale rows until
 * the destination folder syncs.
 */
export interface MoveResult extends RemovalResult {
  mapping: UidMapping[] | null;
  /**
   * The destination folder's UIDVALIDITY as the server reported it alongside
   * the mapping. Destination UIDs mean nothing outside that generation; the
   * caller refuses the mapping when this disagrees with the folder's last
   * synced UIDVALIDITY. `null` whenever `mapping` is, or when malformed.
   */
  dest_uidvalidity: number | null;
}

const UID_MAX = 0xffff_ffff;

function isUid(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= UID_MAX
  );
}

/**
 * Validate a `COPYUID` mapping coming back across the Tauri IPC boundary.
 *
 * The mapping drives local identity, so it is checked as a whole: every entry
 * an object of two `u32` UIDs, no source UID repeated. Any defect degrades the
 * *entire* mapping to `null` — a partial mapping would re-key some rows and
 * leave the rest to a fallback that assumes none were, which is the one state
 * the design never produces on purpose. `null` is the safe direction: rows are
 * hidden until sync, never mis-keyed.
 */
function parseUidMapping(value: unknown): UidMapping[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    console.warn("Malformed COPYUID mapping from Rust; ignoring it", value);
    return null;
  }
  const mapping: UidMapping[] = [];
  const seenSource = new Set<number>();
  const seenDest = new Set<number>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      console.warn("Malformed COPYUID mapping entry from Rust; ignoring the mapping", entry);
      return null;
    }
    const { source_uid, dest_uid } = entry as { source_uid?: unknown; dest_uid?: unknown };
    if (
      !isUid(source_uid) ||
      !isUid(dest_uid) ||
      seenSource.has(source_uid) ||
      seenDest.has(dest_uid)
    ) {
      console.warn("Malformed COPYUID mapping entry from Rust; ignoring the mapping", entry);
      return null;
    }
    seenSource.add(source_uid);
    seenDest.add(dest_uid);
    mapping.push({ source_uid, dest_uid });
  }
  return mapping;
}

function parseMoveResult(value: unknown): MoveResult {
  const { expunged } = parseRemovalResult(value);
  if (typeof value !== "object" || value === null) {
    return { expunged, mapping: null, dest_uidvalidity: null };
  }
  const raw = value as { mapping?: unknown; dest_uidvalidity?: unknown };
  const mapping = parseUidMapping(raw.mapping);
  // UIDVALIDITY is a u32 too; anything else is treated as unknown, and an
  // unknown generation is not enough to re-key on.
  const dest_uidvalidity =
    mapping !== null && isUid(raw.dest_uidvalidity) ? raw.dest_uidvalidity : null;
  return { expunged, mapping, dest_uidvalidity };
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
 *
 * Validated at the boundary (F-4 REQ-1.1): this list feeds a local-deletion
 * decision, so a malformed answer is an error, never an empty list — an empty
 * list would read as "everything vanished".
 */
export async function imapSearchAllUids(
  sessionId: string,
  folder: string
): Promise<number[]> {
  const value: unknown = await invoke('imap_search_all_uids', { sessionId, folder });
  if (!Array.isArray(value) || !value.every(isUid)) {
    throw new Error(`Malformed UID list from Rust for ${folder}`);
  }
  return value;
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
 *
 * Returns the server's `COPYUID` mapping when one arrived, so the caller can
 * re-key the local rows to their new folder and UID (F-5).
 */
export async function imapMoveMessages(
  sessionId: string,
  folder: string,
  uids: number[],
  destination: string
): Promise<MoveResult> {
  return parseMoveResult(
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
 * F-4 REQ-2.3: how many messages in `folder` are not flagged `\Deleted`. The
 * cheap belt for no-UIDPLUS accounts. Validated: a non-integer answer is an
 * error, never a count.
 */
export async function imapCountNotDeleted(sessionId: string, folder: string): Promise<number> {
  const value: unknown = await invoke('imap_count_not_deleted', { sessionId, folder });
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Malformed NOT DELETED count from Rust for ${folder}`);
  }
  return value;
}

/**
 * F-4 REQ-4.1: which of `uids` still exist in `folder`. Validated like
 * `imapSearchAllUids`: a malformed answer throws, and the answer must be a
 * subset of what was asked.
 */
export async function imapSearchUidsPresent(
  sessionId: string,
  folder: string,
  uids: number[],
): Promise<number[]> {
  if (uids.length === 0) return [];
  const value: unknown = await invoke('imap_search_uids_present', { sessionId, folder, uids });
  const asked = new Set(uids);
  if (!Array.isArray(value) || !value.every((u) => isUid(u) && asked.has(u))) {
    throw new Error(`Malformed UID presence list from Rust for ${folder}`);
  }
  return value;
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
