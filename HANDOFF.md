# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.

- **Branch:** `main` @ `1ab7518` — D0, A, B, C and Batch G's dependency half are all merged.
- **Open PRs:** the one landing this edit (the **P11 brief**). No code PRs open.
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **State:** frontend suite **1,709** (was 1,562) · Rust **45** (was 6) · **0 prod npm advisories** (was 3).

---

## 1. Exact next step — **P11 needs Jim, then Batch E**

### 1a. P11 is the one item an agent cannot finish

Brief: `docs/briefs/2026-09-01-batch-g-p11-capabilities.md`. It is written and **not built**, for two
reasons that are both recorded there:

1. **The audit's proposed split is not viable as written.** It would give pop-out windows "read-only
   sql", but `ThreadWindow.tsx` calls `runMigrations()` and renders the full `Composer` (draft
   auto-save writes every 3 s), and `ActionBar`/`MessageItem` expose one-click unsubscribe, which
   POSTs to **arbitrary sender-supplied URLs** — so `http` cannot be narrowed until unsubscribe moves
   to a Rust command with URL validation. The brief proposes a smaller, honest narrowing instead.
2. **Its acceptance cannot be automated.** The audit says so itself: *"no automated harness exists for
   capability denial"*. An over-narrow grant fails at **runtime**, in a window that only opens on user
   action — CI cannot catch it.

