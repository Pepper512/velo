# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Branch:** `main` @ **`99b691f`** (#31, docs). **Last commit that changed code: `0d0b373`** (#29,
  dependency batch B). Docs-only commits above it are wrap-ups and are expected — check line numbers
  against the **code** pin, never this one.
- **Open PRs:** none. CI green on `main`; Release Please **skipped** (EX-007 guard holding).
  A stale local branch `docs/handoff-repin-5c545f9` remains from **PR #28, closed deliberately**:
  it refreshed this same file against the same base as #31 and would have clobbered it. Its one
  unique fact (F-5 as a live defect) was folded into #31 before closing. Nothing to recover; delete
  the branch whenever convenient.
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **⚠️ Two agent sessions work this repo.** The Opus session (`velo-build-6d`) works the main
  checkout; the Fable session (`velo-build-9d`) owns the **locked worktree**
  `.claude/worktrees/f2-email-links-open` — whose directory name lags its branch (currently
  `docs/handoff-refresh-eod` or later). Trust `git worktree list`, not the path; do not touch the
  other session's tree. The worktree is gitignored but **not vitest-excluded**: a bare
  `npx vitest run` at the repo root globs into it — always pass the excludes in §1.
  **The Fable seat was restarted at the end of 2026-09-01**, so do not assume it is live or reachable
  at a remembered address: use `ListAgents` to find the current one, and treat its queue (dependency
  PRs C→D) as unowned until a session claims it.
- **State:** frontend **1,822** tests (152 files) · Rust **56** · npm audit **0 — full tree AND
  prod** · 0 service import cycles · EX-001/002/004 closed; EX-003/005/006/007 open; **EX-008 was
  deliberately NOT created** (every dev-graph advisory was fixable in-range — fix beats exception).

---

## 1. Exact next step

**Four decisions are with Jim. Everything buildable behind them is written, reviewed, and parked.
An agent cannot supply any of them.**

1. **E2 rev-2 re-confirmation — the ONLY thing blocking the session-pooling build.** Decision 4 is
   DECIDED (a) (Jim, 2026-09-01, relayed). The brief is rev 3 (`a230f3a`,
   `docs/briefs/2026-09-01-e2-p15-session-pooling.md`): citations re-verified at `0d0b373`,
   #25/#26 drift folded in, **six pooling findings recorded — judge the re-confirmation against
   §Pooling findings item 1** (cancellation bypasses eviction-on-error; the design does not cover
   it; the cheap fix — checkout-removes-entry — also closes the panic path). Build seat: Opus.
2. **F-4 fresh approval** (vanished-UID reconciliation). Spec is **rev 5** in the vault
   (`Pepper Knowledge/10 Projects/Velo/Build Queue/10-Bug-Fixes/SPEC-F-4_…`). Two vendors, five
   revisions: Opus ×2 rounds → Gemini cross-vendor **DO NOT BUILD YET** (7 findings, all verified
   and adopted in rev 4) → delta-review found 3 defects in rev 4's own clauses → rev 5 fixed them →
   **re-check clean**. Jim's earlier conditional approval voided itself per its own terms; the
   decision is his, fresh. Builds after E2.
3. **PR C plan approval** — the Gemini SDK swap (`@google/genai` 2.20 replacing the EOL'd
   `@google/generative-ai`): the one dependency-series item that is a **new dependency**, so its
   Tier-2 plan (vault, `Build Queue/20-Enhancements/PLAN-PR-C_Gemini-SDK-Replacement.md`) needs
   Jim's sign-off before code. ~2 h build once approved. Blast radius: one 40-line provider file.
