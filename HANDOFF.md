# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Code pin: `a7058cb`** (#80, SPEC-AR — the last commit on `main` that changed `src/` or
  `src-tauri/`). **The only SHA this file pins.** `git log --oneline a7058cb..origin/main` —
  anything there that is not `docs:` means the pin is stale and every line number in the briefs
  must be re-grepped before citing.
- **Open PRs: none at writing** (this docs PR excepted). Never trust this line — run
  `gh pr list --repo Pepper512/velo`.
- **Branches:** `main` plus the branches pinned by the dead worktrees below, plus **about twenty
  merged feature branches** (`f297-bcc-strip`, `f240-pinned-tx`, `docs-post-*`, …) that nobody
  pruned after #43–#71. All merged; `git branch -d` is safe on every one of them. A chore, not a
  risk.
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **Seats, as of 2026-09-03.** One build seat (this session ran as **Fable 5.1**, Jim present
  and directing: "go", the platform question, the review-model change, then the P11 prompt). Name **seats, never
  session ids**, and run **`ListAgents`** before assuming a peer is live.
  - **Merge permission** is with the build seat under the standing rule (green on the exact SHA,
    up to date, no unresolved conversation) — exercised on #73.
  - **Independent review = two cross-vendor legs, and the Gemini leg is now 3.8 Flash High.**
    Jim, 2026-09-03, mid-review: *"you should be on gemini 3.8 Flash High"* — not 3.7. So:
    `agy --model gemini-3.8-flash-high --mode plan --print-timeout 20m --print="$(cat prompt)"`
    from a `.sh` wrapper (flags **before** `--print`; tell it not to use tools; inline the diff
    from committed SHAs), **and** Grok 4.6 (`grok -m grok-4.6 --disable-web-search
    --prompt-file …`, ~14 minutes, output file stays near-empty until it finishes). On #73 the
    two found *different* real defects again, and a follow-up pass on the fix delta found two
    more — when a review makes you write new logic, review the new logic.
  - **Worktrees:** this session's `.claude/worktrees/e2-part3-pool-carry` (branch
    `worktree-e2-part3-pool-carry`, everything in it landed via #73 and this docs PR) plus the
    **three dead ones from before** (`f1-decisions` locked, `f2-email-links-open`,
    `f5-move-hygiene`). Removal is **Jim's** (`git worktree remove` is refused to the agent
    seat). Vitest excludes when running from inside a worktree:
    `--exclude '**/node_modules/**' --exclude '**/.claude/worktrees/*/.claude/**'`.
  - **The format-on-save hook runs `rustfmt` on any `.rs` file you Edit or Write, and the crate
    is not rustfmt-clean.** A stray `cargo fmt` reformats twelve untouched files. Patch
    `commands.rs`-sized files by script (`python3` from the scratchpad) when you want a clean
    reviewer diff; `pool.rs` is clean and safe to Edit.
- **State on `main` @ `a7058cb`:** frontend **174** files / **2,326** tests · Rust **173** +
  3 ignored (the live Dovecot tests) · **28** migrations / 32 tables · npm audit 0 · 0 service
  import cycles. **No dependency added this session.** Still open for Jim: `urlpattern` as a
  dev-dependency (SPEC-280 §Open for Jim).

---

## 1. Exact next step

