# Brief — F-5: a moved IMAP message must not keep pointing at its source folder (rev 2)

- **Task:** After Velo moves, archives, trashes or spam-files an IMAP message, the local `messages`
  row still identifies the message by its **source** folder and UID. Make the local row follow the
  message.
- **Tier:** **2** — the correct fix needs Rust IMAP protocol work (`COPYUID` parsing in
  `src-tauri/src/imap/client.rs`), and every option touches a local-deletion or re-key path. Plan
  approved before code; threat pass and rollback below.
- **Status:** rev 2 — **decision-ready, deliberately NOT built.** Rev 1 was written under the
  2026-09-02 delegation window (LOG.md, PR #33). Rev 2 adopts the opposite-line plan read (Opus seat,
  at `be6a50e`): the two items rev 1 marked *unverified* now have answers, **one of which changes
  option A's cost and the sequencing argument** — `COPYUID` is already parsed by a crate in the
  build graph and is reachable without a new parser (§Defect item 3, §Options, §Recommendation).
  Building it *cheap* still destroys local-only thread state; that part is unchanged. Approval is
  Jim's.
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
3. **The Rust move returns no new UID — but the data is already in reach (rev 2).**
   `move_messages` (`imap/client.rs:540`) returns `RemovalResult { expunged: bool }`
   (`imap/types.rs:115`), and `async-imap` 0.10.4's `uid_mv` returns `Result<()>`
   (`client.rs:920`), discarding the server's `COPYUID`. Rev 1 concluded that meant writing a
   parser. It does not: **`imap-proto` 0.16 (already in the build graph under `async-imap`) parses
   `COPYUID` into `ResponseCode::CopyUid(u32, Vec<UidSetMember>, Vec<UidSetMember>)`**
   (`types.rs:139`, RFC 4315 parser at `parser/rfc4315.rs:54`), and `async-imap`'s
   `handle_unilateral` has a `_ =>` catch-all (`parse.rs:460`) that forwards any untagged response
   it does not special-case to the caller's **unsolicited-response channel** as
   `UnsolicitedResponse::Other(ResponseData)`. A `* OK [COPYUID …]` is none of the four it
   special-cases, so it lands on that channel with the parsed code inside. Verified in the cargo
   registry source by both seats; **not** yet against a live server. Two caveats that must shape
   the design: the forward is `try_send(..).ok()` — best-effort, a full channel drops it silently,
   so "no mapping arrived" must be a supported outcome (it must be anyway for non-UIDPLUS
   servers); and whether the response is delivered on the same command turn as the tagged `OK`
   is exactly what the Dovecot harness in Done-when 4 exists to confirm.
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
  **both land in the same thread — and the thread view renders the message twice.** Rev 1 left
  this unverified (a grep for the *absence* of dedupe); rev 2 upgrades it to **verified by a
  positive trace of every step** (Opus seat): `getMessagesForThread` (`db/messages.ts:39`) is
  `SELECT * … WHERE thread_id = $2 ORDER BY date ASC` with no `DISTINCT` and no grouping on
  `message_id_header`; `ThreadView.tsx:83` puts the rows straight into state; `ThreadView.tsx:428`
  is `messages.map(… <MessageItem …>)` with no filter. **Two consequences rev 1 missed, same
  file:** the print/HTML path (`ThreadView.tsx:195`) and the `.eml` export (`:328`) map the same
  array, so a duplicated row is also duplicated in printed output and in exported mail — artefacts
  that leave the app. Still not a live-server run; it is a code-path trace.
- **F-4's suspect table inherits every one of these rows** (F-4 rev 5 §Not doing).

## Options

