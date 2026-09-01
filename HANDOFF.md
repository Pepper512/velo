# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Branch:** `main` @ `3576093`. **Last commit that changed code: `d704ea0`** ("fix: IMAP sync
  authenticated OAuth accounts with an empty password (#18)"). Use that second SHA when checking
  whether work has landed since — docs-only commits on top are expected and harmless.
- **Open PRs:** none. Working tree clean. CI green on `main`; Release Please **skipped** (EX-007 guard holding).
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **⚠️ A parallel session owns a worktree here.** `git worktree list` shows
  `.claude/worktrees/f2-email-links-open` (branch `fix/f2-email-links-open` @ `1bf2184`, **locked**).
  **Do not touch it.** It is gitignored (`.gitignore:51`) but **not excluded from vitest**, so a bare
  `npx vitest run` at the repo root also runs *that* branch's tests and reports ~200 failures that
  have nothing to do with `main`. Always scope your run — see §1. CI is unaffected (clean checkout).
- **State:** frontend **1,757** tests (144 files) · Rust **47** · **0** prod npm advisories
  · **0** import cycles containing a service · EX-001/002/004 closed; EX-003/005/006/007 open.

---

## 1. Exact next step

**E2 / P15 session pooling is written, reviewed, and blocked on Jim.** The brief is at
`docs/briefs/2026-09-01-e2-p15-session-pooling.md` (**rev 2**, `3576093`). It has been through an
independent cross-vendor review that returned **DO NOT BUILD YET**; all findings are folded in.
**Two things need Jim, and an agent cannot supply either:**

1. **Decision 4 — where the raw-fetch fallback gets its credential.** Three costed options in the
   brief; the recommendation is **(a)** (pooled command returns `NeedRawFallback`, frontend calls a
   separate config-carrying command). **Open, and it blocks the build.**
2. **Rev 2 re-confirmation.** Jim approved rev 1. Rev 2 changed retry semantics, session lifecycle,
   caps and the fallback design — material enough to need re-approval. `CLAUDE.md` is explicit that
   agent merge authority does **not** reach Tier 2 plan approval.

**While those are open, the highest-value unblocked work is (B).**

- **(B) Write the Tier-1 brief for the `move_messages` duplication bug** (§2c). Found during the E2
  review, ships today, affects user data. Not part of E2.
- **(C) Low-risk cleanup:** P16 (1)(2)(4)(5) dedupe (~380 lines), P13 (c)(d)(e), P14 remainder,
  `react-best-practices` skill trim.

### Resume commands

```bash
cd /Users/jpepper/Developer/Claude/Velo-Build/velo
git checkout main && git pull origin main
npm ci                                   # node_modules is gitignored

# NOTE the exclude — a parallel worktree lives under .claude/ and vitest will glob into it
npx tsc --noEmit && npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'
npm run graph:check && npm run docs:check
(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)
gh repo set-default Pepper512/velo       # gh otherwise resolves PR numbers against upstream
```

Expected: **144 test files, 1,757 tests, all passing.** Any other file count means the exclude was
dropped or the worktree changed.

### Re-verify before acting — these may have gone stale

- **Has real work landed since?** `git log --oneline -5`. Docs-only commits are wrap-ups; anything
  else means someone has pushed and this file is behind.
- **Is the parallel worktree still there?** `git worktree list`. If `f2-email-links-open` is gone the
  vitest exclude is no longer needed — but leaving it in is harmless.
- **Upstream drift:** `git fetch upstream && git log --oneline main..upstream/main`. Empty all
  session; if security-relevant `src-tauri/` commits appear, rebase the plan on them first.
- **CI green?** `gh run list --branch main --limit 2`. Release Please must read **`skipped`**, never
  `failure` — a failure means the EX-007 guard was removed or bypassed.
- **Every line number the E2 brief cites was verified at `d704ea0`.** Re-grep before editing.
- **The audit's measurements are not trustworthy** — §6. Neither were rev 1 of the E2 brief's; see
  the §6 postscript.

---

## 2. Immediate / time-sensitive

**No credentials to rotate. None were created, read, or logged this session.**

Two items are blocked on **Jim personally**. Finishing them unasked would be wrong.

### 2a. P11 — capability split (needs manual QA)

Brief: `docs/briefs/2026-09-01-batch-g-p11-capabilities.md`. Written, **not built**, because:

1. **The audit's proposed split is not viable as written.** It would give pop-out windows
   "read-only sql", but `ThreadWindow.tsx` calls `runMigrations()` and renders the full `Composer`
   (draft auto-save writes every 3 s), and `ActionBar`/`MessageItem` expose one-click unsubscribe,
   which POSTs to **arbitrary sender-supplied URLs** — so `http` cannot be narrowed until unsubscribe
   moves to a Rust command with URL validation.
2. **Its acceptance cannot be automated** — the audit says so: *"no automated harness exists for
   capability denial"*. An over-narrow grant fails at **runtime**, in a window that only opens on
   user action. Neither `cargo build` nor CI catches it.

**Jim:** approve the brief, then run its five QA steps against a dev build. **Step 5** — an
`fs|remove` invoke from a pop-out console being **denied** — is the only positive security
assertion. If it succeeds the split achieved nothing; if steps 1–4 fail it went too far.

### 2b. P19 — phishing detection is dark (product decision)

`phishingDetector.ts` (486 lines) is imported by exactly four files: its own test and **three other
orphans** (`PhishingBanner`, `LinkConfirmDialog`, `phishingScanner`). Nothing in `ThreadView` or
`MessageItem` references phishing. **The feature does not run.**

`SECURITY.md` claimed it *"flag[s] suspicious links before you click them"* — untrue of any shipped
build, so a user could click a link believing Velo had screened it. **That claim is corrected**; the
code is untouched. **Jim decides: re-wire it, or delete it and drop the claim.**

### 2c. `move_messages` duplicates mail on a timeout (live bug, found this session)

`src-tauri/src/imap/client.rs:496-497` matches `Ok(Ok(()))` for success and `_` for **everything
else**, so a timeout or connection error is treated identically to *"this server lacks the MOVE
extension"* and falls through to COPY + STORE `+Deleted` + EXPUNGE. A `UID MOVE` that **succeeded
server-side** but whose response timed out is therefore COPY'd again — **the message now exists twice
in the destination folder.**

Ships today; independent of session pooling. The fix is to distinguish "MOVE unsupported" (a tagged
NO/BAD from the server) from a transport failure, and to fail rather than fall back on the latter.
**Needs its own Tier-1 brief — this is item (B) in §1.**

---

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is hardening it under his engineering methodology
(`docs/methodology/`, pinned copy). A 2026-09-01 optimization audit raised 20 items; **all 20 were
accepted**, and all are landed except the two above.

The audit's framing held up: the code was disciplined where tooling enforced it and weak wherever
nothing watched. These batches added the watchers.

---

## 4. What just happened (2026-09-01)

### This session — E2 brief, its review, and one bug fix

| PR | What |
|---|---|
| #17 `bdadce4` | **E2/P15 brief, rev 1** — session pooling plan (Tier 2, docs only) |
| #18 `d704ea0` | **fix:** IMAP sync authenticated OAuth accounts with an **empty password** |
| #19 `3576093` | **E2/P15 brief, rev 2** — independent review, three blockers folded in |

**#18 was a live bug found while writing the brief.** `imapSync.ts:400`/`:833` built the sync config
with no access token; for an OAuth IMAP account `imap_password` is `NULL` by construction
(`insertOAuthImapAccount`, `db/accounts.ts:331`), so background sync authenticated with `""`. The
interactive path passed a token, so such an account could archive and read mail while **never
syncing**. Fixed with `buildImapConfigWithFreshToken` + regression tests written first. Diagnosed
from code and schema — **not yet confirmed against a live OAuth IMAP account**; the tests are what
make it settled.

**#19 followed a cross-vendor review (Kimi K3) that returned DO NOT BUILD YET** — 3 blockers, 6
majors, 4 factual errors, every claim re-verified before acceptance. The blockers, all real:
*poison-on-error* (a `with_timeout` firing mid-protocol leaves a desynchronised session that the pool
would hand to the next caller — rev 1 never mentioned it and argued an irrelevant `Arc`-vs-take-out
point instead); *retry policy by idempotency* (rev 1's blanket retry would duplicate Sent mail and
COPY-fallback moves — its acceptance criterion **mandated** the bug); and *the raw-fetch fallback's
credential source*, which rev 1 deferred to "call this out in review" and is now Decision 4.

### Earlier — the audit backlog

Thirteen PRs merged — batches **D0 → A → B → C → G-deps → E → F → H**.

| PR | What |
|---|---|
| #2 `252bb1a` | HANDOFF; closes EX-001 |
| #3 `6fe932a` | Release automation upstream-only (EX-007) |
| #4 `f7e890b` | **Batch A** — IMAP injection, OAuth panic, token-as-password, literal cap; closes EX-002 |
| #5 `2f61d4b` | Agents perform merges; EX-005 rewritten |
| #6 `9a206e7` | Batch B brief (approved before code) |
| #7 `df51f4e` | **Batch B** — credentials fail closed, migrations atomic, LLM boundary, SQLite harness |
| #8 `5a5e77e` | **Batch C** — sanitizer corpus, header injection, FTS5 escaping, ADR-002 |
| #9 `6d67fd4` | dompurify 3.3.1→3.4.14 (18 XSS advisories) |
| #10 `1ab7518` | tiptap 3.19→3.31; advisories to **0**; closes EX-004 |
| #11 `19f14ce` | P11 brief |
| #12 `3d76f1b` | **Batch E** — services/router cycle broken, typed IMAP errors |
| #13 `dc02f09` | **Batch F** — xAI Grok, provider/PKCE/route dedupe, typed settings keys |
| #14 `be2610b` | **Batch H** — CI-checked doc counts, two risky skills rewritten |

**Real bugs fixed**, not items ticked: IMAP command injection at nine sites · an OAuth panic firing
*before* the CSRF check could run · OAuth tokens sent as plaintext IMAP passwords and written to
release logs · a remote kill-switch via uncapped allocation · **credential ciphertext sent to mail
servers as passwords** · a migration that could delete attachments *every launch* · prompt injection
through an unescapable delimiter · unparseable model output reaching the compose path · **five live
tracking-pixel bypasses** · `mailto:` header injection · FTS5 crashes on any quote character · a
sidebar highlighting the wrong item on two pages · a skill executing **remote instructions from a
mutable URL**.

---

## 5. Decisions

**Made** (all in `docs/decisions/LOG.md`):
- Release automation is **upstream-only** on this fork (guard, not delete) → **EX-007**.
- **Agents perform merges** once every required check is green *on the exact commit merged*; EX-005
  rewritten to accept the residual risk rather than leave a falsified mitigation.
- **ADR-002** — three-bucket error policy (propagate / surface / log).
- **Grok is available, not default**; `getActiveProviderName` still falls back to Claude.
- **AI model defaults deliberately unchanged** — fast/cheap tier per provider, because Velo runs one
  model for *all* features and the highest-volume one is background categorisation on every sync.

**Made this session — E2/P15 (all recorded in the brief's §Approval):**
- **Decision 1 — typed error: DECIDED.** A minimal `MailError` (`NoSuchSession` / `TooManySessions` /
  `NeedRawFallback` / `Other(String)`). `Other` keeps `isConnectionError` working unchanged, so the
  brief does not have to re-classify every IMAP failure. `SessionClosed` was **dropped** in rev 2 —
  poison-on-error makes eviction a fact about the map rather than a string classification.
- **Decision 2 — dependency: DECIDED, `getrandom = "0.3"`** (Jim). Already in `Cargo.lock`
  transitively, so a declaration and no new transitive cost. The **only** dependency E2 may add.
- **Decision 3 — OAuth sync bug: RESOLVED**, shipped separately as #18 at Jim's direction rather than
  folded into a Tier-2 refactor.

**Pending Jim:** **E2 Decision 4** (raw-fallback credential — recommendation (a)) and **E2 rev 2
re-confirmation** — both block the build, §1 · P11 approval + QA (§2a) · P19 re-wire-or-delete
(§2b) · confirmation of the per-provider model default proposal (never answered; the conservative
reading shipped).

**Deliberately deferred + reason:**
- **`move_messages` timeout-fallback duplication** (§2c) — a live bug, but out of scope for E2; a
  data-affecting fix should not ride inside a Tier-2 credential refactor. Needs its own Tier-1 brief.
- **E2 build itself** — plan written and reviewed; blocked on Decision 4 and rev 2 re-confirmation,
  not on engineering.
- **P13 (c)(d)(e)** — (a)+(b) killed *all* service cycles, which was the point. 49 components still
  import `services/db/*`; `graph:check` reports the trend but does not gate it — a gate nobody can
  turn green gets deleted.
- **P14 remainder** — send-path and sync sites are ADR-002 bucket 2 and need UI surfaces that are
  design decisions, not mechanical edits.
- **P16 (1)(2)(4)(5)** — pure dedupe, ~380 lines, no risk.
- **`react-best-practices` skill** — still carries ~28 Next.js rules that mislead in a Vite/Tauri SPA.

**Operational notes that bit us:**
- `~/.claude/hooks/git-guard.sh` blocks `git add -A/.` and text-matches protected-branch wording
  across the *whole* Bash command — heredocs and PR bodies included. Author such text with Write and
  pass it via `--body-file` / `git commit -F`; keep `git push` in its own call.
- **A parallel session's worktree under `.claude/worktrees/` breaks a bare `npx vitest run`** — it is
  gitignored but not vitest-excluded, so the root run picks up another branch's tests and reports
  failures that are not yours. Scope the run (§1). This cost real diagnosis time; check
  `git worktree list` before believing a sudden mass failure.
- Branch protection is **strict**: every merge invalidates the branches behind it, and PRs that all
  append to `LOG.md`/`EXCEPTIONS.md` conflict rather than merely going out of date. Sequence
  doc-touching PRs one at a time.

---

## 6. Standing instruction — verify the audit before building to it

**Six of its claims failed verification.** It is still the right backlog for *what* to fix; its
**measurements are not reliable**.

| # | Claim | Reality |
|---|---|---|
| 1 | `serde_json` is unused (§4) | `tauri::generate_context!()` requires it — removing it fails with `E0433` |
| 2 | P1 has six IMAP injection sites | **Nine** — `async-imap` leaves `uid_store`, `uid_search`, `append` unvalidated |
| 3 | Components 0% tested (§6) | 32 component test files existed; the metric script missed `.test.tsx` |
| 4 | P9 lists six missing image vectors | **Five were already handled**; five *different* ones were live and unlisted |
| 5 | P14: poison queue op retried forever | `classifyError` defaults non-retryable **and** `incrementRetry` already had a ceiling |
| 6 | `useContextMenu` is orphaned (P19) | It has **nine** importers |

**#4 is the one that mattered:** building to the audit's vector list would have shipped a fix that
missed every real bypass. It is why the image blocker is DOM-based rather than a longer regex.

Three CI gates now enforce what used to be prose: `graph.mjs --check`, `docs-check.mjs --check`, and
`cargo check --release`.

**Postscript, 2026-09-01 — the same rule applies to our own briefs.** Rev 1 of the E2 brief carried
**four factual errors**, including its headline metric: it gave one login-cost formula for both sync
paths when `INTER_FOLDER_DELAY_MS` applies only to `imapInitialSync` (`imapSync.ts:473-475`) and
delta sync fetches at `BATCH_SIZE = 50` (`:39`), not `CHUNK_SIZE = 200` (`:41`). A cross-vendor
reviewer caught three of the four, plus the design blocker the author had missed entirely. **Verify a
brief's numbers the same way you verify the audit's — including your own.**

---

<!-- ─────── RESUME CARD · `tail -30 HANDOFF.md` is self-contained ─────── -->

## 7. Resume card

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · `main` @ **`3576093`** (last code commit **`d704ea0`**) · no open PRs · clean · CI green.
**Status:** audit backlog (20 items) merged. **E2/P15 session pooling is written and reviewed but NOT built** — it is blocked on Jim, not on engineering.

**Next action — tell Jim these two are waiting on him:**
- **E2 Decision 4** — where the raw-fetch fallback gets its credential. Three costed options in
  `docs/briefs/2026-09-01-e2-p15-session-pooling.md`; **recommendation (a)**. Blocks the build.
- **E2 rev 2 re-confirmation** — he approved rev 1; rev 2 changed retry semantics, session lifecycle,
  caps and the fallback design. Tier 2 plan approval is the one thing agent merge authority does not
  reach.

**Unblocked meanwhile:** (B) write the Tier-1 brief for the **`move_messages` timeout duplication
bug** (§2c — a `UID MOVE` that timed out after succeeding gets COPY'd again, duplicating the message;
ships today) · (C) low-risk cleanup: P16 (1)(2)(4)(5), P13 (c)(d)(e), P14 remainder.

**Verify first:** `git log --oneline -5` shows nothing past `3576093` · `git worktree list` — a
**locked parallel worktree** `f2-email-links-open` belongs to another session, **do not touch** ·
`git fetch upstream && git log --oneline main..upstream/main` empty · `gh run list --branch main --limit 2` shows CI **success** + Release Please **skipped**.

**Get running:**
```bash
git checkout main && git pull origin main && npm ci
npx tsc --noEmit
npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'   # expect 144 files / 1,757 tests
npm run graph:check && npm run docs:check
(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)
```

**Three traps:** a bare `npx vitest run` globs into the parallel worktree and reports ~200 failures
that are **not yours** — always pass the excludes. `cargo build --release` is broken on this machine
(sqlx proc-macro dylib — not ours; use `cargo check --locked --config 'profile.dev.debug-assertions=false'`).
The git-guard hook text-matches protected-branch wording anywhere in a Bash command — pass long text
via `--body-file` or `git commit -F`, never a heredoc.

**Read §6 next:** six audit claims failed verification — and rev 1 of our own E2 brief carried four.
Trust the backlog, not the numbers; re-verify before building.
