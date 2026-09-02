/**
 * Pooled IMAP session lifecycle, frontend half (brief E2/P15, rev 4).
 *
 * Rust keeps authenticated sessions alive; this module decides when to open
 * one, which cached id to reuse, and — the part that matters — when it is safe
 * to retry an operation whose session died underneath it.
 *
 * Two sessions per account, by kind. A 200-message fetch holds its session for
 * seconds, so an archive click must not queue behind it.
 *
 * # Retry policy is about idempotency, not about errors
 *
 * `NoSuchSession` means the session is gone: evicted after an error,
 * cancelled, reaped, or lost to a restart. Reopening is always safe. **Re-running
 * the operation is not**, and the two exclusions are not stylistic:
 *
 * - `imap_append_message` — if APPEND landed server-side but the connection
 *   died before the tagged response, a retry writes a *second* copy to Sent.
 *   A missing Sent copy is already tolerated by the caller; a silent duplicate
 *   is worse.
 * - `imap_move_messages` — the MOVE-extension path is retry-safe, but the COPY
 *   fallback is not: COPY succeeds, the session dies before the EXPUNGE, and
 *   the retry copies every message a second time. The frontend cannot tell
 *   which path the server took, so the whole command is non-retryable.
 *
 * `imap_set_flags` and `imap_delete_messages` are safe: UID STORE on
 * nonexistent UIDs is a no-op (RFC 3501 §6.4.8) and EXPUNGE is idempotent.
 */
import type { DbAccount } from "../db/accounts";
import { getAccount } from "../db/accounts";
import { buildImapConfigWithFreshToken } from "./imapConfigBuilder";
import {
  imapSessionOpen,
  imapSessionClose,
  imapSessionsInvalidate,
} from "./tauriCommands";

/** Which of an account's two sessions to use. */
export type SessionKind = "sync" | "interactive";

export type SessionId = string;

/** Errors the Rust pool returns by name. */
const NO_SUCH_SESSION = "NoSuchSession";
const SESSION_BUSY = "SessionBusy";
const TOO_MANY_SESSIONS = "TooManySessions";

function isPoolError(err: unknown, name: string): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(name);
}

/** `accountId::kind` — one cache slot per session the pool may hold for us. */
type CacheKey = string;

const sessions = new Map<CacheKey, SessionId>();

/** Accounts whose identity we know, so invalidation can reach the pool. */
const accountIdents = new Map<string, { username: string; host: string }>();

function cacheKey(accountId: string, kind: SessionKind): CacheKey {
  return `${accountId}::${kind}`;
}

async function openSession(accountId: string, kind: SessionKind): Promise<SessionId> {
  const account: DbAccount | null = await getAccount(accountId);
  if (!account) throw new Error(`Account ${accountId} not found`);

  // Always through the fresh-token builder (Decision 3): a pooled session may
  // outlive the access token that opened it, but it must never be *opened*
  // with a stale one.
  const config = await buildImapConfigWithFreshToken(account);
  const id = await imapSessionOpen(config);

  sessions.set(cacheKey(accountId, kind), id);
  accountIdents.set(accountId, { username: config.username, host: config.host });
  return id;
}

async function sessionFor(accountId: string, kind: SessionKind): Promise<SessionId> {
  const cached = sessions.get(cacheKey(accountId, kind));
  return cached ?? (await openSession(accountId, kind));
}

/** Forget a cached id without asking Rust to close it (it is already gone). */
function forget(accountId: string, kind: SessionKind): void {
  sessions.delete(cacheKey(accountId, kind));
}

export interface WithSessionOptions {
  /**
   * Whether re-running `fn` after a lost session can duplicate a server-side
   * effect. `false` surfaces the error instead of retrying — see the module
   * comment for the two commands this exists for.
   */
  idempotent: boolean;
}

/**
 * Run one IMAP operation against a pooled session.
 *
 * Opens lazily, reopens once if the session vanished, and retries the operation
 * itself **only when it is safe to**.
 */
export async function withSession<T>(
  accountId: string,
  kind: SessionKind,
  opts: WithSessionOptions,
  fn: (id: SessionId) => Promise<T>,
): Promise<T> {
  const id = await sessionFor(accountId, kind);

  try {
    return await fn(id);
  } catch (err) {
    if (isPoolError(err, NO_SUCH_SESSION)) {
      // The session is gone. Reopening is always safe; re-running is not.
      forget(accountId, kind);
      const fresh = await openSession(accountId, kind);
      if (!opts.idempotent) {
        throw err;
      }
      return await fn(fresh);
    }

    if (isPoolError(err, SESSION_BUSY)) {
      // Rev 4: checkout removes the entry, so a concurrent operation is refused
      // rather than queued. The session is alive — retry it, never reopen, and
      // only when re-running is safe.
      if (!opts.idempotent) {
        throw err;
      }
      return await fn(id);
    }

    if (isPoolError(err, TOO_MANY_SESSIONS)) {
      // Every session for this account is in flight. Give up our own slot and
      // try once more rather than surfacing an error the user cannot act on.
      await closeSession(accountId, kind);
      const fresh = await openSession(accountId, kind);
      return await fn(fresh);
    }

    throw err;
  }
}

/** Close one cached session, if we hold one. */
export async function closeSession(accountId: string, kind: SessionKind): Promise<void> {
  const id = sessions.get(cacheKey(accountId, kind));
  if (!id) return;
  forget(accountId, kind);
  await imapSessionClose(id);
}

/** Close both of an account's sessions — account deletion, sign-out. */
export async function closeAccountSessions(accountId: string): Promise<void> {
  await closeSession(accountId, "sync");
  await closeSession(accountId, "interactive");
}

/**
 * Drop every session authenticated with an account's previous credential.
 *
 * Called on password change (`clearConfigCache`) and on OAuth refresh failure,
 * which is the revocation case: a pooled session outlives the token that opened
 * it, so revocation has to reach the pool explicitly or the connection keeps
 * working after the user revoked it.
 */
export async function invalidateAccountCredentials(accountId: string): Promise<void> {
  const ident = accountIdents.get(accountId);
  forget(accountId, "sync");
  forget(accountId, "interactive");
  if (!ident) return;
  await imapSessionsInvalidate(ident.username, ident.host);
}

/** Close everything. App quit, and the reset point for tests. */
export async function closeAllSessions(): Promise<void> {
  const ids = [...sessions.values()];
  sessions.clear();
  accountIdents.clear();
  await Promise.all(ids.map((id) => imapSessionClose(id)));
}

/** Test seam: what the cache currently holds. */
export function __sessionCacheForTests(): Map<CacheKey, SessionId> {
  return sessions;
}
