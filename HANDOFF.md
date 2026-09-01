# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.

- **Branch:** `main` @ `b751b94` — "chore: CI baseline, methodology import, approved deps (Batch D0) (#1)"
- **Open PRs:** the PR that lands this file (branch `docs/handoff`) — merge it; nothing else open.
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.

---

## 1. Exact next step — write the **Batch A plan** for Jim's approval (Tier 2, no code yet)

**Action:** produce the plan for Batch A (Rust security hardening) as a brief per
`docs/methodology/02-work-loop.md`, with a **threat pass** and a **written rollback path**, and
stop for Jim's approval. Then build on a branch, open a PR, let CI gate it, Jim merges.

**Scope (all accepted — `docs/audits/2026-09-01-optimize-audit.md`):**
- **P1** IMAP wire-protocol quoting/validation — `src-tauri/src/imap/client.rs:968,973,1005,1066,1072,1079`, `commands.rs:126-140`
- **P2** OAuth loopback: byte-slice panic in `oauth.rs:132-136`, no read timeout `:47-52`, port is an IPC arg `:16-19`
- **P3** `imap_raw_fetch_diagnostic` sends OAuth token as `LOGIN` password (`imap/client.rs:1066`) and logs the transcript (`:1101`); `devtools` Cargo feature in release (`Cargo.toml`, `lib.rs:43,95`, `SettingsPage.tsx:1716`)
- **P4** cap server-controlled literal size (`imap/client.rs:1259,1278,1393-1400`)
- Fix the 3 pre-existing clippy lints and remove the `-A` allowances from `ci.yml` → closes **EX-002**
- Remove unused `serde_json` dependency (opportunistic, noted in audit §4)

**Commands to get back to a working state:**
```bash
cd /Users/jpepper/Developer/Claude/Velo-Build/velo
git checkout main && git pull origin main
npm ci                                   # node_modules is gitignored
npx tsc --noEmit && TZ=America/Chicago npx vitest run --reporter=dot
(cd src-tauri && cargo clippy --all-targets --locked -- -D warnings \
   -A clippy::too_many_arguments -A clippy::question_mark -A clippy::unnecessary_map_or)
gh repo set-default Pepper512/velo       # gh otherwise resolves PR numbers against upstream
```

**Re-verify before acting (may have gone stale):**
- `main` still at `b751b94` and the handoff PR merged? (`git log --oneline -3`)
- Line numbers above were verified 2026-09-01 against `ec47a7a`; the Rust files were **not** touched by D0, but re-grep before editing.
- Has upstream moved? `git fetch upstream && git log --oneline main..upstream/main` — if there are security-relevant upstream commits in `src-tauri/`, rebase the plan on them first.
- CI still green on `main`? `gh run list --branch main --limit 1`
- Release Please fired on the D0 merge; confirm it did **not** open a release PR (D0 had no `feat`/`fix` commits). If it did, don't merge it — investigate.

---

## 2. Immediate / time-sensitive

None. No credentials were created or touched. `gh` is authenticated as `Pepper512` via the OS keyring (token scopes `repo`, `read:org`, `gist`, `admin:public_key`) — nothing to rotate.

---

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is running it under his engineering methodology
(`docs/methodology/`, pinned copy) to harden it: a 2026-09-01 optimization audit found the code
disciplined where tooling enforces (TS strict, DOMPurify chokepoint, clippy-clean) and weak where
nothing watched — IMAP wire-protocol injection and reachable panics in Rust, credential-decrypt
fall-through, an untested destructive migration repair, an unvalidated LLM-output boundary, a
40-file import cycle, 0% component test coverage and no real-SQL tests. **All 20 audit items are
accepted**; batch order **D0 → A → B → C → G → E → E2 → F → H**. D0 (CI + governance) is merged;
A is next. A separate accepted feature — **add xAI Grok as an AI provider and refresh every
provider's model list** — is sequenced after P16(3) in Batch F (Grok is an OpenAI-compatible
endpoint; needs a CSP `connect-src` entry for `https://api.x.ai`).

---

## 4. What just happened (this session, 2026-09-01)

