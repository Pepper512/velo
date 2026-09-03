/**
 * Instant Intro (SPEC-II): one action that answers an introduction the way
 * etiquette wants — reply to everyone, move the introducer to Bcc, open with
 * thanks by name.
 *
 * Pure, so the thread view can call it and a test can drive it without React.
 * `replyAllRecipients` is the reply-all rule the four existing copies
 * (ThreadView, InlineReply, the two context menus) compute by hand; they can
 * move onto it in a later, behaviour-preserving pass.
 */
import type { DbMessage } from "../db/messages";
import type { SendAsAlias } from "../db/sendAsAliases";
import type { ComposerState } from "@/stores/composerStore";
import { bareAddress } from "@/utils/emailUtils";
import { escapeHtml } from "@/utils/sanitize";
import { resolveFromAddress } from "@/utils/resolveFromAddress";
import { isNoReplyAddress } from "@/utils/noReply";

/** The message fields the rule reads. */
export type IntroSource = Pick<
  DbMessage,
  "from_address" | "from_name" | "reply_to" | "to_addresses" | "cc_addresses" | "subject"
>;

export interface InstantIntro {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  introducerName: string;
  openerHtml: string;
}

/** A comma-joined header → its chips, trimmed, empties dropped. */
function splitHeader(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((chip) => chip.trim())
    .filter((chip) => chip.length > 0);
}

/**
 * Keep each address once (by bare, lower-cased address), first chip wins,
 * skipping anything in `exclude`. Returns the kept chips and the set of
 * bare addresses now seen, so To and Cc can share one dedupe.
 */
function dedupe(chips: string[], exclude: Set<string>, seen: Set<string>): string[] {
  const kept: string[] = [];
  for (const chip of chips) {
    const addr = bareAddress(chip);
    if (!addr || exclude.has(addr) || seen.has(addr)) continue;
    seen.add(addr);
    kept.push(chip);
  }
  return kept;
}

/** The address a reply goes to: `reply_to`, else `from_address`; blanks count as absent. */
function replyTarget(message: IntroSource): string | null {
  const replyTo = message.reply_to?.trim();
  const from = message.from_address?.trim();
  return replyTo || from || null;
}

/**
 * Reply All's recipients: the reply target first, then the To header, then
 * the Cc header — with the account's own addresses removed and each address
 * kept once.
 */
export function replyAllRecipients(
  message: IntroSource,
  ownAddresses: string[],
): { to: string[]; cc: string[] } {
  const own = new Set(ownAddresses.map(bareAddress));
  const seen = new Set<string>();
  const target = replyTarget(message);
  const to = dedupe([...(target ? [target] : []), ...splitHeader(message.to_addresses)], own, seen);
  const cc = dedupe(splitHeader(message.cc_addresses), own, seen);
  return { to, cc };
}

/**
 * REQ-2.1: the first word of the display name — quotes and punctuation
 * around it dropped — else the address's local part.
 */
export function introducerFirstName(fromName: string | null, address: string): string {
  const first = fromName
    ?.trim()
    .split(/\s+/)[0]
    ?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (first) return first;
  const bare = bareAddress(address);
  const at = bare.indexOf("@");
  return at > 0 ? bare.slice(0, at) : bare;
}

/**
 * Everything one `openComposer` call needs, so the thread view opens the
 * intro atomically. The composer would pick the From alias from the reply's
 * To/Cc, but the intro has removed me from both — so the alias is resolved
 * here from the original headers and handed over with the rest.
 */
export function composerOptionsForIntro(
  message: IntroSource & Pick<DbMessage, "id" | "thread_id">,
  intro: InstantIntro,
  quoteHtml: string,
  aliases: SendAsAlias[],
): Parameters<ComposerState["openComposer"]>[0] & { mode: "replyAll" } {
  const from = resolveFromAddress(aliases, message.to_addresses, message.cc_addresses);
  return {
    mode: "replyAll",
    to: intro.to,
    cc: intro.cc,
    bcc: intro.bcc,
    subject: intro.subject,
    bodyHtml: intro.openerHtml + quoteHtml,
    threadId: message.thread_id,
    inReplyToMessageId: message.id,
    fromEmail: from?.email ?? null,
  };
}

/**
 * REQ-1.3: why an intro is unavailable on this message, or `null` when it is
 * available. The button shows the reason; the key path checks for `null`.
 */
export function instantIntroUnavailableReason(message: IntroSource, ownAddresses: string[]): string | null {
  const target = replyTarget(message);
  if (!target) return "No sender address to move to Bcc";
  if (isNoReplyAddress(target)) return "This sender does not accept replies";
  const own = new Set(ownAddresses.map(bareAddress));
  if (own.has(bareAddress(target))) return "The last message is your own";
  return buildInstantIntro(message, ownAddresses) ? null : "Nobody to introduce you to";
}

function reSubject(subject: string | null): string {
  const s = subject ?? "";
  return /^re:/i.test(s.trim()) ? s : `Re: ${s}`;
}

/**
 * REQ-1: the intro's recipients and opener, or `null` when the action makes
 * no sense — no introducer address, the last message is my own, or nobody is
 * left once I and the introducer are set aside.
 */
export function buildInstantIntro(message: IntroSource, ownAddresses: string[]): InstantIntro | null {
  const target = replyTarget(message);
  if (!target) return null;
  const introducer = bareAddress(target);
  const own = new Set(ownAddresses.map(bareAddress));
  if (own.has(introducer)) return null;

  const all = replyAllRecipients(message, ownAddresses);
  const to = all.to.filter((chip) => bareAddress(chip) !== introducer);
  const cc = all.cc.filter((chip) => bareAddress(chip) !== introducer);
  if (to.length === 0 && cc.length === 0) return null;

  const introducerName = introducerFirstName(message.from_name, target);
  return {
    to,
    cc,
    bcc: [target],
    subject: reSubject(message.subject),
    introducerName,
    openerHtml: `<p>Thanks ${escapeHtml(introducerName)}, moving you to Bcc.</p>`,
  };
}
