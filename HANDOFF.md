# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.

- **Branch:** `main` @ `b751b94` — "chore: CI baseline, methodology import, approved deps (Batch D0) (#1)"
- **Open PRs:** **#2, #3, #4 — all built, all waiting on you to merge.** Nothing else open.
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.

---

## 1. Exact next step — merge three PRs, in this order

All three are green (or were when written — check), all three are based on `b751b94`, and none
touches a file another one touches. **Agents never merge** (`CLAUDE.md` Part I), so this is yours.

| # | Branch | What it is | Closes |
|---|---|---|---|
| **#2** | `docs/handoff` | This file. | EX-001 |
| **#3** | `chore/fork-release-automation` | Stops Release Please failing on every push. | — |
| **#4** | `feat/batch-a-rust-security` | **Batch A** — the security work. | EX-002 |

**Order matters only because of branch protection:** `main` requires the 5 checks **strict**, i.e.
a branch must be up to date with `main` before it can merge. So after you merge one, the next PR
will show *"This branch is out-of-date"* — click **Update branch**, wait for CI (~7 min, the `rust`
job is the long pole), then merge. Repeat. Merging smallest-first (#2 → #3 → #4) keeps the
re-runs cheap.

**After the final merge, confirm the fix worked:** the Release Please run on that push should show
**skipped**, not failed. `gh run list --branch main --limit 3`.

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
F → H**. D0 is merged; **A is built and awaiting merge**; B is next. A separate accepted feature —
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
- **Merge #2, #3, #4** (section 1).
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

**Exceptions:** EX-001 closes on #2 · EX-002 closes on #4 · **EX-007 new** (no release path on the
fork, review 2027-03-01) · EX-003, EX-004, EX-005, EX-006 open.

**Operational notes that bit us:**
- `~/.claude/hooks/git-guard.sh` blocks `git add -A/.` (stage explicit paths) and text-matches
  protected-branch wording across the *whole* Bash command, heredocs included. Author docs with
  Write/Edit; keep `git push` and `gh pr create --base …` in separate calls. Never bypass it.
- The repo's `.claude/skills/commit` skill pushes unconditionally — don't use it (rewrite pending in Batch H).
- **`gh pr merge` is blocked by the local auto-mode classifier**, which happens to match the repo rule
  that agents never merge. Expect to do all merges yourself.

---

## 6. Next work after the merges — Batch B

Per the audit's batch order. Batch B is where **`zod` gets its first use**, so its PR carries the
dependency block (`06-decisions.md`). Start by re-reading `docs/audits/2026-09-01-optimize-audit.md`
§P5–P8 and writing the brief the same way Batch A's was written.

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
