# Decision Log

> Append-only. One line per decision: date, what was decided, one-clause
> why, link to more if it exists. Agents read this at session start
> (`docs/methodology/03-agents.md`).

- **2026-09-01** — Adopted `docs/methodology/` (methodology-v2, pinned copy),
  `docs/decisions/ADR-000.md` (stack, from `~/claude-memory/STACK-DEFAULTS.md`),
  and `TEAM.md`/`docs/methodology/ROSTER.md` (default team/agent fleet) via
  the `bootstrap-project` skill — because re-deriving these per project
  wastes the judgment already spent getting them right once.
- **2026-09-01** — Rewrote `ADR-000.md` to pin Velo's actual inherited stack
  (Tauri v2 / Rust / React 19 / Zustand / SQLite via tauri-plugin-sql /
  Vitest / npm) instead of the web default (Hono / tRPC / Postgres / Better
  Auth) — because the default described software that doesn't exist here
  and would have made every PR a "deviation." Records how each of Jim's
  hard rules translates to a local-first desktop app, and lists six
  follow-ups (PR CI, Zod, Biome, LLM-boundary threat pass, OS keychain,
  `http` plugin scope) as separate briefs.
- **2026-09-01** — Ran the codebase optimization audit (`~/claude-memory/prompts/optimize-audit.md`)
  against `velo/` @ `ec47a7a`; artifact at `docs/audits/2026-09-01-optimize-audit.md`
  (20 prioritized items, 9 delegation batches, metrics baseline). Top risks: IMAP
  wire-protocol injection + reachable panics in Rust; credential decrypt fall-through
  and an untested destructive migration repair; unvalidated LLM output boundary. No
  source edited. Jim's accept/defer decisions pending — append here when made.
- **2026-09-01** — Jim's decisions on the 2026-09-01 optimize audit (`docs/audits/2026-09-01-optimize-audit.md`):
  1. **Repo model: fork.** `git init` this workspace and host it on Jim's self-hosted
     **Forgejo**; CI runs on a **Forgejo runner** (Forgejo Actions, `.forgejo/workflows/`),
     not GitHub Actions. Fires ADR-000's "fork vs. contributor" tripwire — ADR-000 to be
     amended with the Forgejo/CI row.
  2. **Approved devDependency: `better-sqlite3`** — in-memory SQLite test harness for
     P6 (`runMigrations`) / P8 (FTS5) / real-SQL tests. Dependency block required in the
     Batch D0 brief.
  3. **Approved dependency: `zod`** — boundary validation per the global standard; first
     use is P10 (LLM output). Dependency block required in the Batch B brief.
  4. **`npm audit` bumps:** take **`@tanstack/react-router`** (critical, `seroval`) and
     **`dompurify`** (XSS chokepoint; P9 attack corpus is the regression gate) **now**;
     **defer `@tiptap/pm`** (high, `linkify-it`/`markdown-it`) to Batch G.
  Accept/defer of the remaining P-items: pending.
- **2026-09-01** — Jim **accepted all 20 items (P1–P20)** of the 2026-09-01 optimize audit as written,
  including the batch order (D0 → A → B → C → G → E → E2 → F → H). PM (position 1) to convert into
  briefs. Note: `dompurify` bump sequenced first-in-Batch-C (after the P9 corpus exists), router bump in D0.
- **2026-09-01** — New feature request (not an audit item): **add xAI Grok as an AI provider and move every
  provider's model list/defaults to current models.** To be briefed separately (touches
  `services/ai/providers/*`, `providerManager.ts`, Settings UI, CSP allowlist, help content, docs).
  Sequenced after P16(3) `createOpenAICompatibleProvider` so Grok is a ~10-line provider, not a sixth copy.
- **2026-09-01** — **Supersedes item 1 of the decisions entry above: hosting is GitHub, not Forgejo.**
  Fork `avihaymenahem/velo` on GitHub under Jim's account; CI runs on **GitHub Actions**
  (`.github/workflows/`, actions pinned to commit SHAs, least-privilege `GITHUB_TOKEN`), matching
  the global standard's CI gate ledger. Upstream remains reachable as the `upstream` remote.
- **2026-09-01** — **Batch D0 executed on branch `chore/ci-baseline`** (layout (a) approved by Jim): methodology/
  decisions/audits + `TEAM.md`/`ORIENTATION.md` moved into the repo; root and upstream `CLAUDE.md`
  merged (Part I process / Part II code); `.github/workflows/ci.yml` added (SHA-pinned, read-only
  token; tsc, vitest UTC+CDT, `cargo build --locked`, clippy, cargo test, cargo/npm audit, gitleaks);
  stale `Cargo.lock` synced; TZ-dependent `icalHelper.test.ts` fixture fixed; `better-sqlite3`
  devDependency added (ADR-001) with hand-written `.d.ts` + smoke test; `@tanstack/react-router`
  bumped. Exceptions EX-002..EX-005 filed; EX-001 closing on merge. ADR-000 amended.
