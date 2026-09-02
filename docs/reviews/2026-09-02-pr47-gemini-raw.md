## Verdict

**CHANGES REQUESTED** — The core multi-pass state machine, tombstone preservation, and gate arithmetic are sound, but two high-severity defects in pending operation filtering and catastrophic stop evaluation could delete messages with queued user work or bypass the user confirmation threshold.

---

## Findings

### 1. High — Thread-level cache in `withoutPendingOps` bypasses message-level pending operation checks
- **Severity**: HIGH
- **File**: `src/services/imap/reconcilePass.ts` (lines 257–266)
- **Concern**: `checkedThreads` caches the combined boolean `(ops.length > 0 || msgOps.length > 0)` under `threadId`.
- **Trigger**: Multiple suspect messages belong to the same thread. If a message with no message-level pending operations is evaluated first, `checkedThreads.set(threadId, false)` is stored. When a subsequent message in that same thread (which *does* have pending operations on its `message_row_id`) is evaluated, `checkedThreads.get(threadId)` returns `false`.
- **Consequence**: The message-level check for the second row is skipped entirely. The row with active pending operations is marked eligible and deleted in `deleteConfirmed`, violating REQ-3.4. (Conversely, if the message with pending ops is evaluated first, unrelated sibling messages in the thread are unnecessarily blocked from deletion).
- **Fix**: Decouple thread-level caching from message-level checks. Cache only `threadOps.length > 0` by `threadId`, and always query `getPendingOpsForResource(accountId, row.message_row_id)` per row:
  ```ts
  const threadBlocked = checkedThreads.get(threadId);
  let isThreadBlocked = threadBlocked;
  if (isThreadBlocked === undefined) {
    const ops = await getPendingOpsForResource(accountId, threadId);
    isThreadBlocked = ops.length > 0;
    checkedThreads.set(threadId, isThreadBlocked);
  }
  const msgOps = await getPendingOpsForResource(accountId, row.message_row_id);
  if (!isThreadBlocked && msgOps.length === 0) {
    out.push(row);
  }
  ```

---

### 2. High — `planDeletions` evaluates `eligible.length` instead of total `confirmed.length`, bypassing the >50% catastrophic stop
- **Severity**: HIGH
- **File**: `src/services/imap/reconcilePass.ts` (lines 185–188)
- **Concern**: `planDeletions` is invoked with `eligible.length` (the subset of confirmed absent rows without pending ops) rather than `confirmed.length` (the total population confirmed absent on the server).
- **Trigger**: A folder of 20 messages has 15 messages confirmed absent on the server (>50% vanished). If 11 of those confirmed messages currently have pending operations, `eligible.length` is 4. `planDeletions(20, 4)` evaluates `4 * 2 > 20` as `false` (`stop = false`).
- **Consequence**: The >50% catastrophic stop is bypassed without prompting the user (REQ-3.1). The unattended pass deletes the 4 eligible rows immediately, and subsequent passes will delete the remaining rows in batches as pending operations complete, defeating the safety gate.
- **Fix**: Base the stop decision on the total confirmed absent population in the folder:
  ```ts
  const plan = planDeletions(localRows, confirmed.length);
  if (plan.stop) {
    summary.stops.push({ folder, confirmed: confirmed.length, localRows });
    useUIStore.getState().pushReconcileStop({
      accountId,
      folder,
      uidvalidity: entry.uidvalidity,
      confirmed: confirmed.length,
      localRows,
    });
    continue;
  }
  const batch = eligible.slice(0, plan.budget);
  ```

---

### 3. Medium — `incrementFlaggedNotExpunged` evaluates to SQL `NULL` on legacy rows
- **Severity**: MEDIUM
- **File**: `src/services/db/folderSyncState.ts` (lines 62–67)
- **Concern**: `UPDATE folder_sync_state SET flagged_not_expunged = flagged_not_expunged + $1` evaluates to `NULL` if `flagged_not_expunged` is currently `NULL`.
- **Trigger**: Any folder sync state record created prior to column defaults or populated without the column encountering a non-expunged deletion or move.
- **Consequence**: The counter stays `NULL`. On delta sync, `savedState.flagged_not_expunged ?? 0` treats it as `0`, causing `shouldListFolder` to continuously mismatch `EXISTS` and run a full `UID SEARCH ALL` on every sync pass (violating NFR-1).
- **Fix**: Use `COALESCE` in the update:
  ```sql
  UPDATE folder_sync_state
  SET flagged_not_expunged = COALESCE(flagged_not_expunged, 0) + $1
  WHERE account_id = $2 AND folder_path = $3
  ```

---

### 4. Nit — Redundant `getLiveMessagesInFolder` query in `finishReconcilePass`
- **Severity**: NIT
- **File**: `src/services/imap/reconcilePass.ts` (lines 174, 186)
- **Concern**: When `entry.fetchCompleted` is `true`, `getLiveMessagesInFolder` is called on line 174 and then immediately queried again on line 186 for `localRows`.
- **Trigger**: Any folder that completed fetch and has confirmed suspects.
- **Consequence**: Unnecessary duplicate database select in the sync loop.
- **Fix**: Reuse the `live` array or count obtained on line 174.

---

### 5. Nit — Stop dialog clears on execution failure, preventing retry until next sync
- **Severity**: NIT
- **File**: `src/components/ui/ReconcileStopDialog.tsx` (lines 39–42)
- **Concern**: `finally { dismiss(); }` clears the stop from `uiStore.reconcileStops` even if `deleteConfirmedAfterUserApproval` throws (e.g. SQLite database locked).
- **Trigger**: Temporary database failure during user confirmation.
- **Consequence**: The dialog closes and the user is shown a notice that nothing changed, but cannot retry until the next sync pass encounters the folder again.
- **Fix**: Call `dismiss()` only on success inside the `try` block, leaving the dialog available for retry if an error occurs.

---

## Questions

1. **Unlisted New Folders**: In `imapDeltaSync`, if a newly added folder fails during initial sync, `deltaFolderErrors` is not appended, but `checkedFolders` omits it, causing `attestPass` to return `false`. Is it intended that `allFoldersFailed` (which checks `deltaFolderErrors.length > 0`) does not throw when only new folders fail?
2. **Stop Dialog Metrics**: When the user approves bulk deletion in `ReconcileStopDialog`, `confirmedInFolder` deletes all confirmed absent rows in the folder regardless of `passId`. If a stop dialog was open across multiple sync passes and additional messages became `confirmed_absent`, the dialog message shows the original stop count while `deleteConfirmedAfterUserApproval` deletes the latest count. Should the dialog display be bound to the live count or refresh on update?

---

## What is good

1. **Strict Multi-Pass Safety**: Suspect state promotion is strictly tied to `last_verified_pass_id = this pass`, guaranteeing that single-observation anomalies, network hiccups, or unverified passes never delete rows.
2. **Exclusion of Tombstones**: F-5 tombstones are cleanly excluded from the reconciliation diff and protected from deletion while awaiting destination sync reaping.
3. **Thread and Label Lifecycle**: Threads and thread labels are removed atomically in the same transaction only when `getThreadMessageCount` (which properly counts tombstones) returns `0`.
4. **Resilient Attestation Gate**: Attestation requires 100% folder check coverage, zero errors, and verified listings for every opened gate before any unattended deletion can proceed.
