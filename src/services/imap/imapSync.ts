import type {
  ImapMessage,
  ImapFetchResult,
  DeltaCheckRequest,
  DeltaCheckResult,
} from "./tauriCommands";
import {
  imapListFolders,
  imapGetFolderStatus,
  imapFetchMessages,
  imapRawFetchMessages,
  isNeedRawFallback,
  imapFetchNewUids,
  imapSearchFolder,
  imapDeltaCheck,
  imapSearchAllUids,
  imapCountNotDeleted,
} from "./tauriCommands";
import { withSession } from "./sessionManager";
import { buildImapConfigWithFreshToken } from "./imapConfigBuilder";
import {
  mapFolderToLabel,
  getLabelsForMessage,
  syncFoldersToLabels,
  getSyncableFolders,
} from "./folderMapper";
import type { ParsedMessage, ParsedAttachment } from "../gmail/messageParser";
import type { SyncResult } from "../email/types";
import { upsertMessage, updateMessageThreadIds, getLiveMessagesInFolder } from "../db/messages";
import { upsertThread, setThreadLabels, deleteThread } from "../db/threads";
import {
  attestPass,
  beginReconcilePass,
  finishReconcilePass,
  markFetchCompleted,
  reconcileFolderList,
  shouldListFolder,
  invalidateFolderSuspects,
  beltDue,
  folderListLooksPartial,
  noteFolderMissing,
} from "./reconcilePass";
import { upsertAttachment } from "../db/attachments";
import { getAccount, updateAccountSyncState } from "../db/accounts";
import { withTransaction } from "../db/connection";
import { getOwnAddresses, clearSnoozeForNewExternalMessages } from "../snooze/snoozeSync";
import {
  upsertFolderSyncState,
  getAllFolderSyncStates,
  bumpReconcilePasses,
  clearFolderMissing,
  setFlaggedNotExpunged,
  setForceList,
} from "../db/folderSyncState";
import {
  buildThreads,
  type ThreadableMessage,
  type ThreadGroup,
} from "../threading/threadBuilder";
import { getPendingOpsForResource } from "../db/pendingOperations";
import { isAllTime } from "../syncPeriod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;
/** Number of messages to fetch per IPC call during initial sync. */
const CHUNK_SIZE = 200;
/** Number of thread groups to process per transaction in Phase 4. */
const THREAD_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Circuit breaker for connection storms
// ---------------------------------------------------------------------------

/** After this many consecutive connection failures, add a cooldown delay. */
const CIRCUIT_BREAKER_THRESHOLD = 3;
/** Delay (ms) to wait after hitting the circuit breaker threshold. */
const CIRCUIT_BREAKER_DELAY_MS = 15_000;
/** After this many consecutive failures, skip remaining folders entirely. */
const CIRCUIT_BREAKER_MAX_FAILURES = 5;
/**
 * Delay (ms) between folder syncs during initial sync.
 *
 * It existed to avoid connection bursts: every folder used to open its own
 * TCP+TLS session and log out again, and a server watching a client open twenty
 * connections in twenty seconds may well throttle it. Under pooling the whole
 * initial sync runs on ONE session, so there is no burst left to space out and
 * the delay is now only politeness between commands — reduced rather than
 * removed, because a server's per-command rate limits are its own business
 * (Done-when 3).
 */
const INTER_FOLDER_DELAY_MS = 200;

export function isConnectionError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("connection") ||
    msg.includes("tcp") ||
    msg.includes("tls") ||
    msg.includes("dns") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("socket")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// IMAP SINCE date helpers
// ---------------------------------------------------------------------------

const IMAP_MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Format a Date as `DD-Mon-YYYY` for the IMAP SINCE search criterion (RFC 3501 §6.4.4).
 */
