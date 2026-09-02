import { describe, it, expect } from "vitest";
import { ALL_TIME, DEFAULT_SYNC_PERIOD_DAYS, isAllTime, parseSyncPeriodDays } from "./syncPeriod";

// SPEC-276 REQ-2.1: exactly "0" (all time) or a positive integer are meanings a
// user can set; anything else is the default. `parseInt(x) || 365` — the line
// this replaces — turned a legitimate 0 into 365.
describe("parseSyncPeriodDays", () => {
  it("keeps 0 as all time", () => {
    expect(parseSyncPeriodDays("0")).toBe(ALL_TIME);
    expect(parseSyncPeriodDays(" 0 ")).toBe(ALL_TIME);
  });

  it("keeps a positive integer", () => {
    expect(parseSyncPeriodDays("30")).toBe(30);
    expect(parseSyncPeriodDays("365")).toBe(365);
    expect(parseSyncPeriodDays("1825")).toBe(1825);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["abc"],
    ["NaN"],
    ["-5"],
    ["1.5"],
    ["30days"],
    ["0x10"],
  ])("falls back to the default for %j", (raw) => {
    expect(parseSyncPeriodDays(raw)).toBe(DEFAULT_SYNC_PERIOD_DAYS);
  });

  it("has the default the migration seeds", () => {
    expect(DEFAULT_SYNC_PERIOD_DAYS).toBe(365);
  });
});

describe("isAllTime", () => {
  it("is true only for 0", () => {
    expect(isAllTime(0)).toBe(true);
    expect(isAllTime(365)).toBe(false);
    expect(isAllTime(1)).toBe(false);
  });
});
