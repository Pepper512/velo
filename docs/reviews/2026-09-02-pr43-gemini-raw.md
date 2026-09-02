## Verdict

**CHANGES REQUESTED** — The move-rekey implementation is well-architected and thoroughly tested against SQLite constraints, but `reapMovedTombstones` deletes tombstoned rows globally on `message_id_header` without verifying the destination folder, causing premature deletion of cached message bodies and cascading deletion of attachments before the destination folder syncs, alongside missing destination UID uniqueness validation in the parser and IPC boundaries.

---

## Findings

### 1. HIGH — Premature deletion of tombstone rows and attachments across folders
- **File**: `src/services/db/messages.ts` (lines 134–136, 287–295)
- **Concern**: `reapMovedTombstones` deletes tombstoned rows matching `message_id_header` without checking that the upserted folder matches `moved_to`.
- **Trigger**: A message in folder $A$ is moved to folder $B$ without UIDPLUS and tombstoned (`moved_to = 'FolderB'`). Before folder $B$ syncs, an unrelated IMAP sync in folder $C$ (e.g., `Sent`, `All Mail`, or an incoming reply with the same `message_id_header`, or a message with an empty `""` / malformed header) calls `upsertMessage`.
- **Consequence**: `DELETE FROM messages WHERE account_id = $1 AND message_id_header = $2 AND moved_to IS NOT NULL AND id <> $3` executes and deletes the tombstoned row in folder $A$ immediately. Because `attachments` has an `ON DELETE CASCADE` foreign key to `messages`, all cached attachments and the message row for folder $A$ are purged from SQLite before folder $B$ has ever synced the message. If the client goes offline before folder $B$ syncs, the message and its attachments vanish locally. Furthermore, if `message_id_header` is empty or generic, upserting an unrelated message can delete all tombstoned messages across the entire account.
- **Suggested Fix**:
  1. Pass `msg.imapFolder` into `reapMovedTombstones(msg.accountId, msg.messageIdHeader, msg.id, msg.imapFolder)`.
  2. Scope the deletion to matching destination folders: `DELETE FROM messages WHERE account_id = $1 AND message_id_header = $2 AND moved_to = $4 AND id <> $3`.
  3. Ensure `reapMovedTombstones` is only invoked when `message_id_header` is a non-empty string (`msg.messageIdHeader.trim().length > 0`).

---

### 2. MEDIUM — Missing destination UID uniqueness validation causes transaction abort and re-key failure
- **Files**:
  - `src-tauri/src/imap/copyuid.rs` (lines 102–105)
  - `src/services/imap/tauriCommands.ts` (lines 191–197)
  - `src/services/db/messages.ts` (lines 201–213)
- **Concern**: Both `mapping_from_response` in Rust and `parseUidMapping` in TypeScript validate that `source_uid` values are unique, but neither checks that `dest_uid` values are unique. Additionally, `rekeyMovedMessages` does not track target IDs assigned within the current batch.
- **Trigger**: A broken or non-compliant IMAP server returns duplicate destination UIDs (e.g., `COPYUID 1 5,6 10,10`), or multiple source messages map to the same destination UID.
- **Consequence**: The pre-check `SELECT id FROM messages ... WHERE id IN (...)` checks the database and sees `newId` (`imap-acc-1-Dest-10`) as unoccupied. During the update loop, the first pair succeeds and updates row 5 to `newId`. The second pair attempts to update row 6 to `newId`, causing a SQLite `PRIMARY KEY (account_id, id)` constraint violation. The entire transaction rolls back, and `settleMovedRows` catches the error and degrades *all* messages in the batch to tombstones instead of completing valid re-keys.
- **Suggested Fix**:
  1. In `copyuid.rs`, validate destination UID uniqueness:
     ```rust
     let mut seen_dest = std::collections::HashSet::with_capacity(dest.len());
     if !dest.iter().all(|uid| seen_dest.insert(*uid)) {
         return None;
     }
     ```
  2. In `tauriCommands.ts`, validate `dest_uid` uniqueness in `parseUidMapping` (`seenDest.has(dest_uid)`).
  3. In `rekeyMovedMessages`, add `taken.add(pair.newId)` as pairs are processed to prevent self-collisions within the same batch.

---

### 3. MEDIUM — Concurrent sync race leaves permanent zombie tombstones
- **Files**: `src/services/imap/moveHygiene.ts` (lines 68–89) & `src/services/db/messages.ts` (lines 187–251)
- **Concern**: Pre-check-then-UPDATE in `rekeyMovedMessages` can race with a concurrent destination folder sync, resulting in permanent un-reaped tombstones.
- **Trigger**:
  1. `rekeyMovedMessages` runs `SELECT id FROM messages ...` and finds `newId` does not exist.
  2. A concurrent background sync for the destination folder runs `upsertMessage` for `newId` and calls `reapMovedTombstones`. At this moment, `oldId` has `moved_to IS NULL`, so 0 rows are reaped.
  3. `rekeyMovedMessages` proceeds to `UPDATE messages SET id = newId ...`, which fails with a PK collision against the newly inserted row and rolls back the transaction.
  4. `settleMovedRows` catches the error and falls back to `tombstoneMovedMessages`, setting `moved_to = destFolder` on `oldId`.
