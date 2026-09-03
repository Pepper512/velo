/**
 * Auto reminders (SPEC-AR): a follow-up reminder by default on every external
 * send, due on a working morning.
 *
 * Pure, so the composer can call it and a test can drive it without React or
 * a database. The checker (`followupManager.ts`) already cancels a reminder
 * when a reply arrives and notifies when it is due; this module only decides
 * whether to create one and when it falls due.
 */
import type { DbFollowUpReminder } from "../db/followUpReminders";
import { bareAddress } from "@/utils/emailUtils";

/** The delays the setting offers, in days. */
export const AUTO_REMINDER_DAY_CHOICES = [1, 2, 3, 7] as const;
export type AutoReminderDays = (typeof AUTO_REMINDER_DAY_CHOICES)[number];
export const DEFAULT_AUTO_REMINDER_DAYS: AutoReminderDays = 3;

/** The hour, local time, a reminder falls due. Matches the manual presets. */
const DUE_HOUR = 9;

/** A stored setting value → one of the offered choices, else the default. */
export function normaliseAutoReminderDays(value: string | number | null | undefined): AutoReminderDays {
  const n = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return (AUTO_REMINDER_DAY_CHOICES as readonly number[]).includes(n)
    ? (n as AutoReminderDays)
    : DEFAULT_AUTO_REMINDER_DAYS;
}

function domainOf(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 0 || at === address.length - 1) return null;
  return address.slice(at + 1).trim().toLowerCase();
}

/**
 * REQ-1.2: a send is external when at least one recipient is on another
 * domain than the sending address and is not one of the account's own
 * addresses. Domains and addresses compare case-insensitively, display
 * names are ignored; a recipient without a domain is ignored.
 */
export function isExternalSend(input: {
  from: string;
  recipients: string[];
  ownAddresses: string[];
}): boolean {
  const fromDomain = domainOf(bareAddress(input.from));
  const own = new Set(input.ownAddresses.map(bareAddress));
  return input.recipients.some((r) => {
    const addr = bareAddress(r);
    if (own.has(addr)) return false;
    const domain = domainOf(addr);
    if (domain === null) return false;
    return domain !== fromDomain;
  });
}

/**
 * REQ-2: `sentAt` + `days` at 09:00 local, rolled past a weekend to Monday.
 * Returns unix seconds. Local-time arithmetic through `setDate`/`setHours`,
 * so a DST change inside the window does not shift the morning.
 */
export function autoReminderDueAt(sentAt: Date, days: number): number {
  const due = new Date(sentAt.getTime());
  due.setDate(due.getDate() + normaliseAutoReminderDays(days));
  const day = due.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 6) due.setDate(due.getDate() + 2);
  else if (day === 0) due.setDate(due.getDate() + 1);
  // Hours last, after every date move, so the morning is 09:00 on the final
  // day whatever the clock did in between.
  due.setHours(DUE_HOUR, 0, 0, 0);
  return Math.floor(due.getTime() / 1000);
}

/**
 * REQ-3.1: the per-message flag. Off whenever the setting is off; the user's
 * explicit choice wins over the rule; otherwise the rule.
 */
export function effectiveAutoReminder(input: {
  enabled: boolean;
  override: boolean | null;
  external: boolean;
}): boolean {
  if (!input.enabled) return false;
  return input.override ?? input.external;
}

export interface AutoReminderDeps {
  getFollowUpForThread: (accountId: string, threadId: string) => Promise<DbFollowUpReminder | null>;
  insertFollowUpReminder: (
    accountId: string,
    threadId: string,
    messageId: string,
    remindAt: number,
  ) => Promise<void>;
}

export type AutoReminderOutcome =
  | { scheduled: true; remindAt: number }
  | { scheduled: false; reason: "no-thread" | "existing" | "failed" };

/**
 * REQ-1.1, 1.3, 1.4: after a successful send. Never overwrites a pending
 * reminder the user set by hand (the table's upsert would), never throws
 * into the send path — the send already happened and its outcome stands.
 */
export async function scheduleAutoReminder(
  deps: AutoReminderDeps,
  input: {
    accountId: string;
    threadId: string | null | undefined;
    messageId: string;
    sentAt: Date;
    days: number;
  },
): Promise<AutoReminderOutcome> {
  if (!input.threadId) {
    console.warn("[autoReminders] No thread id for the sent message; no reminder set");
    return { scheduled: false, reason: "no-thread" };
  }
  try {
    const existing = await deps.getFollowUpForThread(input.accountId, input.threadId);
    if (existing) return { scheduled: false, reason: "existing" };
    const remindAt = autoReminderDueAt(input.sentAt, input.days);
    await deps.insertFollowUpReminder(input.accountId, input.threadId, input.messageId, remindAt);
    return { scheduled: true, remindAt };
  } catch (err) {
    console.warn("[autoReminders] Could not set the reminder:", err);
    return { scheduled: false, reason: "failed" };
  }
}
