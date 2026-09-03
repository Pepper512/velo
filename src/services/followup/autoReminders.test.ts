import { describe, it, expect, vi } from "vitest";
import {
  AUTO_REMINDER_DAY_CHOICES,
  DEFAULT_AUTO_REMINDER_DAYS,
  autoReminderDueAt,
  effectiveAutoReminder,
  isExternalSend,
  normaliseAutoReminderDays,
  scheduleAutoReminder,
} from "./autoReminders";

/**
 * SPEC-AR: the rule that decides whether a send is external, the due-time
 * arithmetic that lands on a working morning, the per-message flag, and the
 * post-send scheduling that never overwrites a manual reminder.
 */

describe("isExternalSend (REQ-1.2)", () => {
  const own = ["me@acme.com", "alias@acme.com"];

  it("is external when a recipient is on another domain", () => {
    expect(isExternalSend({ from: "me@acme.com", recipients: ["x@example.com"], ownAddresses: own })).toBe(true);
  });

  it("is internal when every recipient shares the sender's domain", () => {
    expect(isExternalSend({ from: "me@acme.com", recipients: ["boss@acme.com", "peer@acme.com"], ownAddresses: own })).toBe(false);
  });

  it("compares domains case-insensitively", () => {
    expect(isExternalSend({ from: "Me@ACME.com", recipients: ["Peer@Acme.COM"], ownAddresses: own })).toBe(false);
    expect(isExternalSend({ from: "me@acme.com", recipients: ["X@Example.COM"], ownAddresses: own })).toBe(true);
  });

  it("never counts one of my own addresses as external, whatever its domain", () => {
    expect(isExternalSend({ from: "me@acme.com", recipients: ["Alias@Acme.com"], ownAddresses: own })).toBe(false);
    expect(
      isExternalSend({ from: "me@acme.com", recipients: ["me@other.org"], ownAddresses: ["me@acme.com", "me@other.org"] }),
    ).toBe(false);
  });

  it("counts Bcc-only external recipients — the caller passes all three lists merged", () => {
    expect(isExternalSend({ from: "me@acme.com", recipients: ["peer@acme.com", "x@example.com"], ownAddresses: own })).toBe(true);
  });

  it("ignores a recipient without an @ and an empty list", () => {
    expect(isExternalSend({ from: "me@acme.com", recipients: ["not-an-address"], ownAddresses: own })).toBe(false);
    expect(isExternalSend({ from: "me@acme.com", recipients: [], ownAddresses: own })).toBe(false);
  });

  it("treats a sender without a domain as matching nothing, so any real recipient is external", () => {
    expect(isExternalSend({ from: "me", recipients: ["x@example.com"], ownAddresses: [] })).toBe(true);
  });
});

describe("autoReminderDueAt (REQ-2)", () => {
  // Local-time arithmetic: build dates with the local constructor so the
  // assertions hold in both CI time zones (UTC and America/Chicago).
  const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0, 0);
  const at = (ts: number) => new Date(ts * 1000);

  it("is N days later at 09:00 local on a weekday", () => {
    // Monday 2026-09-07 noon + 3 days -> Thursday 2026-09-10 09:00.
    const due = at(autoReminderDueAt(local(2026, 9, 7), 3));
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate(), due.getHours(), due.getMinutes()]).toEqual([2026, 9, 10, 9, 0]);
  });

  it("rolls a Saturday to the following Monday", () => {
    // Friday 2026-09-11 + 1 day -> Saturday 12 -> Monday 2026-09-14 09:00.
    const due = at(autoReminderDueAt(local(2026, 9, 11), 1));
    expect([due.getMonth() + 1, due.getDate(), due.getDay(), due.getHours()]).toEqual([9, 14, 1, 9]);
  });

  it("rolls a Sunday to the following Monday", () => {
    // Friday 2026-09-11 + 2 days -> Sunday 13 -> Monday 14.
    const due = at(autoReminderDueAt(local(2026, 9, 11), 2));
    expect([due.getDate(), due.getDay()]).toEqual([14, 1]);
  });

  it("sends on a Saturday land on a working morning too", () => {
    // Saturday 2026-09-12 + 1 day -> Sunday 13 -> Monday 14.
    const due = at(autoReminderDueAt(local(2026, 9, 12), 1));
    expect([due.getDate(), due.getDay()]).toEqual([14, 1]);
  });

  it("a week later crosses the weekend untouched when it lands on a weekday", () => {
    // Wednesday 2026-09-09 + 7 -> Wednesday 16.
    const due = at(autoReminderDueAt(local(2026, 9, 9), 7));
    expect([due.getDate(), due.getDay(), due.getHours()]).toEqual([16, 3, 9]);
  });

  it("is always in the future for a same-day 09:00 edge: a late send plus one day is the next morning", () => {
    const sent = local(2026, 9, 7, 23);
    const due = autoReminderDueAt(sent, 1);
    expect(due).toBeGreaterThan(Math.floor(sent.getTime() / 1000));
  });
});

