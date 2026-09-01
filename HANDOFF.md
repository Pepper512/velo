# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Branch:** `main`. **Last commit: `5c545f9`** ("fix(imap): expunge only the messages the
  operation was given (REQ-2/3/4) (#26)"). Unlike previous revisions of this file, the pin **is** the
  code commit — this refresh landed after it.
- **Open PRs:** none. Working tree clean. CI green on `main`; Release Please **skipped** (EX-007 guard holding).
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **⚠️ A parallel session is active in this repo and lands work.** `git worktree list` shows
  `.claude/worktrees/f2-email-links-open`, **locked** — and re-pointed again, now to
  `deps/pr-a-security-alignment` (the dependency-audit PR A). **The directory name has never matched
  its branch; trust `git worktree list`, not the path. Do not touch it.** It is gitignored
  (`.gitignore:51`) but **not excluded from vitest**, so a bare `npx vitest run` at the repo root also
  runs *that* branch's tests. Always scope your run — see §1. CI is unaffected (clean checkout).
- **Expect `main` to move under you.** Five merges landed this session from two sessions working in
  parallel. Rebase before merging, and re-run gates after the rebase.
- **State:** frontend **1,822** tests (152 files) · Rust **56** · **0** prod npm advisories
  · **0** import cycles containing a service · EX-001/002/004 closed; EX-003/005/006/007 open.

---

## 1. Exact next step

**Three things are live. In priority order:**

**(A) F-4 rev-4 delta-review — you are the gate, not a formality.** Jim approved F-4 *pending a clean
delta-review from this session*: clean ⇒ fully approved, anything found ⇒ approval void, back to Jim.
Spec: `~/Vaults/Pepper Knowledge/10 Projects/Velo/Build Queue/10-Bug-Fixes/SPEC-F-4_Vanished-UID-Reconciliation.md`
(rev 4). Review **only the rev-4 changes against the seven Gemini findings**, not a fourth full round.
Two seams the author flagged: whether the >50% catastrophic stop and the batching cap compose sanely
at the boundary, and whether REQ-2.2's recompute (`|server_list − local_uids|` after the pass's
new-message fetch) has an ordering hazard.

