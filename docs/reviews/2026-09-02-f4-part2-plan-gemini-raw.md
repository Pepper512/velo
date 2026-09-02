## Verdict

**BUILD WITH CHANGES** — The substrate and two-pass state machine architecture are robust, but the plan contains critical arithmetic bugs in the gate and counter recomputation, unsafe mid-pass tombstone deletions that bypass attestation and budgeting, and a gap in pass attestation when message fetches fail.

---

## Findings

### 1. [HIGH] Step 2 — Gate arithmetic omits incoming new UIDs, causing false full `UID SEARCH ALL` on every incoming email
- **Plan Step:** 2 (The gate)
- **Scenario:** A folder receives a new email. Server `EXISTS` increases (e.g., from 10 to 11). `DeltaCheckResult` reports `exists: 11` and `new_uids: [101]`. At the gate check *before* fetching new UIDs, `localCount` is still 10 and `flagged_not_expunged` is 0. The gate evaluates `11 !== 10 + 0` which is `true`.
- **Consequence:** Every normal incoming email falsely trips the gate, forcing an expensive and redundant `imapSearchAllUids` round-trip across the entire folder, directly violating NFR-1 ("no extra round trip when EXISTS matches").
- **Change to Plan:** Include the incoming new UIDs in the expected count:
  ```ts
  shouldListAll = deltaResult.exists !== (localCount + deltaResult.new_uids.length + state.flagged_not_expunged)
  ```
  Also explicitly guard `deltaResult.exists != null`.

---

### 2. [HIGH] Step 3 — Counter recomputation formula `|serverUids − localUids|` miscounts vanished mail as ghosts, permanently corrupting the gate
- **Plan Step:** 3 (The full list)
- **Scenario:** 5 messages are deleted on the server by another client. Server has 95 UIDs; local DB has 100 UIDs (`localUids \ serverUids` = 5 vanished UIDs). The plan recomputes `flagged_not_expunged := |serverUids − localUids|` = `|95 − 100| = 5`.
- **Consequence:** The 5 vanished messages are misclassified as server-side `\Deleted` ghosts (which represent messages deleted locally but still counted by the server). When local subsequently deletes those 5 messages on pass 2 (reducing `localCount` to 95), the gate checks `exists (95) !== localCount (95) + flagged_not_expunged (5)` $\rightarrow$ `95 !== 100`. The gate is permanently jammed open and executes a full search on every single future pass.
- **Change to Plan:** Replace `|serverUids − localUids|` with the directional count of server ghosts. After new UIDs are ingested, ghosts are strictly server UIDs not present in local live messages (`serverUids \ localUids`). When `localCount > serverUids.length` (vanished mail), `flagged_not_expunged` contribution from this discrepancy is `0`.

---

### 3. [HIGH] Step 3 — Direct deletion of tombstones mid-pass bypasses attestation, budgeting, and risks data loss before destination folder syncs
- **Plan Step:** 3 (The full list)
- **Scenario:** A message is moved from `INBOX` to `Archive` without `COPYUID` and is tombstoned in `INBOX` (`moved_to = 'Archive'`) awaiting `Archive` to sync it in. `INBOX` runs `applySearchAll` and sees the UID missing from `INBOX`. Step 3 deletes the tombstoned row directly inside the per-folder loop.
- **Consequence:** 
  1. **Data Loss:** If `Archive` has not synced yet and the network drops or sync fails, the local message body and headers are destroyed before the destination folder has ingested them locally. This violates the F-5 invariant ("tombstoned until destination syncs it in").
  2. **Safety Bypass:** Direct deletion inside Step 3 executes before whole-pass attestation is evaluated, completely bypassing the `planDeletions` cap, the REQ-3.1 >50% stop, and structured deletion logging.
- **Change to Plan:** Do not delete tombstones in Step 3. Tombstones must only be removed when the destination folder confirms ingestion of the message (by Message-ID matching), or processed through the standard end-of-pass deletion pipeline under budget and attestation.

---

### 4. [MEDIUM] Step 1 — Attestation calculation misses per-folder message fetch errors recorded in `deltaFolderErrors`
- **Plan Step:** 1 (Pass id and attestation)
- **Scenario:** A folder's delta check succeeds (`checked: true`) and gate search succeeds (`searchAllSucceeded.has(f)`), but fetching the folder's new message batch throws and pushes to `deltaFolderErrors`. The plan's attestation check `listSucceeded && syncableFolders.every(both bits) && newFoldersAllSucceeded` evaluates to `true` because both checked bits were set prior to the fetch failure.
- **Consequence:** A degraded pass with active folder errors is certified as fully attested, allowing destructive deletions to proceed despite partial sync failure.
- **Change to Plan:** Require that no folder in `syncableFolders` encountered an error during any stage of the pass:
  ```ts
  attested = listSucceeded &&
    syncableFolders.every(f => 
      deltaResultMap.get(f.raw_path)?.checked === true &&
      (!gateOpened.has(f.raw_path) || searchAllSucceeded.has(f.raw_path)) &&
      !deltaFolderErrors.has(f.raw_path)
    ) &&
    newFoldersAllSucceeded;
  ```

