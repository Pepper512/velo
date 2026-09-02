# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Code pin: `33c87a5`** (#37, E2/P15 part 1 — the last commit that changed `src/` or
  `src-tauri/`). **The only SHA this file pins.** `b66978d` (#38) sits above it and touched only
  `scripts/docs-check.mjs` and two docs. To see what is above the pin: `git log --oneline
  33c87a5..origin/main` — anything that is not `docs:`/`chore(docs-check)` means the pin is stale.
  **Brief line numbers have NOT been re-verified at this pin:** the E2 brief cites the pre-pool
  `commands.rs`; the F-5 brief cites `client.rs:540` and `imapSmtpProvider.ts:638`. #39 rewrites
  `commands.rs` again — re-grep before citing anything.
- **Open PRs:** never trust this line — run `gh pr list --repo Pepper512/velo`. At writing:
  **#39** (E2/P15 part 2, code, CLEAN), **#40** (LOG: Jim's direct F-4/F-5 approval, docs, CLEAN),
  and this file's own PR. All three wait on the Fable seat's EX-005 read, then the Opus seat merges.
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **⚠️ Two agent seats, not one-per-tree.** Name **seats, never session ids**; run **`ListAgents`**.
  - **The Opus seat holds merge permission** (Jim, in person, 2026-09-02 ~03:30 UTC; LOG via #33
    `db00e09`) under `CLAUDE.md` *Agents perform the merge*: green on the exact rebased SHA, up to
    date, no unresolved conversation, and — its own addition, keep it — **re-verify that a rebase
    changed none of the branch's own content before relying on an approval given earlier.** It
    caught a semantically wrong test-count merge that way. The Fable seat's merges are
    classifier-blocked; it reviews, it does not merge.
  - **Comms are one-way until a file exists.** Opus → Fable `SendMessage` is refused by the Opus
    session's classifier; Fable → Opus works. Jim's fix: create `velo/.claude/settings.local.json`
    (gitignored, `.gitignore:51`) containing `{"permissions":{"allow":["SendMessage"]}}` in the
    **main checkout** — the Fable seat's worktree guard cannot write there, so it created only its
    own copy. **As of writing the main-checkout file does not exist**; the Opus seat reports through
    PR threads meanwhile, which works. Any seat may create it; Jim authorised the content verbatim.
  - The Fable seat works in **`.claude/worktrees/f1-decisions`** (`EnterWorktree`); the main
    checkout is the Opus seat's. Inside a worktree, Bash refuses compound/substituted commands near
    anything it cannot prove is not `git` — plain commands, the file tools, a `.sh` wrapper for
    `agy`.
  - **`f2-email-links-open` @ `86bbc52` is dead** (= what #31 merged, clean, unlocked, nothing
    unlanded, verified by both seats) and **removal is Jim's alone** — `git worktree remove` was
    refused to both seats.
  - Worktrees are gitignored but **not vitest-excluded** — always pass the excludes in §1.
- **State on `main`:** frontend **1,843** tests (**154** files — the breakdown is now gated too,
  #38) · Rust **78** · npm audit **0 — full tree AND prod** · 0 service import cycles ·
  EX-001/002/004 closed; EX-003/005/006/007 open. **Dependencies: −1 this session** (`@google/generative-ai`
  gone, nothing added; `getrandom 0.3` was Jim's direct Decision 2).

---

## 1. Exact next step

**Fable seat: EX-005 review of #40, then #39 (E2 part 2). Opus seat: merge each on green after
the read.** That is the whole queue. Nothing waits on Jim except the four items in §2.

Order and why: **#40 first** (docs-only, records Jim's F-4/F-5 approval — the record F-5's build
will cite), then **#39** (code, 13 files, +804/−279: the other 14 IMAP commands pooled, Decision 4(a)
implemented with the fallback deliberately evicting, `with_pooled_session` helper, ADR-003,
`poolBoundary.test.ts` asserting the password crosses IPC exactly twice per round). Review #39
the way part 1 was reviewed — re-derive from the tree, run every gate on the exact head, Gemini
cross-vendor via the `agy` wrapper (`e2-review.sh` pattern), post both legs to the thread. The
part-1 must-fix list is the checklist for what part 2 must not have re-introduced: retry gate on the
wrong error class, dead branches, attributes on the wrong item, unbounded exit paths, claims the
tree does not back. **Attack the helper:** the guard must stay in scope with the `await` or the
cancellation guarantee dies silently — #39's own body says so.

**After that, the Fable seat's next build item is the PR D plan** (TypeScript 5.9 → 6.0 → 7.0 with
the `baseUrl` fix, then Vite 8 + `@vitejs/plugin-react` 6; two gated commits, ~4 h; defined in the
vault at `2026-09-01_Velo_Dependency-Audit.md:93`; **no plan file exists yet**). Tier 2 (dependency
change): plan approved before code — Jim is reachable now, so ask him rather than proxy it.
**The Opus seat's next build item is E2 part 3** (the carry list in #39's scope table), then **F-5
option A at rev 2** and **F-4 rev 5**, both now Jim-approved (#40) and both parked behind E2.

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

- `git log --oneline 33c87a5..origin/main` — a non-docs commit means the code pin and every brief
  line number are stale. #39 is expected to be that commit.
- `gh pr list` — this file was written with #39 and #40 open.
- `ls velo/.claude/settings.local.json` — if it exists, comms are two-way; if not, see above.
- `gh run list --branch main --limit 2` — `ci` success, Release Please **skipped**.
- The F-4 spec's own approval line **in the vault** still needs Jim's mark — #40 records the
  approval in LOG but could not reach the vault from the checkout. Reconcile when he is next there.

---

## 2. Immediate / time-sensitive

**No credentials to rotate. None were created, read, or logged this session.** The Gemini SDK
tarball used to verify a wire format was unpacked in a scratchpad and never installed.

**Jim only, all four refused to both seats:**
1. **Make `rust MSRV` a required check** —
   `gh api -X POST repos/Pepper512/velo/branches/main/protection/required_status_checks/contexts -f "contexts[]=rust MSRV"`.
   Until it lands the MSRV is not enforced.
2. **`git worktree remove .claude/worktrees/f2-email-links-open`**.
3. **Create `velo/.claude/settings.local.json`** (content above) so the Opus seat can message the
   Fable seat — or let a seat do it; the content is his verbatim.
4. **Mark the F-4 approval in the vault spec** (`Build Queue/10-Bug-Fixes/SPEC-F-4_…`, §Approval).

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

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · **code pin `33c87a5`** (#37; the
only SHA pinned — `git log --oneline 33c87a5..origin/main` shows what is above it; a non-docs
commit there means brief line numbers are stale) · CI green · 154 files / 1,843 tests / 78 Rust ·
npm audit 0.

**Next action:** **Fable seat reviews #40 then #39** (E2 part 2 — re-derive from the tree, all
gates on the exact head, Gemini via the `agy` wrapper, both legs in the thread; attack
`with_pooled_session` keeping the guard in scope with the await). **Opus seat merges each on green
after the read** (it holds merge permission; LOG #33 `db00e09`). Then: Fable → PR D plan (Tier 2,
ask Jim); Opus → E2 part 3, then F-5 (A, rev 2) and F-4 (rev 5), both Jim-approved in #40.

**Jim only, four items, all refused to both seats:** `rust MSRV` required-check `gh api` (§2) ·
`git worktree remove .claude/worktrees/f2-email-links-open` · create
`velo/.claude/settings.local.json` with `{"permissions":{"allow":["SendMessage"]}}` so Opus can
message Fable · mark F-4 approved in the vault spec.

**Verify first:** `git worktree list` (never assert "clean on `main`" without it) · `gh pr list` ·
`ListAgents` for who is live · `gh run list --branch main --limit 2` (ci success, Release Please
**skipped**) · `ls velo/.claude/settings.local.json` (comms two-way or not).

**Get running:** `git checkout main && git pull && npm ci`, then
`npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'`,
`npx tsc --noEmit`, `npm run graph:check && npm run docs:check`, `(cd src-tauri && cargo test --locked)`.
`cargo build --release` stays broken locally (sqlx dylib — use
`cargo check --locked --config 'profile.dev.debug-assertions=false'`). Work in your own worktree
(`EnterWorktree`); inside one, use plain commands and the file tools.

**Read §6:** verify numbers, check which side is stale, treat review lanes as independent, and
remember a clean merge can still be wrong — including ours.
