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
import { bareAddress } from "@/utils/emailUtils";
import { escapeHtml } from "@/utils/sanitize";

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

/** The address a reply goes to: `reply_to`, else `from_address`. */
function replyTarget(message: IntroSource): string | null {
  const target = message.reply_to ?? message.from_address;
  return target && target.trim().length > 0 ? target.trim() : null;
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

/** REQ-2.1: the first word of the display name, else the address's local part. */
export function introducerFirstName(fromName: string | null, address: string): string {
  const first = fromName?.trim().split(/\s+/)[0];
  if (first) return first;
  const bare = bareAddress(address);
  const at = bare.indexOf("@");
  return at > 0 ? bare.slice(0, at) : bare;
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