- **Consequence**: `oldId` is now marked with `moved_to = destFolder`, but the destination sync's `reapMovedTombstones` has *already* executed. Unless that message is re-synced in the future, `oldId` is never deleted and remains a permanent zombie tombstone in the database.
- **Suggested Fix**: When `rekeyMovedMessages` detects collisions or catches a rollback, check if `newId` already exists in `messages` with matching `message_id_header`; if it does, immediately delete `oldId` (or reap it) rather than marking it as a tombstone that will never be visited again.

---

### 4. LOW — Non-atomic rekey and tombstone execution across app termination
- **File**: `src/services/imap/moveHygiene.ts` (lines 67–88)
- **Concern**: `rekeyMovedMessages` and `tombstoneMovedMessages` are executed as separate database operations rather than inside a single atomic transaction.
- **Trigger**: The application process is abruptly terminated (SIGKILL, crash, power loss) after `rekeyMovedMessages` commits its transaction for mapped rows, but before `tombstoneMovedMessages` executes for unmapped/skipped UIDs.
- **Consequence**: The unmapped/skipped messages are left in the local database with their stale source folder and source UID and `moved_to IS NULL`. Subsequent actions on those messages target the wrong folder/UID until a full sync occurs.
- **Suggested Fix**: Wrap both re-keying and tombstoning inside a single `withTransaction` block within `moveHygiene.ts`.

---

### 5. LOW — `keepLiveMessageIds` silently drops user actions on moved messages
- **File**: `src/services/imap/messageHelper.ts` (lines 139–165)
- **Concern**: `keepLiveMessageIds` filters out any message ID where `moved_to IS NOT NULL` or where the ID is not yet in SQLite.
- **Trigger**: A user performs a non-move action (e.g., `star`, `markRead`) on a thread containing a message that was moved under Option B fallback and is currently tombstoned awaiting sync.
- **Consequence**: The message ID is dropped with only a `console.warn`. The user's action (`star`, `markRead`) is silently swallowed for that message and neither applied locally nor sent to the server.
- **Suggested Fix**: For metadata actions (`markRead`, `star`), record the intent / pending flag update on the tombstoned row or return an explicit outcome to the caller so the UI does not show false state.

---

### 6. NIT — Missing partial index on `moved_to`
- **File**: `src/services/db/migrations.ts` (lines 803–820)
- **Concern**: Migration 25 adds column `moved_to TEXT` without an index, while `getMessagesForThread` and `keepLiveMessageIds` now append `AND moved_to IS NULL` to their query filters.
- **Trigger**: Executing queries across mailboxes with tens of thousands of messages.
- **Consequence**: While `thread_id` and `id` indexes provide fast initial lookups, queries filtering by `moved_to IS NOT NULL` during cleanup or tombstone scanning require table scans.
- **Suggested Fix**: Consider adding a partial index `CREATE INDEX idx_messages_tombstones ON messages(account_id, message_id_header) WHERE moved_to IS NOT NULL;` to optimize `reapMovedTombstones`.

---

## Questions the author should answer

1. **Connection Pinning in `tauri-plugin-sql`**: `rekeyMovedMessages` relies on `PRAGMA defer_foreign_keys = ON;`. In `tauri-plugin-sql` / `sqlx`, does `withTransaction` guarantee that all queries in the callback share the exact same underlying connection from the pool, ensuring that connection-scoped PRAGMAs remain active until `COMMIT`?
2. **Flag mutations on tombstoned rows**: If a user stars or marks a thread as read while some messages in it are tombstoned awaiting destination sync, what is the expected lifecycle for propagating those flag changes once the destination row arrives?
3. **Empty Message-ID handling**: How should messages lacking a `Message-ID` header (e.g., drafts, local imports, or malformed provider messages) be handled when moved on non-UIDPLUS servers, given that `reapMovedTombstones` keys exclusively on `message_id_header`?

---

## What is good

- **Zero-parser design**: Leveraging `async-imap`'s `unsolicited_responses` channel and `imap-proto`'s existing `ResponseCode::CopyUid` AST avoided introducing fragile, custom IMAP response parsers in Rust.
- **Bounded expansion and memory safety**: Bounding `MAX_COPYUID_MEMBERS = 10_000` and pre-checking range spans `(hi - lo)` in `copyuid.rs` provides robust protection against memory exhaustion from malicious or malformed `1:4294967295` server ranges.
- **Total validation at the IPC boundary**: `parseUidMapping` in TypeScript cleanly degrades any malformed entry or structure to `null`, ensuring corrupted IPC data never reaches SQL queries.
- **Attachment PK rewriting**: The `CASE` expression in `rekeyMovedMessages` accurately preserves the `_${partId}` suffix on `attachments.id` while rewriting the prefix to `newId`, preventing orphaned attachment rows.
- **Thread state preservation**: Leaving `thread_id` untouched during re-keying successfully preserves pins, labels, snoozes, and conversation continuity.
- **Comprehensive SQLite harness tests**: Testing migrations, composite PK constraints, FTS5 triggers, and transaction rollbacks against real SQLite with foreign keys active provides high confidence in the baseline SQL execution.
