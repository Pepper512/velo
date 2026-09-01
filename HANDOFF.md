# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Code pin: `0d0b373`** (#29, dependency batch B) — **the only SHA this file pins.** Every line
  number in every brief was verified against it. This file no longer pins a docs SHA: it cannot know
  its own merge commit at write time, and chasing one produced three re-pin PRs in one day (#28, #31,
  #32). To see what is above the code pin: `git log --oneline 0d0b373..origin/main` — docs-only
  commits there are wrap-ups and expected; **a code commit there means this pin is stale and every
  brief line number needs re-grepping.**
- **Open PRs:** never trust this line — run `gh pr list --repo Pepper512/velo`. As of writing, two
  are open, both complete and waiting only on Jim (§1): **#33** (docs — the delegation record) and
  **#34** (dependency PR C). CI green on `main`; Release Please **skipped** (EX-007 guard holding).
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **⚠️ Two agent seats work this repo, and they are not one-per-tree.** Name **seats, never
  session ids** — every id this file ever pinned went stale within a day. Run **`ListAgents`** to
  find who is live.
  - **Both seats may share the main checkout**, so `git status` there can report **someone else's
    branch** — check `git worktree list` before asserting anything about `main`. On 2026-09-01 the
    Fable seat moved to its own worktree (`.claude/worktrees/f1-decisions`, created with
    `EnterWorktree`) precisely to stop this; **do the same rather than sharing the main checkout.**
  - A worktree-isolated session has a **guard on Bash**: it refuses compound commands, `$(…)`
    substitution and shell variables near anything it cannot prove is not `git`. Use plain single
    commands, the `Edit`/`Write` tools for file changes, and a small `.sh` wrapper for anything that
    needs substitution (the `agy` review runner is the standing example).
  - Worktrees are gitignored but **not vitest-excluded**: a bare `npx vitest run` at the repo root
    globs into every one of them — always pass the excludes in §1.
- **State on `main`:** frontend **1,822** tests (152 files) · Rust **56** · npm audit **0 — full
  tree AND prod** · 0 service import cycles · EX-001/002/004 closed (EX-002's register row was
  only flipped to Closed in #32 — it had lagged the HANDOFF since #4); EX-003/005/006/007 open.
  **After #34 merges:** 153 files / **1,842** tests, and one dependency fewer.

---

## 1. Exact next step

**Jim is back from a three-hour absence during which he delegated his decision authority to the
Fable seat** (`velo-build-f1`; 22:30 → 01:30 UTC, 2026-09-01/02 — recorded with a hard expiry in
`docs/decisions/LOG.md` via #33). **The delegation has expired. Nothing further is decided in his
name.** What waits on him, in the order it unblocks work:

1. **Ratify or reverse the delegated decisions — read the #33 LOG entry first.** Every decision
   made under the delegation is marked *(delegated)* there and is subject to his retroactive
   review; anything he reverses is reverted, not argued. The decisions:
   - **E2/P15 rev 2 re-confirmed**, judged against §Pooling findings as he asked: **findings 1, 3,
     5 folded into the build; 4, 6 deferred** (1 and 5 via one checkout-removes-entry pattern; 3 =
     `account_key` includes port/TLS/auth-mechanism + a credential-version counter).
   - **PR C plan approved with an amendment: no new dependency.** Built as #34 — see §4.
   - **F-4: deliberately NOT decided.** Read in full; recommendation is *approve rev 5 as written*.
     It builds after E2 anyway, so deciding it by proxy would have traded provenance for nothing.
2. **Merge #33 and #34** — both green, both opposite-line reviewed, #34 also cross-vendor
   reviewed. **Every `gh pr merge` from the Fable session was classifier-blocked, and was NOT
   routed through the Opus seat** (that is the unresolved "agent reach" precedent from #24; doing it
   again would have decided the question by fait accompli). So either Jim merges, or he rules on
   agent merge reach. Merge #33 first — #34's provenance points at it.
3. **The E2 build is HELD by the Opus seat until Jim confirms the delegation to it directly.** The
   Opus seat approved #33 *as a record* but declined to build a Tier-2 IMAP rewrite on an
   agent-created approval — because the artifact attesting to the grant was written by the session
   that received it, which is exactly the hazard the #24 LOG entry names. That hold was correct and
   the Fable seat did not argue it. One sentence from Jim to the Opus seat starts the build in the
   recorded scope.
4. **F-4 fresh approval** — his, after (1); builds after E2.
5. **Decision 4 — make `rust MSRV` a required check.** Attempted again from the Fable session at
   22:33 UTC, classifier-blocked again, not laundered. Jim runs:
   `gh api -X POST repos/Pepper512/velo/branches/main/protection/required_status_checks/contexts -f "contexts[]=rust MSRV"`
   **Until it lands, the MSRV is not enforced.**

**Build order once unblocked:** merge #33 → #34 · E2/P15 on the Opus line · PR D (TS 6→7, Vite 8)
on the Fable line · then PR E (Rust parsers) and F-4, both parked behind E2 for file-collision
reasons.

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

Expected on `main` before #34: **152 test files, 1,822 tests**; after: **153 / 1,842**. A wildly
higher count means a worktree exclude was dropped.

### Re-verify before acting — these may have gone stale

- **Has code landed past `0d0b373`?** `git log --oneline 0d0b373..origin/main` — anything that is
  not `docs:` means the code pin is stale. #34 will be the first such commit.
- **PR state:** `gh pr list` — this file was written with #33/#34 open.
- **Node 24 / `rust-version = "1.89"`** — the MSRV job pins it; if that job reds while `rust` stays
  green, a dependency raised its floor again.
- **Upstream drift:** `git fetch upstream && git log --oneline main..upstream/main` — empty all day.
- **Every E2-brief line number was verified at `0d0b373`.** Re-grep after any code merge —
  including #34, though it touches nothing E2 touches.

---

## 2. Immediate / time-sensitive

**No credentials to rotate. None were created, read, or logged this session.** The Gemini SDK
tarball used to verify the wire format was unpacked in a scratchpad and never installed.

- **The #33 ratification** is the only genuinely time-sensitive item: the longer the delegated
  decisions stand unreviewed, the more work stacks on them.
- Still parked on Jim from earlier, unchanged: **P11** capability split (brief written; needs
  approval + 5-step manual QA) · **P19** phishing wired-or-deleted (F-3 in the vault queue).

---

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is hardening it under his methodology (`docs/methodology/`,
pinned). The 20-item optimization audit is fully landed. Current thrust: the **dependency audit**
(A, B landed; **C built and reviewed**; D next; E parked) and the **IMAP correctness line** (#25/#26
shipped; E2 pooling scoped and held on a provenance question; F-4 specced and recommended).

Two agent seats run in parallel under cross-session governance: relayed approvals carry Jim's
authority but never create it (LOG.md, #24); merges happen only on green-at-exact-head plus a
recorded opposite-line review (EX-005). **New this session: a time-boxed delegation of Jim's own
authority to a seat, recorded before use (#33).** The Opus seat's refusal to build on it is the
governance working as designed, not a failure of it.

---

## 4. What just happened (2026-09-01 22:30 → 01:30 UTC — the delegation window, Fable seat)

| PR | State | What |
|---|---|---|
| #33 | **open, green, reviewed** | **LOG.md entry:** the delegation itself (hard expiry), the E2 scope decision, the PR C amendment, F-4 read-and-not-decided, Decision 4 attempted-and-blocked. Opus EX-005: *approve as a record*. |
| #34 | **open, green, reviewed ×2** | **Dependency PR C — `@google/generative-ai` removed, nothing added.** `geminiProvider.ts` rewritten as one `fetch` to v1beta `generateContent`; 19 tests written first. Opus EX-005 **approved at head `e5655ff`**; Gemini 3.7 cross-vendor **APPROVE WITH NITS** (3 LOW, all adopted). |

**Why PR C added nothing.** The approved plan swapped SDKs one-for-one. Re-verified in the tree:
the old SDK has **zero** dependencies; `@google/genai` would have brought `google-auth-library`,
`protobufjs`, `ws` and `p-retry` into a renderer that holds mail credentials, for a provider that
makes one POST. Two of the four are structurally dead weight here (Opus verified: `ws` is the Live
API, `google-auth-library` is server-side ADC). The wire format was read from the successor SDK's
own source, and 2 of the 14 initial tests passed against the *old* provider because the old SDK
was making the identical request underneath — corroboration, not luck. Net: **−1 dependency**, and
the only provider whose auth/rate errors now derive from real HTTP status (it maps 403, which the
central string-sniffing mapper in `aiService.ts` misses).

**The one real bug in PR C was found by the same-vendor reviewer, not the cross-vendor one.**
`testConnection` sent a 10-token budget through the strict text extractor; on the default model
(Gemini 2.5 Flash, a *thinking* model whose thinking tokens come out of `maxOutputTokens`) that can
be a 200 with no text part → typed error → `false` → a valid key reported as broken. A regression
the rewrite introduced, not inherited — the old provider never read `.text()` there. Fixed by
splitting the POST (proves the key) from extraction (strict only in `complete()`), with tests for
thinking-only parts and for `parts: []` + `finishReason: MAX_TOKENS`. **Neither reviewer hit the
live API**; the fix restores the old semantics exactly, so its worst case is fixing nothing. Gemini
had reviewed the earlier head, was asked for regressions, and reported none material — see §6.

**The peer seat held the E2 build.** Correctly — see §1 item 3. The Fable seat's own PR C work
proceeded because *that* grant was first-hand (typed into its session), not relayed; the
distinction is recorded in #33's thread.

**Three permission gates fired in the Fable session and none was routed around:** the branch
protection append, `gh pr merge` (twice), and one cross-session message that asserted delegated
authority in prose (re-sent as a pointer to the durable record instead — the right shape anyway).

---

## 5. Decisions

**Made this window — all in `docs/decisions/LOG.md` via #33, marked *(delegated)*, subject to Jim's
retroactive review:**
- **The delegation itself:** Jim → `velo-build-f1`, 22:30–01:30 UTC, scoped to the four open
  decisions and build judgment calls; the proxy cannot reach what a permission gate refuses; *no
  self-approval* still binds the proxy's own builds.
- **E2/P15 rev 2 re-confirmed; findings 1/3/5 in, 4/6 deferred.** `getrandom = "0.3"` stays the
  only dependency E2 may add.
- **PR C amended: REST via `fetch`, no new dependency.** Self-approval hazard named (the proxy
  amended, approved and built it); mitigated by an opposite-line plan ack *before* code, EX-005
  review, and cross-vendor review — all three recorded on #33/#34.
- **F-4: read in full, recommended, not decided.**
- **Decision 4: not made** — permission-gated twice, never laundered.

**Made by the Opus seat, and right:** hold E2 until Jim confirms the delegation directly.

**Pending Jim:** everything in §1 · P11 · P19/F-3 · the "agent reach" question, which now has
three more data points (two blocked merges, one blocked protection append), all handled the same
way: surface, never route around.

**Deliberately deferred + reason:**
- **`AbortSignal.timeout()` on the Gemini fetch** — one line, but the test environment is jsdom and
  its `AbortSignal` support is unverified; a mock-fetch suite would pass either way. Not a
  regression (the old provider had no timeout). Small follow-up.
- **`callAi` duplicate** — 16 identical lines in `aiService.ts` and `writingStyleService.ts`
  (Opus, review of #34); the P16(3) pattern; its own PR.
- **F-5**, **PR E**, **TS 7 direct**, **lucide aria-label sweep** — unchanged from the previous
  handoff, same reasons.
- **`docs/development.md:43`'s per-group test breakdown** sums to 129 against a gated total of 153;
  only the gated number was touched in #34. Delete the breakdown or regenerate it; do not hand-fix.

**Operational notes that bit us this window:**
- **`--print` on `agy` requires its prompt as an argument** and will eat the next flag as the prompt;
  stdin is not read. Wrap it in a `.sh` (the worktree guard refuses `$(cat …)` inline).
- **A single-use `Response` in a `vi.fn().mockResolvedValue` fails the second call** with a
  misleading "non-JSON" error — use `mockImplementation(() => new Response(…))` for multi-call tests.
- **The cross-session classifier blocks messages that assert authority in prose.** Land the record
  first, then send a pointer to it. This is also the process-correct order.

---

## 6. Standing instruction — verify measurements before building to them

The two audits' falsified numbers stand as recorded (see git history of this file). Two additions
from this window, both about *how* to verify rather than *whether*:

- **Check the direction of staleness; don't infer it from which document usually drifts.** §6 had
  trained both seats to suspect the newer summary. In the #32 review the HANDOFF said EX-001/002/004
  were closed while the *register* still read "Closing" for EX-002 — the older, more authoritative
  document was the stale one. The mismatch was correctly flagged and incorrectly attributed until
  someone checked `ci.yml:83`.
- **Cross-vendor is not automatically the stronger review.** On #34 the same-vendor EX-005 reviewer
  found the only real bug (a liveness check that fails on the shipped default model); the
  cross-vendor pass, run on the same head and asked for regressions, found three polish items and
  reported no regression. F-4 showed the opposite (Gemini found what three Opus rounds missed).
  One case each way, same day: **neither seat is reliably stronger; the value is the independence,
  not the vendor.** The two passes caught disjoint classes because of what each had *context* on —
  the same-vendor finding came from grepping `types.ts` for the default model rather than trusting
  the diff; the cross-vendor findings came from the API contract. So the requirement on *both*
  reviewers is the same: **re-derive from the tree, don't read only the patch.** A same-vendor
  reviewer who re-derives beats a cross-vendor one who doesn't. Record both, weight neither as
  senior, and do not overturn the methodology's cross-vendor preference on one data point — that
  would be the §6 mistake in a new coat. (Sharpened by the Opus seat in the #34 thread.)

---

<!-- ─────── RESUME CARD · `tail -30 HANDOFF.md` is self-contained ─────── -->

## 7. Resume card

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · **code pin `0d0b373`** (the only
SHA pinned; `git log --oneline 0d0b373..origin/main` shows what is above it) · CI green · npm audit
**0** · 152 files / 1,822 tests / 56 Rust on `main` (**153 / 1,842** once #34 lands).

**Next action — Jim, in this order:**
1. **Read the #33 LOG entry and ratify or reverse** the decisions made under the 3-hour delegation
   (expired 01:30 UTC): E2 rev 2 re-confirmed with findings 1/3/5 in scope; PR C amended to *no new
   dependency*; F-4 read and recommended but **not** decided.
2. **Merge #33, then #34** — both green and reviewed; every agent merge was classifier-blocked and
   deliberately not routed through the other seat. Or rule on agent merge reach.
3. **Tell the Opus seat directly** that the delegation was real — it is holding the E2 build on
   exactly the provenance concern the LOG warns about, and one sentence releases it.
4. **F-4 approval** (recommended) · **Decision 4** — the `gh api` line in §1, agent-blocked twice.

**Verify first:** `git worktree list` (seats may share the main checkout — never assert "clean on
`main`" without it) · `gh pr list` · `git log --oneline 0d0b373..origin/main` (any non-`docs:`
commit = stale line numbers) · `gh run list --branch main --limit 2` (CI success + Release Please
**skipped**) · `ListAgents` for who is live — never a remembered session id.

**Get running:** `git checkout main && git pull && npm ci`, then
`npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'` (bare runs
glob every worktree), `npx tsc --noEmit`, graph/docs checks, `(cd src-tauri && cargo test --locked)`.
`cargo build --release` stays broken locally (sqlx dylib — use
`cargo check --locked --config 'profile.dev.debug-assertions=false'`). Prefer your own worktree
(`EnterWorktree`); inside one, Bash refuses compound/substituted commands near git — use plain
commands and the file tools.

**Read §6:** two audits, ten falsified numbers; this window added two *method* lessons — check
which side is stale before assuming, and treat same-vendor and cross-vendor reviews as independent
samples, not a hierarchy. Trust backlogs, verify numbers — including ours.