| | A — re-key on `COPYUID` | B — tombstone | C — delete source rows on success |
|---|---|---|---|
| What | Rust parses `COPYUID <uidvalidity> <src-set> <dst-set>` from `UID MOVE`/`UID COPY`; returns the mapping; TS rewrites `id`, `imap_folder`, `imap_uid` for each moved row in one transaction | New column `messages.moved_to` (folder); tombstoned rows hidden from actions and lists; reaped when the destination sync inserts the same `message_id_header`, or by F-4's confirmed-absent path | Delete the moved rows; keep the thread row if it has other messages or local-only state; destination sync re-creates the row |
| Correctness | Exact — the row *is* the message, identity preserved, no window | Correct on read paths that honour the flag; the stale row still exists until reaped | Correct for message rows; **thread state at risk** |
| Local-only thread state (pins, mutes, `thread_labels`, snooze) | Untouched — `thread_id` unchanged | Untouched | Preserved only if the thread row survives; the "no other messages" case needs a rule for pinned/labelled empty threads that does not exist today |
| Needs UIDPLUS | **Yes** for the mapping; without it, fall back to B or C for that account (`caps.has_uidplus` already exists since #26) | No | No |
| Rust change | **(rev 2)** Drain the session's unsolicited-response channel after `uid_mv`/`uid_copy` and match `ResponseCode::CopyUid` — no parser to write; `RemovalResult` → `MoveResult { expunged, mapping: Option<Vec<(u32,u32)>> }` to carry it across IPC. Touches the move command's *result*, not its protocol internals; **the `client.rs` collision with E2 is therefore small, and is not the reason for the sequencing** (see §Recommendation) | None | None |
| Migration | None | **One**, paired (Tier 2 by itself) | None |
| FK impact | `attachments(account_id, message_id)` is the only FK (`migrations.ts:107`); re-key must update it in the same transaction (or the cascade deletes cached attachments) | None | Cascade deletes cached attachments; re-fetched on next open |
| Tier | 2 (Rust IMAP) | 2 (migration) | 1 as code, but a data-affecting judgement |

**Not an option: calling `updateMessageImapFolder` as written.** See defect item 2.

## Recommendation

**A, after E2/P15 lands, with B's hidden-row semantics as the fallback for `has_uidplus == false`
accounts — and nothing built before then.** A is the only option where the local row *is* the
message rather than a description of where it used to be, and every server Velo is likely to meet
(Gmail, Fastmail, Exchange, Dovecot) advertises UIDPLUS, so the fallback is rare.

**The sequencing reason changed in rev 2, and Jim should confirm the ordering against the new
reason, not the old one.** Rev 1 said "after E2" because option A would rewrite `client.rs`'s move
path and collide with E2's rewrite of the same file. With `COPYUID` arriving on a channel the
session already owns, that collision is small. The reason that remains is weaker but real: **E2
changes who owns the session, and reading an unsolicited channel is exactly what the pool's
checkout semantics touch** — a `COPYUID` that arrives after `release_ok` has a different owner, and
a session evicted on error takes its undrained channel with it. Designing the drain against the
pre-pool session and then re-deriving it under the pool is the expensive order; designing it once
under the pool is the cheap one. So: after E2, for that reason. If Jim judges the ownership
interaction tolerable, A could be built before E2 on the pre-pool session at the cost of one
re-derivation later — recorded as an option, not recommended.

**PR E's `async-imap` 0.11 bump is no longer load-bearing.** Rev 1 made the parser design wait on
it; the data is already reachable on 0.10.4. Check the channel first; let 0.11 be an ordinary bump.

C is rejected: it converts a stale-pointer bug into a lost-pins bug, and the empty-thread rule it
needs is a product decision.

## Done when (for the A build, later)

1. Harness test: move a message on a UIDPLUS session → the local row's `id`, `imap_folder`,
   `imap_uid` change in one transaction; `attachments.message_id` follows; `thread_id`, pins,
   labels unchanged; the destination's next sync **updates** that row (upsert hits) instead of
   inserting a second.
2. Harness test: no-UIDPLUS session → the row is hidden from `groupByFolder` and from thread
   listing until the destination sync inserts the fresh row, at which point the stale one is reaped.
3. **(re-scoped in rev 2 — Velo owns no parser.)** Rust tests for the *drain*, four cases:
   mapping present (single UID and a range, via `imap-proto`'s own types); mapping absent
   (non-UIDPLUS server, or the best-effort channel dropped it) → `mapping: None` and the caller
   takes the fallback; mapping present but unusable (set lengths differ, UID outside `u32`) →
   treated as absent, never a panic; and **a mapping whose destination UID collides with an
   existing local id** → the re-key transaction is rejected by the composite PK and rolled back,
   the row is left as it was. The last is the one the threat pass depends on.
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
- **Opposite-line plan read: done** (Opus seat, at `be6a50e`, on PR #36) — *"the analysis holds,
  the recommendation needs one revision."* Both of its verifications and its re-scoping of
  Done-when 3 are adopted in rev 2; the `COPYUID` trace was re-verified independently by the
  author in the cargo registry source before adoption. Re-read requested at the rev-2 head.
- **Sequencing decision embedded here for Jim to confirm or reject:** F-5 (A) builds **after E2,
  before F-4** — **on the ownership-interaction reason in §Recommendation, not the
  parser-collision reason rev 1 gave.** The before-E2 alternative is recorded there as an option.
