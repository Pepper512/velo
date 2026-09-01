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
- **2026-09-01** — **Agents now perform merges** (Jim, explicit: "new rule do the merges when a merge
  needs done"; "create the same merge rule for this repo"). Supersedes "agents never merge" in
  `CLAUDE.md` Part I and is mirrored in the global standard `~/claude-memory/`'s hard-rules list.
  **Why it had to be changed in both places:** the precedence order puts a repo instruction file
  (#2) *above* the global standard (#4), so adding the rule globally alone would have left this repo
  still forbidding it. A rule that only exists at the lower precedence level is not a rule here.
  **Preconditions on the merge** are in `CLAUDE.md`: every required check green on the *exact* commit
  merged (a rebase or force-push invalidates the previous run — this bit us three times on
  2026-09-01, when merging #2 and then #3 each made the remaining branches `DIRTY` on
  `LOG.md`/`EXCEPTIONS.md` and forced a rebase + full re-run), branch current, no unresolved
  conversation, and stop-and-ask on any red gate or judgment-call conflict.
  **The cost is real and is recorded, not hidden:** EX-005 justified running without required
  approving reviews *because* agents never merged and Jim was the only merger. That mitigation is
  now withdrawn. EX-005 has been rewritten to say so and to accept the residual risk explicitly —
  an agent can land its own Tier 0/1 work with no human in the loop. Tier 2+ still requires Jim's
  plan approval before code, and merging remains an execution step that never counts as approval
  under `03-agents.md`'s no-self-approval rule.
- **2026-09-01** — Merge order executed: **#2 (`252bb1a`) → #3 (`6fe932a`) → #4 (`f7e890b`)**.
  Verified after #3: the Release Please run on that push is **`skipped` (2s)**, where the push
  before it (the #2 merge, pre-guard) was **`failure` (1m9s)** — the EX-007 guard works. The #2
  merge also re-created the stray `release-please--branches--main--components--velo` branch, since
  it landed before the guard; deleted again.
- **2026-09-01** — **Third audit error found; treat `docs/audits/…` §6 metrics as unverified.**
  A completion review of the whole backlog turned up that the audit's headline metric
  **"52% of source files (0% of components) have no test"** is wrong on the components half: there
  are **32 component test files** (29 using `@testing-library/react`), present at the audit commit
  `ec47a7a` and still present today. The audit's sibling-test script missed `.test.tsx`.
  **Why it matters:** "0% component coverage" is the stated blocker for splitting `SettingsPage.tsx`
  and the other god-components (audit §4 defers them "until component tests exist" — they exist), and
  it inflates the apparent size of the component-test work. Anything sourced from that script (§6
  metrics table) needs re-measuring before it is used to size or sequence work.
  Running tally of audit corrections: (1) `serde_json` "unused" — false, `generate_context!` needs it;
  (2) P1's six injection sites — an undercount, `async-imap` leaves three more sinks unvalidated;
  (3) components "0% tested" — false. The audit remains the backlog's source of truth for *what* to
  fix; its measurements are not trustworthy without a spot-check.
- **2026-09-01** — **Batch B scope corrected before work started: it is P5, P6, P10 — not P5–P8.**
  An earlier `HANDOFF.md` draft (and a verbal answer to Jim) said "P5–P8". The audit's delegation map
  §3 is authoritative: **B** = P5 credential decrypt + P6 migration repair + **P10 LLM output
  boundary**; **C** = P7, P8, P9, P14. P10 is the item that would have silently slid — it is Tier 2
  and it is the LLM-output-is-untrusted-input rule from the global standard. Corrected in `HANDOFF.md`
  §1. Consequence: the doubt raised earlier about whether **`zod`** belongs in Batch B was an artifact
  of the wrong scope. The 2026-09-01 decisions entry above already says it plainly — *"Approved
  dependency: `zod` … **first use is P10 (LLM output)**. Dependency block required in the Batch B
  brief."* Nothing to re-decide; the block goes in the Batch B PR.
  **Lesson:** the scope error came from re-deriving batch membership from the P-item narrative instead
  of reading the delegation map (§3), and then repeating that guess in `HANDOFF.md` and to Jim. Read
  the map.
- **2026-09-01** — **Jim: pull the P12 real-SQLite test harness forward into Batch B.** ("yes pull the
  sqlite harness into batch b".) The audit sequences the harness late, but **P6's acceptance criteria
  cannot be met without it** — P6 is a destructive one-shot repair (`migrations.ts:898-923`) that
  deletes IMAP attachments and `folder_sync_state`, runs on every launch, and has zero tests; without
  a harness it would be "fixed" with nothing that ever executes it. It is also a **one-way door**: no
  down migrations exist, so users on the fixed build cannot be downgraded.
  **What already exists** (landed in D0, ADR-001): the `better-sqlite3` devDependency, a hand-written
  `src/test/better-sqlite3.d.ts`, and a smoke test at `src/test/sqliteHarness.test.ts`. **What Batch B
  adds** is the reusable harness itself — an in-memory DB that `runMigrations` can be pointed at — plus
  the P6 tests it exists to enable: fresh DB applies all migrations; a second run applies zero
  (idempotent); a simulated failure between the repair's DELETEs and its flag write leaves **nothing**
  deleted and the flag unset. No new dependency: ADR-001 already covers this use.
  **Consequence for scope:** Batch B is now P5 + P6 + P10 + the harness, which makes it materially
  larger than Batch A. Sequenced first within the batch, since P6's tests depend on it.
  Note this also unblocks **P8** (FTS5 quoting, Batch C), whose acceptance is likewise written against
  real SQLite — C gets cheaper as a side effect, but P8 stays in C.
