# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Code pin: `5a5fe59`** (#44, F-4 part 1 — the last commit on `main` that changed `src/` or
  `src-tauri/`). **The only SHA this file pins.** `git log --oneline 5a5fe59..origin/main` —
  anything there that is not `docs:` means the pin is stale and every line number in the briefs
  must be re-grepped before citing.
- **Open PRs: none at writing** (the wrap-up docs PR this file ships in is the exception). Never
  trust this line — run `gh pr list --repo Pepper512/velo`. #43 and #44 both landed 2026-09-02.
- **Branches:** `main` plus the two dead worktree branches below. Remote branches for #43 and #44
  were deleted at merge; their local copies linger only inside this session's worktree.
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **Seats, as of 2026-09-02 08:00 UTC.** One build seat (this session ran as **Fable 5.1** under
  Jim's second delegation window, 06:12–08:12 UTC — LOG.md records the window, its terms, and the
  two deviations it named). Name **seats, never session ids**, and run **`ListAgents`** before
  assuming a peer is live.
  - **Merge permission** is with the build seat under the standing rule (green on the exact SHA,
    up to date, no unresolved conversation) — exercised on #43 this session.
  - **Independent review = two cross-vendor legs this session:** Gemini 3.7 via `agy` **and Grok
    4.6 via the `grok` CLI** (`grok -m grok-4.6 --disable-web-search --prompt-file …`). Grok's use as
    a Tier-2 reviewer is a **named deviation** from `ROSTER.md` valid for the window only. Both legs
    found real defects on #43 that the author missed, and they found *different* ones (LOG.md).
    `agy` gotchas unchanged: flags before `--print`, prompt via a `.sh` wrapper, tell it not to use
    tools. Grok gotcha: with a long prompt it "offloads" the text and reads it back with its own
    tools — takes 5–10 minutes, the output file stays near-empty until it finishes.
  - **Worktrees:** the session's own worktree `.claude/worktrees/f5-move-hygiene` (branch
    `f4-vanished-uid-part1` checked out at the end) plus the **two dead ones from before**
    (`f1-decisions` locked, `f2-email-links-open`) — removal is still **Jim's**. Vitest excludes:
    `--exclude '**/node_modules/**' --exclude '**/.claude/worktrees/*/.claude/**'` when run from
    inside a worktree; the old `'**/.claude/**'` exclude hides the worktree's own tests.
- **State on `main` @ `5a5fe59`:** frontend **157** files / **1,954** tests · Rust **95** + 1 ignored
  (the live Dovecot test) · 26 migrations / 32 tables · npm audit 0 · 0 service import cycles. No
  dependency added or removed this session.

---

## 1. Exact next step

**Build F-4 part 2 from `docs/briefs/2026-09-02-f4-part2-plan.md` — after an opposite-line plan
read.** Part 2 is the deleting half of F-4 (the gate, the attestation, end-of-pass deletion under
the budget, the reconcile op, the ConfirmDialog stop). The plan was written at the end of the
delegation window without a plan read; get one before code. Everything it depends on landed in #44.

**Before that, read the Opus 5 full review** (`docs/reviews/2026-09-02-opus5-window-review.md`;
verdicts and dispositions in LOG.md). Its HIGH 1 — permanent delete had become a server-side
no-op after F-5 — is **fixed in the wrap-up PR**. Its HIGH 2 — the re-key transaction depends on
per-connection SQLite state over a pooled, unpinned `tauri-plugin-sql` connection — is **open and
Jim's to scope**: it is pre-existing for every `withTransaction` in Velo, but F-5 made it
load-bearing for a destructive identity rewrite. Own brief; candidate fix is a Rust command owning
one connection. The five MEDIUMs (per-message reap cost, UIDVALIDITY guard off for never-synced
folders, regex constraint detection, per-row inserts in `recordMissing`, and the **>50% stop
eroding across passes** — part 2 must evaluate it against the row count at first confirmation)
are recorded in LOG.md and belong to the next F-5/F-4 follow-up.