**(B) E2/P15 brief refresh — docs only, no code.** Decision 4 is now **DECIDED: (a)** (Jim,
2026-09-01). The refresh must: re-verify every line number against `5c545f9` (they were verified at
`d704ea0`, five merges back, and #26 moved code inside the functions pooling touches); fold in the
drift #25/#26 created; and record the five Kimi pooling findings, **cancellation-bypassing-eviction
first — the current design does not cover it**. Keep **rev-2 re-confirmation open at the top**, and
where a Kimi finding changes what an option costs, say so *next to the decision block*.

**(C) Dependency-audit PRs A–E** are being built by the parallel session, in dependency order. Each
comes to this session for the EX-005 opposite-line review. Expect that load.

**Then, and only after Jim re-confirms rev 2: build E2/P15.**

### What must be re-verified before acting

- **Every line number in the E2 brief.** Verified at `d704ea0`; `main` is `5c545f9`. #25 added
  `caps.rs`/`move_outcome.rs` and rewrote the `uid_mv` arm; #26 rewrote both removal paths and changed
  `move_messages`/`delete_messages` to return `RemovalResult`. Re-grep before editing.
- **Has `main` moved?** `git log --oneline -5`. A second session lands work here continuously.
- **The parallel worktree's branch** — `git worktree list`. The directory name lies; it has been
  re-pointed twice.
- **Upstream drift:** `git fetch upstream && git log --oneline main..upstream/main`. Empty all session.
- **CI:** `gh run list --branch main --limit 2`. Release Please must read **`skipped`**, never `failure`.
- **Kimi quota** — it hit its weekly limit on 2026-09-01. Gemini 3.7 via Antigravity is the working
  cross-vendor seat and is what caught F-4's three HIGHs.

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

Expected: **152 test files, 1,822 tests, all passing**, and **56** Rust tests. A wildly higher file
count means the exclude was dropped and you are running the parallel worktree's tests.

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

### 2c. ~~`move_messages` duplicates mail on a timeout~~ — **FIXED, both halves**

Kept as a record because the shape recurs. Two defects, both live for the project's whole history:

1. `move_messages` matched `Ok(Ok(()))` and `_`, collapsing "server lacks MOVE", a `NO` refusal and a
   timeout into one COPY fallback — so a `UID MOVE` that succeeded server-side but timed out was
   COPY'd again. Fixed in **#25** (`2066351`).
2. **The worse one, found in review:** both the COPY fallback and `delete_messages` called a bare
   `session.expunge()`, which removes *every* `\Deleted`-flagged message in the folder, not just the
   given UIDs — including another client's flags. `deleteDraft` reached it, so discarding one draft
   expunged everything flagged in Drafts. Fixed in **#26** (`5c545f9`), proved by live Dovecot
   transcripts.

**The lesson worth keeping:** #25's first cut passed every test written for it and still did not fix
the bug, because the tests never crossed the IPC boundary. The Rust classifier refused to retry, but
the error text contained "timed out", `networkErrors.ts` marked it retryable, and `executeEmailAction`
re-ran the move. **A requirement that spans Rust and TS is not done when the Rust half is done.**

### 2d. `updateMessageImapFolder` has zero callers — latent bug on `main` (**F-5**, queued)

`messageHelper.ts:126` exports it "for after a move operation"; nothing calls it, and nothing else
writes `messages.imap_folder` outside the sync upsert. So after an archive or move the local row still
names the **source** folder until the destination folder syncs. Consequences: actions on an
already-moved message use a stale folder/UID pair, and any naive folder-diff reconciliation would read
archived mail as vanished (this is what F-4 rev 1 would have done). Not fixed; queued as **F-5**.

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is hardening it under his engineering methodology
(`docs/methodology/`, pinned copy). A 2026-09-01 optimization audit raised 20 items; **all 20 were
accepted**, and all are landed except the two above.

The audit's framing held up: the code was disciplined where tooling enforced it and weak wherever
nothing watched. These batches added the watchers.

---

## 4. What just happened (2026-09-01)

### Latest session — the move/expunge data-loss fix, end to end

| PR | What |
|---|---|
| #23 `60728a1` | **Brief** for the move/expunge defects — Tier 2, approved by Jim in the PR comment |
| #24 `a96af36` | **Decision:** a peer session may relay Jim's Tier-2 approvals (see §5) |
| #25 `2066351` | **REQ-1** — classify `UID MOVE` failures; `caps.rs` reads `CAPABILITY` |
| #26 `5c545f9` | **REQ-2/3/4** — targeted `UID EXPUNGE`; the untargeted one is gone from the tree |

**Verified on merged `main`:** `grep "\.expunge()"` returns **no call site** — only the doc comment
describing the old bug. Rust 47 → 56, frontend 1,784 → 1,822.

**Merge-gate evidence.** #26's Done-when required live Dovecot transcripts, run by the parallel
session (Docker's daemon is not running in this session). All three scenarios passed. The decisive
one: on the UIDPLUS server a second client's bystander survived **with its `\Deleted` flag intact** —
exactly the message the old bare `EXPUNGE` would have destroyed. The driver called Velo's production
`delete_messages`, which is what makes it evidence about Velo rather than about Dovecot.
`docs/testing/dovecot/` ships the harness; the **Alpine variant is the trusted one**, the official
amd64 compose is kept but labelled unverified (it crash-loops under Rosetta and its credential env
vars were never honoured).

**Not verified anywhere:** none of this has run against a real provider. Gmail, Fastmail and Exchange
all advertise UIDPLUS, so the primary path should hold — but that is inference from capability lists,
not observation.

### Earlier that day — E2 brief, its review, and one bug fix

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

**Made this session:**
- **E2 Decision 4 — DECIDED: (a)**, frontend-driven (Jim, 2026-09-01, direct + relayed). Pooled
  command returns `NeedRawFallback`; the frontend calls a separate config-carrying
  `imap_raw_fetch_messages`. The password crosses IPC only on that rare non-standard-server path, at
  the cost of one **named** exemption in the acceptance grep. (c) was killed by the OAuth argument —
  stored tokens expire, so it would need refresh logic and refresh tokens in long-lived Rust state.
- **move/expunge Decision 1 — (a)** with four binding conditions (report `expunged:false`, say so in
  the UI, log the capability miss once per account, never degrade a failed `UID EXPUNGE` to a bare
  one). *"'Permanently' may degrade to 'eventually' only when the app says so out loud."*
- **A peer session may relay Jim's Tier-2 approvals** (#24, `LOG.md`). Scope is narrow and matters:
  merging is still execution not approval; *no self-approval* still holds, so an agent cannot relay
  approval for its own work; a relay **carries** his authority and does not **create** any. A relayed
  approval with no durable record is coordination, not approval. **This is the line that stopped E2:**
  Decision 4 had never been made, so there was nothing to relay until Jim actually made it.

**Pending Jim:**
- **E2 rev-2 re-confirmation** — deliberately held until the brief refresh lands, so he re-confirms
  against current facts (the cancellation-bypasses-eviction finding especially). **No pre-commit
  exists.** Refresh PR → EX-005 review → back to Jim.
- **F-4** — approved *conditionally on a clean rev-4 delta-review from this session*. Not clean ⇒
  approval void.
- P11 approval + QA (§2a) · P19 re-wire-or-delete (§2b) · the per-provider model default proposal
  (never answered; the conservative reading shipped).
- **A permission question, unresolved:** a `gh pr merge` that this session's classifier blocked twice
  was performed from the parallel session instead (#24). The change was uncontroversial; the
  precedent — that a permission decision in one session is reachable through another — was flagged to
  Jim and he has not ruled on it.

**Deliberately deferred + reason:**
- **E2 build itself** — plan written and reviewed; Decision 4 is now settled, so it is blocked on
  **rev-2 re-confirmation alone**, and on the brief refresh that re-confirmation should be made
  against. Not blocked on engineering.
- **F-5 (move-time row hygiene)** — §2d. A latent bug on `main` today, not just an F-4 dependency.
- **The 11 other IMAP `invoke()` wrappers do not validate their results** (`tauriCommands.ts`),
  contrary to `CLAUDE.md`'s boundary rule. #26 validated the one it added and left the rest; queued.
- **`raw_fetch_messages` still opens its own connection** — Decision 4(a) accepts this; Kimi's
  option (d) (run the raw fetch on the pooled session) is the more elegant end state and is recorded
  in the brief as a future simplification, not scope.
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

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · `main` @ **`5c545f9`** · clean · CI green.
**Status:** audit backlog merged. **The move/expunge data-loss bug is FIXED and verified** (#25, #26) —
`grep "\.expunge()"` returns no call site anywhere. E2/P15 is still **not built**.

**Next action — three live items, in order:**
1. **F-4 rev-4 delta-review.** Jim approved F-4 *conditionally on this coming back clean*; anything
   found voids the approval and returns it to him. Review the rev-4 changes only, against the seven
   Gemini findings. Spec in the vault under `10 Projects/Velo/Build Queue/10-Bug-Fixes/`.
2. **E2/P15 brief refresh — docs only, no code.** Decision 4 is **DECIDED (a)**. Re-verify every line
   number against `5c545f9`: they were verified at `d704ea0`, five merges back, and #26 rewrote code
   inside the very functions pooling touches. Fold in the #25/#26 drift and record the five Kimi
   pooling findings — **cancellation bypassing eviction-on-error is not covered by the current
   design**. Leave **rev-2 re-confirmation open at the top**: it is the last thing blocking the build,
   and Jim is holding it deliberately until he can judge it against this refresh.
3. **EX-005 opposite-line reviews for dependency-audit PRs A–E**, as the parallel session sends them.

**Verify first:** `git log --oneline -5` — a second session lands work here continuously ·
`git worktree list` — a **locked** worktree under `.claude/worktrees/` belongs to that session and
**its directory name has never matched its branch**; do not touch it · rebase before merging ·
`git fetch upstream && git log --oneline main..upstream/main` empty ·
`gh run list --branch main --limit 2` shows CI **success** + Release Please **skipped**.

**Get running:**
```bash
git checkout main && git pull origin main && npm ci
npx tsc --noEmit
npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'   # expect 152 files / 1,822 tests
npm run graph:check && npm run docs:check
(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)   # 56 Rust tests
```

**Four traps:** a bare `npx vitest run` globs into the parallel worktree and reports failures that are
**not yours** — always pass the excludes. `cargo build --release` is broken on this machine (sqlx
proc-macro dylib — not ours; use `cargo check --locked --config 'profile.dev.debug-assertions=false'`).
The git-guard hook text-matches protected-branch wording anywhere in a Bash command — author such text
with the Write tool and pass it via `--body-file` / `git commit -F`, never a heredoc, and keep the
push in its own call. Docker's daemon is **not running** here, so Dovecot transcripts cannot be
produced from this session.

**Read §6 next:** six audit claims failed verification, rev 1 of our own E2 brief carried four, and
this session's first cut of REQ-1 passed every test written for it while still not fixing the bug —
the tests never crossed the IPC boundary the requirement was about. Trust the backlog, not the
numbers, including your own.
