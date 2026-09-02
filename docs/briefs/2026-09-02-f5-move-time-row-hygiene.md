# Brief — F-5: a moved IMAP message must not keep pointing at its source folder (rev 1)

- **Task:** After Velo moves, archives, trashes or spam-files an IMAP message, the local `messages`
  row still identifies the message by its **source** folder and UID. Make the local row follow the
  message.
- **Tier:** **2** — the correct fix needs Rust IMAP protocol work (`COPYUID` parsing in
  `src-tauri/src/imap/client.rs`), and every option touches a local-deletion or re-key path. Plan
  approved before code; threat pass and rollback below.
- **Status:** rev 1 — **decision-ready, deliberately NOT built.** Written under the 2026-09-02
  delegation window (LOG.md, PR #33) precisely because building it *right* is Rust work that
  collides with E2/P15's rewrite of `client.rs`, and building it *cheap* destroys local-only thread
  state. Both are Jim's call, not a proxy's at 01:00.
- **Base:** `main` @ `31c8b9e` (code pin `0d0b373`). Every citation below was grepped at that pin.
- **Source:** found by the F-4 rev-1 review (Opus HIGH 1); recorded as a live defect in HANDOFF §2d
  since #31. F-4 rev 5 §Not doing: *"F-5 is what keeps the suspect window small enough that
  two-pass stays cheap; if F-5 slips, the suspect table carries far more rows than this design
  assumes."*
- **Effort:** M · 1–2 days for option A once E2 has landed (the Rust half is small; the tests are
  most of it).

## The defect, verified

1. **The only writer of `messages.imap_folder` is the sync upsert** (`db/messages.ts:74-83`,
   `ON CONFLICT(account_id, id) DO UPDATE`). The helper written for exactly this purpose,
   `updateMessageImapFolder` (`imap/messageHelper.ts:126`), has **zero callers** outside its own
   test.
2. **The helper could not suffice anyway.** IMAP message ids are `imap-{accountId}-{folder}-{uid}`
   (CLAUDE.md), and every provider action derives folder and UID **from the id**, not from the
   column: `groupByFolder` (`email/imapSmtpProvider.ts:638`) is what `archive`, `trash`, `spam`,
   `moveToFolder`, `permanentDelete`, `markRead` and `star` all call (`:296-393`). Updating a column
   changes nothing those paths read.
3. **The Rust move returns no new UID.** `move_messages` (`imap/client.rs:540`) returns
   `RemovalResult { expunged: bool }` (`imap/types.rs:115`). `async-imap`'s `uid_mv` / `uid_copy`
   discard the server's untagged `COPYUID` response, which is the only thing that tells us the
   message's new UID in the destination.
4. **Nothing removes the source row after a move.** `DELETE FROM messages` has two sites
   (`db/messages.ts:125,152`): per-message delete and per-account wipe. Neither is on a move path.

### Consequences (what a user can hit today)

- **Actions on an already-moved message target the wrong folder/UID.** Archive a thread, then star
  or mark-read it from search or from the Archive view before the Archive folder has synced: the
  action is sent to the *source* folder with a UID that no longer exists there. On a MOVE-capable
  server that is a no-op or a `NO`; on a COPY-fallback server it can hit whatever message now
  occupies that UID slot after expunge renumbering. **Unverified against a live server; inferred
  from the code paths above.**
- **Duplicate rows after the destination syncs.** The destination folder's next delta sync inserts
  the message under a **new** id (new folder, new UID); the sync upsert keys on `(account_id, id)`,
  so the stale source row is not replaced. Both rows carry the same `message_id_header`, and
  `generateThreadId` (`threading/threadBuilder.ts:121`) is deterministic on the root Message-ID, so
  **both land in the same thread.** Whether the thread view then renders the message twice is
  **unverified** — no read-side dedupe by `message_id_header` was found in `db/threads.ts`,
  `db/messages.ts` or `ThreadView.tsx`, but the check was a grep, not a run.
- **F-4's suspect table inherits every one of these rows** (F-4 rev 5 §Not doing).

## Options

| | A — re-key on `COPYUID` | B — tombstone | C — delete source rows on success |
|---|---|---|---|
| What | Rust parses `COPYUID <uidvalidity> <src-set> <dst-set>` from `UID MOVE`/`UID COPY`; returns the mapping; TS rewrites `id`, `imap_folder`, `imap_uid` for each moved row in one transaction | New column `messages.moved_to` (folder); tombstoned rows hidden from actions and lists; reaped when the destination sync inserts the same `message_id_header`, or by F-4's confirmed-absent path | Delete the moved rows; keep the thread row if it has other messages or local-only state; destination sync re-creates the row |
| Correctness | Exact — the row *is* the message, identity preserved, no window | Correct on read paths that honour the flag; the stale row still exists until reaped | Correct for message rows; **thread state at risk** |
| Local-only thread state (pins, mutes, `thread_labels`, snooze) | Untouched — `thread_id` unchanged | Untouched | Preserved only if the thread row survives; the "no other messages" case needs a rule for pinned/labelled empty threads that does not exist today |
| Needs UIDPLUS | **Yes** for the mapping; without it, fall back to B or C for that account (`caps.has_uidplus` already exists since #26) | No | No |
| Rust change | `client.rs` move/copy paths + `RemovalResult` → `MoveResult { expunged, mapping: Option<Vec<(u32,u32)>> }` — **collides with E2** | None | None |
| Migration | None | **One**, paired (Tier 2 by itself) | None |
| FK impact | `attachments(account_id, message_id)` is the only FK (`migrations.ts:107`); re-key must update it in the same transaction (or the cascade deletes cached attachments) | None | Cascade deletes cached attachments; re-fetched on next open |
| Tier | 2 (Rust IMAP) | 2 (migration) | 1 as code, but a data-affecting judgement |

**Not an option: calling `updateMessageImapFolder` as written.** See defect item 2.

## Recommendation

**A, after E2/P15 lands, with B's hidden-row semantics as the fallback for `has_uidplus == false`
accounts — and nothing built before then.** Reasons: A is the only option where the local row is
the message rather than a description of where it used to be; every server Velo is likely to meet
(Gmail, Fastmail, Exchange, Dovecot) advertises UIDPLUS, so the fallback is rare; and the Rust half
is a few lines *once E2's session pool owns the command path* — writing it now against the
pre-pool `client.rs` guarantees a conflict on the most expensive kind of rebase (a Tier-2 credential
change). PR E's `async-imap` 0.11 bump may or may not expose `COPYUID` directly — **unverified;
check its changelog before designing the parser.**

C is rejected: it converts a stale-pointer bug into a lost-pins bug, and the empty-thread rule it
needs is a product decision.

## Done when (for the A build, later)

1. Harness test: move a message on a UIDPLUS session → the local row's `id`, `imap_folder`,
   `imap_uid` change in one transaction; `attachments.message_id` follows; `thread_id`, pins,
   labels unchanged; the destination's next sync **updates** that row (upsert hits) instead of
   inserting a second.
2. Harness test: no-UIDPLUS session → the row is hidden from `groupByFolder` and from thread
   listing until the destination sync inserts the fresh row, at which point the stale one is reaped.
3. Rust unit tests for the `COPYUID` parser: single UID, ranges, multiple sets, absent response,
   malformed response (must not panic — hostile bytes are the P1 threat class).
4. Live Dovecot transcript (the #26 harness, Alpine variant): move with a second client watching;
   the local DB shows one row, in the destination, with the server's UID.
5. The F-4 spec's coupling note can be struck.

## Threat pass (Tier 2)

The server's `COPYUID` now drives local identity. A hostile or buggy mapping can at worst re-key a
row to a UID that does not exist (next action fails cleanly, next sync corrects it) or collide with
an existing local id (must be rejected: `INSERT`/`UPDATE` under the composite PK will fail, and the
transaction rolls back). Parser must be total over arbitrary bytes. No credential is touched; the
mapping crosses IPC as plain integers and is validated (`u32`, non-empty, sets well-formed) before
any SQL.

## Rollback

Revert the PR. Option A has no migration; rows re-keyed before the revert are simply correct rows.
Option B's fallback column is dropped by its paired down-migration; tombstoned rows revert to being
stale rows — no worse than today.

## Not doing

- Building tonight (see Status).
- Fixing the read-side duplicate rendering separately — if it exists it is a symptom of this defect,
  and A removes the cause.
- QRESYNC — F-4's follow-on, unchanged.

## Approval

- **Plan approval:** __________ (Jim) date: ______ — *deliberately not taken under the delegation.*
- **Opposite-line plan read:** requested from the Opus seat on the PR that carries this brief, so
  the option analysis is checked before Jim spends time on it.
- **Sequencing decision embedded here for Jim to confirm or reject:** F-5 (A) builds **after E2,
  before F-4**, on the Opus line that will then own `client.rs`.