4. **Branch-protection append** — `rust MSRV` passes on every PR but is **not a required check**;
   the append was classifier-blocked for agents (settings-level). Jim runs:
   `gh api -X POST repos/Pepper512/velo/branches/main/protection/required_status_checks/contexts -f "contexts[]=rust MSRV"`
   (Opus bundled this with its own #24 governance question as one "agent reach" decision.)

**Build order once unblocked:** PR C → PR D (TS 6→7, Vite 8) on the Fable line · E2/P15 on the Opus
line · then PR E (Rust parsers) and F-4, both explicitly parked behind E2.

### Resume commands

```bash
cd /Users/jpepper/Developer/Claude/Velo-Build/velo
git checkout main && git pull origin main
npm ci
npx tsc --noEmit && npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'
npm run graph:check && npm run docs:check
(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)
gh repo set-default Pepper512/velo
```

Expected: **152 test files, 1,822 tests, all passing.** A wildly higher count means the worktree
exclude was dropped.

### Re-verify before acting — these may have gone stale

- **Has code landed past `0d0b373`?** `git log --oneline -5`. Two sessions land work here — `main`
  moves; rebase before merging, and sequence doc-touching PRs (LOG/EXCEPTIONS appends conflict).
- **PR #30 was the last merge** — if more merged since, this file is behind; the memory log
  (`~/.claude/projects/-Users-jpepper-Developer-Claude-Velo-Build/memory/velo-upstream-issue-triage.md`)
  is the running ledger.
- **Node:** CI, `engines`, `.nvmrc` all say **24** since #27. `rust-version = "1.89"` — the MSRV
  job pins it; if that job reds while `rust` stays green, a dependency raised its floor again.
- **Upstream drift:** `git fetch upstream && git log --oneline main..upstream/main` — empty all day.
- **Every E2-brief line number was verified at `0d0b373`** (rev 3 did exactly that). Re-grep after
  any new code merge.

---

## 2. Immediate / time-sensitive

**No credentials to rotate. None were created, read, or logged this session.**

- **The four Jim decisions in §1** — nothing else is truly time-sensitive. The dependency series'
  SLA item (the vitest critical) already **landed** in #27.
- Still parked on Jim from earlier sessions, unchanged: **P11** capability split (brief written;
  needs his approval + 5-step manual QA) · **P19** phishing wired-or-deleted (product decision —
  F-3 in the vault queue tracks it).

---

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is hardening it under his methodology (`docs/methodology/`,
pinned). The 20-item optimization audit is fully landed. Current thrust: the **2026-09-01
dependency audit** (5 PRs, A–E — A and B landed today) and the **IMAP correctness line** (#25/#26
shipped; E2 pooling and F-4 reconciliation specced and parked on approvals).

Two agent sessions run in parallel under cross-session governance: relayed approvals carry Jim's
authority but never create it (LOG.md rule, PR #24); merges happen only on green-at-exact-head plus
recorded opposite-line review (EX-005).

---

## 4. What just happened (2026-09-01, evening session — Fable seat)

| PR | What |
|---|---|
| #27 `0183733` | **Dep batch A** — vitest 4.1.11 (critical killed), vite 7.3.6, Tauri 2.11 align, Node 24, `rust-version` 1.89 + **MSRV CI job**, full-audit visibility step. Full-tree `npm audit` → **0** via in-range fixes (no EX-008 needed) |
| #29 `0d0b373` | **Dep batch B** — @anthropic-ai/sdk 0.122, openai 7.8, lucide 1.39 (8 renames + the `Github` brand icon the audit missed → GitBranch), jsdom 30, jest-dom 7 (+@testing-library/dom **promoted** transitive→declared, same 10.4.1), tsdav 2.3.1, 4 release workflows SHA-pinned |
| #30 `a230f3a` | **E2 brief rev 3** (Opus authored, Fable reviewed) — citations at `0d0b373`, Decision 4 recorded DECIDED (a), six pooling findings written down |

**F-4 went rev 2 → rev 5 today.** The commissioned Gemini cross-vendor read (per the same-vendor
caveat) returned DO NOT BUILD YET with 7 verified findings — including a cap deadlock, a
permanently-broken counter invariant, and an arrival-masking hole in two-pass confirmation that
three same-vendor rounds missed. Rev 4 adopted all seven; the delta-review then caught rev 4
contradicting itself in three places; rev 5 fixed those and re-checked clean. Raw Gemini review is
archived beside the spec.

**The MSRV gate falsified its own audit figure on first run** (real floor 1.89 via notify-rust, not
1.85 via lettre) — and PR #27 was mergeable with that job red, which is finding-grade evidence for
§1 item 4. The job is named version-stably (`rust MSRV`) precisely so it can become a required
check.

---

## 5. Decisions

**Made today (recorded in the E2 brief, F-4 spec, PR threads, LOG.md):**
- **E2 Decision 4: (a) frontend-driven** `NeedRawFallback` (Jim, direct, relayed to Opus). Option
  (d) — raw fetch over the pooled session — recorded as the better post-E2 end state, with the two
  reasons it is not scope now.
- **Dep batches A–E approved as a series** (Jim: "approve") — A, B landed; **C gated on its own
  Tier-2 plan** (new dependency); D next after C; E parked behind E2.
- **F-4 conditional approval voided by its own terms** (delta-review found findings) — approval is
  Jim's again, fresh; rev 5 verified clean.
- **Fix beats exception:** dev-graph advisories were cleared in-range rather than registered
  (EX-008 never created). Register rows are for what cannot be fixed.
- **Version-stable CI check names** — a required-status context must never embed a version.

**Pending Jim:** the four items in §1 · P11 · P19/F-3 · the "agent reach on settings" governance
question (Opus bundled protection-append + #24).

**Deliberately deferred + reason:**
- **F-4 build** — after E2/P15 (same files, active rewrite; a second rebase of a Tier-2 credential
  change is the expensive kind).
- **F-5 (move-time row hygiene)** — not merely an F-4 dependency: `updateMessageImapFolder`
  (`messageHelper.ts:126`) has **zero callers** and nothing else writes `messages.imap_folder`
  after a move, so an action on an already-moved message uses a stale folder/UID pair. **A live
  defect on `main` today** (reviewer-verified at `a230f3a`), queued — and if it slips past F-4,
  F-4's suspect table grows beyond design assumptions (coupling note in the spec).
- **PR E** (`async-imap` 0.11, `mail-parser` 0.11, reqwest 0.13) — parked behind E2 for the same
  file-collision reason; reqwest must keep `native-tls` explicit or TLS silently swaps to rustls.
- **TS 7 direct** — 6.0 bridge first (`baseUrl` removal bites; tsconfig:19).
- **lucide aria-label sweep** — v1 sets `aria-hidden` on icons; lone-icon buttons predate it; noted
  as follow-up, not smuggled into #29.

**Operational notes that bit us today (adds to the standing list):**
- `agy` (Antigravity/Gemini): `--print` **swallows the next flag as its prompt** — use
  `--print="$(cat file)"` with other flags first, via a small `sh` script for the worktree guard.
- The permission classifier blocks **settings-level** `gh api` calls (branch protection) in agent
  sessions — surface to Jim, never route around; and never claim an action done before its call
  resolves (both sessions filed corrections for exactly this today).
- **Truncated audit reads produce confident wrong counts** — both sessions did it within one hour
  (undici-only claim; four-vs-five highs). Read complete outputs before stating numbers.

---

## 6. Standing instruction — verify measurements before building to them

The optimization audit's six failed claims (see git history of this file for the table) now have
company: **the dependency audit lost four point-facts to mechanical checks** — `serde_json` unused
(build fails without it), the injection-site count, **MSRV 1.85** (job's first run: 1.89), and
"Velo uses no brand icons" (`Github` in SettingsPage). Both audits ranked the work correctly and
measured it unreliably. The rule stands, now with more scars: **trust the backlog, verify every
number, including our own briefs' — and read outputs to the end before counting.**

---

<!-- ─────── RESUME CARD · `tail -30 HANDOFF.md` is self-contained ─────── -->

## 7. Resume card

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · `main` @ `99b691f` (last code:
`0d0b373`, #29) · clean · CI green · npm audit **0 full-tree** · 152 files / 1,822 tests / 56 Rust.

**Next action — four decisions wait on Jim; all work behind them is ready:**
1. **E2 rev-2 re-confirmation** (only pooling blocker; judge against the brief's §Pooling finding 1
   — cancellation bypasses eviction; Decision 4 already DECIDED (a)). Opus builds.
2. **F-4 fresh approval** (spec rev 5 in vault, two vendors, re-check clean; prior conditional
   approval voided itself). Builds after E2.
3. **PR C plan approval** (vault: `PLAN-PR-C_Gemini-SDK-Replacement.md` — new dep `@google/genai`,
   ~2 h). Then PR D. Fable builds.
4. **Branch protection:** make `rust MSRV` required —
   `gh api -X POST repos/Pepper512/velo/branches/main/protection/required_status_checks/contexts -f "contexts[]=rust MSRV"`
   (agent-blocked, correctly; it passes everywhere but gates nothing until this lands).

**Verify first:** `git log --oneline -5` (two sessions land work; past `a230f3a` means this file is
behind — the memory ledger `velo-upstream-issue-triage.md` is the running log) · `git worktree list`
(locked worktree = the other session's; name lags branch) · `gh run list --branch main --limit 2`
(CI success + Release Please **skipped**).

**Get running:** `git checkout main && git pull && npm ci`, then
`npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'` (bare runs
glob the parallel worktree), `npx tsc --noEmit`, graph/docs checks, `(cd src-tauri && cargo test --locked)`.
`cargo build --release` stays broken locally (sqlx dylib — use
`cargo check --locked --config 'profile.dev.debug-assertions=false'`). git-guard: long text via
`--body-file`/`commit -F`; `git push` in its own call.

**Read §6:** two audits, ten falsified numbers between them, four caught today by new mechanical
gates. Trust backlogs, verify numbers — including ours.
