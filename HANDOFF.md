# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Code pin: `9bec56a`** (#50, F-4 part 3 — the last commit on `main` that changed `src/` or
  `src-tauri/`). **The only SHA this file pins.** `git log --oneline 9bec56a..origin/main` —
  anything there that is not `docs:` means the pin is stale and every line number in the briefs
  must be re-grepped before citing.
- **Open PRs: none at writing** (this docs PR excepted). Never trust this line — run
  `gh pr list --repo Pepper512/velo`. #43–#47 and #50 all landed 2026-09-02.
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
    4.6 via the `grok` CLI** (`grok -m grok-4.6 --disable-web-search --prompt-file …`). Grok is a
    **standing second Tier-2 leg since ADR-004** (Jim, 2026-09-02) — run both legs on every Tier-2
    PR. Both legs found real defects on every PR this day that the author missed, and they found
    *different* ones (LOG.md; on #50 Grok's three HIGHs were all real while Gemini approved).
    `agy` gotchas unchanged: flags before `--print`, prompt via a `.sh` wrapper, tell it not to use
    tools. Grok gotcha: with a long prompt it "offloads" the text and reads it back with its own
    tools — takes 5–10 minutes, the output file stays near-empty until it finishes.
  - **Worktrees:** the session's own worktree `.claude/worktrees/f5-move-hygiene` (branch
    `docs-post-50` checked out at the end) plus the **two dead ones from before**
    (`f1-decisions` locked, `f2-email-links-open`) — removal is still **Jim's**. Vitest excludes:
    `--exclude '**/node_modules/**' --exclude '**/.claude/worktrees/*/.claude/**'` when run from
    inside a worktree; the old `'**/.claude/**'` exclude hides the worktree's own tests.
- **State on `main` @ `9bec56a`:** frontend **160** files / **2,028** tests · Rust **95** + 1 ignored
  (the live Dovecot test) · 27 migrations / 32 tables · npm audit 0 · 0 service import cycles. No
  dependency added or removed this session.

---

## 1. Exact next step

**The full ordered plan is `docs/ROADMAP.md`** (pinned 2026-09-02): F-4 follow-up → bug-fix queue
(#297, #240, …) → carried hardening → Superhuman-parity waves, with the copy-paste prompt for the
next session at the end. **Jim made all eight gating decisions on 2026-09-02** (LOG.md): widen
`img-src` for #197, Rust fetch for #209, `@tanstack/react-virtual` approved, MCP ADR now, wire
P19/F-3, signing and distribution not yet, **Grok 4.6 is a standing second Tier-2 review leg
(ADR-004)** — run both legs on every Tier-2 PR.

**F-4 is complete in code: part 3 landed as #50 (`9bec56a`)** — the REQ-2.3 `NOT DELETED` belt,
the REQ-4 reconcile queue op, the "folder gone" path, migration 27, plus one follow-up commit
adopting Grok's three HIGHs (the op inserts suspects only and the next list *adopts* them; a
short LIST cannot count folders as gone; the op is pinned to its UIDVALIDITY generation). Every
disposition is on the PR and in LOG.md.

**Next: the bug-fix queue, starting with #297 (Bcc strip before SMTP `send_raw`, P0, ~1 day,
Tier 2).** Spec it from the vault SPEC template into `docs/briefs/` first, plan in the PR before
code, TDD, both review legs, merge on green. Then #240 (dedicated Rust transaction connection —
also Opus 5's HIGH 2). **Still open on F-4:** the live Dovecot Done-when (scenarios 1–5 in
`docs/testing/dovecot/README.md`; manual, needs the running app — never run) and, Jim's call, a
persistent per-folder hold for "Keep them" (today a threshold, not a hold). **Merges are the
build seat's** under the standing rule — Jim reaffirmed it on 2026-09-02 after the seat deferred
#47 to him; Opus 5's Tier-2 carve-out was not adopted.

**Before that, read the Opus 5 full review** (`docs/reviews/2026-09-02-opus5-window-review.md`;
verdicts and dispositions in LOG.md). Its HIGH 1 — permanent delete had become a server-side
no-op after F-5 — is **fixed (#45, `ef7c91c`)**. Its HIGH 2 — the re-key transaction depends on
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

Expected on `main`: **160 test files, 2,028 tests; Rust 95 passed, 1 ignored.**

### Re-verify before acting

- `git log --oneline 9bec56a..origin/main` — a non-`docs:` commit there means the pin is stale.
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
**F-5 landed (#43)** with its permanent-delete regression fixed in #45; **F-4 part 1 landed (#44), part 2 planned.**

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
| #44 `ef7c91c` | build seat | **F-4 part 1.** `DeltaCheckResult` per-folder attestation (`checked`/`error`/nullable `exists`; timeout → `Err` → pool evicts), `imapDeltaSync` skips unchecked and records fallback failures, `imapSearchAllUids` validated, migration 26, `reconcile.ts` (pure budget/cap/diff + generation-scoped suspect state machine + atomic `applySearchAll`) on the harness. Gemini CHANGES REQUESTED (1H 2M 1L 2N) and Grok CHANGES REQUESTED (11): everything adopted or already fixed, nothing declined. Nothing in it deletes; the part 2 plan is in `docs/briefs/` |

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

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · **code pin `9bec56a`** (#50 F-4
part 3; the only SHA pinned — `git log --oneline 9bec56a..origin/main` shows what is above it) ·
**no open PRs** · CI green · 160 files / 2,028 tests / Rust 95 + 1 ignored · 27 migrations ·
npm audit 0.

**Next action: #297 — strip `Bcc` before SMTP `send_raw` (P0, Tier 2).** Spec from the vault
SPEC template into `docs/briefs/`, plan in the PR before code, TDD, Gemini + Grok legs, merge on
green. Then #240 (Rust-side transaction connection = Opus 5's HIGH 2). Open on F-4: the live
Dovecot Done-when (manual, needs the running app; `docs/testing/dovecot/README.md` scenarios
1–5) and the "Keep them" hold (Jim's call). The build seat merges its own green PRs.

**Seats:** one build seat. Independent review = Gemini via `agy` **and** Grok via `grok` CLI
(a standing second Tier-2 leg since ADR-004). Both found real defects on every PR this day —
on #50 Grok's three HIGHs were real while Gemini approved. Don't merge Tier 2 on one pair of eyes.

**Jim only:** `rust MSRV` required-check `gh api` (§2) · remove the three worktrees
(`f1-decisions` locked, `f2-email-links-open`, `f5-move-hygiene`) · glance at the vault edits
(F-4 spec task list, queue lines) — the vault **is** reachable from this machine.

**Verify first:** `git worktree list` · `gh pr list` · `ListAgents` · `gh run list --branch main --limit 2`.

**Get running:** `git checkout main && git pull && npm ci`, then
`npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'`,
`npx tsc --noEmit`, `npm run graph:check && npm run docs:check`,
`(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)`.
Live Dovecot: `docs/testing/dovecot/README.md` (F-5 section). Work in your own worktree
(`EnterWorktree`); inside one, use plain commands and the file tools, and cd back to the root.

**Read §6:** verify numbers, check which side is stale, treat review lanes as independent, and
remember a clean merge can still be wrong — including ours.
