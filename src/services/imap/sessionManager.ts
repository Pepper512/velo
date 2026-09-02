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
 * # Where the duplicate-mail guard actually lives
 *
 * Rev 1 of the brief specified retry-by-idempotency, and the first cut of this
 * module put that gate on the pool errors. **That was the wrong error class.**
 *
 * `NoSuchSession` and `SessionBusy` are raised by the pool's `acquire`, which
 * runs *before the connection is touched* — checkout is a `HashMap` operation.
 * So when either surfaces, **the command never reached the server**, and
 * re-running it cannot duplicate anything. Gating them on idempotency does not
 * make APPEND safer; it just makes the first archive after a 300 s idle reap
 * fail in the user's face for no reason.
 *
 * The duplicate risk lives in **mid-operation** failure — APPEND lands
 * server-side, the connection dies before the tagged response. That surfaces as
 * an ordinary IMAP error, not a pool error, and this module passes those
 * straight through **without any retry**. That pass-through, not a flag, is what
 * satisfies Done-when 6:
 *
 * - `imap_append_message` — a retry would write a second copy to Sent. A
 *   *missing* Sent copy is already tolerated by the caller; a silent duplicate
 *   is worse.
 * - `imap_move_messages` — the MOVE-extension path is retry-safe, the COPY
 *   fallback is not, and the frontend cannot tell which the server took.
 *
 * # The precondition that makes retry sound
 *
 * All of the above holds **only because `fn` wraps exactly one command.** If a
 * caller puts two server-visible commands in one `fn`, a retry re-runs the
 * first — which is the duplicate bug arriving by a different road. Such a caller
 * must pass `retrySafe: false`.
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

/**
 * Pool sentinels, namespaced by Rust and matched here **exactly**.
 *
 * Pool errors and operation errors share one `Result<T, String>` channel, and
 * the operation half carries server-supplied text — mailbox names, `NO`
 * responses. Retry safety depends on telling the two apart, so a loose
 * `includes()` would let a server spell a sentinel and decide whether Velo
 * retries. For APPEND that is a duplicate in Sent. An IMAP failure is always
 * `"<operation> failed: <detail>"` and can never equal one of these.
 *
 * Cross-vendor review finding 2 on PR #39, which is the finding that undercut
 * the pre-I/O retry argument rather than merely nitpicking it.
 */
const NO_SUCH_SESSION = "velo:pool:NoSuchSession";
const SESSION_BUSY = "velo:pool:SessionBusy";
const TOO_MANY_SESSIONS = "velo:pool:TooManySessions";

/**
 * Pause before retrying a busy session.
 *
 * The holder is doing network I/O; retrying in the same tick just loses the
 * race again. Short enough that a user waiting on an archive does not notice.
 */
const SESSION_BUSY_BACKOFF_MS = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPoolError(err: unknown, name: string): boolean {
  const message = err instanceof Error ? err.message : String(err);
  // Exact, not `includes`: see the comment on the sentinels above.
  return message.trim() === name;
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
   * Whether re-running `fn` from the start is safe.
   *
   * Defaults to `true`, which is correct for the ordinary case of `fn` wrapping
   * a single command: pool errors are raised before the connection is touched,
   * so nothing reached the server. Pass `false` only when `fn` performs **more
   * than one** server-visible command, where a retry would re-run the earlier
   * ones.
   */
  retrySafe?: boolean;
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
  const retrySafe = opts.retrySafe ?? true;

  let id: SessionId;
  try {
    id = await sessionFor(accountId, kind);
  } catch (err) {
    // `TooManySessions` comes from `insert` during the *open*, so it surfaces
    // here rather than from the operation. Give up this realm's slot and try
    // once more rather than showing an error the user cannot act on.
    if (!isPoolError(err, TOO_MANY_SESSIONS)) throw err;
    await closeSession(accountId, kind);
    id = await openSession(accountId, kind);
  }

  try {
    return await fn(id);
  } catch (err) {
    // Pool errors are raised before the connection is touched, so the command
    // never reached the server and re-running it duplicates nothing. The only
    // reason to refuse is a caller that wrapped several commands in one `fn`.
    if (isPoolError(err, NO_SUCH_SESSION)) {
      forget(accountId, kind);
      const fresh = await openSession(accountId, kind);
      if (!retrySafe) throw err;
      return await fn(fresh);
    }

    if (isPoolError(err, SESSION_BUSY)) {
      // Checkout removes the entry, so a concurrent operation is refused rather
      // than queued. The session is alive — retry it, never reopen. Back off
      // first: an immediate retry races the same in-flight network operation
      // and loses again.
      if (!retrySafe) throw err;
      await delay(SESSION_BUSY_BACKOFF_MS);
      return await fn(id);
    }

    // Anything else is the operation's own failure, mid-protocol. It may have
    // landed server-side, so it is surfaced and never retried — this is the
    // line that keeps APPEND from duplicating into Sent.
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
