## Verdict

CHANGES REQUESTED — While the core two-pass state machine and rate-limiting math faithfully match SPEC-F-4 rev 5, a critical discrepancy between the timeout comment and code in Rust leaves desynchronized IMAP connections in the pool, and `clearReappeared` introduces severe O(N) database/IPC thrashing on large mailboxes.

---

## Findings

### 1. HIGH — Desynchronized IMAP session returned to pool on timeout instead of being evicted
- **File:** `src-tauri/src/imap/client.rs` (lines 878–886, 919–927)
- **Concern:** The function comment explicitly notes: `// A *timeout* additionally ends the pass: the session is desynchronised mid-protocol, so every later folder is unchecked too and nothing further is sent on this connection (the caller's Err path evicts it).` However, the code executes `return Ok(results);`.
- **Trigger:** A `SELECT` or `UID SEARCH` command times out during `delta_check_folders`.
- **Consequence:** Because `delta_check_folders` returns `Ok(...)`, the TS caller `withSession(accountId, "sync", {}, ...)` resolves successfully without throwing. `withSession` assumes the connection is healthy and returns it to the active pool. The underlying TCP/TLS stream remains mid-command with unread bytes pending. Subsequent sync operations checking out this session will receive corrupted/misaligned IMAP protocol frames, leading to erratic errors or bogus UID responses.
- **Suggested fix:** Either explicitly close/poison the underlying IMAP stream in Rust before returning `Ok(results)`, or have `delta_check_folders` return `Err(...)` (or set a session error flag) so that `withSession` immediately evicts the session from the pool.

---

### 2. MEDIUM — `clearReappeared` runs O(server_uids / 400) IPC `DELETE` queries on every full search
- **File:** `src/services/imap/reconcile.ts` (lines 137–154)
- **Concern:** `clearReappeared` chunks `presentUids` into slices of 400 and issues sequential `DELETE FROM reconcile_suspects WHERE ... uid IN (...)` statements across Tauri IPC for the entire server UID list.
- **Trigger:** Any delta sync where `EXISTS` mismatches and a full `UID SEARCH ALL` runs on a folder with thousands of messages (e.g., 20,000–50,000 UIDs).
- **Consequence:** On a 20,000-message folder, `clearReappeared` executes 50 separate IPC round-trips and SQL `DELETE` queries with 400 parameters each, even though `reconcile_suspects` almost always contains 0 rows for that folder. This causes severe main-thread lag, IPC overhead, and unnecessary SQLite write locking during routine syncs.
- **Suggested fix:** In `clearReappeared`, query `reconcile_suspects` first: `SELECT uid FROM reconcile_suspects WHERE account_id = $1 AND folder = $2 AND uidvalidity = $3`. If no suspects exist (the 99.9% case), exit immediately (0 `DELETE` queries). If suspects do exist (typically a few rows), filter in-memory against `presentUidsSet` and delete only those specific suspect UIDs.

---

### 3. MEDIUM — Fallback path in `imapDeltaSync` drops failed folders from `deltaResultMap`
- **File:** `src/services/imap/imapSync.ts` (lines 1051–1055)
- **Concern:** In the `catch (err)` per-folder fallback loop, when a per-folder check throws `folderErr`, nothing is inserted into `deltaResultMap`.
- **Trigger:** Batch delta check fails, triggering the fallback loop, and an individual folder status check or UID fetch fails.
- **Consequence:** The failed folder is completely omitted from `deltaResultMap`. The commit claim that the "fallback path sets exists/checked/error" is only true for successful fallback checks. If Part 2 validates the pass attestation (`checked-set == syncableFolders-set`, REQ-1.2b) by evaluating `Array.from(deltaResultMap.values()).every(r => r.checked)`, a pass with failed folders during fallback could falsely evaluate as clean/complete because the failed folders are missing from the map rather than marked `checked: false`.
- **Suggested fix:** In the fallback `catch (folderErr)` handler, populate `deltaResultMap`:
  ```ts
  deltaResultMap.set(req.folder, {
    folder: req.folder,
    uidvalidity: req.uidvalidity,
    new_uids: [],
    uidvalidity_changed: false,
    exists: 0,
    checked: false,
    error: String(folderErr),
  });
  ```

---