**Carried, no PR:** E2 part 3 carry list (unchanged from the previous handoff — the `Arc`/
`logout_arc` item, evictions without LOGOUT, `bump_credential_version` by ident, the cross-window
invalidation race, the unvalidated session-id wrapper, Done-when 9 and the live halves of 2/10) ·
**PR D** (TypeScript 5.9→6→7, Vite 8; Tier 2, needs Jim's plan approval) · **F-5 follow-ups**
recorded on #43: an old→new id refresh for UI state after a re-key (Grok M4), `withTransaction`
connection pinning (pre-existing, both reviewers), tombstones still visible to `threads.message_count`
until the destination syncs.

### Resume commands

```bash
cd /Users/jpepper/Developer/Claude/Velo-Build/velo
git worktree list                        # who is where — before anything else
git checkout main && git pull origin main
npm ci
npx tsc --noEmit && npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'
npm run graph:check && npm run docs:check
(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)
gh repo set-default Pepper512/velo
```

Expected on `main`: **157 test files, 1,954 tests; Rust 95 passed, 1 ignored.**

### Re-verify before acting

- `git log --oneline 5a5fe59..origin/main` — a non-`docs:` commit there means the pin is stale.
- `gh pr list --repo Pepper512/velo` — none open at writing; this line ages fastest.
- `git worktree list` — three worktrees at writing (this session's plus two dead ones).
- `gh run list --branch main --limit 2` — `ci` success, Release Please **skipped**.
- **`ListAgents`** before assuming a peer seat exists.

---

## 2. Immediate / time-sensitive

**No credentials to rotate.** The Dovecot harness's throwaway credentials were used against
`127.0.0.1` only; the containers were torn down (`down -v`) at the end of the window.

**Jim only:**
1. **Make `rust MSRV` a required check** — unchanged since 2026-09-01:
   `gh api -X POST repos/Pepper512/velo/branches/main/protection/required_status_checks/contexts -f "contexts[]=rust MSRV"`.
2. **Remove the two dead worktrees** (unchanged; `f1-decisions` is locked, unlock first) — and now
   also this session's `.claude/worktrees/f5-move-hygiene` (everything in it landed via #43, #44
   and the wrap-up docs PR; its local branches `worktree-f5-move-hygiene`, `f4-vanished-uid-part1`
   and `docs/window-wrapup` can go with it).
3. ~~Mark the F-4 approval in the vault spec~~ — **done this session.** The vault
   (`~/Vaults/Pepper Knowledge/10 Projects/Velo/…`) **is reachable from this machine**; the earlier
   "not reachable from the checkout" note was wrong. The spec's approval line, Task 13 and the
   F-5 coupling note were reconciled directly. Jim should glance at the edit.

Still parked, unchanged: **P11** · **P19/F-3**.

---

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is hardening it under his methodology (`docs/methodology/`,
pinned). The optimization audit is landed; dependency audit A/B/C landed, D next (plan to write),
E parked. **IMAP correctness line:** move/expunge shipped (#26); E2 pooling landed (#37/#39);
**F-5 landed (#43)**; **F-4 part 1 in #44, part 2 planned.**

**Governance this session, in one paragraph.** Jim put the Fable seat in charge for two hours with
every project decision pre-approved and named the review legs; every decision made is in LOG.md
marked *(delegated)*; two deviations were named up front (Grok as reviewer, the Fable seat itself);
the vault was edited directly once it turned out to be reachable; an Opus 5 full review was
commissioned at the close as Jim asked.

---

## 4. What just happened (2026-09-02 06:12 → ~08:10 UTC)

| PR | Merged | What |
|---|---|---|
| #43 `2792251` | build seat | **F-5, option A rev 2.** Rust drains `COPYUID` from `async-imap`'s unsolicited channel inside the pooled checkout (no parser owned; backlog discarded before `UID MOVE` — a defect the brief did not know about); TS re-keys the row + attachments + soft refs in one transaction (deferred FKs, per-pair savepoints), tombstones the rest (`messages.moved_to`, migration 25), hides tombstones from thread view/search/actions, reaps on destination sync (folder-scoped), refuses a mapping from the wrong UIDVALIDITY generation; every provider action filters to live rows first. Live Dovecot: `:11143` mapping on the same turn, `:11144` COPY path with none. Gemini CHANGES REQUESTED (1H 2M 2L 1N) + Grok CHANGES REQUESTED (15) → 9 adopted, rest answered/recorded/declined with reasons on the PR |
| #44 `5a5fe59` | build seat | **F-4 part 1.** `DeltaCheckResult` per-folder attestation (`checked`/`error`/nullable `exists`; timeout → `Err` → pool evicts), `imapDeltaSync` skips unchecked and records fallback failures, `imapSearchAllUids` validated, migration 26, `reconcile.ts` (pure budget/cap/diff + generation-scoped suspect state machine + atomic `applySearchAll`) on the harness. Gemini CHANGES REQUESTED (1H 2M 1L 2N) and Grok CHANGES REQUESTED (11): everything adopted or already fixed, nothing declined. Nothing in it deletes; the part 2 plan is in `docs/briefs/` |

**Findings worth remembering.** *Both cross-vendor legs found defects the author missed, and
different ones* (#43: Gemini the reap scoping and the zombie race, Grok the whole-batch rollback
and the UIDVALIDITY generation). *CI caught a clippy lint the local run had not compiled* (first
push of #43) — CI stays the source of test status. *`async-imap`'s unsolicited channel was never
read by Velo* — it fills and drops silently; anything that needs an untagged response must clear
it first. *The vault is reachable.* *Spec citations were stale again* (F-4 Task 5's command already
existed) — re-grep, always.

---

## 5. Decisions

**Made by Jim directly this session:** the delegation window and its terms (LOG.md, verbatim).

**Made under delegation, all in LOG.md, marked *(delegated)*:** every F-5 build decision beyond the
brief (channel discard, COPY-fallback-has-no-mapping accepted, live-row filter on every action,
extra tables the re-key rewrites, option-B minimal build), every review disposition on #43 and
#44 (adopted / recorded / declined — each with its reason on the PR), the merge of #43, the
F-4 part 1 scope cut (substrate only), the vault edits, the part 2 plan.

**Deliberately deferred + reason:** F-4 part 2 (the deleting half; needs a plan read, not a
window's last 40 minutes) · the `withTransaction` connection-pinning question (pre-existing, every
transaction shares it; own brief) · the UI old→new id refresh after a re-key (small, separate) ·
Grok L8 on #43 **declined** (RFC 3501 defines a range as unordered) · Gemini NIT on a `moved_to`
index **declined** (already indexed via `message_id_header`).

**Operational notes that bit us:** the worktree guard refuses heredocs and `$(cat …)` — use the
file tools and `.sh` wrappers · `cd` persists between Bash calls; a `cd src-tauri` left later
`npx vitest` runs finding "no test files" · the harness translator rejects a `$n` used twice —
bind the value twice · `runMigrations` in a harness test leaves its BEGIN/COMMIT in `statements`;
slice from your own start index · Grok's long-prompt path is slow but works.

---

## 6. Standing instruction — verify measurements before building to them

Two audits, ten falsified numbers, plus this session's: **the vault was reachable** when HANDOFF
said it was not; **a spec task was already done in the tree**; **the reviewer's HIGH on the timeout
path was real** and the author had written the opposite in a comment. Check the direction of
staleness; treat review lanes as independent samples; a clean merge can still be wrong — including
ours.

---

<!-- ─────── RESUME CARD · `tail -30 HANDOFF.md` is self-contained ─────── -->

## 7. Resume card

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · **code pin `5a5fe59`** (#44 F-4
part 1; the only SHA pinned — `git log --oneline 5a5fe59..origin/main` shows what is above it) ·
**no open PRs** · CI green · 157 files / 1,954 tests / Rust 95 + 1 ignored · 26 migrations ·
npm audit 0.

**Next action: read the Opus 5 review (`docs/reviews/`, dispositions in LOG.md) — its HIGH 1 is
fixed, its HIGH 2 (pooled-connection transaction state under the re-key) is Jim's to scope — then
build F-4 part 2 from `docs/briefs/2026-09-02-f4-part2-plan.md` after an opposite-line plan
read.** Part 2 is the half that deletes local rows. Everything it needs landed in #44.

**Seats:** one build seat. Independent review = Gemini via `agy` **and** Grok via `grok` CLI
(Grok is a named deviation from the roster, valid for the 2026-09-02 window only — ask Jim before
reusing it). Both found real defects this session. Don't merge Tier 2 on one pair of eyes.

**Jim only:** `rust MSRV` required-check `gh api` (§2) · remove the two dead worktrees (+ this
session's once #44 lands) · glance at the vault F-4 spec edits (approval line, Task 13, coupling
note) — the vault **is** reachable from this machine.

**Verify first:** `git worktree list` · `gh pr list` · `ListAgents` · `gh run list --branch main --limit 2`.

**Get running:** `git checkout main && git pull && npm ci`, then
`npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'`,
`npx tsc --noEmit`, `npm run graph:check && npm run docs:check`,
`(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)`.
Live Dovecot: `docs/testing/dovecot/README.md` (F-5 section). Work in your own worktree
(`EnterWorktree`); inside one, use plain commands and the file tools, and cd back to the root.

**Read §6:** verify numbers, check which side is stale, treat review lanes as independent, and
remember a clean merge can still be wrong — including ours.
