# Opus 5 full review — second delegation window (2026-09-02 06:12–08:12 UTC)

Seat: Principal SWE — Architecture & Security (TEAM.md position 5). Reviewed at
`f4-vanished-uid-part1` head `b964b23`, which carries #43 (merged, squash `2792251`)
and #44 (open) stacked.

**Gates I ran myself in the worktree:** `npx tsc --noEmit` clean · `npx vitest run` 157 files
/ 1952 tests passed · `cargo test --locked` 95 passed, 1 ignored · `npm run docs:check` OK
(26 migrations, 32 tables, 157 test files). `gh pr checks 44` — all six required checks green
on `b964b23`, the head commit. The author's gate claims are accurate; the only stale number
is #44's body ("1946 tests") which predates its own last commit.

---

## Verdict

**#43 (F-5, merged) — I would not have merged it as written.** Not because the design is
wrong: the design is good, and better than the brief. The Rust drain is a careful, total
function over untrusted input with real tests; the DB work runs on a real SQLite harness with
real migrations and FK enforcement on; the live Dovecot run on both harness ports is exactly
the right evidence for the one claim unit tests cannot settle. But it shipped one live
regression to a destructive user action — **permanent delete no longer reaches the server**
(Finding 1) — and the test suite contains a test that asserts the regression as intended
behaviour. It also promoted a pre-existing connection-pooling assumption into a load-bearing
precondition for identity rewrites and dispositioned that as "recorded, out of scope"
(Finding 2). Both are follow-up-fixable and neither justifies a revert. Finding 1 must be
fixed before any release build; it is a Tier-2 change in its own right.

**#44 (F-4 part 1, open) — mergeable with changes.** Nothing in it deletes a local row, CI is
green on the head commit, and the substrate is the right shape: the attestation is a real
safety property, the state machine is generation-scoped, `applySearchAll` as the single
atomic entry point is the correct answer to Grok M4. I would ask for Findings 6 and 15 in
this PR (both small, both in files the PR already touches) and for Finding 7 to be answered
in the part-2 plan before part 2 starts. Given what #43 cost, I would also ask that a human
take this one rather than the build seat self-merging it now that the window has closed.

---

## Findings

### 1. HIGH — `permanentDelete` is now a silent no-op: mail is never deleted on the server

- `src/services/email/imapSmtpProvider.ts:354-363` (`permanentDelete` → `groupLiveByFolder`)
- `src/services/imap/messageHelper.ts:139-167` (`keepLiveMessageIds`)
- `src/services/emailActions.ts:202-207` (`applyLocalDbUpdate`, `case "permanentDelete"`)
- `src/services/db/migrations.ts:89` (`messages … FOREIGN KEY (account_id, thread_id) REFERENCES threads(...) ON DELETE CASCADE`)

**Trigger.** The user permanently deletes a thread. `executeEmailAction` (`emailActions.ts:326-372`)
runs in a fixed order: optimistic UI → **local DB update** → offline check → provider call.
The local DB update for `permanentDelete` is `DELETE FROM threads WHERE account_id = $1 AND id = $2`,
which cascades to every `messages` row of that thread. Foreign keys *are* enforced at runtime:
`tauri-plugin-sql` 2.4.1 (`wrapper.rs:91`) uses sqlx, and `sqlx-sqlite-0.8.6/src/options/mod.rs:185`
sets `PRAGMA foreign_keys = ON` by default. Step 4 then calls `provider.permanentDelete`, whose
first act is now `keepLiveMessageIds`, which SELECTs those very rows — and finds none. `grouped`
is empty, the `for` loop body never runs, `imapDeleteMessages` is never invoked.

**Consequence.** Permanent delete stops reaching IMAP entirely. The mail stays on the server,
the local rows are gone, and the next sync re-downloads what the user believes they destroyed.
The queued path is affected identically: `enqueuePendingOperation` runs *after* the local delete,
so `executeQueuedAction` → `executeViaProvider` hits the same empty filter when the queue drains.
Before #43, `groupByFolder` parsed the ids without touching the DB and the delete was issued, so
this is a regression introduced by F-5, not a pre-existing defect.