---

### 5. [MEDIUM] Step 6 — Pending operations must be filtered *before* calculating deletion plan and budget slice
- **Plan Step:** 6 (End-of-pass deletion)
- **Scenario:** `confirmedOnPass` returns 20 rows. 8 rows belong to threads with active `pending_operations`. The plan states: `skip rows whose message or thread has pending_operations; plan = planDeletions(localRows, confirmed.length); ... delete the first plan.budget rows`.
- **Consequence:** If `planDeletions` is given the unfiltered count (20 instead of 12), the >50% stop may trigger falsely. Furthermore, taking the first `plan.budget` rows from the unfiltered list could attempt deletion of skipped rows or exhaust the budget on un-deletable items.
- **Change to Plan:** Explicitly filter `confirmed` rows against `pending_operations` first (`candidateRows = confirmed.filter(...)`), then execute `plan = planDeletions(localRows, candidateRows.length)` and slice `candidateRows.slice(0, plan.budget)`.

---

### 6. [MEDIUM] Step 8 — UI Store `reconcileStop` overwrite on multi-folder stop and lack of persistent bypass token
- **Plan Step:** 8 (The REQ-3.1 stop UI)
- **Scenario:** 
  1. A user moves mail across multiple folders on another client; multiple folders trip the >50% stop on the same pass.
  2. The user clicks "Delete them", triggering a new sync pass. On the next pass, `confirmed * 2 > localRows` is still true.
- **Consequence:** A scalar `reconcileStop` object in `useUIStore` clobbers stops from preceding folders. Without a persistent or session-scoped approval token, the subsequent pass hits the stop condition again, trapping the user in an infinite confirmation prompt loop.
- **Change to Plan:** Key `useUIStore.reconcileStop` by `${accountId}:${folder}`. When the user approves "Delete them", persist an override (e.g. `bypass_stop_pass_id` or an IPC action `approveReconcileStop(accountId, folder)`) so the immediate next pass bypasses the stop for that folder while respecting the per-pass deletion cap.

---

### 7. [LOW] Step 6 & 7 — Pending operations query needs structural compatibility with Step 7's reconcile ops
- **Plan Step:** 6 (End-of-pass deletion) & Step 7 (Deferred reconcile op)
- **Scenario:** Step 7 introduces reconcile operations keyed as `{ operation_type: "reconcile", resource_id: "reconcile:{folder}", params: { folder, uids } }`. Step 6 only checks `pending_operations.resource_id = thread_id`.
- **Consequence:** When Step 7 is implemented in the follow-up PR, Step 6 will fail to recognize active reconcile operations protecting specific UIDs.
- **Change to Plan:** Ensure the helper in Step 6 (`hasPendingOperations(accountId, threadId, folder, uid)`) is designed to check both `resource_id = thread_id` and any active folder reconcile operations.

---

### 8. [NIT] Step 1 — Concurrency control for `imapDeltaSync`
- **Plan Step:** 1 (Pass id)
- **Scenario:** A periodic delta sync timer fires while a manual sync or another delta sync pass is in progress.
- **Consequence:** Overlapping passes with different `passId` values could observe and promote suspects within milliseconds, violating the multi-pass observation guarantee.
- **Change to Plan:** Document and verify that `imapDeltaSync` is strictly single-flighted per account via an async mutex or queue.

---

## Questions

1. **Tombstone Resolution:** Where in the sync lifecycle are F-5 tombstones currently resolved when the destination folder syncs? Is there already an upsert hook matching Message-IDs across folders, or does it rely on a separate reconciliation step?
2. **Stop UI Scope:** When a folder hits the >50% stop and is frozen, does the freeze only block deletion/reconciliation for that folder, or does it pause incoming `new_uids` sync as well? (Recommendation: continue fetching new mail; freeze only deletions).
3. **`threadMessageCount` Boundary:** Can a thread span multiple accounts or solely multiple folders within the same `account_id`? (Confirm `threadMessageCount` queries `WHERE account_id = ? AND thread_id = ? AND moved_to IS NULL`).

---

## What is sound

- **Pass ID Scope:** Generating `passId` once at the top of `imapDeltaSync` correctly prevents single-pass duplicate promotion.
- **Atomic Substrate Transaction:** `applySearchAll` atomically purging other generations, clearing reappeared UIDs, and recording suspects prevents split-brain state.
- **Two-Pass Requirement:** Requiring promotion from `suspect` $\rightarrow$ `confirmed_absent` exclusively via actual `UID SEARCH ALL` execution on a subsequent pass prevents single-observation deletions.
- **Budgeting & Cap:** `planDeletions` capping deletions at $\min(500, \max(10, \lceil 10\% \rceil))$ and enforcing human-in-the-loop above 50% provides solid protection against server-side truncation or catastrophic loss.
- **Attestation Contract:** Enforcing positive verification across all syncable folders before permitting any end-of-pass deletions prevents partial sync passes from executing destructive operations.
