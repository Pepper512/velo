/**
 * The `sync_period_days` setting, read once and correctly (SPEC-276).
 *
 * The setting is a string in the `settings` table (seeded `'365'`). `0` means
 * "all time" — no date filter on either provider. The previous reader,
 * `parseInt(raw ?? "365", 10) || 365`, could never see that value: a parsed
 * `0` is falsy, so the fallback fired for a legitimate zero exactly as for
 * `NaN`. Both sync-manager call sites had their own copy of that line; this
 * module is the single reader so there is nothing to drift.
 */

/** What the migration seeds and what an unreadable value falls back to. */
export const DEFAULT_SYNC_PERIOD_DAYS = 365;

/** "All time": no date filter at all. */
export const ALL_TIME = 0;

/**
 * Parse the stored setting: exactly `"0"` (all time) or a positive integer are
 * the meanings a user can set. Anything else — missing, empty, non-numeric,
 * negative, fractional, hex, trailing text — is the default. Stricter than
 * `parseInt` on purpose: a negative period has no meaning anyone chose.
 */
export function parseSyncPeriodDays(raw: string | null | undefined): number {
  if (raw == null) return DEFAULT_SYNC_PERIOD_DAYS;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_SYNC_PERIOD_DAYS;
  const days = Number(trimmed);
  if (!Number.isSafeInteger(days)) return DEFAULT_SYNC_PERIOD_DAYS;
  return days;
}

/** True when the period means "no date filter". */
export function isAllTime(days: number): boolean {
  return days === ALL_TIME;
}
