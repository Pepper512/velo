# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Code pin: `9e991bb`** (#39, E2/P15 part 2 — the last commit that changed `src/` or
  `src-tauri/`). **The only SHA this file pins.** To see what is above it:
  `git log --oneline 9e991bb..origin/main` — anything that is not `docs:` means the pin is stale.
  **Brief line numbers are stale at this pin and must be re-grepped before citing.** #37 and #39
  rewrote `commands.rs` twice: the E2 brief cites the pre-pool version, and the F-5 brief cites
  `client.rs:540` and `imapSmtpProvider.ts:638`, which the pooling rewrite moved. F-5's build must
  re-derive its citations first — that is not optional, it is what §6 is about.
- **Open PRs: none.** Never trust this line — run `gh pr list --repo Pepper512/velo`. The whole
  queue landed on 2026-09-02: #33 through #41. `main` is `1205ef4`, CI green, Release Please
  **skipped** (EX-007 guard holding).
- **Branches: cleaned.** 18 merged local branches deleted and remote refs pruned. Every branch that
  ever existed maps to a **merged** PR except #28, closed deliberately. What remains locally is
  `main` plus the two branches pinned by the dead worktrees below — those disappear with them.
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **One seat, as of 2026-09-02.** Jim wound the second (Fable) seat down after this session. Name
  **seats, never session ids**, and run **`ListAgents`** before assuming any peer is live — every
  id this file ever pinned went stale within a day.
  - **The build seat holds merge permission** (Jim, in person, 2026-09-02 ~03:30 UTC; LOG via #33
    `db00e09`) under `CLAUDE.md` *Agents perform the merge*: green on the exact rebased SHA, up to
    date, no unresolved conversation, and — **keep this one, it earned itself** — **re-verify that a
    rebase changed none of the branch's own content before relying on an approval given earlier.**
    It caught a rebase that was mechanically clean and semantically wrong: two branches each bumped
    a test count 152→153, git merged the identical lines without conflict, and the real total was
    154.
  - **The independent review leg is now the cross-vendor seat** (Gemini 3.7 via the `agy` wrapper),
    not a second Claude session. **It is not a formality**: on #39 it returned CHANGES REQUESTED
    with two HIGH findings the author had missed, one of which undercut an invariant the author had
    explicitly defended in a prior review thread. Do not merge a Tier-2 change on one pair of eyes
    because the second seat is gone — run the cross-vendor leg and post it to the PR.
    `agy` gotchas: `--print` swallows the next flag, so pass other flags first and the prompt via
    `--print="$(cat file)"` from a small `.sh` wrapper; headless mode auto-denies shell, so tell it
    **not to use tools** and inline everything it needs, or it returns nothing at all.
  - **Both worktrees are dead** and their removal is **Jim's alone** — `git worktree remove` is
    refused to the agent seat. `f2-email-links-open` @ `86bbc52` (= what #31 merged) and
    `f1-decisions` @ the wrap-up branch (= this PR). **Both verified clean, nothing uncommitted,
    nothing unpushed, every branch's content landed via a squash merge.** `f1-decisions` is
    **locked** and needs unlocking first.
  - Worktrees are gitignored but **not vitest-excluded** — always pass the excludes in §1.
- **State on `main`:** frontend **1,875** tests (**155** files — the breakdown is now gated too,
  #38) · Rust **78** · npm audit **0 — full tree AND prod** · 0 service import cycles ·
  EX-001/002/004 closed; EX-003/005/006/007 open. **Dependencies: −1 this session** (`@google/generative-ai`
  gone, nothing added; `getrandom 0.3` was Jim's direct Decision 2).

---

## 1. Exact next step

**Build F-5 (option A, rev 2), then F-4 (rev 5).** Both are Jim-approved directly (#40) and both
were parked behind E2, which has now landed. Nothing else is queued and nothing waits on a review
seat.

**Re-grep before writing a line of it.** F-5's brief cites `client.rs:540` and
`imapSmtpProvider.ts:638` at a pin two rewrites old. Its design also assumed a `client.rs` whose
move path has since been pooled — the `COPYUID` mapping now has to be drained from a session the
pool owns, which is the ownership interaction rev 2 gave as its sequencing reason. That reason is
now the *design* problem, not a scheduling one.

**Single-seat working, as of 2026-09-02.** Jim wound the Fable seat down. One seat builds; the
**cross-vendor seat (Gemini 3.7 via the `agy` wrapper) is the independent review leg**, and it is
not a formality — on #39 it returned CHANGES REQUESTED with two HIGH findings that a same-vendor
reviewer and the author had both missed, one of which undercut an invariant the author had
explicitly defended. EX-005's mitigation is satisfied by that leg plus Jim; do not merge a Tier-2
change on one pair of eyes because the second seat is gone.

**Carried work with no PR:** E2 part 3 (the carry list in #39's body — the redundant `Arc` together
with `logout_arc`'s `try_unwrap`, evictions dropped without LOGOUT, `bump_credential_version`
evicting by ident regardless of version, the cross-window invalidation race, the unvalidated
session-id wrapper, and Done-when 9 plus the live-server halves of 2 and 10, which need the Dovecot
harness rather than another unit test). **PR D** (TypeScript 5.9 → 6.0 → 7.0 with the `baseUrl`
fix, then Vite 8; vault `2026-09-01_Velo_Dependency-Audit.md:93`) has **no plan file** and is a
dependency change, so it is Tier 2 and needs Jim's plan approval before code.

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

Expected on `main`: **154 test files, 1,843 tests; 78 Rust.** #39 will move all three.

### Re-verify before acting — these may have gone stale

- `git log --oneline 9e991bb..origin/main` — **a non-`docs:` commit there means the code pin and
  every brief line number in this repo are stale.** Re-grep before citing anything.
- `gh pr list --repo Pepper512/velo` — none open at writing; this line ages faster than any other.
- `git worktree list` — **two dead worktrees were still present at writing** (see §2). If they are
  gone, ignore the §2 item; if they are there, do not work in them and do not trust a bare
  `npx vitest run`, which globs into them.
- `gh run list --branch main --limit 2` — `ci` success, Release Please **skipped**.
- **`ListAgents` before assuming any peer seat exists.** There is one seat as of 2026-09-02, and
  every session id this file has ever pinned went stale within a day.
- The F-4 spec's own approval line **in the vault** still needs Jim's mark — #40 records the
  approval in LOG but could not reach the vault from the checkout. Reconcile when he is next there.

---

## 2. Immediate / time-sensitive

**No credentials to rotate. None were created, read, or logged this session.** The Gemini SDK
tarball used to verify a wire format was unpacked in a scratchpad and never installed.

**Jim only, all three refused to the agent seat:**
1. **Make `rust MSRV` a required check** —
   `gh api -X POST repos/Pepper512/velo/branches/main/protection/required_status_checks/contexts -f "contexts[]=rust MSRV"`.
   Until it lands the MSRV is not enforced. This has been open since 2026-09-01 and is the only
   gate in the ledger that passes on every PR while enforcing nothing.
2. **Remove both worktrees** — the last piece of cleanup the agent seat could not finish. Both
   verified clean: nothing uncommitted, nothing unpushed, and every branch's content landed by
   squash merge. `f1-decisions` is **locked**, so it needs unlocking first. Paste:
   ```bash
   git worktree unlock .claude/worktrees/f1-decisions
   git worktree remove .claude/worktrees/f1-decisions
   git worktree remove .claude/worktrees/f2-email-links-open
   git branch -D docs/handoff-wrapup docs/handoff-refresh-eod
   ```
   The two branches only still exist because a worktree pins them. After this, `git branch` is
   `main` alone and `git worktree list` is one line — which is what makes the next session's
   *"trust `git worktree list`"* rule cheap instead of confusing.
3. **Mark the F-4 approval in the vault spec** (`Build Queue/10-Bug-Fixes/SPEC-F-4_…`, §Approval).
   The repo-side record is in `LOG.md` via #40; the vault is not reachable from this checkout, so
   the two records are deliberately not claimed to be in sync.

*(The `settings.local.json` item is gone: it existed only so one seat could message the other, and
there is one seat now.)*

Still parked, unchanged: **P11** (brief written; needs approval + 5-step manual QA) · **P19/F-3**.

---

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is hardening it under his methodology (`docs/methodology/`,
pinned). The 20-item optimization audit is landed. The **dependency audit** is A, B, C landed; D
next (plan to write); E parked behind E2. The **IMAP correctness line**: move/expunge shipped;
**E2 pooling part 1 landed, part 2 in review**; F-4 and F-5 approved, parked behind E2.

**Governance this session, in one paragraph.** Jim delegated his decision authority to the Fable
seat for a time-boxed window, then renewed it, then returned and re-authorised in person; every
decision made under it is in LOG (#33) marked *(delegated)*, none reversed. The Opus seat held the
E2 build on a provenance concern, then lifted the hold on a better argument (agent merges were
blocked, so building was reversible), then received merge permission from Jim directly. Four
permission gates fired across both seats and none was laundered. **A subagent estimate put the
hardening core at ~67% (63–72%) before #37–#38 landed.**

---

## 4. What just happened (2026-09-01 22:30 → 2026-09-02 ~04:50 UTC)

| PR | Merged | What |
|---|---|---|
| #33 `f8f917c` | Opus | LOG: the delegation, its renewal, Jim's re-authorisation, merge assignment, every *(delegated)* decision |
| #34 `a4663dd` | Opus | **Dependency PR C — −1 dep, 0 added.** `geminiProvider.ts` is one `fetch`; 19 tests written first; one same-vendor-found regression (thinking-model liveness) fixed; Gemini cross-vendor APPROVE WITH NITS, all adopted |
| #35 `a6c9366` | Opus | HANDOFF: code-SHA-only pin; the "count the PR you are written from" rule |
| #36 `0501a91` | Opus | **F-5 brief rev 2** — `COPYUID` already parsed by `imap-proto` and forwarded on `async-imap`'s unsolicited channel (both seats verified in registry source); duplicate render verified by trace, also in print and `.eml` export; sequencing re-decided on pool ownership |
| #37 `33c87a5` | Opus | **E2/P15 part 1** — the pool (checkout-removes-entry), lifecycle, reaper, exit hook, one command converted. Fable EX-005 + Gemini: CHANGES REQUESTED (5 must-fix) → fixed at root → APPROVED. Rust 56 → 78 |
| #38 `b66978d` | Opus | `docs-check` now gates the per-directory test-file breakdown; both docs regenerated (they had disagreed with each other and the tree by up to 12 files while the total passed) |

**Open:** #39 E2 part 2 (Opus built; 14 commands pooled; credential crosses IPC once per session;
Done-when 1 measured: `imap_client::connect` 15 → 1) · #40 Jim's F-4/F-5 approval record.

**Findings worth remembering.** *Pool errors are pre-I/O by construction* (`acquire` is a map
lookup), so re-running after `NoSuchSession`/`SessionBusy` is always safe; the duplicate-mail guard
is the pass-through of mid-operation errors, not a flag — part 1 had it inverted and the Opus seat
named its own error plainly. *Same-vendor found the only real bug on #34; cross-vendor found the
polish; on F-4 it was the reverse* — §6. *Two identical `152 → 153` lines merged without conflict
while the truth was 154* — #38 exists because of it.

---

## 5. Decisions

**Made by Jim directly this session:** merge execution → Opus seat (#33 `db00e09`) · **F-4 rev 5
approved · F-5 option A at rev 2 approved** (#40; *"I approve f-4 and f-5"*, in his session) ·
`getrandom 0.3` (Decision 2, 2026-09-01) · comms fix content (§2 item 3).

**Made under delegation, all in LOG #33, none reversed on his return:** E2 rev 2 re-confirmed with
findings 1/3/5 in scope, 4/6 deferred · PR C amended to no new dependency · F-4 read and
recommended, deliberately not decided by proxy · Decision 4 attempted and blocked, not laundered.

**Deliberately deferred + reason:**
- **E2 part 3 carry list** (in #39): redundant `Arc<tokio::Mutex>` **together with** `logout_arc`'s
  `try_unwrap` skipping LOGOUT (closer to a defect than a nit); evictions without LOGOUT;
  `bump_credential_version` evicting by ident regardless of version; unvalidated session-id
  wrapper; Done-when 9 and the live-server halves of 2 and 10 (Dovecot harness).
- **Per-window session binding and P11's capability grant** — ADR-003 in #39 states plainly they
  are not done: a stolen session id is usable from any window today; 128 random bits defend
  against guessing, not theft.
- **`AbortSignal.timeout()` on the Gemini fetch** (jsdom support unverified) · **`callAi` dedupe**
  (P16(3) shape) · **PR E, TS 7 direct, lucide aria sweep** — unchanged.
- **HANDOFF's code pin is allowed to lag** by design; refresh at wrap-ups, never chase it.

**Operational notes that bit us:**
- `agy --print` needs its prompt as an argument and eats the next flag otherwise; wrap it in a
  `.sh` (the worktree guard refuses `$(cat …)` inline). Pattern: `e2-review.sh`.
- A single-use `Response` in `mockResolvedValue` fails the second call with a misleading
  "non-JSON" error — `mockImplementation(() => new Response(…))` for multi-call tests.
- The cross-session classifier blocks messages that assert authority in prose — land the record,
  send a pointer. It also blocked one seat's `SendMessage` outright (§2 item 3).
- `gh pr checks` can start being refused mid-session; `gh pr view --json mergeStateStatus` = CLEAN
  is the substitute.

---

## 6. Standing instruction — verify measurements before building to them

Two audits, ten falsified numbers, plus this session's additions: **check the direction of
staleness** (the register, not the summary, was stale in #32); **same-vendor and cross-vendor
reviews are independent samples, not a hierarchy** — require both to re-derive from the tree;
**a merge with no textual conflict can still be semantically wrong** (the 153/153/154 count) —
gate the number, don't trust the merge. Trust backlogs, verify numbers, including ours.

---

<!-- ─────── RESUME CARD · `tail -30 HANDOFF.md` is self-contained ─────── -->

## 7. Resume card

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · **code pin `9e991bb`** (#39; the
only SHA pinned — `git log --oneline 9e991bb..origin/main` shows what is above it; a non-docs
commit there means brief line numbers are stale) · **no open PRs, branches pruned** · CI green ·
155 files / 1,875 tests / 78 Rust · npm audit 0.

**Next action: build F-5 (option A, rev 2), then F-4 (rev 5).** Both Jim-approved directly in #40,
both were parked behind E2, and E2 has landed. **Re-grep their citations first** — F-5's brief
points at a `client.rs` that #37 and #39 have since rewritten, and its `COPYUID` mapping must now
be drained from a session the pool owns. That is the design problem, not a scheduling one.

**One seat now.** The cross-vendor leg (Gemini via `agy`) is the independent review, and it is not
a formality — it found two HIGH issues in #39 that the author missed. Don't merge Tier 2 on one
pair of eyes.

**Jim only, three items, all refused to the agent seat:** `rust MSRV` required-check `gh api` (§2) ·
`git worktree remove` for **both** worktrees (`f1-decisions` is **locked** — unlock first; both are
verified clean and fully merged) · mark F-4 approved in the vault spec, which this repo cannot
reach.

**Verify first:** `git worktree list` (never assert "clean on `main`" without it) · `gh pr list` ·
`ListAgents` before assuming a peer exists · `gh run list --branch main --limit 2` (ci success,
Release Please **skipped**).

**Get running:** `git checkout main && git pull && npm ci`, then
`npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'`,
`npx tsc --noEmit`, `npm run graph:check && npm run docs:check`, `(cd src-tauri && cargo test --locked)`.
`cargo build --release` stays broken locally (sqlx dylib — use
`cargo check --locked --config 'profile.dev.debug-assertions=false'`). Work in your own worktree
(`EnterWorktree`); inside one, use plain commands and the file tools.

**Read §6:** verify numbers, check which side is stale, treat review lanes as independent, and
remember a clean merge can still be wrong — including ours.