**What Jim has to do:** approve the brief, then run the five manual QA steps in its *Verification*
section against a dev build. Step 5 (a `fs|remove` invoke from a pop-out's console being **denied**)
is the one positive security assertion; if it succeeds, the split achieved nothing.

### 1b. Then Batch E (P13, P15)

Per the audit order, E follows G. Both items are large and are **pure refactoring**, not security:
P13 is the 40-file import cycle that drags the router into Gmail sync; P15 is the Rust `MailError`
enum plus `open_stream()` dedupe. Together they are roughly a quarter of all remaining effort.

---

## 2. Standing instruction — verify the audit before building to it

**Five of its claims have now failed verification.** It remains the right backlog for *what* to fix;
its *measurements* are not reliable. Spot-check anything from it before sizing or sequencing work.

| # | Claim | Reality |
|---|---|---|
| 1 | `serde_json` is an unused dependency (§4) | `tauri::generate_context!()` requires it; removing it fails the build with `E0433` |
| 2 | P1 has six IMAP injection sites | Nine — `async-imap` leaves `uid_store`, `uid_search` and `append` unvalidated |
| 3 | Components have 0% test coverage (§6) | 32 component test files exist; the metric script missed `.test.tsx` |
| 4 | P9 lists six missing remote-image vectors | Five were already handled; five **different** ones were live and unlisted |
| 5 | P14: poison queue op "retried forever, no ceiling" | `classifyError` defaults to non-retryable *and* `incrementRetry` already has a ceiling |

---

## 3. Superseded sections (kept for the audit trail)

Batch B is **Tier 2** on all three counts (P5 credentials, P6 migrations, P10 LLM boundary).
Write the brief the way Batch A's was written
(`docs/briefs/2026-09-01-batch-a-rust-security.md` is the template that worked), get Jim's approval,
then build → PR → gates → merge.

**Scope — P5, P6, P10, plus the P12 harness pulled forward** (delegation map §3 is authoritative
on the P-items; the harness is Jim's 2026-09-01 addition):
- **P5** credential decrypt falls through to using ciphertext as the password (`accounts.ts:39-75`)
- **P6** `runMigrations` destructive one-shot repair, untested, runs every launch (`migrations.ts:898-923`)
- **P10** LLM output boundary — model text reaches the composer via a regex tag-strip; email bodies
  interpolated into prompts unescaped (`aiService.ts`, `askInbox.ts`, `prompts.ts`)

> **Correction (2026-09-01):** an earlier draft of this handoff said Batch B was "P5–P8". It is not.
> **P7 and P8 belong to Batch C** (with P9 and P14). P10 is the item that silently slid out of scope
> — it is Tier 2 and it is the LLM-output boundary, so losing it would have been the expensive kind
> of mistake. The delegation map in the audit, not this file, is the authority on batch membership.

**Both prior questions are now settled — nothing is blocking the brief:**
1. **P12's real-SQLite harness is pulled forward into Batch B — decided by Jim 2026-09-01.**
   Build it *first* within the batch; P6's tests depend on it. Already in place from D0 (ADR-001):
   the `better-sqlite3` devDependency, `src/test/better-sqlite3.d.ts`, and a smoke test at
   `src/test/sqliteHarness.test.ts`. **B adds** the reusable in-memory harness `runMigrations` can be
   pointed at, plus P6's tests: fresh DB applies all migrations · a second run applies zero · a
   simulated failure between the repair's DELETEs and its flag write leaves **nothing** deleted and
   the flag unset. **No new dependency** — ADR-001 already covers this use.
   Side effect: this also unblocks **P8** (FTS5, Batch C), whose acceptance is likewise written
   against real SQLite. P8 stays in C; C just gets cheaper.
2. **`zod` — already approved, and the question was mine, not yours.** `LOG.md` (2026-09-01, item 3)
   records: *"Approved dependency: `zod` — boundary validation per the global standard; **first use is
   P10 (LLM output)**. Dependency block required in the Batch B brief."* An earlier draft of this file
   asked whether zod "earns its place in B" — that doubt only existed because the same draft had B
   scoped wrongly as P5–P8, which excluded P10. With P10 restored, zod's first use *is* Batch B,
   exactly as decided. **No decision needed: carry the dependency block in the Batch B PR,** scoped to
   the AI-output parser.

**P6 is a one-way door:** there are no down migrations, so users on the fixed build cannot be
downgraded. The audit says the plan must state this. It must.

---

## 1b. How merges work now (changed 2026-09-01)

All three are green (or were when written — check), all three are based on `b751b94`, and none
**Agents perform the merge** (Jim, 2026-09-01 — supersedes the old "agents never merge"). Land work
in dependency order once every required check is green **on the exact commit being merged**; a rebase
or force-push invalidates the previous run. Stop and ask on a red gate or a judgment-call conflict.

The three PRs below are **done** — kept here only as the worked example of the sequencing hazard,
because it cost three full CI re-runs:

| # | Branch | What it is | Closes |
|---|---|---|---|
| **#2** ✅ `252bb1a` | `docs/handoff` | This file. | EX-001 |
| **#3** ✅ `6fe932a` | `chore/fork-release-automation` | Stops Release Please failing on every push. | — |
| **#4** ✅ `f7e890b` | `feat/batch-a-rust-security` | **Batch A** — the security work. | EX-002 |

**Order matters only because of branch protection:** `main` requires the 5 checks **strict**, i.e.
a branch must be up to date with `main` before it can merge. So after you merge one, the next PR
will show *"This branch is out-of-date"* — click **Update branch**, wait for CI (~7 min, the `rust`
job is the long pole), then merge. Repeat. Merging smallest-first (#2 → #3 → #4) kept the re-runs
cheap — and was still three extra full runs, because all three PRs appended to the same two doc files.

**Confirmed after #3 merged:** the Release Please run on that push is **`skipped` (2s)**, where the
push before it (the #2 merge, which landed pre-guard) was **`failure` (1m9s)**. The #2 merge also
re-created the stray `release-please--…` branch; deleted again. The guard works.

---

## 2. Immediate / time-sensitive

None. No credentials were created or touched.

One standing annoyance: **`cargo build --release` does not work on this machine.** It fails inside
`sqlx 0.8.6` with `dlopen(libsqlx_macros….dylib): mis-aligned LINKEDIT string pool` — a corrupt
proc-macro dylib the *release profile* produces on this macOS/toolchain combination. It reproduces
after a full `cargo clean --release` and fails **before any Velo source compiles**, so it is not
ours. Debug builds are fine. To type-check the `#[cfg(not(debug_assertions))]` arm locally, use:

```bash
cd src-tauri && cargo check --locked --config 'profile.dev.debug-assertions=false'
```

PR #4 adds `cargo check --release --locked` to CI so Linux checks it properly from now on.

---

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is running it under his engineering methodology
(`docs/methodology/`, pinned copy) to harden it: a 2026-09-01 optimization audit found the code
disciplined where tooling enforces (TS strict, DOMPurify chokepoint, clippy-clean) and weak where
nothing watched. **All 20 audit items are accepted**; batch order **D0 → A → B → C → G → E → E2 →
F → H**. **D0 and A are merged**; **B is next**. A separate accepted feature —
**add xAI Grok as an AI provider and refresh every provider's model list** — is sequenced after
P16(3) in Batch F.

---

## 4. What just happened (session 2, 2026-09-01, overnight)

**Handed the PM role to the agent; it found something the previous handoff had mispredicted.**

- **Release Please was failing on `main`.** The previous handoff predicted it would no-op on the D0
  merge (no `feat`/`fix` commits). It didn't: it computed a `0.4.21 → 0.5.0` bump from **173
  inherited upstream commits** — the fork has no release history, so every upstream commit reads as
  unreleased — pushed a version-bump branch, then died on `GitHub Actions is not permitted to create
  or approve pull requests`. → **PR #3** guards the release workflows on `github.repository` so they
  run only upstream. The stray `release-please--…` branch was deleted. **EX-007** filed (this fork
  now has no exercised release path). Granting the missing permission was rejected: it would have
  made it *succeed* at publishing an unsigned `v0.5.0` of someone else's work.
- **Batch A built** — brief at `docs/briefs/2026-09-01-batch-a-rust-security.md` (Tier 2: outcome,
  not-doing, acceptance conditions, threat pass over four surfaces, rollback). P1–P4 fixed, EX-002
  closed, **Rust tests 6 → 45**.

### Three things Batch A found that the audit had wrong or missed

1. **P1 is wider than the audit's six sites.** Reading the vendored `async-imap` 0.10.4 source:
   the library runs `validate_str` on `select`/`uid_copy`/`uid_mv`/`status`/`login`, but **not** on
   `uid_store` (`:808-828`), `uid_search` (`:1219`), or `append`'s mailbox *and* flags (`:1119-1136`).
   So `flags`, `since_date`, and append's `folder` were three further injection sinks reachable from
   `#[tauri::command]` arguments. All nine sites now route through the new `src-tauri/src/imap/wire.rs`.
2. **`serde_json` is NOT an unused dependency — audit §4 is wrong.** `tauri::generate_context!()`
   expands to code naming `::serde_json`; removing it fails with `E0433`. Verified by removing it and
   rebuilding. Restored with a comment. **Treat that audit line as retracted.**
3. **The sharpest bug in P2 was not the panic itself.** `urlencoding_decode` sliced a `&str` by byte
   index, so `?code=%€x` panicked — *before* the CSRF `state` comparison at `oauth.rs:58` could run.
   The security control existed and was being bypassed by a crash.

---

## 5. Decisions

**Made this session (in `docs/decisions/LOG.md`):**
- **Release automation is upstream-only on this fork** (guard, not delete — keeps the diff friendly to
  upstream merges). If you ever want signed builds from `Pepper512/velo`, that is an **ADR** (release +
  signing model), not a guard flip.
- Batch A deviations, all recorded in the brief: `Result<_, String>` kept instead of the audit's
  suggested `MailError`; no `percent-encoding` dependency (declined — the fix is ~15 lines of byte
  matching); flag handling changed shape so rendering happens in `imap::wire`, which widened the
  frontend diff to 2 call sites + 4 test assertions; landed as 2 commits rather than the planned 6
  because P1/P3/P4/clippy edit interleaved regions of the same functions.

**Pending your decision:**
- **The two Batch B questions in section 1** (pull the P12 SQLite harness forward? does `zod` earn its
  place in B?).
- **Model defaults per provider** for the Grok/models brief (proposed: fast-and-cheap for background
  categorization, frontier selectable for compose/Ask Inbox). Also still unconfirmed: Grok is
  *available*, not the default for anything.
- **Five pre-existing bugs Batch A found and deliberately did not fix** — in the brief's *Observations*
  section. Two want a decision on whether they get their own brief soon:
  1. **The OAuth 17249–17251 fallback is dead code.** `redirectUri` is hard-coded to `:17248` in both
     `oauthFlow.ts:71` and `auth.ts:88`, so binding a fallback port just makes sign-in fail *slower*.
  2. **`oauthFlow.ts:71` uses `http://localhost:17248` while the server binds `127.0.0.1`** (upstream
     `ec47a7a` deliberately switched the bind). Where `localhost` resolves to `::1` first, that redirect
     goes nowhere. `gmail/auth.ts:88` already uses `127.0.0.1`. **Likely a live bug for non-Gmail OAuth.**

**Deliberately deferred + reason (unchanged):**
- `dompurify` bump → first in Batch C, after the P9 attack corpus exists.
- `@tiptap/pm` bump → Batch G (hence EX-004).
- Splitting `SettingsPage.tsx` → not until component tests exist.
- IMAP session pooling (P15/E2) → after A lands; Tier 2, changes credential lifecycle.

**Exceptions:** EX-001 **closed** (#2) · EX-002 **closed** (#4) · EX-007 open (no release path on the
fork, review 2027-03-01) · EX-003, EX-004, EX-006 open · **EX-005 rewritten 2026-09-01**: its old
mitigation was "agents never merge; Jim is the only merger", which the new merge rule withdrew. It now
records the residual risk explicitly — an agent can land its own Tier 0/1 work with no human in the
loop. Tier 2+ still needs Jim's plan approval before code.

**Operational notes that bit us:**
- `~/.claude/hooks/git-guard.sh` blocks `git add -A/.` (stage explicit paths) and text-matches
  protected-branch wording across the *whole* Bash command, heredocs included. Author docs with
  Write/Edit; keep `git push` and `gh pr create --base …` in separate calls. Never bypass it.
- The repo's `.claude/skills/commit` skill pushes unconditionally — don't use it (rewrite pending in Batch H).
- **Every merge invalidates the branches behind it.** `main` protection is *strict*, and #2/#3/#4 all
  appended to `LOG.md` and `EXCEPTIONS.md`, so each merge left the rest `DIRTY` (a real conflict, not
  just out-of-date) and forced a rebase + a full CI re-run. When batching PRs, expect this: resolve
  append conflicts by keeping **both** entries in chronological order, re-run the gates locally, then
  force-push. Sequence doc-touching PRs one at a time rather than in parallel where possible.

---

## 6. Batch B detail

Full scope and the two open questions are in **section 1** (they belong at the top now that Batch B
is the next step, not a future one). Start from `docs/audits/2026-09-01-optimize-audit.md` §P5–P8.

---

## 7. How to run / develop

```bash
cd velo
npm ci && npm run tauri dev            # full app (Vite :1420 + Tauri)
npx tsc --noEmit                       # typecheck
npx vitest run                         # 1,562 tests; add TZ=America/Chicago for the CI matrix leg
cd src-tauri && cargo build --locked && cargo test --locked
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # no -A flags after #4
gh repo set-default Pepper512/velo     # gh otherwise resolves PR numbers against upstream
```
Details: `docs/development.md`, `docs/architecture.md`, `CLAUDE.md` Part II.
Process: `CLAUDE.md` Part I, `ORIENTATION.md`, `docs/methodology/`, `docs/briefs/`.