- **2026-09-01** — Per accepted P18: full semver-compatible `cargo update` (369 crate bumps, lockfile
  only; `cargo check --locked` green) cleared 13 of 15 RustSec advisories incl. both `quick-xml`
  (via `plist`) and `h2`. Remaining `rkyv`/`rsa` are lockfile-only → EX-006. Own commit so it can be
  reverted independently if CI on any platform objects.
- **2026-09-01** — PR #1 (`chore/ci-baseline`) first run: all 5 jobs green (rust 6m21s). Default-branch
  protection enabled: the 5 job names as required checks (strict), linear history, enforce for admins,
  deletions blocked, conversation resolution required, required reviews off (EX-005). Repo
  `allowed_actions` = GitHub-owned + 6 pinned third-party actions. **EX-001 closes on merge of PR #1.**
- **2026-09-01** — Session wrap-up: `HANDOFF.md` created (pinned to `b751b94`; next step = Batch A plan
  for Jim's approval). EX-001 closed. Handoff lands via PR from branch `docs/handoff`.
- **2026-09-01** — **Release automation is upstream-only on this fork.** The Release Please workflow
  failed on the D0 merge (`release-please failed: GitHub Actions is not permitted to create or approve
  pull requests`) *after* computing a `0.4.21 → 0.5.0` bump from **173 inherited upstream commits** —
  the fork has no release tag or manifest history, so every upstream commit reads as unreleased. It
  also left a stray branch `release-please--branches--main--components--velo` carrying that version
  bump. Decision (Jim, approving the PM recommendation): **guard the release workflows on
  `github.repository`** rather than enable the Actions PR-creation permission or delete the files.
  Rationale: this fork is a hardening fork, not a distribution channel; it holds **no** signing secrets
  (`gh secret list` is empty — no `TAURI_SIGNING_PRIVATE_KEY`, no Apple certs, no `HOMEBREW_TAP_TOKEN`);
  `update-homebrew.yml` pushes to **upstream's** tap `avihaymenahem/homebrew-velo`; and a permanently
  red workflow on the default branch normalises red, which is exactly what the gate ledger exists to
  prevent. Guarding rather than deleting keeps the diff upstream-merge-friendly. `packaging.yml` needs
  no guard — it is `workflow_call`-only and unreachable once `release-please.yml` is guarded. Filed as
  **EX-007** (this fork now has no exercised release path). If Jim later wants signed builds from
  `Pepper512/velo`, that is an ADR (release + signing model), not a reversal of this entry.
- **2026-09-01** — **Batch A (Rust security hardening) built** on `feat/batch-a-rust-security`, brief at
  `docs/briefs/2026-09-01-batch-a-rust-security.md`. Three findings changed the shape of the work
  versus the audit text, all recorded in the brief:
  1. **P1 is wider than the audit's six `format!` sites.** `async-imap` 0.10.4 validates the mailbox on
     `select`/`uid_copy`/`uid_mv`/`status`/`login` (`validate_str`) but **not** on `uid_store`,
     `uid_search`, or `append` — so `flags`, `since_date`, and `append`'s folder were three further
     injection sinks reachable from `#[tauri::command]` arguments. All now go through `imap::wire`.
  2. **`serde_json` is NOT an unused dependency** — audit §4 is wrong. `tauri::generate_context!()`
     expands to code referencing `::serde_json`; removing it fails the build with E0433. Verified by
     removing it and rebuilding. Restored with a comment so nobody removes it again.
  3. **`set_flags` and `imap_append_message` changed shape**: both now take unrendered flag names
     (`["Seen"]`) instead of a pre-built `"(\\Seen)"` string, so rendering happens in `imap::wire`
     against an allowlist. This touched 2 TS call sites and 4 test assertions — slightly more frontend
     work than the brief's "Not doing" anticipated, and a deliberate widening.
  Rust tests went 6 → 45 (`imap/wire.rs`, `imap/client.rs`, and `oauth.rs` had none before).
  **EX-002 closes on merge.** A `cargo check --release --locked` step was added to `ci.yml` to
  type-check the `#[cfg(not(debug_assertions))]` arm that compiles the dev-only commands out.
- **2026-09-01** — **Local release builds are broken on this machine**, unrelated to any Velo code:
  `cargo build --release` fails in `sqlx 0.8.6` with `dlopen(libsqlx_macros…dylib): mis-aligned
  LINKEDIT string pool`, a corrupt proc-macro dylib produced by the release profile on this
  macOS/toolchain combination. It reproduces after a full `cargo clean --release`, and fails before
  any Velo source is compiled. Worked around for verification purposes with
  `cargo check --locked --config 'profile.dev.debug-assertions=false'`, which compiles the same
  `not(debug_assertions)` arm and passes. Linux CI is the real gate.