- Bootstrapped methodology into the workspace, then moved everything **into** `velo/` (layout (a)).
- Rewrote **ADR-000** for the real inherited stack, then amended it: fork on GitHub, CI on GitHub Actions, approved deps.
- Ran the optimize audit → `docs/audits/2026-09-01-optimize-audit.md` (20 items, 9 batches, metrics baseline). ~12 highest-severity findings re-verified by hand.
- Forked to `Pepper512/velo`; `origin`/`upstream` remotes; `gh` default set to the fork.
- **PR #1 (Batch D0), merged as `b751b94`:** `.github/workflows/ci.yml` (SHA-pinned; tsc, vitest in `TZ=UTC` + `America/Chicago`, `cargo build --locked`, clippy `-D warnings`, `cargo test`, `cargo audit`, `npm audit`, gitleaks) · stale `Cargo.lock` synced · TZ-dependent `icalHelper.test.ts` fixture fixed (suite now 1,562/1,562 everywhere) · `better-sqlite3` devDep (**ADR-001**) + hand-written `.d.ts` + smoke test · `@tanstack/react-router` 1.159→1.170 (npm critical = 0) · full semver-compatible `cargo update` (13/15 RustSec advisories cleared) · CLAUDE.md merged (Part I process / Part II upstream guide) · ORIENTATION boundary manifest + gate ledger.
- Repo settings: `main` protection (5 required checks strict, linear history, admins enforced, deletions blocked, conversation resolution; **no required reviews — EX-005**); `allowed_actions` = GitHub-owned + 6 pinned third-party actions.
- Exceptions filed: EX-002 (clippy allowances), EX-003 (lettre advisory not compiled), EX-004 (npm audit at `critical` until tiptap bump), EX-005, EX-006 (rkyv/rsa lockfile-only). **EX-001 closed** by the handoff PR.

---

## 5. Decisions

**Made (all in `docs/decisions/LOG.md`, 2026-09-01):**
- Fork on GitHub, CI on GitHub Actions (a same-day Forgejo decision was superseded before any work landed).
- Approved: `better-sqlite3` (dev), `zod` (first use Batch B — dependency block goes in that PR), `@tanstack/react-router` bump now.
- All 20 audit items accepted as written, including batch order.
- Grok + latest-models feature: accepted, sequenced after P16(3). Assumption: Grok is *available*, not the default for anything — **Jim has not confirmed this**.

**Pending Jim's approval:**
- The **Batch A plan** (section 1) — Tier 2, must be approved before code.
- Model defaults per provider for the Grok/models brief (propose fast-and-cheap for background categorization, frontier selectable for compose/Ask Inbox).

**Deliberately deferred + reason:**
- `dompurify` bump → **first in Batch C**, after the P9 sanitizer attack corpus exists (Jim specified the corpus as the regression gate; bumping first would test the new version rather than prove no regression).
- `@tiptap/pm` bump (High: `linkify-it`/`markdown-it`) → **Batch G**, per Jim; hence `npm audit --audit-level=critical` (EX-004).
- Splitting `SettingsPage.tsx` (2,323 lines) and other god-components → not until component tests exist (audit §4).
- Biome / pnpm / TS linter → separate dependency decisions, not audit fixes.
- Session pooling for IMAP (P15/E2) → after Batch A lands; it's the one real runtime speedup (removes a TLS handshake per action) but changes credential lifecycle → Tier 2.

**Operational notes that bit us:**
- `~/.claude/hooks/git-guard.sh` text-matches protected-branch wording in the *whole Bash command*, including heredoc document content and a `gh pr create --base main` chained after a branch push. Author such docs with Write/Edit; keep those commands in separate calls. Never bypass it.
- The repo's `.claude/skills/commit` skill pushes unconditionally — don't use it (audit §7, rewrite pending in Batch H).
- Release Please runs on every push to `main`; it only acts on `feat`/`fix`/`perf`/`BREAKING` commits.

---

## 6. How to run / develop

```bash
cd velo
npm ci && npm run tauri dev            # full app (Vite :1420 + Tauri)
npm run dev                            # Vite only
npx tsc --noEmit                       # typecheck
npx vitest run                         # tests; add TZ=America/Chicago to mimic the CI matrix leg
npx vitest run src/path/file.test.ts   # one file
cd src-tauri && cargo build --locked && cargo test && cargo clippy --all-targets   # Rust
```
Details: `docs/development.md`, `docs/architecture.md`, `CLAUDE.md` Part II. Process: `CLAUDE.md` Part I, `ORIENTATION.md`, `docs/methodology/`.