**It is locked in by a test.** `src/services/email/imapSmtpProvider.test.ts:344-354`
("filters every action, not only the moves") stubs `keepLiveMessageIds` to return `[]` and
asserts `expect(imapDeleteMessages).not.toHaveBeenCalled()`. The test was written from the
implementation rather than from the requirement, so the suite ratifies the bug.

**Fix.** The predicate the actions actually want is *"this id was re-keyed away or tombstoned"*,
not *"this id has a live row"* — those coincide only when the caller has not already deleted the
row for its own reasons. Smallest correct change: for `permanentDelete`, capture the folder/UID
grouping before `applyLocalDbUpdate` runs, or move the local cascade delete to after the provider
call. Better, and it closes the general case: land Grok's M4 (the old→new id alias, currently a
"recorded follow-up") so an unknown id can be distinguished from a re-keyed one, and pass unknown
ids through instead of dropping them. Whatever the fix, the test at :344 has to be rewritten to
state the requirement ("an id that was re-keyed away is not sent; an id whose row the caller
deleted still is").

### 2. HIGH — the re-key transaction is not connection-pinned; `PRAGMA defer_foreign_keys` and `SAVEPOINT` are connection-scoped state

- `src/services/db/connection.ts:39-80` (`withTransaction`)
- `src/services/db/messages.ts:206-262` (`rekeyMovedMessages`)
- `tauri-plugin-sql-2.4.1/src/wrapper.rs:91`: `Pool::connect(conn_url)`

**Trigger.** `Database.load("sqlite:velo.db")` yields an sqlx `Pool` built by `Pool::connect`,
i.e. `PoolOptions::default()` — **`max_connections = 10`, `min_connections = 0`**. Every
`db.execute` / `db.select` is a separate IPC call that acquires a connection independently and
returns it to the idle set. `withTransaction` serialises *transactions* against each other via
`txQueue`, and its own doc comment states that it deliberately does **not** block
non-transactional reads. So any concurrent non-transactional statement — a sync `upsertMessage`,
the `reapMovedTombstones` it now fires, a UI query — can take the idle connection while a re-key
transaction is between statements, at which point sqlx opens a second connection and the
transaction's next statement may land on it.

**Consequence.** `BEGIN` and `PRAGMA defer_foreign_keys = ON` on connection A; `UPDATE messages
SET id = …` autocommitting on connection B; the attachments/soft-ref updates rolling back on A.
That is a message row re-keyed with nothing following it — orphaned or lost attachments and soft
references, committed, silently. The savepoint path degrades the same way:
`ROLLBACK TO SAVEPOINT rekey_pair` on a connection that has no such savepoint raises an error
that `isConstraintFailure` does not match, so the whole batch aborts (see Finding 5).

**Why I am escalating what both reviewers already raised.** Gemini's Q1 and Grok's M5 both hit
this. The disposition was: *"statements are sequential from a single JS thread, so in practice one
connection is ever created and reused; but nothing pins it, and this is exactly the property every
existing `withTransaction` in Velo already depends on. Pre-existing, out of F-5's scope."* The
first clause is an empirical claim about a ten-connection pool that was not checked against the
source, and it is contradicted by `withTransaction`'s own comment. The "pre-existing" half is
true — but F-5 is the first code in Velo to put a **destructive identity rewrite** on that
assumption, and the first to use `defer_foreign_keys` and `SAVEPOINT`, both of which are
per-connection state. That changes the risk class, and a change that changes the risk class of an
existing assumption owns it.

**Fix.** Robust: move `rekeyMovedMessages` into a `#[tauri::command]` that owns one
`SqliteConnection` for the whole transaction. Cheap stopgap: route *all* DB access through
`txQueue`, not only transactions, so the single-connection assumption is at least enforced on the
JS side. Either way this deserves its own brief, as the Gemini answer itself suggested — it just
should not have been closed inside #43 without one.

### 3. MEDIUM — the reap fires an extra DELETE for every IMAP message upserted, on every sync

`src/services/db/messages.ts:130-141`. `upsertMessage` now calls `reapMovedTombstones` for every
IMAP row with a non-empty Message-ID. Trigger: any backfill or full resync, which upserts
thousands of rows. Consequence: one extra IPC round trip and write-lock acquisition per message
on accounts that have never tombstoned anything — 20k extra statements on a 20k-message backfill,
serialised behind the same pool the sync is using. Gemini's NIT 6 (an index on `moved_to`) was
declined on the grounds the lookup is already indexed, which is true and beside the point: the
cost here is the round trip, not the query plan. Fix: keep a cheap per-account "has tombstones"
flag (set in `tombstoneWithin`, cleared when the last tombstone is reaped) and skip the call when
it is false; or reap once per sync batch with the batch's Message-IDs.

### 4. MEDIUM — the UIDVALIDITY guard is disabled exactly where the re-key is most novel

`src/services/imap/moveHygiene.ts:46-56`. `generationMatches` returns `true` when the destination
folder has no `folder_sync_state` row, or its `uidvalidity` is `null`/`0`. Trigger: a move into a
folder Velo has never synced — a folder the user just created, or one outside the sync window,
which is a common destination for `moveToFolder`. Consequence: the Grok-L9 guard that refuses a
mapping from the wrong generation is off for precisely those moves; rows are re-keyed into a
generation Velo cannot corroborate, and if the mailbox is later recreated those ids point at
someone else's mail. Fix: when the mapping is accepted for an unsynced folder, write
`dest_uidvalidity` into `folder_sync_state` inside the same transaction — the COPYUID *is* the
observation, and recording it lets the first real sync detect a disagreement instead of
inheriting one.

### 5. MEDIUM — `isConstraintFailure` is a message-text regex, and a false negative undoes the Grok-M6 fix

`src/services/db/messages.ts:264-267`:
`/constraint|UNIQUE|PRIMARY KEY|FOREIGN KEY/i.test(text)`. Trigger: any SQLite/sqlx error whose
surfaced text does not contain one of those words — a code-only rendering
(`error returned from database: (code: 1555)`), a wrapped/localised message, or the
"no such savepoint" case from Finding 2. Consequence: a benign per-pair collision is re-thrown,
the whole transaction rolls back, and `settleMovedRows` falls back to tombstoning **every** UID in
the move — which is exactly the batch-wide degradation the per-pair savepoint was adopted to
prevent. Fix: invert the rule. The savepoint rollback has already restored the pair either way, so
treat *any* failure of the pair's statements as skip-and-tombstone, and re-throw only if the
`SAVEPOINT` / `ROLLBACK TO` / `RELEASE` statements themselves fail. That is both simpler and
fails in the direction the module says it fails in ("everything here fails toward keep").

### 6. MEDIUM — `recordMissingWithin` issues one INSERT per missing UID

`src/services/imap/reconcile.ts:123-146`. The promotion UPDATE is chunked at 400; the
`INSERT OR IGNORE` beneath it is a per-row loop. Trigger: a bulk server-side removal (a rule that
empties Trash, a mailbox cleanup) reports thousands of vanished UIDs. Consequence: thousands of
sequential IPC statements inside one transaction, holding `txQueue` and the SQLite write lock for
the duration. This is the same complaint Gemini filed as M2 against `clearReappeared` in the same
file, which was adopted; the sibling was left. Fix: multi-row
`INSERT OR IGNORE … VALUES (…),(…),…` in the chunks the function already computes.

### 7. MEDIUM (for part 2 to settle) — the >50% stop is per-pass, not cumulative

`src/services/imap/reconcile.ts:62-72`. `planDeletions` evaluates the stop against the folder's
*current* row count, which the previous pass's deletions already shrank, and the `localRows > 10`
qualifier lets a small folder clear fully. Worked example: an 11-row folder, 5 UIDs confirmed
absent → no stop, budget 5, five rows deleted, 6 rows left. Next pass, the remaining 6 confirmed
→ `localRows > 10` is now false → budget 6 → the folder clears completely, even though 11 of 11
rows vanishing is the mass-vanish event the stop exists to catch. The vault spec records the
*cliff* ("a 10-row folder may clear fully; an 11-row folder blocks at 6 suspects"); it does not
record that the cliff erodes across passes. The monotonicity argument in the doc comment
((S−k)/(R−k) strictly decreasing) is correct and proves the ratio cannot *rise*, which is a
different property from the one a reader will assume. Fix for part 2: evaluate the stop against
the row count as of first confirmation, or keep a per-folder cumulative deleted-this-episode
counter, so the 50% test is against the population that existed when the suspects were raised.

### 8. LOW — a two-copy mailbox loses one cached copy on the first destination arrival

`src/services/db/messages.ts:378-390`. `reapMovedTombstones` deletes *every* row with the given
`message_id_header` and `moved_to = arrivedIn` except the fresh one; there is no 1:1
correspondence between tombstones and arrivals. Two local rows sharing a Message-ID (a duplicate
delivery, a filter that files to two places) moved to the same folder produce two tombstones, and
the first fresh arrival reaps both — the second copy's cached body and attachments go with it
until its own row is upserted (normally later in the same batch, so transient). The Gemini-H1 fix
narrowed this correctly from "any folder" to "this folder"; it did not make it one-for-one. Note
also that Message-ID is sender-controlled, so a message that merely shares a Message-ID and lands
in the destination folder reaps a genuine tombstone. Both losses are cache-only and recoverable
by re-fetch, which is why this is LOW. Fix if wanted: reap one row per arrival, or record the
source UID on the tombstone and reap by identity rather than by header.

### 9. LOW — the drain accepts a COPYUID whose source set is not the set Velo asked to move

`src-tauri/src/imap/copyuid.rs:97-150` (`mapping_from_response`) validates set lengths,
the cap, zeros and duplicates, but never compares the source set against the UIDs the command
sent. The only defences against a stale/foreign COPYUID are `discard_pending` before the MOVE
(`client.rs:564-573`) and the "two mappings → none" rule — neither closes a single stale response
that lands between the discard and the command. The frontend partly mitigates it
(`moveHygiene.ts:80-97` only consults the map for UIDs it requested, so extra pairs contribute
nothing and missing ones fall through to tombstone), so the exploitable residue is narrow. Fix is
one line and worth having: pass the requested UID set into the drain (or check it in
`settleMovedRows`) and reject a mapping whose sources are not a subset of it.

### 10. LOW — the per-folder delta fallback does not feed the circuit breaker

`src/services/imap/imapSync.ts:1057-1075`. The fallback's `catch` now records the folder as
unchecked (the Gemini-M3 / Grok-M3 fix, correct) but — unlike the new-folder loop above it at
:991-1000 — it does not push to `deltaFolderErrors` and does not increment `consecutiveFailures`.
Trigger: F-4 changed a batch timeout from `continue` to `Err`, so the fallback path now runs for
the *whole account* on any batch timeout, one sequential `withSession` per folder. Consequence: a
server that is timing out gets N sequential round trips per pass with no breaker and no entry in
the pass's error list, on the path that was specifically made more reachable. Fix: mirror the
new-folder loop — push the error and count connection errors.

### 11. LOW — a queued operation whose ids were re-keyed is dropped silently

Recorded as Grok M4 / a follow-up, and I agree it does not belong in #43. But the *silence* is the
part to fix: `keepLiveMessageIds` logs to `console.warn` and the user gets no signal that a
queued star/archive was discarded. Until the alias exists, surface a notice.

### 12. NIT — `DeltaCheckResult.checked` is a name that invites the mistake it documents

`src-tauri/src/imap/types.rs:130-146` and `src/services/imap/tauriCommands.ts:97-115` both carry
long comments explaining that `checked` is *not* "a `UID SEARCH ALL` ran" (it is `true` on the
UIDVALIDITY-changed row, which runs no search). Grok M2 caught this and the part-2 plan now
attests from two bits, which is right. Rename the field to `delta_checked` before part 2 so the
misreading is unavailable rather than merely warned against.

### 13. NIT — #44's body reports 1946 frontend tests; its head commit produces 1952

The last fix-up added six tests after the body was written. Trivial, but in a process where the
PR body is the evidence artifact, the numbers should be re-stamped at the final push.

---

## Governance

**Was the delegation exercised within its terms?** Substantially, yes. The instruction was
"build F-5 (option A, rev 2), then F-4 (rev 5), then continue", with every project decision
pre-approved for the window and an Opus review commissioned at the close. Both items were built,
in that order, on plans Jim had approved *directly* in #40 before the window opened — so the
Tier-2 "plan approved before code" requirement was satisfied by a real human approval, not by the
window's blanket pre-approval. That distinction matters and the LOG entry makes it explicitly
(#40 predates the window; the seat did not approve its own plans).

**The single best decision of the window** was cutting F-4 to a substrate that deletes nothing and
deferring the deleting half to a written part-2 plan, rather than pushing a mail-deleting path
through the last forty minutes. That is the judgment the tier system exists to produce, and the
seat produced it without being asked.

**The two named deviations were handled correctly in form.** Both appear in the LOG delegation
entry with rule, reason, risk, mitigation and owner, which is the format CLAUDE.md requires;
`ROSTER.md` was left unchanged rather than edited to match the exception, which is right — the
deviation is temporary and visible, not laundered into policy.

**Where the window's evidence is weaker than it looks.** Every artefact of the two cross-vendor
reviews is authored by the seat under review. The findings tables, the severities, the "Verified
✓/✗" column, the dispositions and the reviewers' answered questions are all the author's account
of what the reviewers said; no raw transcript from `agy` or the `grok` CLI is preserved anywhere
in the repo. The dispositions I could check against the tree were accurate — and the declines I
checked were correct (the RFC 3501 §9 reading behind declining Grok L8 is right: `2:4` ≡ `4:2`,
a range is a set) — but "no self-approval" is about *structure*, and a review whose only record is
written by the reviewee is structurally an author's claim. Attach the raw output next time; it
costs nothing and it is the difference between a record and a summary.

**Two things I think should have gone differently, neither of them a rule violation as the rules
are currently written:**

1. **The seat merged its own Tier-2 PR.** CLAUDE.md's "agents perform the merge" says merging is
   execution, not approval, and the preconditions were genuinely verified (`ci` green on `ca62b18`,
   `mergeStateStatus` CLEAN, no unresolved conversations). But EX-005's residual-risk acceptance
   was written for Tier 0/1 work, and "everything relating to this project is approved" is a grant
   of *decision* authority — it is not a substitute for the human look a Tier-2 data-path change
   normally gets. Finding 1 is what that gap cost: a regression to a destructive action, shipped
   to `main`, with no human ever having read the diff. This is a gap in the rules the window
   exposed, and it is worth Jim's decision (see next steps 6).

2. **`keepLiveMessageIds` was a design widening made mid-build, not an amendment to the approved
   plan.** Deleting `updateMessageImapFolder` was in scope (F-4 Task 13's wire-or-delete, named in
   the brief). Making *every* provider action filter through row existence was not; it is the
   change that produced Finding 1, and it altered a precondition shared by seven actions the brief
   only discussed four of. Under the work loop, a Tier-2 plan approved before code should be
   amended before the code widens past it — even inside a delegation window, and especially then,
   because the window removes the reader who would otherwise notice.

**Was anything decided that should have waited for Jim?** Nothing on the specs — F-4 rev 5 and
F-5 rev 2/option A were his own approvals. The two decisions I would have wanted him for are the
two above: the self-merge of a Tier-2 data-path change, and the "recorded, out of scope"
disposition on the connection-pinning question (Finding 2), which closed an architectural
question about SQLite transaction integrity inside a PR rather than in the brief the answer itself
proposed.

**Was the vault edit appropriate?** Yes, with one caveat. Striking Task 13 and the coupling note
is plainly correct — F-5 landed and the coupling is gone. Reconciling the approval line is correct
in substance: it records an approval Jim actually gave, independently logged in #40 before the
window, and the edit is transparently attributed ("reconciled … by the delegated build seat during
Jim's second delegation window"), with the superseded text struck rather than deleted. The caveat
is a matter of principle rather than of this instance: a spec's **Approval** field is the one field
a delegated seat should default to leaving for the principal, precisely because it is the field
that authorises everything else. The self-attribution and the citation make this instance
adequate, and I would not ask for it to be reverted. The correction of the "vault is not reachable
from this checkout" claim in HANDOFF was honest and useful.

---

## Process

**Did well — and these are not small things:**

- **Every cross-vendor finding was re-derived against the tree before adoption,** with a ✓/✗
  column recording which ones did not survive. Grok's H2-A was correctly identified as not-yet-live
  and routed into the F-4 spec instead of being fixed speculatively. One finding was declined with
  an RFC citation that is correct on the merits.
- **The seat found its own HIGH before either reviewer did** (the `delta_check_folders` timeout
  returning `Ok` and handing a desynchronised session back to the pool) and said so in the record,
  rather than letting the reviewers' duplicate filings imply the reviewers found it.
- **Test quality is genuinely high.** `moveHygiene.test.ts` and `reconcile.test.ts` run against a
  real SQLite harness with the real migrations and FK enforcement on, not mocks — that is why the
  rollback and cascade behaviour is actually proven. The live Dovecot run on both ports, with the
  two-append trick so a source/destination confusion cannot pass by coincidence, is the right kind
  of evidence for the one protocol claim the design rests on.
- **Honest about the gate divergence** (CI caught a clippy `reversed_empty_ranges` the local run
  had not compiled with `--all-targets`) rather than quietly fixing it.
- **Commit hygiene is good**: three commits, one per review leg, each message carrying the
  dispositions including what was declined and why. The LOG entries are the best documentation
  artefact in this repo.

**Do differently:**

1. **When a change widens the precondition of an existing operation, enumerate every caller of
   every operation it touches.** "Every provider action now filters to live rows first" is a
   sentence about seven methods; the brief discussed four. One grep of `emailActions.ts` would have
   surfaced that `permanentDelete`'s caller deletes the rows locally *before* calling it. This is
   the highest-value habit change available here.
2. **Write the test from the requirement, not from the implementation.** The test at
   `imapSmtpProvider.test.ts:344` was written to describe what the new code does. Had it been
   written to describe what permanent delete must do, it would have failed.
3. **Do not answer an architectural question with an unverified empirical claim.** "In practice one
   connection is ever created and reused" was the load-bearing half of the answer to two
   reviewers, and `Pool::connect` → `max_connections = 10` took two greps to establish. When the
   honest answer is "I don't know and it is out of scope", say that; it is a stronger answer than a
   guess.
4. **Apply a fix to its siblings.** `clearReappeared` was rewritten for Gemini M2; the per-row
   INSERT loop twenty lines below it in the same file (Finding 6) was not.
5. **Preserve raw reviewer output** as a repo artefact (`docs/audits/` or a PR attachment), so the
   dispositions can be checked against what was actually returned.
6. **Re-stamp the PR body's numbers at the final push** (#44 says 1946; the head produces 1952).
7. **Time use was good.** F-5 fully built, twice reviewed, fixed and landed, plus a scoped F-4
   substrate with its own two review legs and an executable part-2 plan, inside two hours, with
   green gates throughout. The problem was not pace.

---

## Recommended next steps for Jim, in priority order

1. **Fix Finding 1 before anything else ships.** Permanent delete is currently a client-side
   no-op — the mail is removed locally and left on the server. Small, Tier 2, and it needs the
   test at `imapSmtpProvider.test.ts:344` rewritten from the requirement.
2. **Decide Finding 2 (connection pinning).** Pre-existing, but F-5 made it load-bearing for
   identity rewrites. Its own brief, as the review answer itself proposed: either move
   `rekeyMovedMessages` into a Rust command that owns one connection, or serialise all DB access
   through `withTransaction`'s queue as a stopgap. Everything in `docs/decisions/` that says
   "recorded, out of scope" for this should be reopened.
3. **Take #44** with Findings 6 and 10 folded in (both small and in-file), or with them booked as
   immediate follow-ups. CI is green on the head commit `b964b23`.
4. **Before F-4 part 2 starts:** settle Finding 7 (the >50% stop is per-pass, not cumulative — the
   part-2 plan's step 6 is where the fix goes) and rename `checked` → `delta_checked`. The part-2
   plan itself is good and I would run it largely as written, with an opposite-line read of the
   deletion step specifically.
5. **Ask for the raw Gemini/Grok transcripts** to be filed alongside #43 and #44, and decide
   whether Grok stays a Tier-2 reviewer or reverts to panel-only. `ROSTER.md` is unchanged and
   currently disagrees with what happened; either the roster row moves with an ADR, or the
   exception gets an expiry date in `docs/decisions/EXCEPTIONS.md`.
6. **Decide whether "agents perform the merge" should carve out Tier 2.** I am not asking for the
   rule to be reversed — it works, and the merge preconditions were honoured. But #43 is the case
   study for what "no human ever read this diff" costs on a data path, and EX-005's accepted
   residual risk was written for Tier 0/1. A one-line carve-out ("Tier 2 merges wait for a human
   read of the diff, even under delegation") would have caught Finding 1 and would have cost this
   window nothing but a few hours' latency.
