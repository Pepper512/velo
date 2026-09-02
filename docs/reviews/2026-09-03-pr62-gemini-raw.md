### Verdict
**APPROVE WITH NITS**

The implementation is clean, robust, and correctly solves the latent `|| 365` coercion defect. The parser in [syncPeriod.ts](file:///src/services/syncPeriod.ts) is strict, centralized, and well-tested. Date filtering is properly disabled across both Gmail and IMAP sync paths, including IMAP's message-level date cutoff.

---

### Numbered Findings

#### 1. [LOW] `imapDeltaSync` missing unit test for `daysBack = 0`
* **File & Function:** [imapSync.test.ts](file:///src/services/imap/imapSync.test.ts#L478) / [`imapDeltaSync`](file:///src/services/imap/imapSync.ts#L1007)
* **Concern:** While [`imapInitialSync`](file:///src/services/imap/imapSync.ts#L574) has a test verifying that `daysBack = 0` passes `null` to `imapSearchFolder` and preserves old messages, [`imapDeltaSync`](file:///src/services/imap/imapSync.ts#L1007) (which contains two `sinceDateForDaysBack` call sites: routine folder sync and UIDVALIDITY resync) has no test asserting it passes `null` when `daysBack = 0`.
* **Exact Scenario:** If a regression or merge conflict reverted lines 1017 or 1172 in [imapSync.ts](file:///src/services/imap/imapSync.ts) back to `computeSinceDate(daysBack)`, all existing tests would still pass.
* **Consequence:** Delta sync or UIDVALIDITY resync on an account configured for "All time" could silently fall back to `SINCE <1 day ago>` without failing tests.
* **Fix:** Add a test case in [imapSync.test.ts](file:///src/services/imap/imapSync.test.ts) invoking `imapDeltaSync("acc-1", 0)` and asserting `mockImapSearchFolder` is called with `null` both on standard delta sync and on UIDVALIDITY mismatch.

#### 2. [LOW] `syncManager.test.ts` does not verify `imapDeltaSync` receives `syncDays = 0`
* **File & Function:** [syncManager.test.ts](file:///src/services/gmail/syncManager.test.ts#L300) / [`syncImapAccount`](file:///src/services/gmail/syncManager.ts#L94)
* **Concern:** The new tests in [syncManager.test.ts](file:///src/services/gmail/syncManager.test.ts) test initial sync for Gmail and IMAP, but not the delta sync branch where `account.history_id` is present.
* **Exact Scenario:** An IMAP account with an existing `history_id` performs a background sync with `sync_period_days` set to `"0"`.
* **Consequence:** If `syncImapAccount` failed to forward `syncDays` to `imapDeltaSync` (e.g. called it with default arguments), the test suite would not catch it.
* **Fix:** Add a test in [syncManager.test.ts](file:///src/services/gmail/syncManager.test.ts) mocking an IMAP account with `history_id: "123"` and `getSetting("sync_period_days")` returning `"0"`, asserting `mockImapDeltaSync` is called with `("i1", 0)`.

#### 3. [NIT] `computeSinceDate` remains exported and could be mistakenly called directly
* **File & Function:** [imapSync.ts](file:///src/services/imap/imapSync.ts#L140) / [`computeSinceDate`](file:///src/services/imap/imapSync.ts#L140)
* **Concern:** [`computeSinceDate`](file:///src/services/imap/imapSync.ts#L140) remains exported alongside [`sinceDateForDaysBack`](file:///src/services/imap/imapSync.ts#L147). If called with `0`, `computeSinceDate(0)` yields a date for yesterday (`getDate() - 0 - 1`), which reintroduces the bug if used by new code.
* **Exact Scenario:** A future developer adds a search or sync call site in another module and calls `computeSinceDate(syncDays)` directly instead of `sinceDateForDaysBack(syncDays)`.
* **Consequence:** `0` would be treated as "since yesterday" rather than "all time".
* **Fix:** Add a JSDoc `@deprecated` tag or doc comment on [`computeSinceDate`](file:///src/services/imap/imapSync.ts#L140) directing callers to use [`sinceDateForDaysBack`](file:///src/services/imap/imapSync.ts#L147).

---

### Questions

1. **Settings UI coverage:** Is there a component test for [SettingsPage.tsx](file:///src/components/settings/SettingsPage.tsx) to verify that selecting "All time" writes `"0"` to the settings store and persists it properly?
2. **Initial sync cancellation/restart:** If a user with a multi-gigabyte mailbox cancels or closes Velo mid-sync during an "All time" initial sync, does the next launch resume cleanly from the folder state or re-run from scratch?

---

### What is Good

* **Parser Design:** [syncPeriod.ts](file:///src/services/syncPeriod.ts) is lean, avoids third-party dependencies, and uses strict regex validation (`/^\d+$/` + `Number.isSafeInteger`) rather than loose `parseInt`/`Number` parsing. It safely handles `null`, `undefined`, whitespace, negatives, fractions, and non-numeric junk by falling back to `DEFAULT_SYNC_PERIOD_DAYS` (365).
* **End-to-End Correctness:**
  * **Gmail:** Passing `undefined` for `q` in [`initialSync`](file:///src/services/gmail/sync.ts#L196) cleanly integrates with `client.listThreads`, which omits falsy query parameters.
  * **IMAP Search:** Passing `null` down to `imapSearchFolder` seamlessly matches Rust's `match since_date { Some(d) => "SINCE d", None => "ALL" }`.
  * **IMAP Message Cutoff:** Setting `cutoffDate = 0` when `isAllTime(daysBack)` is true ensures fetched messages are not discarded in JS post-search.
* **Zero Schema Migrations / Backward Compatibility:** Reusing the existing `sync_period_days` string setting avoids database migrations and ensures straightforward rollback if needed.