describe("normaliseAutoReminderDays", () => {
  it("accepts exactly the offered choices and falls back to the default", () => {
    expect(AUTO_REMINDER_DAY_CHOICES).toEqual([1, 2, 3, 7]);
    expect(DEFAULT_AUTO_REMINDER_DAYS).toBe(3);
    for (const d of AUTO_REMINDER_DAY_CHOICES) expect(normaliseAutoReminderDays(String(d))).toBe(d);
    expect(normaliseAutoReminderDays("5")).toBe(3);
    expect(normaliseAutoReminderDays("abc")).toBe(3);
    expect(normaliseAutoReminderDays(null)).toBe(3);
    expect(normaliseAutoReminderDays(0)).toBe(3);
  });
});

describe("effectiveAutoReminder (REQ-3.1)", () => {
  it("is off whenever the setting is off, whatever else is true", () => {
    expect(effectiveAutoReminder({ enabled: false, override: true, external: true })).toBe(false);
  });

  it("follows the external rule until the user chooses", () => {
    expect(effectiveAutoReminder({ enabled: true, override: null, external: true })).toBe(true);
    expect(effectiveAutoReminder({ enabled: true, override: null, external: false })).toBe(false);
  });

  it("lets the user's choice win over the rule, both ways", () => {
    expect(effectiveAutoReminder({ enabled: true, override: false, external: true })).toBe(false);
    expect(effectiveAutoReminder({ enabled: true, override: true, external: false })).toBe(true);
  });
});

describe("scheduleAutoReminder (REQ-1.1, 1.3, 1.4)", () => {
  function deps(existing: unknown = null) {
    return {
      getFollowUpForThread: vi.fn(async () => existing as never),
      insertFollowUpReminder: vi.fn(async () => undefined),
    };
  }
  const sentAt = new Date(2026, 8, 7, 12, 0, 0, 0); // Monday

  it("inserts a pending reminder for the sent message's thread at the computed time", async () => {
    const d = deps();
    const result = await scheduleAutoReminder(d, {
      accountId: "acc-1",
      threadId: "t-1",
      messageId: "m-1",
      sentAt,
      days: 3,
    });
    expect(result).toEqual({ scheduled: true, remindAt: autoReminderDueAt(sentAt, 3) });
    expect(d.insertFollowUpReminder).toHaveBeenCalledWith("acc-1", "t-1", "m-1", autoReminderDueAt(sentAt, 3));
  });

  it("leaves an existing pending reminder on the thread untouched", async () => {
    const d = deps({ id: "r-1", remind_at: 123, status: "pending" });
    const result = await scheduleAutoReminder(d, { accountId: "acc-1", threadId: "t-1", messageId: "m-2", sentAt, days: 3 });
    expect(result).toEqual({ scheduled: false, reason: "existing" });
    expect(d.insertFollowUpReminder).not.toHaveBeenCalled();
  });

  it("sets nothing without a thread id, and says so", async () => {
    const d = deps();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await scheduleAutoReminder(d, { accountId: "acc-1", threadId: null, messageId: "m-3", sentAt, days: 3 });
    expect(result).toEqual({ scheduled: false, reason: "no-thread" });
    expect(d.insertFollowUpReminder).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("uses the default delay for a value outside the offered choices", async () => {
    const d = deps();
    const result = await scheduleAutoReminder(d, { accountId: "acc-1", threadId: "t-1", messageId: "m-4", sentAt, days: 9 });
    expect(result).toEqual({ scheduled: true, remindAt: autoReminderDueAt(sentAt, 3) });
  });

  it("reports an insert failure instead of throwing into the send path", async () => {
    const d = deps();
    d.insertFollowUpReminder.mockRejectedValueOnce(new Error("db locked"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await scheduleAutoReminder(d, { accountId: "acc-1", threadId: "t-1", messageId: "m-5", sentAt, days: 3 });
    expect(result).toEqual({ scheduled: false, reason: "failed" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