**The full ordered plan is `docs/ROADMAP.md`**: the bug-fix queue is done except #278 ("not
yet"), F-3/P19 landed (#71), E2 part 3 landed (#73), P11 landed (#75), the PR D / PR E plans
are docs awaiting Jim (#77, #78), and **enhancement wave 1 has started: Auto Reminders landed
(#80)**. Next in §4 of the roadmap: custom split-inbox tabs, Instant Intro, the speed budget.

**SPEC-AR landed as #80 (`a7058cb`) — auto reminders on external sends.** Brief
`docs/briefs/2026-09-03-auto-reminders.md` (Tier 1, committed before code). Sending to an
address outside the sender's domain (own addresses and aliases excluded) sets a follow-up
reminder N days later at 09:00 local, Saturday/Sunday rolled to Monday; the composer shows
"Remind me if no reply in N days" (override wins); Settings → Sending has the toggle and the
delay (1/2/3/7, default 3), persisted as `auto_reminders_enabled` / `auto_reminders_days`.
`EmailProvider.sendMessage` returns `{ id, threadId? }` so the reminder has a thread. An
existing reminder is never overwritten; no thread id → warn, no row; a queued offline send
sets nothing. Pure module `src/services/followup/autoReminders.ts`, tests first. Review
dispositions in `docs/decisions/LOG.md` (2026-09-03, PR #80) and on the PR.

**P11 landed as #75 (`e05f6cd`) — the Tauri capability grant is split.** Spec
`docs/briefs/2026-09-01-batch-g-p11-capabilities.md` (rewritten from the 2026-09-01 draft,
re-grepped, plan committed and the PR opened before any code). `capabilities/main.json` is the
main window's grant, byte for byte the old `default.json`; `capabilities/content.json` is what
`thread-*` and `compose-*` windows demonstrably call, **scoped by path**: `core:path`, event
listen/unlisten (no emit — `main` opens a composer on `single-instance-args`), sql
load/select/execute, opener open-url with the default URL set, dialog save, `velo.key`
read-only, the attachment cache as the only write root, `.eml` export to a dialog-picked path
through the runtime scope the dialog plugin extends, `http` with main's scope (**the recorded
residual**: unsubscribe POST and Ollama; the next narrowing is unsubscribe → a Rust command and
Ollama → `ai_fetch`). Removed from pop-outs: webview creation, `fs:remove`, notifications,
badge, autostart, shortcuts, deep-link, updater, process, `os`, title-bar window controls, and
any write beside the key or the database file. The splash page (static HTML) is in no file.
`ThreadView`, `Composer` and `ContextMenuPortal` hide or guard "Open in new window" by one
label-first rule (`src/utils/windowKind.ts`: `getCurrentWindow().label` inside Tauri, the URL
outside; an unknown label fails closed) that `main.tsx` also routes by. **Four review passes**
(Gemini 3.8 ×3, Grok 4.6), every finding dispositioned on the PR and in LOG.md; six declined
against plugin source (the dialog plugin *does* extend the fs scope — `tauri-plugin-dialog`
`commands.rs:194-198`; decorations are stripped from `main` only — `lib.rs:344`). The trade
named for Jim: popping the reply composer out of a thread pop-out is no longer offered.
**Jim's five-step manual QA is open, not done** — the spec's *Verification* section; the merge
landed behind it per the roadmap instruction; `git revert` restores the flat grant.

**The PR D / PR E plans are written and landed as docs — #77 (`1ccafbf`) and #78
(`2e4707b`) — and STOP there: no code, no dependency change until Jim approves each.**
`docs/briefs/2026-09-03-pr-d-toolchain-majors.md` (TypeScript 5.9 → 6.0.3 → 7.0.2, then Vite
8.2.2 + plugin-react 6.1.1; four rebase-merged commits with legal revert sets; the browser floor
pinned to Vite 7's; a packaged-bundle smoke before the Vite commit merges; `npm audit
signatures` into CI) and `docs/briefs/2026-09-03-pr-e-rust-parsers.md` (`mail-parser` =0.11.8
fail-closed with `full_encoding`, `async-imap` =0.11.3, `socket2` =0.6.5, `reqwest` =0.13.4 on
`native-tls-no-alpn` with `.use_native_tls()` explicit; a MIME fixture suite first, invariant
versus hardening; five rebase-merged commits; `hashify` 0.2.9 the one pre-1.0 transitive
addition). **Every claim in both was measured without touching the repo** — the compilers from
the npx cache, a throwaway copy of `src-tauri` and a throwaway copy of the project — and each
plan took two review legs (Gemini 3.8 Flash High, Grok 4.6) with every finding dispositioned in
LOG.md. **Corrections to the vault dependency audit are recorded in the specs** (the reqwest
duplicate stays; `base64` is not collapsible; `mail-parser` 0.11's empty default features;
0.11.2's quoting change is COPY/LIST; reqwest 0.13's `native-tls` now carries ALPN).

**Decisions each plan asks of Jim, in its Approval section:** PR D — the native-binary trust
(unattested Microsoft compiler binaries; attested VoidZero bundler binaries), the browser floor,
the CI signatures step, the rebase merge. PR E — `hashify`, the live-harness merge gate, the
rebase merge. **Next, once either is approved: build it as its spec says** (D is ~1 day, E ~1
day). Until then the next unblocked work is **enhancement wave 1** (ROADMAP §4: Auto Reminders
1.5 d, custom split-inbox tabs 3 d, Instant Intro 0.5 d, the speed budget 6 d with the already-
approved `@tanstack/react-virtual`) — Tier 1 items, briefs first.

**Open for Jim:** the `urlpattern` dev-dependency; the **rebrand inventory**
(`docs/audits/2026-09-03-rebrand-inventory.md` — the `com.velomail.app` identifier decision is a
one-way door needing an ADR; the inventory recommends keeping it); the F-3 follow-up questions;
**P11's five-step QA** (`npm run tauri dev`, pop out a thread: opens; reply and send;
unsubscribe; save an attachment; `plugin:fs|remove` and `plugin:webview|create_webview_window`
denied in devtools); whether to keep the reply-composer pop-out path (strike it and P11's
`thread-*` grant gets webview creation back); PR D/E plan approvals; reporter re-tests for
#280, #241, #252, #197, #276, #209, #233, #281; the "Keep them" hold. **Manual, still open:**
#240's Task 6, F-4's live Done-when, E2's Done-when 2, and the two E2 part 3 live tests
(`cargo test --locked -- --ignored live_dovecot` with the harness up).

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

Expected on `main`: **173 test files, 2,299 tests; Rust 173 passed, 3 ignored.**

### Re-verify before acting

- `git log --oneline e05f6cd..origin/main` — a non-`docs:` commit there means the pin is stale.
- `gh pr list --repo Pepper512/velo` — none open at writing; this line ages fastest.
- `git worktree list` — four worktrees at writing (this session's plus three dead ones).
- `gh run list --branch main --limit 2` — `ci` success, Release Please **skipped**.
- **`ListAgents`** before assuming a peer seat exists.

---

## 2. Immediate / time-sensitive

**No credentials to rotate.** None were created, read or logged; the Dovecot harness was not
started (Docker down).

**Jim only:**
1. **Make `rust MSRV` a required check** — unchanged since 2026-09-01:
   `gh api -X POST repos/Pepper512/velo/branches/main/protection/required_status_checks/contexts -f "contexts[]=rust MSRV"`.
2. **Remove the four worktrees** (`f1-decisions` is locked, unlock first; `f2-email-links-open`;
   `f5-move-hygiene`; and this session's `e2-part3-pool-carry`). Everything in all four landed.
3. **Glance at the vault edits** to `SPEC-F-4` (approval line, Task 13, coupling note) — unchanged
   from the previous handoff. The vault queue line for E2 part 3 was **not** written this session
   (the vault was not opened); the repo-side spec carries the landed status.

**Agent seat, cheap:** prune the merged local branches (`git branch -d` each; all merged).

Still parked, unchanged: **#278** (decision 6) · **PR E** · the Rust image proxy (privacy
enhancement) · E2 option (d) (raw fetch over the pooled session).

---

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is hardening it under his methodology (`docs/methodology/`,
pinned). The optimization audit is landed; dependency audit A/B/C landed, D next (plan to write),
E parked. **IMAP correctness line, complete for now:** move/expunge (#26), pooling (#37/#39/#73),
F-5 (#43, #45), F-4 (#44/#47/#50), the bug-fix queue (#52–#69), F-3/P19 (#71). What is left is
the capability split (P11) and the toolchain majors (PR D/E), then features.

**It runs on Windows and Linux as well as macOS** (Jim asked, 2026-09-03): Tauri v2; upstream
ships `.msi`/`.exe`, `.deb`/`.AppImage` (plus the Flatpak and RPM packaging #233 touched) and
`.dmg`; the release workflow's matrix builds on `ubuntu-22.04` and `windows-latest`. Two caveats:
the fork's own CI runs on Ubuntu only, so a Windows-only compile break would surface only in a
release build; and the release workflow is guarded to upstream (EX-007), so the fork has never
cut a Windows or Linux bundle. The platform-specific code is small (one Windows AUMID line, two
Linux blocks in `lib.rs`) and untouched by the hardening work.

**Governance this session, in one paragraph.** Jim was present: "go" on the E2 part 3 plan
(with the roadmap prompt as the standing instruction), the platform question, and the
review-model change mid-review. Every review finding across four passes is dispositioned on the
PR and in LOG.md; one HIGH was declined with the reason verified against the MSRV. The build seat
merged #73 under the standing rule.

---

## 4. What just happened (2026-09-03)

| PR | Merged | What |
|---|---|---|
| #80 `a7058cb` | build seat | **SPEC-AR.** Auto reminders on external sends: rule + weekend-skipping due time in a pure module, composer checkbox, Settings → Sending toggle and delay, providers return the thread id; two review legs, findings verified against source |
| #75 `e05f6cd` | build seat | **P11.** The capability grant split: `main.json` unchanged, `content.json` scoped by path for `thread-*`/`compose-*`, splash in no file, the three creator sites gated by one label-first rule; four review passes; Jim's five-step QA open |
| #73 `1116348` | build seat | **E2 part 3.** Pool owns `Option<S>`; LOGOUT on every clean eviction under a 3 s budget; `StaleCredential` + `BadId`; session-id shape; the invalidation event with nonce; frontend invalidation epoch with once-only retry; pending invalidations by identity; `imapIdentityOf` shared by the config builder and the session manager (host lower-cased). Four review passes; Rust 159 → 173, frontend 2,249 → 2,273 |

**Findings worth remembering.** *The carry item understated the bug*: #39 said a bump could
evict a session opened on the new credential (one wasted login); the re-grep found the other
interleaving — a bump landing inside `imap_session_open`'s one round trip inserted a session
tagged with the *retired* generation that survived until the next bump. *Then Grok found the
dual*: a config built before another window's bump whose Rust command starts after it — Rust
cannot see that one, so the frontend epoch closes it. *Then Gemini 3.8 found two holes in the
epoch fix* (identity recorded after the token-refreshing build; the retry reusing the old
row). *Review the fix, not just the change.* Also: `Instant::duration_since` saturates since
Rust 1.60 — a reviewer will call it a panic; check the MSRV before adopting. And: the vitest
module cache makes listener-registration tests order-dependent; `vi.resetModules()` + a fresh
`import` is the pattern.

---

## 5. Decisions

**Made by Jim directly this session:** "go" on E2 part 3 under the roadmap prompt · the
Gemini review leg is **3.8 Flash High** (supersedes "3.7 first, 3.8 if Grok is slow").

**Made by the build seat, all in LOG.md with reasons:** the ownership design (owned `Option<S>`
+ `BoxFuture` HRTB over the alternatives) · refuse a stale generation at `insert` rather than
re-tag · Rust-side emit · frontend epoch + nonce for the dual race · pending invalidations by
identity · every review disposition (adopted / residual / declined).

**Deliberately deferred + reason:** per-window session binding (ADR-003; P11 next) · LOGOUT on
the error path (protocol state unknown; a destructor cannot await) · a join set for spawned
LOGOUTs (three rare paths, bounded at 3 s) · E2 option (d) · the logging pass (#39 finding 5).

**Operational notes that bit us:** `cd src-tauri && …` in one Bash call **persists the cwd**
into the next call — use `(cd src-tauri && …)` subshells · the worktree guard refuses `for`
loops with computed `sed` arguments — plain `grep -n` instead · `gh pr checks` may be refused;
`gh pr view --json statusCheckRollup` works · Grok's long-prompt path offloads the prompt and
reads it back with its own tools (~14 min) · a test that resolves an async mock synchronously
cannot see a race in the awaited region (Gemini 3.8 N7) — hold the mock open with a deferred
promise.

---

## 6. Standing instruction — verify measurements before building to them

Two audits, ten falsified numbers, plus this session's: **a carry-list item described the
smaller of two interleavings**; **a reviewer's HIGH was a saturating call, not a panic** (check
the MSRV); **the handoff on disk was 30 commits behind origin** at session start (pull before
reading). Check the direction of staleness; treat review lanes as independent samples; a clean
merge can still be wrong — including ours.

---

<!-- ─────── RESUME CARD · `tail -30 HANDOFF.md` is self-contained ─────── -->

## 7. Resume card

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · **code pin `a7058cb`** (#80,
SPEC-AR; the only SHA pinned — `git log --oneline a7058cb..origin/main` shows what is above it) ·
**no open PRs** · CI green · 174 files / 2,326 tests / Rust 173 + 3 ignored · 28 migrations ·
npm audit 0 · no dependency added.

**Note, unverified here:** a separate read-only session's notes (2026-09-03 evening) report Jim approving
the PR D and PR E plans, the `urlpattern` dev-dependency, and a reminder on queued offline sends. The
repo has no record — both Approval lines are blank on `main` — so the next build session **asks Jim
to confirm** before filling them in or adding any dependency.

**Next action: wait for Jim's approval of the PR D and PR E plans** (landed as docs, #77
`1ccafbf` and #78 `2e4707b`; both stop before any code). If one is approved, build it exactly
as its spec says — rebase merge, per-commit gates, the packaged-bundle smoke (D) or the fixture
suite first and the live-harness attempt (E). If neither is, continue **enhancement wave 1**
(ROADMAP §4): Auto Reminders landed (#80); next **custom split-inbox tabs**, then Instant Intro,
then the speed budget — briefs first, Tier 1, one PR per item. **Review legs:** Gemini **3.8 Flash High** via `agy` **and** Grok 4.6
via the `grok` CLI; diffs from committed SHAs; verify every finding against source before
adopting — on the two plans, eleven were declined that way. Open for Jim: the two plan
approvals with their named decisions; **P11's five-step QA** and the reply-composer pop-out
path; `urlpattern`; the rebrand `com.velomail.app` ADR; the F-3 follow-ups; reporter re-tests.
Manual and open: #240 Task 6, F-4's live Done-when, E2 Done-when 2, the E2 part 3 live tests.

**Seats:** one build seat. Don't merge Tier 2 on one pair of eyes.

**Jim only:** `rust MSRV` required-check `gh api` (§2) · remove the **four** worktrees
(`f1-decisions` locked — unlock first; `f2-email-links-open`; `f5-move-hygiene`;
`e2-part3-pool-carry`, which also carried P11) · glance at the vault edits to `SPEC-F-4`.

**Verify first:** `git worktree list` · `gh pr list` · `ListAgents` · `gh run list --branch main --limit 2`.

**Get running:** `git checkout main && git pull && npm ci`, then
`npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'`,
`npx tsc --noEmit`, `npm run graph:check && npm run docs:check`,
`(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)`.
Work in your own worktree (`EnterWorktree`); inside one, use plain commands, `(cd …)` subshells,
and the file tools; the rustfmt hook reformats any `.rs` file you Edit.

**Read §6:** verify numbers, check which side is stale, treat review lanes as independent, and
remember a clean merge can still be wrong — including ours.