export function formatImapDate(date: Date): string {
  const day = date.getUTCDate();
  const month = IMAP_MONTH_NAMES[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Compute a `DD-Mon-YYYY` SINCE date string for the given `daysBack` value.
 * Subtracts an extra day as a safety margin for timezone differences
 * (IMAP SINCE has date-only granularity, no time component).
 */
export function computeSinceDate(daysBack: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysBack - 1);
  return formatImapDate(date);
}

/**
 * The SINCE date for a sync period, or `null` for "all time" (SPEC-276): the
 * Rust command then issues `UID SEARCH ALL` instead of `UID SEARCH SINCE`.
 */
export function sinceDateForDaysBack(daysBack: number): string | null {
  return isAllTime(daysBack) ? null : computeSinceDate(daysBack);
}

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

export interface ImapSyncProgress {
  phase: "folders" | "messages" | "threading" | "storing_threads" | "done";
  current: number;
  total: number;
  folder?: string;
}

export type ImapSyncProgressCallback = (progress: ImapSyncProgress) => void;

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

/**
 * Generate a synthetic Message-ID for messages that lack one.
 */
function syntheticMessageId(accountId: string, folder: string, uid: number): string {
  return `synthetic-${accountId}-${folder}-${uid}@velo.local`;
}

/**
 * Convert an ImapMessage (from Tauri backend) to the ParsedMessage format
 * used throughout the app.
 */
export function imapMessageToParsedMessage(
  msg: ImapMessage,
  accountId: string,
  folderLabelId: string,
): { parsed: ParsedMessage; threadable: ThreadableMessage } {
  const messageId = `imap-${accountId}-${msg.folder}-${msg.uid}`;
  const rfc2822MessageId =
    msg.message_id ?? syntheticMessageId(accountId, msg.folder, msg.uid);

  const folderMapping = { labelId: folderLabelId, labelName: "", type: "" };
  const labelIds = getLabelsForMessage(
    folderMapping,
    msg.is_read,
    msg.is_starred,
    msg.is_draft,
  );

  const snippet = msg.snippet ?? (msg.body_text ? msg.body_text.slice(0, 200) : "");

  const attachments: ParsedAttachment[] = msg.attachments.map((att) => ({
    filename: att.filename,
    mimeType: att.mime_type,
    size: att.size,
    gmailAttachmentId: att.part_id, // reuse field for IMAP part ID
    contentId: att.content_id,
    isInline: att.is_inline,
  }));

  const parsed: ParsedMessage = {
    id: messageId,
    threadId: "", // will be assigned after threading
    fromAddress: msg.from_address,
    fromName: msg.from_name,
    toAddresses: msg.to_addresses,
    ccAddresses: msg.cc_addresses,
    bccAddresses: msg.bcc_addresses,
    replyTo: msg.reply_to,
    subject: msg.subject,
    snippet,
    date: msg.date * 1000,
    isRead: msg.is_read,
    isStarred: msg.is_starred,
    bodyHtml: msg.body_html,
    bodyText: msg.body_text,
    rawSize: msg.raw_size,
    internalDate: msg.date * 1000,
    labelIds,
    hasAttachments: attachments.length > 0,
    attachments,
    listUnsubscribe: msg.list_unsubscribe,
    listUnsubscribePost: msg.list_unsubscribe_post,
    authResults: msg.auth_results,
  };

  const threadable: ThreadableMessage = {
    id: messageId,
    messageId: rfc2822MessageId,
    inReplyTo: msg.in_reply_to,
    references: msg.references,
    subject: msg.subject,
    date: msg.date * 1000,
  };

  return { parsed, threadable };
}

// ---------------------------------------------------------------------------
// Thread storage
// ---------------------------------------------------------------------------

/**
 * Store threads and their messages into the local DB.
 */
async function storeThreadsAndMessages(
  accountId: string,
  threadGroups: ThreadGroup[],
  parsedByLocalId: Map<string, ParsedMessage>,
  imapMsgByLocalId: Map<string, ImapMessage>,
  labelsByRfcId?: Map<string, Set<string>>,
): Promise<ParsedMessage[]> {
  const storedMessages: ParsedMessage[] = [];
  const ownAddresses = await getOwnAddresses(accountId);

  // Pre-check pending ops OUTSIDE any transaction
  const skippedThreadIds = new Set<string>();
  for (const group of threadGroups) {
    const pendingOps = await getPendingOpsForResource(accountId, group.threadId);
    if (pendingOps.length > 0) {
      console.log(`[imapSync] Skipping thread ${group.threadId}: has ${pendingOps.length} pending local ops`);
      skippedThreadIds.add(group.threadId);
    }
  }

  // Process in batches within transactions to avoid long-held locks
  for (let i = 0; i < threadGroups.length; i += THREAD_BATCH_SIZE) {
    const batch = threadGroups.slice(i, i + THREAD_BATCH_SIZE);

    await withTransaction(async (tx) => {
      for (const group of batch) {
        if (skippedThreadIds.has(group.threadId)) continue;

        const messages = group.messageIds
          .map((id) => parsedByLocalId.get(id))
          .filter((m): m is ParsedMessage => m !== undefined);

        if (messages.length === 0) continue;

        // Assign threadId to each message
        for (const msg of messages) {
          msg.threadId = group.threadId;
        }

        // Sort by date ascending
        messages.sort((a, b) => a.date - b.date);

        const firstMessage = messages[0]!;
        const lastMessage = messages[messages.length - 1]!;

        // Collect all label IDs across messages in this thread.
        // Also include labels from duplicate folder copies (same RFC Message-ID
        // in multiple folders) that the threading algorithm may have deduplicated.
        const allLabelIds = new Set<string>();
        for (const msg of messages) {
          for (const lid of msg.labelIds) {
            allLabelIds.add(lid);
          }
          // Merge labels from all folder copies of this message
          const imapMsg = imapMsgByLocalId.get(msg.id);
          const rfcId = imapMsg?.message_id;
          if (rfcId && labelsByRfcId) {
            const extraLabels = labelsByRfcId.get(rfcId);
            if (extraLabels) {
              for (const lid of extraLabels) {
                allLabelIds.add(lid);
              }
            }
          }
        }

        const isRead = messages.every((m) => m.isRead);
        const isStarred = messages.some((m) => m.isStarred);
        const hasAttachments = messages.some((m) => m.hasAttachments);

        // SPEC-F-1 REQ-1.3 — decided before upsertThread overwrites last_message_at.
        await clearSnoozeForNewExternalMessages(
          accountId,
          group.threadId,
          messages.map((m) => ({ id: m.id, fromAddress: m.fromAddress })),
          ownAddresses,
          tx,
        );

        await upsertThread({
          id: group.threadId,
          accountId,
          subject: firstMessage.subject,
          snippet: lastMessage.snippet,
          lastMessageAt: lastMessage.date,
          messageCount: messages.length,
          isRead,
          isStarred,
          isImportant: false,
          hasAttachments,
        }, tx);

        const labelArray = [...allLabelIds];
        await setThreadLabels(accountId, group.threadId, labelArray, tx);

        // Store messages sequentially to avoid concurrent DB writes
        for (const parsed of messages) {
          const imapMsg = imapMsgByLocalId.get(parsed.id);

          await upsertMessage({
            id: parsed.id,
            accountId,
            threadId: parsed.threadId,
            fromAddress: parsed.fromAddress,
            fromName: parsed.fromName,
            toAddresses: parsed.toAddresses,
            ccAddresses: parsed.ccAddresses,
            bccAddresses: parsed.bccAddresses,
            replyTo: parsed.replyTo,
            subject: parsed.subject,
            snippet: parsed.snippet,
            date: parsed.date,
            isRead: parsed.isRead,
            isStarred: parsed.isStarred,
            bodyHtml: parsed.bodyHtml,
            bodyText: parsed.bodyText,
            rawSize: parsed.rawSize,
            internalDate: parsed.internalDate,
            listUnsubscribe: parsed.listUnsubscribe,
            listUnsubscribePost: parsed.listUnsubscribePost,
            authResults: parsed.authResults,
            messageIdHeader: imapMsg?.message_id ?? null,
            referencesHeader: imapMsg?.references ?? null,
            inReplyToHeader: imapMsg?.in_reply_to ?? null,
            imapUid: imapMsg?.uid ?? null,
            imapFolder: imapMsg?.folder ?? null,
          }, tx);

          for (const att of parsed.attachments) {
            await upsertAttachment({
              id: `${parsed.id}_${att.gmailAttachmentId}`,
              messageId: parsed.id,
              accountId,
              filename: att.filename,
              mimeType: att.mimeType,
              size: att.size,
              gmailAttachmentId: att.gmailAttachmentId,
              contentId: att.contentId,
              isInline: att.isInline,
            }, tx);
          }

          storedMessages.push(parsed);
        }
      }
    });
  }

  return storedMessages;
}

// ---------------------------------------------------------------------------
// Fetch messages from a folder in batches
// ---------------------------------------------------------------------------

/**
 * Fetch messages from a folder in batches of BATCH_SIZE.
 */
/**
 * Fetch one batch through the pooled `sync` session, with Decision 4(a)'s
 * escape hatch.
 *
 * `imap_fetch_messages` answers `NeedRawFallback` when `async-imap` yielded
 * nothing for a folder the server did have data in. The raw-TCP retry needs a
 * credential and the pool deliberately holds none, so it is re-issued here
 * through the one command that still carries a config. The pooled session has
 * already been evicted by then — its protocol state is exactly what is in
 * doubt — so the next batch opens a fresh one.
 */
async function fetchMessagesPooled(
  accountId: string,
  folder: string,
  uids: number[],
  fallbackFolders?: Set<string>,
): Promise<ImapFetchResult> {
  const rawFetch = async (): Promise<ImapFetchResult> => {
    const account = await getAccount(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);
    const config = await buildImapConfigWithFreshToken(account);
    return imapRawFetchMessages(config, folder, uids);
  };

  // Once a folder has needed the fallback, every later batch in the same pass
  // will too — the trigger is a parser-level property of the folder's messages,
  // not of the batch. Without this each batch would open a session, fail,
  // evict it, and open a raw connection: two handshakes per batch, fifty
  // batches, for a folder that was never going to work through the pool.
  // Cross-vendor review finding 4 on PR #39.
  if (fallbackFolders?.has(folder)) return rawFetch();

  try {
    return await withSession(accountId, "sync", {}, (id) =>
      imapFetchMessages(id, folder, uids),
    );
  } catch (err) {
    if (!isNeedRawFallback(err)) throw err;

    console.log(`[imapSync] Raw-fetch fallback for folder ${folder}`);
    fallbackFolders?.add(folder);
    return rawFetch();
  }
}

async function fetchMessagesInBatches(
  accountId: string,
  folder: string,
  uids: number[],
  onBatch?: (fetched: number, total: number) => void,
): Promise<{ messages: ImapMessage[]; lastUid: number; uidvalidity: number }> {
  // Shared across this folder's batches only; a fresh sync re-tests the pool.
  const fallbackFolders = new Set<string>();
  const allMessages: ImapMessage[] = [];
  let lastUid = 0;
  let uidvalidity = 0;

  for (let i = 0; i < uids.length; i += BATCH_SIZE) {
    const batch = uids.slice(i, i + BATCH_SIZE);
    const result = await fetchMessagesPooled(accountId, folder, batch, fallbackFolders);

    allMessages.push(...result.messages);
    uidvalidity = result.folder_status.uidvalidity;

    for (const msg of result.messages) {
      if (msg.uid > lastUid) lastUid = msg.uid;
    }

    onBatch?.(Math.min(i + BATCH_SIZE, uids.length), uids.length);
  }

  return { messages: allMessages, lastUid, uidvalidity };
}

// ---------------------------------------------------------------------------
// Initial sync
// ---------------------------------------------------------------------------

/**
 * Perform initial sync for an IMAP account.
 * Fetches messages from all folders for the past N days.
 */
export async function imapInitialSync(
  accountId: string,
  daysBack = 365,
  onProgress?: ImapSyncProgressCallback,
): Promise<SyncResult> {
  const account = await getAccount(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }
  const ownAddresses = await getOwnAddresses(accountId);


  // Phase 1: List and sync folders
  onProgress?.({ phase: "folders", current: 0, total: 1 });
  // One command per `withSession`, so a pool error is always safe to retry.
  const allFolders = await withSession(accountId, "sync", {}, (id) => imapListFolders(id));
  const syncableFolders = getSyncableFolders(allFolders);
  await syncFoldersToLabels(accountId, syncableFolders);
  console.log(`[imapSync] Initial sync for account ${accountId}: ${syncableFolders.length} syncable folders`);
  onProgress?.({ phase: "folders", current: 1, total: 1 });

  // ---------------------------------------------------------------------------
  // Phase 2: Streaming fetch & store
  // ---------------------------------------------------------------------------
  // For each folder, for each batch: fetch → parse → store to DB immediately
  // (with placeholder threadId = messageId). Only lightweight metadata is kept
  // in memory for the subsequent threading pass.
  // This avoids accumulating all message bodies in memory (OOM on large mailboxes).

  interface MessageMeta {
    id: string;
    rfcMessageId: string;
    labelIds: string[];
    isRead: boolean;
    isStarred: boolean;
    hasAttachments: boolean;
    subject: string | null;
    snippet: string;
    date: number;
    fromAddress: string | null;
  }

  const allThreadable: ThreadableMessage[] = [];
  const allMeta = new Map<string, MessageMeta>();

  // Track RFC Message-ID → all label IDs from every folder copy.
  // This ensures labels aren't lost when the threading algorithm deduplicates
  // messages that exist in multiple IMAP folders (e.g., INBOX + Sent).
  const labelsByRfcId = new Map<string, Set<string>>();

  // Estimate total messages for progress
  let totalEstimate = 0;
  for (const folder of syncableFolders) {
    totalEstimate += folder.exists;
  }

  let fetchedTotal = 0;
  let totalMessagesFound = 0;
  let storedCount = 0;
  let consecutiveFailures = 0;
  const folderErrors: string[] = [];

  for (let folderIdx = 0; folderIdx < syncableFolders.length; folderIdx++) {
    const folder = syncableFolders[folderIdx]!;
    if (folder.exists === 0) continue;

    // Circuit breaker: skip remaining folders after too many consecutive failures
    if (consecutiveFailures >= CIRCUIT_BREAKER_MAX_FAILURES) {
      console.warn(
        `[imapSync] Circuit breaker: ${consecutiveFailures} consecutive connection failures, ` +
        `skipping remaining ${syncableFolders.length - folderIdx} folders`,
      );
      break;
    }

    // Circuit breaker: add cooldown delay after threshold failures
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      console.warn(
        `[imapSync] Circuit breaker: ${consecutiveFailures} consecutive failures, ` +
        `waiting ${CIRCUIT_BREAKER_DELAY_MS / 1000}s before next folder`,
      );
      await delay(CIRCUIT_BREAKER_DELAY_MS);
    }

    // Inter-folder delay to avoid connection bursts (skip before first folder)
    if (folderIdx > 0) {
      await delay(INTER_FOLDER_DELAY_MS);
    }

    const folderMapping = mapFolderToLabel(folder);

    try {
      // Phase 2a: Lightweight search — get UIDs only (no message bodies over IPC)
      const sinceDate = sinceDateForDaysBack(daysBack);
      const searchResult = await withSession(accountId, "sync", {}, (id) =>
        imapSearchFolder(id, folder.raw_path, sinceDate),
      );
      const uidsToFetch = searchResult.uids;

      // Reset circuit breaker on success
      consecutiveFailures = 0;

      if (uidsToFetch.length === 0) continue;

      // Date filter config. "All time" keeps every message the search returned
      // (SPEC-276 REQ-1.3) — a cutoff of 0 is below any real date.
      const cutoffDate = isAllTime(daysBack) ? 0 : Math.floor(Date.now() / 1000) - daysBack * 86400;
      const nowSeconds = Math.floor(Date.now() / 1000);
      let dateFallbackCount = 0;
      let folderFetchedCount = 0;
      let folderStoredCount = 0;
      let lastUid = 0;
      const uidvalidity = searchResult.folder_status.uidvalidity;

      // Phase 2b: Fetch messages in small IPC-friendly chunks
      for (let chunkStart = 0; chunkStart < uidsToFetch.length; chunkStart += CHUNK_SIZE) {
        const chunkUids = uidsToFetch.slice(chunkStart, chunkStart + CHUNK_SIZE);
        let chunkResult;
        try {
          chunkResult = await fetchMessagesPooled(accountId, folder.raw_path, chunkUids);
        } catch (chunkErr) {
          // Retry once for transient connection errors
          if (isConnectionError(chunkErr)) {
            console.warn(`[imapSync] Chunk fetch failed in ${folder.path}, retrying in 2s:`, chunkErr);
            await delay(2_000);
            try {
              chunkResult = await fetchMessagesPooled(accountId, folder.raw_path, chunkUids);
            } catch (retryErr) {
              console.error(`[imapSync] Chunk retry failed in ${folder.path}:`, retryErr);
              continue;
            }
          } else {
            console.error(`[imapSync] Failed to fetch chunk ${chunkStart}-${chunkStart + chunkUids.length} in ${folder.path}:`, chunkErr);
            continue;
          }
        }

        // Collect parsed data for this chunk to write in a single transaction
        const chunkParsed: { parsed: ParsedMessage; msg: ImapMessage; threadable: ThreadableMessage }[] = [];

        for (const msg of chunkResult.messages) {
          if (msg.uid > lastUid) lastUid = msg.uid;
          folderFetchedCount++;

          // Date filter
          if (msg.date === 0) {
            dateFallbackCount++;
            msg.date = nowSeconds;
          }
          if (msg.date < cutoffDate) continue;

          const { parsed, threadable } = imapMessageToParsedMessage(
            msg,
            accountId,
            folderMapping.labelId,
          );

          parsed.threadId = parsed.id; // placeholder — updated after threading
          chunkParsed.push({ parsed, msg, threadable });
        }

        // Write entire chunk to DB in a single transaction
        if (chunkParsed.length > 0) {
          await withTransaction(async (tx) => {
            for (const { parsed, msg } of chunkParsed) {
              // Create placeholder thread first to satisfy FK constraint
              await upsertThread({
                id: parsed.id,
                accountId,
                subject: parsed.subject,
                snippet: parsed.snippet,
                lastMessageAt: parsed.date,
                messageCount: 1,
                isRead: parsed.isRead,
                isStarred: parsed.isStarred,
                isImportant: false,
                hasAttachments: parsed.hasAttachments,
              }, tx);
              await upsertMessage({
                id: parsed.id,
                accountId,
                threadId: parsed.id,
                fromAddress: parsed.fromAddress,
                fromName: parsed.fromName,
                toAddresses: parsed.toAddresses,
                ccAddresses: parsed.ccAddresses,
                bccAddresses: parsed.bccAddresses,
                replyTo: parsed.replyTo,
                subject: parsed.subject,
                snippet: parsed.snippet,
                date: parsed.date,
                isRead: parsed.isRead,
                isStarred: parsed.isStarred,
                bodyHtml: parsed.bodyHtml,
                bodyText: parsed.bodyText,
                rawSize: parsed.rawSize,
                internalDate: parsed.internalDate,
                listUnsubscribe: parsed.listUnsubscribe,
                listUnsubscribePost: parsed.listUnsubscribePost,
                authResults: parsed.authResults,
                messageIdHeader: msg.message_id ?? null,
                referencesHeader: msg.references ?? null,
                inReplyToHeader: msg.in_reply_to ?? null,
                imapUid: msg.uid ?? null,
                imapFolder: msg.folder ?? null,
              }, tx);

              // Store attachments
              for (const att of parsed.attachments) {
                await upsertAttachment({
                  id: `${parsed.id}_${att.gmailAttachmentId}`,
                  messageId: parsed.id,
                  accountId,
                  filename: att.filename,
                  mimeType: att.mimeType,
                  size: att.size,
                  gmailAttachmentId: att.gmailAttachmentId,
                  contentId: att.contentId,
                  isInline: att.isInline,
                }, tx);
              }
            }
          });
        }

        // Keep only lightweight data in memory for threading
        for (const { parsed, threadable } of chunkParsed) {
          const meta: MessageMeta = {
            id: parsed.id,
            rfcMessageId: threadable.messageId,
            labelIds: parsed.labelIds,
            isRead: parsed.isRead,
            isStarred: parsed.isStarred,
            hasAttachments: parsed.hasAttachments,
            subject: parsed.subject,
            snippet: parsed.snippet,
            date: parsed.date,
            fromAddress: parsed.fromAddress,
          };
          allMeta.set(parsed.id, meta);
          allThreadable.push(threadable);

          // Build cross-folder label map
          let labels = labelsByRfcId.get(threadable.messageId);
          if (!labels) {
            labels = new Set();
            labelsByRfcId.set(threadable.messageId, labels);
          }
          for (const lid of parsed.labelIds) {
            labels.add(lid);
          }
        }

        folderStoredCount += chunkParsed.length;
        storedCount += chunkParsed.length;

        // Report progress after each chunk (not just each folder)
        onProgress?.({
          phase: "messages",
          current: fetchedTotal + Math.min(chunkStart + CHUNK_SIZE, uidsToFetch.length),
          total: totalEstimate,
          folder: folder.path,
        });
      }

      totalMessagesFound += folderFetchedCount;
      fetchedTotal += uidsToFetch.length;

      if (dateFallbackCount > 0) {
        console.warn(
          `[imapSync] Folder ${folder.path}: ${dateFallbackCount}/${folderFetchedCount} messages had unparseable dates, using current time as fallback`,
        );
      }

      console.log(
        `[imapSync] Folder ${folder.path}: ${uidsToFetch.length} UIDs, ${folderFetchedCount} fetched, ${folderStoredCount} after date filter`,
      );

      // Update folder sync state
      await upsertFolderSyncState({
        account_id: accountId,
        folder_path: folder.raw_path,
        uidvalidity,
        last_uid: lastUid,
        modseq: null,
        last_sync_at: Math.floor(Date.now() / 1000),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err ?? "Unknown error");
      console.error(`[imapSync] Failed to sync folder ${folder.path}:`, err);
      folderErrors.push(`${folder.path}: ${errMsg}`);
      if (isConnectionError(err)) {
        consecutiveFailures++;
      }
      // Continue with next folder
    }
  }

  // If no messages were stored and every folder failed, propagate the error
  if (storedCount === 0 && folderErrors.length > 0) {
    throw new Error(`All folders failed to sync: ${folderErrors[0]}`);
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Thread messages (lightweight — only IDs + headers in memory)
  // ---------------------------------------------------------------------------
  onProgress?.({ phase: "threading", current: 0, total: allThreadable.length });
  const threadGroups = buildThreads(allThreadable);
  console.log(
    `[imapSync] Threading: ${allThreadable.length} messages → ${threadGroups.length} thread groups`,
  );

  // ---------------------------------------------------------------------------
  // Phase 4: Create thread records + batch-update message thread IDs
  // ---------------------------------------------------------------------------
  onProgress?.({ phase: "storing_threads", current: 0, total: threadGroups.length });

  for (let batchStart = 0; batchStart < threadGroups.length; batchStart += THREAD_BATCH_SIZE) {
    const batch = threadGroups.slice(batchStart, batchStart + THREAD_BATCH_SIZE);

    // Pre-check pending ops OUTSIDE the transaction to avoid nested DB issues
    const skippedThreadIds = new Set<string>();
    for (const group of batch) {
      const pendingOps = await getPendingOpsForResource(accountId, group.threadId);
      if (pendingOps.length > 0) {
        console.log(`[imapSync] Skipping thread ${group.threadId}: has ${pendingOps.length} pending local ops`);
        skippedThreadIds.add(group.threadId);
      }
    }

    await withTransaction(async (tx) => {
      for (const group of batch) {
        if (skippedThreadIds.has(group.threadId)) continue;

        const messages = group.messageIds
          .map((id) => allMeta.get(id))
          .filter((m): m is MessageMeta => m !== undefined);

        if (messages.length === 0) continue;

        // Sort by date ascending
        messages.sort((a, b) => a.date - b.date);

        const firstMessage = messages[0]!;
        const lastMessage = messages[messages.length - 1]!;

        // Collect all label IDs including cross-folder copies
        const allLabelIds = new Set<string>();
        for (const msg of messages) {
          for (const lid of msg.labelIds) {
            allLabelIds.add(lid);
          }
          const extraLabels = labelsByRfcId.get(msg.rfcMessageId);
          if (extraLabels) {
            for (const lid of extraLabels) {
              allLabelIds.add(lid);
            }
          }
        }

        const isRead = messages.every((m) => m.isRead);
        const isStarred = messages.some((m) => m.isStarred);
        const hasAttachments = messages.some((m) => m.hasAttachments);

        // SPEC-F-1 REQ-1.3 — decided before upsertThread overwrites last_message_at.
        await clearSnoozeForNewExternalMessages(
          accountId,
          group.threadId,
          messages.map((m) => ({ id: m.id, fromAddress: m.fromAddress })),
          ownAddresses,
          tx,
        );

        await upsertThread({
          id: group.threadId,
          accountId,
          subject: firstMessage.subject,
          snippet: lastMessage.snippet,
          lastMessageAt: lastMessage.date,
          messageCount: messages.length,
          isRead,
          isStarred,
          isImportant: false,
          hasAttachments,
        }, tx);

        await setThreadLabels(accountId, group.threadId, [...allLabelIds], tx);

        // Batch-update thread IDs for all messages in this thread
        const messageIds = messages.map((m) => m.id);
        await updateMessageThreadIds(accountId, messageIds, group.threadId, tx);
      }
    });

    onProgress?.({
      phase: "storing_threads",
      current: Math.min(batchStart + THREAD_BATCH_SIZE, threadGroups.length),
      total: threadGroups.length,
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 5: Clean up orphaned placeholder threads
  // ---------------------------------------------------------------------------
  // Phase 2 created a placeholder thread per message (threadId = messageId).
  // Phase 4 merged messages into real threads and updated message thread IDs.
  // Placeholder threads that are no longer referenced by any final thread group
  // should be deleted to avoid ghost threads in the UI.
  const finalThreadIds = new Set(threadGroups.map((g) => g.threadId));
  const allMessageIds = new Set(allMeta.keys());
  let orphanCount = 0;
  for (const msgId of allMessageIds) {
    // If this message's placeholder ID isn't a final thread ID, it's orphaned
    if (!finalThreadIds.has(msgId)) {
      await deleteThread(accountId, msgId);
      orphanCount++;
    }
  }
  if (orphanCount > 0) {
    console.log(`[imapSync] Cleaned up ${orphanCount} orphaned placeholder threads`);
  }

  console.log(
    `[imapSync] Stored ${storedCount} messages in ${threadGroups.length} threads (found ${totalMessagesFound} on server)`,
  );

  // Only mark sync as complete if messages were stored OR no messages exist on server.
  if (storedCount > 0 || totalMessagesFound === 0) {
    await updateAccountSyncState(accountId, `imap-synced-${Date.now()}`);
  } else {
    console.warn(
      `[imapSync] Found ${totalMessagesFound} messages on server but stored 0 — NOT marking sync as complete so it will be retried`,
    );
  }

  onProgress?.({
    phase: "done",
    current: storedCount,
    total: storedCount,
  });

  return { messages: [] };
}

// ---------------------------------------------------------------------------
// Delta sync
// ---------------------------------------------------------------------------

/**
 * Perform delta sync for an IMAP account.
 * Fetches only new messages since the last sync using stored UID state.
 */
export async function imapDeltaSync(accountId: string, daysBack = 365): Promise<SyncResult> {
  const account = await getAccount(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }


  // Get all folders we've synced before
  const syncStates = await getAllFolderSyncStates(accountId);

  // Also check for any new folders
  // One command per `withSession`, so a pool error is always safe to retry.
  const allFolders = await withSession(accountId, "sync", {}, (id) => imapListFolders(id));
  const syncableFolders = getSyncableFolders(allFolders);
  await syncFoldersToLabels(accountId, syncableFolders);

  const syncStateMap = new Map(syncStates.map((s) => [s.folder_path, s]));

  const allParsed = new Map<string, ParsedMessage>();
  const allThreadable: ThreadableMessage[] = [];
  const allImapMsgs = new Map<string, ImapMessage>();

  // F-4: one reconciliation pass per delta sync, one pass id for every folder.
  const pass = beginReconcilePass(accountId);
  const checkedFolders = new Set<string>();

  // F-4 part 3, the "folder gone" path: a folder with sync state that this
  // LIST did not return. One miss leaves it unchecked (this pass cannot
  // attest); a second consecutive miss removes its sync state so attestation
  // can resume, keeping its messages. A folder the LIST did return resets.
  // A LIST that drops most known folders is short, not a mass deletion, and
  // counts nothing (Grok H2 on #50). A folder still in the raw LIST but no
  // longer syncable is told apart in the notice only: it cannot be checked
  // either way, so it leaves the known set the same way.
  const listedPaths = new Set(syncableFolders.map((f) => f.raw_path));
  const serverPaths = new Set(allFolders.map((f) => f.raw_path));
  const omitted = syncStates.filter((s) => !listedPaths.has(s.folder_path));
  if (folderListLooksPartial(omitted.length, syncStates.length, syncableFolders.length)) {
    console.warn(
      `[imapSync] LIST omitted ${omitted.length} of ${syncStates.length} synced folder(s); treating it as partial — nothing counted or removed`,
    );
  } else {
    for (const state of syncStates) {
      if (listedPaths.has(state.folder_path)) {
        if ((state.missing_passes ?? 0) > 0) await clearFolderMissing(accountId, state.folder_path);
        continue;
      }
      const stillListed = serverPaths.has(state.folder_path);
      if ((await noteFolderMissing(accountId, state.folder_path, stillListed)) === "removed") {
        syncStateMap.delete(state.folder_path);
      }
    }
  }

  // Separate folders into new (no saved state) vs existing (have saved state)
  const newFolders = syncableFolders.filter((f) => !syncStateMap.has(f.raw_path));
  const existingFolders = syncableFolders.filter((f) => syncStateMap.has(f.raw_path));

  // Handle new folders: search for UIDs then fetch in chunks
  let consecutiveFailures = 0;
  const deltaFolderErrors: string[] = [];
  for (const folder of newFolders) {
    // Circuit breaker: skip remaining new folders after too many failures
    if (consecutiveFailures >= CIRCUIT_BREAKER_MAX_FAILURES) {
      console.warn(
        `[imapSync] Delta sync circuit breaker: ${consecutiveFailures} consecutive failures, skipping remaining new folders`,
      );
      break;
    }
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      await delay(CIRCUIT_BREAKER_DELAY_MS);
    }

    const folderMapping = mapFolderToLabel(folder);
    try {
      const sinceDate = sinceDateForDaysBack(daysBack);
      const searchResult = await withSession(accountId, "sync", {}, (id) =>
        imapSearchFolder(id, folder.raw_path, sinceDate),
      );
      consecutiveFailures = 0;

      if (searchResult.uids.length === 0) continue;

      const { messages, lastUid } = await fetchMessagesInBatches(
        accountId,
        folder.raw_path,
        searchResult.uids,
      );

      for (const msg of messages) {
        const { parsed, threadable } = imapMessageToParsedMessage(
          msg,
          accountId,
          folderMapping.labelId,
        );
        allParsed.set(parsed.id, parsed);
        allThreadable.push(threadable);
        allImapMsgs.set(parsed.id, msg);
      }

      await upsertFolderSyncState({
        account_id: accountId,
        folder_path: folder.raw_path,
        uidvalidity: searchResult.folder_status.uidvalidity,
        last_uid: lastUid,
        modseq: null,
        last_sync_at: Math.floor(Date.now() / 1000),
      });
      // A freshly synced folder has no suspects to age; it counts as checked
      // for the attestation only because it completed (a throw lands below).
      checkedFolders.add(folder.raw_path);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err ?? "Unknown error");
      console.error(`Delta sync failed for new folder ${folder.path}:`, err);
      deltaFolderErrors.push(`${folder.path}: ${errMsg}`);
      if (isConnectionError(err)) {
        consecutiveFailures++;
      }
    }
  }

  // Batch-check existing folders in a single IMAP connection.
  // Falls back to per-folder checks if the batch command fails.
  if (existingFolders.length > 0) {
    const deltaRequests: DeltaCheckRequest[] = existingFolders.map((folder) => {
      const savedState = syncStateMap.get(folder.raw_path)!;
      return {
        folder: folder.raw_path,
        last_uid: savedState.last_uid,
        uidvalidity: savedState.uidvalidity ?? 0,
      };
    });

    let deltaResultMap: Map<string, DeltaCheckResult>;
    try {
      const deltaResults = await withSession(accountId, "sync", {}, (id) => imapDeltaCheck(id, deltaRequests));
      deltaResultMap = new Map(deltaResults.map((r) => [r.folder, r]));
      // F-4 REQ-1.2b: the count is of folders actually checked, and each
      // unchecked one names its reason — a pass missing folders no longer
      // reads as clean.
      const checked = deltaResults.filter((r) => r.checked);
      console.log(`[imapSync] Batch delta check: ${checked.length}/${existingFolders.length} folders checked`);
      for (const r of deltaResults) {
        if (!r.checked) console.warn(`[imapSync] Delta check did not cover ${r.folder}: ${r.error ?? "unknown"}`);
      }
    } catch (err) {
      // Batch check failed — fall back to per-folder checks
      console.warn(`[imapSync] Batch delta check failed, falling back to per-folder:`, err);
      deltaResultMap = new Map();
      for (const folder of existingFolders) {
        const savedState = syncStateMap.get(folder.raw_path)!;
        try {
          const currentStatus = await withSession(accountId, "sync", {}, (id) =>
            imapGetFolderStatus(id, folder.raw_path),
          );
          const uidvalidityChanged =
            savedState.uidvalidity !== null &&
            currentStatus.uidvalidity !== savedState.uidvalidity;

          if (uidvalidityChanged) {
            deltaResultMap.set(folder.raw_path, {
              folder: folder.raw_path,
              uidvalidity: currentStatus.uidvalidity,
              new_uids: [],
              uidvalidity_changed: true,
              exists: currentStatus.exists,
              checked: true,
              error: null,
            });
          } else {
            const newUids = await withSession(accountId, "sync", {}, (id) =>
              imapFetchNewUids(id, folder.raw_path, savedState.last_uid),
            );
            deltaResultMap.set(folder.raw_path, {
              folder: folder.raw_path,
              uidvalidity: currentStatus.uidvalidity,
              new_uids: newUids,
              uidvalidity_changed: false,
              exists: currentStatus.exists,
              checked: true,
              error: null,
            });
          }
        } catch (folderErr) {
          console.error(`[imapSync] Per-folder check failed for ${folder.path}:`, folderErr);
          // F-4 REQ-1.2b: an omission would let part 2's attestation read a
          // failed folder as never requested. Record it as unchecked.
          deltaResultMap.set(folder.raw_path, {
            folder: folder.raw_path,
            uidvalidity: savedState.uidvalidity ?? 0,
            new_uids: [],
            uidvalidity_changed: false,
            exists: null,
            checked: false,
            error: folderErr instanceof Error ? folderErr.message : String(folderErr),
          });
        }
      }
    }

    for (const folder of existingFolders) {
      const folderMapping = mapFolderToLabel(folder);
      const savedState = syncStateMap.get(folder.raw_path)!;
      const deltaResult = deltaResultMap.get(folder.raw_path);

      // An unchecked folder carries no observation to act on (F-4 REQ-1.2b).
      if (!deltaResult || !deltaResult.checked) continue;
      // A checked folder always carries EXISTS from Rust. Without it the gate
      // cannot judge anything, so the folder counts as unchecked rather than
      // as "nothing vanished" (Grok M4 on #50).
      const exists = deltaResult.exists;
      if (exists === null || exists === undefined) {
        console.warn(`[imapSync] ${folder.path}: delta check reported no EXISTS; treating the folder as unchecked`);
        continue;
      }
      checkedFolders.add(folder.raw_path);

      try {
        if (deltaResult.uidvalidity_changed) {
          // UIDVALIDITY changed — full resync of this folder
          console.warn(
            `UIDVALIDITY changed for folder ${folder.path} ` +
              `(was ${savedState.uidvalidity}, now ${deltaResult.uidvalidity}). ` +
              `Doing full resync of this folder.`,
          );
          // F-4 REQ-1.4/1.5: a regenerated mailbox reuses UIDs, so every
          // suspect recorded under the old generation — and any stop raised
          // on them — is void. The gate does not run for this folder this
          // pass; the resync below is the observation.
          await invalidateFolderSuspects(accountId, folder.raw_path, deltaResult.uidvalidity);
          const sinceDate = sinceDateForDaysBack(daysBack);
          const searchResult = await withSession(accountId, "sync", {}, (id) =>
        imapSearchFolder(id, folder.raw_path, sinceDate),
      );
          if (searchResult.uids.length === 0) continue;

          const { messages, lastUid } = await fetchMessagesInBatches(
            accountId,
            folder.raw_path,
            searchResult.uids,
          );

          for (const msg of messages) {
            const { parsed, threadable } = imapMessageToParsedMessage(
              msg,
              accountId,
              folderMapping.labelId,
            );
            allParsed.set(parsed.id, parsed);
            allThreadable.push(threadable);
            allImapMsgs.set(parsed.id, msg);
          }

          await upsertFolderSyncState({
            account_id: accountId,
            folder_path: folder.raw_path,
            uidvalidity: searchResult.folder_status.uidvalidity,
            last_uid: lastUid,
            modseq: null,
            last_sync_at: Math.floor(Date.now() / 1000),
          });
          continue;
        }

        // F-4 REQ-2.1: does the server hold what we think it holds? If not,
        // fetch the full UID list and record what vanished (REQ-1.1). A throw
        // here is a folder error: the folder's gate opened but it was not
        // listed, so the pass cannot attest and nothing is deleted.
        const liveCount = (await getLiveMessagesInFolder(accountId, folder.raw_path)).length;
        const passNumber = await bumpReconcilePasses(accountId, folder.raw_path);
        const forced = (savedState.force_list ?? 0) !== 0;
        let gateOpen =
          forced ||
          shouldListFolder(
            exists,
            liveCount,
            deltaResult.new_uids.length,
            savedState.flagged_not_expunged ?? 0,
          );

        // F-4 REQ-2.3: on a no-UIDPLUS folder the counter drifts with other
        // clients' `\Deleted` flags. Every Nth pass, when the gate would open,
        // ask the cheap question first — how many messages are NOT deleted —
        // and recompute the counter from it. If that count matches what Velo
        // holds plus the new mail it is about to fetch, nothing vanished and
        // the full list is skipped. A forced list is never belted.
        if (gateOpen && !forced && beltDue(passNumber, savedState.flagged_not_expunged ?? 0)) {
          const notDeleted = await withSession(accountId, "sync", {}, (id) =>
            imapCountNotDeleted(id, folder.raw_path),
          );
          const ghosts = Math.max(0, exists - notDeleted);
          await setFlaggedNotExpunged(accountId, folder.raw_path, ghosts);
          if (notDeleted === liveCount + deltaResult.new_uids.length) {
            gateOpen = false;
            console.debug(`[imapSync] ${folder.path}: NOT DELETED count agrees, skipping the full list`);
          }
        }

        if (gateOpen) {
          pass.gateOpened.add(folder.raw_path);
          const serverUids = await withSession(accountId, "sync", {}, (id) =>
            imapSearchAllUids(id, folder.raw_path),
          );
          await reconcileFolderList(
            pass,
            folder.raw_path,
            deltaResult.uidvalidity,
            serverUids,
            exists,
          );
          if (forced) await setForceList(accountId, folder.raw_path, false);
        }

        // Normal delta: fetch the new UIDs returned by delta check
        if (deltaResult.new_uids.length === 0) {
          markFetchCompleted(pass, folder.raw_path);
          continue;
        }

        const { messages, lastUid, uidvalidity } = await fetchMessagesInBatches(
          accountId,
          folder.raw_path,
          deltaResult.new_uids,
        );
        markFetchCompleted(pass, folder.raw_path);

        for (const msg of messages) {
          const { parsed, threadable } = imapMessageToParsedMessage(
            msg,
            accountId,
            folderMapping.labelId,
          );
          allParsed.set(parsed.id, parsed);
          allThreadable.push(threadable);
          allImapMsgs.set(parsed.id, msg);
        }

        await upsertFolderSyncState({
          account_id: accountId,
          folder_path: folder.raw_path,
          uidvalidity,
          last_uid: Math.max(savedState.last_uid, lastUid),
          modseq: null,
          last_sync_at: Math.floor(Date.now() / 1000),
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err ?? "Unknown error");
        console.error(`Delta sync failed for folder ${folder.path}:`, err);
        deltaFolderErrors.push(`${folder.path}: ${errMsg}`);
      }
    }
  }

  // F-4 end of pass. Attestation (REQ-1.2b): every folder Velo knows about —
  // this LIST's syncable folders and every folder with sync state — produced
  // an observation, every opened gate was listed, and no folder failed
  // anywhere in the pass. Counters are recomputed either way; deletion needs
  // the attestation. `settleReconcile` runs in the `finally` below, so it
  // covers every exit — including a throw in threading or the store, where a
  // pass that did not finish cleanly is not attested — and never fails the
  // sync itself.
  let attested = attestPass(
    pass,
    [...syncableFolders.map((f) => f.raw_path), ...syncStateMap.keys()],
    checkedFolders,
    deltaFolderErrors.length,
  );
  const settleReconcile = async () => {
    try {
      const summary = await finishReconcilePass(pass, attested);
      if (summary.deleted.length > 0 || summary.stops.length > 0) {
        console.info(
          `[imapSync] Reconciliation: ${summary.deleted.length} vanished message(s) removed, ${summary.stops.length} folder(s) stopped for confirmation`,
        );
      }
    } catch (err) {
      console.error("[imapSync] Reconciliation pass failed; nothing was deleted:", err);
    }
  };

  try {
    return await storeDeltaResults(accountId, allParsed, allThreadable, allImapMsgs, deltaFolderErrors);
  } catch (err) {
    attested = false;
    throw err;
  } finally {
    await settleReconcile();
  }
}

/** The tail of a delta pass: thread and store what was fetched. */
async function storeDeltaResults(
  accountId: string,
  allParsed: Map<string, ParsedMessage>,
  allThreadable: ThreadableMessage[],
  allImapMsgs: Map<string, ImapMessage>,
  deltaFolderErrors: string[],
): Promise<SyncResult> {
  // If no new messages found and every folder errored, propagate the error
  if (allThreadable.length === 0 && deltaFolderErrors.length > 0) {
    throw new Error(`All folders failed to sync: ${deltaFolderErrors[0]}`);
  }

  if (allThreadable.length === 0) {
    return { messages: [] };
  }

  // Build RFC Message-ID → labels map for cross-folder label merging
  const labelsByRfcId = new Map<string, Set<string>>();
  for (const threadable of allThreadable) {
    const parsed = allParsed.get(threadable.id);
    if (!parsed) continue;
    let labels = labelsByRfcId.get(threadable.messageId);
    if (!labels) {
      labels = new Set();
      labelsByRfcId.set(threadable.messageId, labels);
    }
    for (const lid of parsed.labelIds) {
      labels.add(lid);
    }
  }

  // Thread the new messages
  const threadGroups = buildThreads(allThreadable);

  // Store in DB
  const storedMessages = await storeThreadsAndMessages(
    accountId,
    threadGroups,
    allParsed,
    allImapMsgs,
    labelsByRfcId,
  );

  // Update sync state timestamp
  await updateAccountSyncState(accountId, `imap-synced-${Date.now()}`);

  return { messages: storedMessages };
}
