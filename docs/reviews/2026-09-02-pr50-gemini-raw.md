## Verdict

**APPROVE WITH NITS** — The diff soundly implements SPEC-F-4 rev 5 (Part 3), deletes zero message rows, preserves all Part 2 reconciliation and attestation guarantees, and enforces strict boundary validation across Rust and TypeScript.

---

## Findings

### 1. [Low / Nit] Time skew between `deltaResult.exists` and `imapCountNotDeleted` during the belt check
- **File:** `src/services/imap/imapSync.ts`
- **Concern:** `deltaResult.exists` is captured during `imapDeltaCheck`. When `beltDue` triggers, `imapCountNotDeleted` issues a fresh `SELECT` on the server and runs `UID SEARCH NOT DELETED`. If new messages arrive on the server in the millisecond window between the delta check and `imapCountNotDeleted`, `notDeleted` reflects the newer count while `deltaResult.exists` reflects the older count.
- **Trigger:** High-volume incoming email arriving concurrently during the execution of `imapDeltaSync` on a pass where `beltDue` is true.
- **Consequence:** `notDeleted === liveCount + deltaResult.new_uids.length` evaluates to `false` (or `ghosts` calculates slightly low due to `Math.max(0, deltaResult.exists - notDeleted)`). `gateOpen` remains `true`, falling back to `imapSearchAllUids` and a full reconciliation list.
- **Fix:** This is fail-safe behavior (it errs on doing a full list rather than skipping). To make the calculation strictly monotonic, `count_not_deleted` in Rust could optionally return a tuple of `(exists, not_deleted_count)` from its own `SELECT`, or keep the current fallback which safely falls back to a full list.

---

### 2. [Low / Nit] `listedPaths` checks `syncableFolders` rather than raw LIST results
- **File:** `src/services/imap/imapSync.ts`
- **Concern:** `listedPaths` is constructed from `syncableFolders` (`syncableFolders.map(f => f.raw_path)`). If an existing folder is returned in the server's raw `LIST` response but is filtered out by `getSyncableFolders` (e.g., if a folder transitioned to `\Noselect` / container-only on the server), `listedPaths.has(state.folder_path)` will evaluate to `false`.
- **Trigger:** An IMAP mailbox with existing sync state becomes `\Noselect` on the remote server while still appearing in `LIST`.
- **Consequence:** After two consecutive sync passes, `noteFolderMissing` will treat the folder as missing from the server, removing its `folder_sync_state` row and logging a notice while keeping all local cached messages.
- **Fix:** If non-syncable folders present in the raw LIST should be retained in sync state, `listedPaths` can be derived from the full `folders` list before `getSyncableFolders` filtering. However, since `\Noselect` folders cannot be selected or delta-synced, removing their sync state while keeping cached messages is safe and expected.

---

### 3. [Low / Nit] Dual query UPDATE + SELECT in counter bump helpers
- **File:** `src/services/db/folderSyncState.ts`
- **Concern:** `bumpReconcilePasses` and `bumpFolderMissing` perform an `UPDATE` followed by a separate `SELECT` to return the incremented counter value.
- **Trigger:** Normal execution of `bumpReconcilePasses` or `bumpFolderMissing`.
- **Consequence:** Two sequential database queries over the SQLite bridge where one would suffice.
- **Fix:** In SQLite 3.35+, `UPDATE folder_sync_state SET reconcile_passes = COALESCE(reconcile_passes, 0) + 1 WHERE ... RETURNING reconcile_passes AS n` can return the updated scalar in a single atomic roundtrip.

---

## Questions

1. **Reconcile Op Pass ID confirmation:** `runReconcileOp` records absent UIDs using `reconcile:${crypto.randomUUID()}`. When the next background `imapDeltaSync` runs, its pass ID (e.g. `pass-delta-N`) differs from the reconcile op's UUID, so `recordMissing` promotes any still-absent suspects to `confirmed` on that first delta pass. Is it the intended design that the targeted check from the queue op counts as observation #1 and the subsequent delta sync pass counts as observation #2? *(Note: this is safe because only `finishReconcilePass` deletes confirmed suspects under attestation and the >50% stop).*
2. **Permanent Delete Revert Semantics:** When a `permanentDelete` action fails with `VELO_OUTCOME_UNKNOWN:`, `enqueueReconcileOps` is invoked. If the local row was already deleted by the optimistic action, `runReconcileOp` filters out absent UIDs that have no matching local row in `getLiveMessagesInFolder` (recording no suspects). Is this intended, relying on regular delta sync to re-fetch the message if the server did not actually delete it?

---

## What is good

1. **Zero Message Deletion Guarantee:** Neither `runReconcileOp`, `degradeReconcileOp`, `noteFolderMissing`, nor the NOT DELETED belt execute any SQL `DELETE` or message pruning. They only manipulate advisory counters, queue entries, and `reconcile_suspects` entries.
2. **Algebraic Invariant in Belt Gate:** In `notDeleted === liveCount + deltaResult.new_uids.length`, the incoming new UIDs term ($A$) appears on both sides of the server/client equation ($\text{live} - V + A = \text{live} + A \iff V = 0$). New incoming mail can never cancel out or mask a vanished UID.
3. **Queue Compaction & Anti-Loophole Logic:** `compactQueue` correctly collapses multiple reconcile ops for the same folder, unions and sorts their UIDs, and carries `Math.max(attempts, op.retry_count)` to eliminate infinite-retry vulnerabilities.
4. **Queue Priority (REQ-4.5):** Ordering `pending_operations` with `ORDER BY (operation_type = 'reconcile') ASC, created_at ASC` ensures read-repair operations never head-of-line block user-initiated writes.
5. **Robust Boundary Validation:** `imapCountNotDeleted` and `imapSearchUidsPresent` strictly validate responses across the FFI boundary, verifying non-negative integers and asserting that returned UIDs are strict subsets of the asked set.
6. **Two-Pass Attestation on Missing Folders:** A single LIST omission only increments `missing_passes`, which deliberately fails pass attestation (preventing premature deletions across the account), and only on the second consecutive miss is sync state cleaned up and attestation unblocked while preserving cached message rows.