### 4. LOW — `recordMissing` executes sequential unbatched `INSERT`s without a transaction
- **File:** `src/services/imap/reconcile.ts` (lines 118–126)
- **Concern:** `recordMissing` runs individual `INSERT OR IGNORE` queries in a JS `for` loop over `chunk` without wrapping the chunk or function in `withTransaction`.
- **Trigger:** `recordMissing` is called with multiple missing UIDs (e.g., 200–500 messages vanished due to a server-side bulk move/archive).
- **Consequence:** Executing hundreds of standalone `db.execute` calls without an explicit transaction causes SQLite to run each insert in its own autocommit transaction, incurring separate fsync/journal overhead and IPC round-trips. Furthermore, a failure midway leaves a partially inserted batch.
- **Suggested fix:** Wrap the loop in `withTransaction` and/or format multi-row `INSERT OR IGNORE INTO reconcile_suspects (...) VALUES (...), (...)` statements.

---

### 5. NIT — Sub-optimal index on `reconcile_suspects`
- **File:** `src/services/db/migrations.ts` (line 850)
- **Concern:** `idx_reconcile_suspects_status` indexes `(account_id, status, last_verified_pass_id)`, omitting `folder`.
- **Trigger:** `confirmedOnPass` executes `WHERE account_id = $1 AND folder = $2 AND status = 'confirmed_absent' AND last_verified_pass_id = $3`.
- **Consequence:** SQLite must scan all matching rows for the account across all folders before filtering down by `folder`.
- **Suggested fix:** Change index definition to `(account_id, folder, status, last_verified_pass_id)`.

---

### 6. NIT — `diffVanished` does not deduplicate `localUids`
- **File:** `src/services/imap/reconcile.ts` (lines 20–27)
- **Concern:** If `localUids` contains duplicate values, `vanished` will contain duplicates.
- **Trigger:** Local database query or iterable contains duplicate UIDs.
- **Consequence:** Redundant entries propagate into `recordMissing` chunks.
- **Suggested fix:** Return `Array.from(new Set(vanished)).sort((a, b) => a - b);`.

---

## Questions the author should answer

1. **Session Eviction on Timeout:** In `client.rs`, the comment states that the caller's `Err` path evicts the session, but the function returns `Ok(results)`. How should the connection pool be notified to close and discard the poisoned IMAP socket when a timeout occurs mid-pass?
2. **Attestation Evaluation in Part 2:** How will Part 2 construct the pass attestation? Will it verify `deltaResultMap` against the full domain of syncable folders (`syncableFolders.every(f => deltaResultMap.get(f.raw_path)?.checked)`), ensuring omitted folders in fallback cannot masquerade as clean passes?
3. **`clearReappeared` Inversion:** Was there a specific design reason to pass the entire server UID list into chunked `DELETE` queries instead of selecting local suspect rows and deleting only those that reappeared?

---

## What is good

- **Spec Alignment on Two-Pass State Machine (REQ-1.1, REQ-1.5):** The state machine strictly prevents first-sight deletions. Newly missing UIDs are inserted as `suspect`, and promotion to `confirmed_absent` requires verification on a subsequent pass (`first_pass_id <> passId`).
- **Mathematical Correctness of Deletion Cap & Hard Stop (REQ-3.1):** `deletionCap` and `planDeletions` correctly implement `min(500, max(10, ⌈10%⌉))` as a batching budget rather than a precondition, handle the >50% stop strictly for folders >10 rows, and correctly allow small folders (≤10 rows) to clear in one pass.
- **Defensive Boundary Validation (REQ-1.1):** `imapSearchAllUids` strictly validates that the response from Rust is an array of positive integers. Rejecting null, malformed, or non-array responses avoids treating an IPC/Rust error as an empty list (which would otherwise register as "all messages vanished").
- **Generational Isolation (REQ-1.5):** `purgeOtherGenerations` guarantees that mailbox UIDVALIDITY resets purge stale suspect records before diffing, preventing new messages from being deleted due to recycled UIDs.
- **Rigorous SQLite Test Harness:** The test suite in `reconcile.test.ts` executes against real SQLite migrations with foreign keys enabled, thoroughly exercising multi-pass promotions, gate skips, reappearance clears, and generation purges.
