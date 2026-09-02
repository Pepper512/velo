## Verdict
**APPROVE WITH NITS** — The change correctly resolves the `permanentDelete` local cascade deletion regression by switching from a positive liveness filter to a negative tombstone filter, safely relying on IMAP UID immutability within a UIDVALIDITY for unknown IDs while maintaining full protection against COPY-fallback stale UID targeting.

---

## Findings

### 1. Stale test case description in provider test suite
- **Severity**: Nit (Low)
- **File**: `src/services/email/imapSmtpProvider.test.ts:330`
- **Trigger**: Running or maintaining unit tests.
- **Consequence**: The test description (`"drops ids that no longer name a live local row before touching the server"`) and its inline comment still describe the obsolete positive liveness requirement rather than the tombstone-dropping requirement.
- **Fix**: Update the test title to `"drops ids whose local rows are tombstoned before touching the server"` and adjust the comment to clarify that the mock simulates dropping a tombstoned ID.

### 2. Method name `groupLiveByFolder` retains stale naming convention
- **Severity**: Nit (Low)
- **File**: `src/services/email/imapSmtpProvider.ts:659`
- **Trigger**: Code maintenance and navigation within `ImapSmtpProvider`.
- **Consequence**: The private helper is named `groupLiveByFolder`, which slightly conflicts with its updated JSDoc (`/** groupByFolder over the ids that are not tombstoned locally. */`) and actual behavior (it now includes non-live, unknown IDs such as freshly deleted messages).
- **Fix**: Rename `groupLiveByFolder` to `groupNonTombstonedByFolder` (or `groupByFolderFiltered`) to align with `dropTombstonedMessageIds`.

---

## What is good

1. **Correct Root-Cause Inversion**: Inverting the filter predicate from `moved_to IS NULL` to `moved_to IS NOT NULL` elegantly fixes the cascade-delete ordering defect where `applyLocalDbUpdate` purges SQLite rows before the provider executes `permanentDelete`.
2. **IMAP Protocol Correctness & UID Invariance**: The pass-through rationale is sound under RFC 3501 / RFC 9051. Because IMAP UIDs are strictly monotonically increasing and non-reusable within a `UIDVALIDITY`, sending actions on unknown or UIDPLUS-re-keyed UIDs is guaranteed to be a server-side no-op or clean `NO`, never targeting an arbitrary message.
3. **Targeted COPY-Fallback Protection**: Only rows that were moved via COPY fallback without a `COPYUID` mapping retain `moved_to IS NOT NULL`, which are precisely the rows where the old folder/UID pair could be ambiguous or expunged; these remain strictly filtered out.
4. **Parameter Safety & Allocation Efficiency**: Preserves SQL parameter batching (`CHUNK = 500`) to stay well within SQLite bound-parameter limits (`$1`–`$501`), short-circuits on `tombstoned.size === 0` to avoid unnecessary array allocations, and preserves the caller's ID ordering via `.filter()`.
5. **Thorough Test Coverage**: Unit tests, SQLite harness tests, and provider mock tests were updated cohesively across `messageHelper.test.ts`, `imapSmtpProvider.test.ts`, and `moveHygiene.test.ts`, with explicit test assertions added for the cascading-delete scenario.
