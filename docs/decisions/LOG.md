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
- **2026-09-01** — **Batch B built** on `feat/batch-b-credentials-migrations-llm` (plan approved by Jim
  on PR #6 **before code** — the first batch to follow `02-work-loop.md`'s Tier 2 sequence properly;
  Batch A ran on a blanket pre-approval given after the fact). Four commits: P12 harness + P6, then
  P5, then P10. **Rust tests untouched; frontend suite 1,562 → 1,610.**
  Three things worth recording because they contradict or extend the plan:
  1. **`isEncrypted` cannot be made correct by shape alone, and the brief implied it could.** A
     12-byte GCM IV encodes to exactly 16 base64 characters, so plaintext of the form
     `<16 base64 chars>:<base64>` is *structurally identical* to real ciphertext. The check was still
     tightened (canonical base64 including `length % 4`, which `atob` does not enforce; IV must decode
     to exactly `IV_LENGTH`), but the residual ambiguity is **asserted by a test on purpose** so nobody
     "fixes" it into something that silently guesses. What actually makes it safe is the fail-closed
     caller: a wrong guess now raises `CredentialDecryptError` instead of putting the value on the wire.
  2. **P10's injection surface was wider than the audit's wording.** The audit named the email *body*;
     `subject`, `snippet`, and `from_address` are interpolated identically and are equally
     attacker-controlled. All are fenced. Separately, `generateSmartReplies` wrapped its
     already-fenced, joined messages in a **second outer fence** that the first inner closing tag
     ended — a pre-existing bug found only by writing the test.
  3. **P6's repair is now migration v24.** Because there are no down migrations anywhere in this
     project, this is a one-way door: it is in its own commit so P5 and P10 stay independently
     revertible. Unlike Batch A — where the promised per-item commit split proved fictional because
     the edits interleaved — here the files are genuinely disjoint and the split is real.
  `zod` used in `services/ai/modelOutput.ts` **and nowhere else**, matching the 2026-09-01 approval
  that named P10 as its first use.
- **2026-09-01** — **Batch C built** (P7, P8, P9, P14) on `feat/batch-c-rendering-and-capabilities`.
  Suite **1,657 → 1,709**. Built under Jim's standing pre-approval ("preapprove next 10 tasks");
  all four are **Tier 1**. **P11 is deliberately NOT in this PR** — see the entry below.
  **Two more audit claims failed verification, bringing the running total to five:**
  4. **P9 listed six missing remote-image vectors; five were already handled.** `srcset`,
     `<picture><source>`, `<video poster>`, `<link rel=prefetch>` and unquoted `src` are all removed
     by `sanitizeHtml`'s attribute **allowlist** before the blocker runs. Probing found **five
     different** live bypasses the audit did not list: `<input type=image>`, `<audio src>`,
     `<track src>`, CSS `image-set()`, and a newline inside the URL scheme (browsers strip it and
     fetch anyway). That lesson drove the fix: `stripRemoteImages` is now **DOM-based** rather than
     regex, so new vectors are covered by construction instead of by having been enumerated.
  5. **P14's queue claim is wrong on both counts.** A malformed `op.params` is **not** "retried
     forever", and there **is** a retry ceiling: `classifyError` defaults to
     `permanent`/non-retryable (`networkErrors.ts:80`), so a JSON `SyntaxError` dead-letters on the
     first attempt, and `incrementRetry` (`pendingOperations.ts:86`) already fails the op at
     `max_retries`. Tests were added to pin the working behaviour rather than to "fix" it.
  **New: ADR-002** — the three-bucket error-handling policy (propagate / surface / log). Applied to
  draft auto-save, which was the worst shape of the class: failing silently while the user typed,
  under a label reading "Draft saved". The send-path and sync sites are named in the ADR but left for
  a later batch — they are bucket 2 and need UI surfaces that are design decisions, not mechanical edits.
- **2026-09-01** — **P11 deferred out of Batch C, with a finding that invalidates the audit's plan.**
  The audit proposes splitting `capabilities/default.json` into a window-scoped pair, giving
  `splashscreen`/`thread-*`/`compose-*` only "events + window controls + read-only sql if needed".
  **That is not viable as written:** `ThreadWindow.tsx` calls `runMigrations()` (which needs SQL
  *execute*) and renders the full `ThreadView` + `Composer`, including the unsubscribe flow and the AI
  features — so pop-out windows legitimately need `sql:allow-execute` and, for unsubscribe against
  arbitrary sender URLs, broad `http`. Narrowing `http` therefore depends on first moving unsubscribe
  POSTs to a Rust command with URL validation (the audit's own alternative), which is separate work.
  **It is also the one item in the backlog whose acceptance cannot be automated** — the audit says so:
  "a `thread-*` window attempting `fs.writeTextFile` is denied (manual QA step … no automated harness
  exists for capability denial)". Shipping an unverifiable Tier-2 security-config change that could
  break pop-out windows for users is worse than sequencing it deliberately, so it gets its own brief
  and PR, gated on Jim's manual QA. **Consequence: the P9+P11 chain stays half-open** — P9's side is
  closed here; P11's is not.
- **2026-09-01** — **Batch E built** (P13 a+b, P15 Tier 1) on `feat/batch-e-p15-rust`. Suite
  **1,709 → 1,716**; Rust 47 tests. Built under Jim's standing pre-approval; both items are **Tier 1**.
  **P15's Tier 2 session-pooling half is NOT included** — it changes credential lifecycle and needs
  its own brief (it is Batch E2 in the audit's order).
  - **P15:** the `ASYNC_IMAP_EMPTY:` string-prefix control flow is now `FetchError::AsyncImapEmpty`.
    The compiler proved the point immediately: changing the return type failed the build at exactly
    the one call site that pattern-matched the prefix — a coupling that had been invisible, where
    adding context to the message would have silently disabled the raw-TCP fallback and left
    non-standard servers showing an empty mailbox. New `imap/net.rs` holds `with_timeout` plus the
    shared connection setup; `grep -c "check your server settings" imap/client.rs` went **44 → 0**
    (acceptance was 1; the single copy now lives in `net.rs`).
    **The two STARTTLS copies had already drifted**, which is the concrete argument for the dedupe
    rather than a hypothetical one: `raw_connect_starttls` discarded the server greeting without
    checking it, so a server opening with `* BYE` was treated as healthy and failed later as an
    unrelated protocol error. Sharing the routine fixed that as a side effect.
    **Near-miss worth recording:** the first draft of `net::configure_tcp_socket` set only
    `TCP_NODELAY` and dropped the socket2 keepalive the original also set — a real regression, caught
    only because removing the old function produced a dead-code warning. Keepalive matters: an idle
    IMAP connection whose NAT mapping is dropped hangs until timeout instead of failing fast.
  - **P13:** `emailActions` and `notificationManager` both imported `router/navigate`, which put the
    whole page tree in the import graph of every service that touches email. The service now reports
    `ActionResult.nextThreadId` and `hooks/useEmailActions` performs the navigation; the UI wrappers
    keep identical signatures so call sites changed one import line each.
    **`notificationManager` was not on the audit's list** and was, by itself, keeping the last cycle
    alive (`sync → notificationManager → router → routeTree → App → syncManager → sync`).
    `scripts/graph.mjs` is the acceptance check and is now a CI gate:
    **1 SCC of 40 files / 54 cycles → 1 SCC of 21 files, zero containing a `services/*` file.**
    Only the cycle rule is enforced; the `services → stores` count (11) and components-importing-`db`
    count (49) are reported for the trend but not gated — a gate nobody can turn green gets deleted.
    Six tests asserted that the *service* navigates; they were pinning the coupling, so they now
    assert the reported value, and `useEmailActions.test.ts` owns the navigation behaviour they used
    to cover.
- **2026-09-01** — **Batch F built** (P16 extractions 3/6/7, P17, P19, plus the accepted **xAI Grok**
  feature) on `feat/batch-f-grok-and-dedupe`. Suite **1,739 → 1,751**.
  - **Grok landed as ~15 lines**, because P16(3) `createOpenAICompatibleProvider` was extracted first —
    exactly the sequencing the audit specified. Model IDs were **fetched from xAI's live
    documentation, not recalled**: `grok-4.6` (their recommended chat/code model), 4.5, 4.3. CSP
    `connect-src` gains `https://api.x.ai`; without it Grok works under `tauri dev` and fails in the
    packaged app with an opaque network error. **Grok is available, not default** —
    `getActiveProviderName` still falls back to Claude, matching the recorded assumption.
  - **Claude model IDs were stale.** Sonnet 4 and Opus 4 no longer exist, and the Haiku entry carried
    a date suffix (`claude-haiku-4-5-20251001`) where the current ID is plain `claude-haiku-4-5`.
    Refreshed from the authoritative model reference rather than memory. **Defaults deliberately
    unchanged** and now documented in `DEFAULT_MODELS`: the fast/cheap tier for every provider,
    because Velo runs *one* model for all AI features and the highest-volume one is background thread
    categorisation on every sync. Jim has still not confirmed the per-provider default proposal; this
    is the conservative reading of it.
  - **P16(6) found a live bug.** `getActiveLabel` and `useActiveLabel` were separate copies and had
    drifted — the React one was missing `/attachments` and `/tasks`, so the sidebar highlighted
    **Inbox** on both pages. Found by duplication analysis, not by a bug report.
  - **P16(7):** PKCE existed byte-identically in two files with **no tests in either**, for the
    mechanism that binds an auth code to the client that requested it — and Velo's OAuth flow has no
    client secret, so it is the only such protection. Now one implementation with the **RFC 7636
    Appendix B** vector as a test.
  - **P17 acceptance verified by injecting a typo:** `getSetting("thmee")` produces `TS2345` naming
    the literal. The compiler also found a settings key the grep that built the list had missed
    (`custom_shortcuts`, written via a variable) — the enumeration-by-hand going stale is the whole
    argument. Deleted the dead `velo-calendar-sync-done` event: one dispatch, **zero** listeners.
  - **P19 is worse than the audit assumed, and it is a documentation-honesty problem.**
    `phishingDetector.ts` (486 lines) is imported by exactly four files: its own test and **three
    other orphans** (`PhishingBanner`, `LinkConfirmDialog`, `phishingScanner`). Nothing in
    `ThreadView`/`MessageItem` references phishing. **The feature does not run at all.**
    SECURITY.md told users it "flag[s] suspicious links before you click them" — untrue of any
    shipped build, and a user could click a link believing Velo had screened it. The claim is
    corrected; the code is left in place. **Neither of the audit's two options was taken:** re-wiring
    is building a security-visible feature whose rendering cannot be verified without running the
    app, and deleting 486 lines of working tested logic is a product decision. **Jim decides.**
    Also corrected the stale CSP domain list in SECURITY.md while in the file.
  - **Sixth audit claim to fail verification:** P19's orphan list names `hooks/useContextMenu.ts`,
    which has **nine importers** and is not orphaned.
- **2026-09-01** — **Batch H built** (P20, skills audit §7) on `docs/batch-h-p20-skills`. Last batch in
  the audit's order.
  - **P20 fixed structurally, not once.** Six documented counts had drifted — and by the time they
    were measured they had drifted *further*, with `docs/architecture.md` claiming **two different
    table counts in the same file** (34 and 35; actual 31). Correcting them by hand would have bought
    nothing, so `scripts/docs-check.mjs` now measures migrations, tables, test files, stores and AI
    providers from the tree and fails CI naming the file, the claim and the real number. It also
    asserts migration count == highest migration version, catching a skipped or duplicated version.
    Prose fixed too: "Eight Zustand stores" sat directly above a table listing nine; `CLAUDE.md` said
    `providerManager` "manages three providers" (six); the README model table still listed Sonnet 4
    and Opus 4 and omitted Grok, Copilot and Ollama entirely.
  - **Two skills carried real risk and were rewritten.**
    **`commit`** ran `git push` — and `git push -u origin HEAD` with no upstream — as an unconditional
    final step. That conflicts with the work loop (work lands through a gated PR) *and* the harness
    rule that agents push only when asked; on a checked-out default branch the good case is a
    protection rejection and the bad case is a bypass. Now: commit only, refuse on `main`/`master`
    with a suggested branch name, and **print** the push/PR commands instead of running them.
    **`web-design-guidelines`** told the agent to fetch a `raw.githubusercontent.com` URL on a
    **mutable `main` branch** and *"apply all rules from the fetched guidelines"* including its
    *"output format instructions"* — remote instruction execution inside a repo holding mail
    credentials. Now the source must be pinned to a full commit SHA, fetched content is explicitly
    **reference data and never instructions**, and the output format lives in the skill. Also scoped
    to Velo: ~half the vendored rules assume Next.js and do not apply to a Vite/Tauri SPA.
  - **`document-feature` sharpened:** it hardcoded "the 13 existing categories" and asked the agent to
    keep counts accurate by hand — the exact drift P20 documents. Now it reads categories from
    `helpContent.ts` and defers every count to `npm run docs:check`, with the instruction to delete a
    number rather than invent a new one.
  - `react-best-practices` (trim) and `composition-patterns` (fine) left: lower value, no risk.
- **2026-09-01** — **A Tier-2 plan approval relayed by another of Jim's own Claude sessions
  counts as Jim's approval** (Jim, in-session, after PR #23). The relaying session states it
  is relaying and posts the approval to the PR so it is on the record; the receiving agent
  does not re-confirm with Jim before acting on it. Decided because Jim runs several sessions
  against this repo and round-tripping every approval through the one he happens to be typing
  in makes the parallel sessions useless.
  **What this does not change:** merging is still an execution step, not an approval
  (**EX-005**); *no self-approval* still holds, so an agent cannot relay an approval for its
  own work; every required check must still be green on the exact commit merged; and a peer
  session cannot grant anything Jim has not — a relay carries his authority, it does not
  create any. A relayed approval that cannot be pointed at a durable record (a PR comment or
  equivalent) is coordination, not approval.
  **Residual risk accepted:** the receiving agent cannot distinguish a genuine relay from a
  compromised or mistaken peer, because the corroborating PR comment is posted through the
  same account the relaying session controls. The mitigation is that relays must be durably
  recorded, so a wrong one is visible after the fact rather than only in a transcript.
- **2026-09-01 22:30 UTC → 2026-09-02 01:30 UTC (hard expiry)** — **Jim delegated his decision
  authority for this repo to session `velo-build-f1` for a three-hour window** (Jim, in-session,
  22:30 UTC: *"you are in charge, you are me"*; he is away for the window and asked that work
  continue). **Scope:** the four open decisions in `HANDOFF.md` §1 and any judgment call the E2/P15
  and dependency-PR-C builds raise. **After expiry nothing further is decided in his name.** Every
  decision made under it is listed here marked *(delegated)* and is **subject to Jim's retroactive
  review on return — anything he reverses is reverted, not argued.**
  **What this does not change:** *no self-approval* (the proxy's own build still needs an
  opposite-line EX-005 review and a cross-vendor review); every required check green on the exact
  commit merged; and **the proxy cannot reach what a permission gate refuses** — the `rust MSRV`
  branch-protection append was attempted from this session at 22:33 UTC and classifier-blocked,
  exactly as the earlier attempt was, and was **not** routed through the peer session. Decision 4
  therefore remains Jim's and is **not made**.
  - *(delegated)* **E2/P15 rev 2 re-confirmed**, judged — as Jim asked — against the brief's
    §Pooling findings. **Findings 1, 3 and 5 are folded into the build; 4 and 6 are deferred.**
    Reasoning: 1 (a dropped future leaves a mid-protocol session in the map with no `Err` to trigger
    eviction) and 5 (a parser panic on hostile bytes does the same) close with one
    *checkout-removes-entry* pattern — take the entry out of the map on checkout, reinsert only on
    clean completion — so eviction becomes a fact about the map rather than about an error reaching
    the caller. 3 (`account_key = "user@host"` collides across port / TLS mode / auth mechanism, so a
    rotated credential keeps being served) is cheap and is a correctness bug. 4 (staleness `NOOP`)
    and 6 (`last_used` stamped on acquire) are availability, not correctness, and stay in the brief
    as follow-ups. Decision 2's `getrandom = "0.3"` remains the **only** dependency E2 may add.
    Landing order unchanged: E2 → async-imap 0.11 bump → F-4/F-5. The rev-4 delta (Done-when
    clauses + the pool pattern in §Proposed change) is written as the first commit of the build
    branch; **this entry is the approval, the delta is its mechanical expression.** Builder:
    `velo-build-43` (Opus seat). Reviewers: `velo-build-f1` (EX-005) + Gemini 3.7 via Antigravity
    (cross-vendor; Kimi is out of weekly quota).
  - *(delegated)* **Dependency-audit PR C — plan approved with one amendment: no new dependency.**
    The vault plan `PLAN-PR-C_Gemini-SDK-Replacement.md` was re-verified in the tree (one importer,
    `geminiProvider.ts`, 39 lines; `generativelanguage.googleapis.com` already in the CSP at
    `tauri.conf.json:42`; no `geminiProvider.test.ts`) and its API claims re-verified against the
    real `@google/genai@2.20.0` typings. `@google/generative-ai` is removed — its end of life
    (2025-11-30) is **Google's announcement, not a registry fact**: npm carries no deprecation flag on
    `0.24.1`, so treat the date as a citation. **Amendment:** rather than swapping SDKs,
    `geminiProvider.ts` is rewritten against the REST API with `fetch` —
    `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, key in
    the `x-goog-api-key` header (never the URL), `systemInstruction` in the body,
    `candidates[0].content.parts[].text` concatenated with `thought` parts skipped — the exact wire
    format the SDK itself emits, read from its source. **Reasons:** (1) the hard rule *no dependency
    where a function suffices* — the provider makes one POST; (2) the plan priced the swap as
    one-for-one, but the old SDK has **zero** dependencies and `@google/genai` brings
    `google-auth-library`, `p-retry`, `protobufjs` and `ws` into a renderer that holds mail
    credentials — a transitive cost the plan did not name; (3) this makes PR C a pure removal, so
    Jim's retroactive review lands on a strictly smaller change than the one he pre-approved, and
    nothing is foreclosed — the SDK path can still be approved later. Error mapping: 401/403 →
    `AiError("AUTH_ERROR")`, 429 → `RATE_LIMITED`, other non-2xx or network failure →
    `NETWORK_ERROR`; a reply with no text part **throws** rather than returning `undefined` (P10
    boundary), while a present-but-empty text is returned as `""` like the sibling providers.
    **Self-approval hazard, named rather than hidden:** the proxy amended and approved this plan and
    is also its builder (`velo-build-f1`, now the Fable seat). Mitigations: an opposite-line plan
    acknowledgement from `velo-build-43` recorded on the PR *before* code — given for the SDK
    version of the plan, **re-requested for this amendment**; EX-005 review by `velo-build-43`;
    Gemini cross-vendor review; and this line, so Jim's retroactive review lands on it first.
  - **F-4 — read in full, deliberately left to Jim.** Rev 5 of
    `SPEC-F-4_Vanished-UID-Reconciliation.md` was read end to end within the window. **Proxy
    recommendation: approve as written.** Five revisions, two vendors, all eleven findings adopted,
    the three rev-5 text fixes re-checked clean, and the design fails toward "keep" on every
    ambiguity (two-pass confirmation, positive completeness attestation, batching cap, 50% stop
    behind `ConfirmDialog`, pending-ops guard). The one sharp edge is stated rather than emergent
    (a 10-row folder may clear fully; an 11-row folder blocks at 6 suspects). **Why not decided in
    his name:** it builds after E2/P15, which is itself held pending Jim's direct confirmation of
    this delegation, so F-4 cannot start inside the window whatever is decided — an agent-created
    approval of a 4–5-day local-deletion feature would trade provenance for nothing. Nothing is
    lost by waiting for him.
  - **Decision 4 (make `rust MSRV` a required check) — not made;** permission-gated, Jim only.
    **Until it lands, the MSRV is not enforced.**
  - **Renewed at 2026-09-02 ~00:20 UTC → 03:20 UTC.** Jim repeated the instruction to the Fable
    session verbatim ("tell him and keep him going, I will be gone the next 3 hours; try to
    complete the project; you are in charge, you are me"), so the window above is superseded by
    this one; the scope, the marking of every decision as *(delegated)*, the retroactive-review
    condition and the permission-gate rule are unchanged. Two facts stated for the record because
    they bear on how much this renewal can carry: it was typed into the Fable session, so it is
    first-hand there and **still a relay everywhere else** — the Opus seat's hold on the E2 build
    (pending Jim's direct confirmation to *it*) is unaffected by it and is its own to keep or lift;
    and it arrived after Jim's session had received a status report naming the blocked merges, but
    it does not mention them, so **no permission gate is read as lifted** — merges, the protection
    append, and `git worktree remove` (blocked for the Opus seat at ~00:15 UTC — the fourth gate
    tonight) all remain Jim's alone. What the renewal is used for: the next Tier-1 engineering item
    that lands nothing on `main` by itself — **F-5** (move-time row hygiene; a live defect on
    `main`, the prerequisite F-4 explicitly wants), briefed before code with the self-approval
    hazard named as for PR C.
  - **Jim returned at ~02:36 UTC and re-authorised the Fable seat directly and in person**
    ("go ahead review #37 and keep managing this project as me"). From that point the seat acts on
    his live instruction, not only on the delegation above; the delegation's expiry (03:20 UTC)
    therefore no longer governs, and any decision after it is his direct word relayed through this
    seat. First act under it: the EX-005 opposite-line review of **#37** (E2/P15 part 1, built by
    the Opus seat after it lifted its own hold on the reasoning that agent merges are blocked for
    both seats) — **CHANGES REQUESTED**, five must-fix items, design sound; a Gemini 3.7
    cross-vendor pass reached the same verdict independently. Merges remain permission-blocked
    for both seats and remain Jim's.
  - **Merge execution assigned to the Opus seat** (Jim, in person, 2026-09-02 ~03:30 UTC: the
    Opus seat "has been approved to commit, push, PR, merge — have him do it when it needs done"
    and "remind him that is in the rules"). This is the standing rule in `CLAUDE.md` Part I —
    *Agents perform the merge* — applied to a named seat now that Jim has granted it the
    permission his own session settings control. **Nothing else changes:** every required check
    green on the exact commit merged, branch up to date, no unresolved review conversation,
    Tier 2 with its plan approved before code, and merging is execution, not approval (EX-005).
    Order: **#33 → #34 → #35 → #36**, then **#37** only after its must-fix items land and the
    re-review at the new head is recorded. The Fable seat's merges stay blocked and are not
    routed anywhere; this entry is the record the Opus seat can point at.
- **2026-09-02 — F-4 and F-5 plan approvals: APPROVED by Jim, directly.** Asked which of the open
  items he wanted to take, he answered *"I approve f-4 and f-5"* in his own session. **Not
  delegated and not relayed** — this is his own word, which matters because both specs had reached
  a state where only he could move them: F-4's earlier conditional approval had voided itself per
  its own terms, and F-5's approval line was deliberately left blank throughout the delegation
  window on the grounds that a data-affecting judgement should not be made by a proxy at 01:00.
  - **F-4 — vanished-UID reconciliation.** Approved at **rev 5** (vault:
    `Build Queue/10-Bug-Fixes/SPEC-F-4_Vanished-UID-Reconciliation.md`), the revision that adopted
    all seven cross-vendor findings and then fixed the three defects a delta-review found in rev 4's
    own clauses. Tier 2. **The approval line in the vault spec still needs Jim's mark** — the vault
    is not reachable from this machine's checkout, so this entry is the repo-side record and the two
    should be reconciled when he is next in the vault.
  - **F-5 — move-time row hygiene.** Approved as **option A** (re-key on `COPYUID`, with option B's
    hidden-row semantics as the fallback for accounts without UIDPLUS), **at rev 2** — the revision
    that corrected rev 1's cost basis after the opposite-line read found `COPYUID` already parsed by
    `imap-proto` and forwarded on `async-imap`'s unsolicited channel. Rev 1 is not what was
    approved: its sequencing rested on a `client.rs` collision that turned out to be small.
    Sequencing confirmed with the approval: **after E2, before F-4**, on rev 2's
    ownership-interaction reason.
  - **Neither is started, deliberately.** Both build on `client.rs`'s move path, which **E2/P15 part
    2 (#39) has just rewritten** and which is still in review. Starting either now would rebase a
    Tier-2 change onto a moving file for no gain. Order: **#39 lands → F-5 → F-4.**
  - **Still Jim's alone, unchanged by this:** the `rust MSRV` branch-protection append, and
    `git worktree remove .claude/worktrees/f2-email-links-open` — both refused to the Opus seat by
    its permission classifier and neither routed through the other seat.
- **2026-09-02 06:12–08:12 UTC — Second delegation window: the Fable seat is in charge of the
  project.** Jim, in his own session, before leaving for two hours: *"for the next 2 hours I want
  you to be in charge of this project do the coding and have gemini 3.7 via agy/antigravity review
  it and grok4.6 review it. I will be gone these two hours so everything relating to this project
  is approved. after you hit the two hours finish what you are doing and have opus 5 do a full
  review."* Then: *"start with Building F-5 (option A, rev 2), then F-4 (rev 5) then continue with
  project. after you stop, create a report of what was done."* Terms as recorded here:
  - **Scope:** build F-5 then F-4 then continue; every project decision inside the window is
    pre-approved by Jim; the window closes at 08:12 UTC, after which the seat finishes the item in
    hand, commissions an Opus 5 full review, and writes the report.
  - **Review legs for this window:** Gemini 3.7 via `agy` **and Grok 4.6 via the `grok` CLI**, both
    on diffs only. **Deviation, named:** `ROSTER.md` lists Grok as a research/panel seat, *"not a
    Tier-2 reviewer"*. Jim's instruction overrides that for this window only; the roster row is
    unchanged. Risk: a panel-only vendor reads Tier-2 code. Mitigation: secrets-free diff, no repo
    access, findings verified against the tree before adoption. Owner: Jim, on his return.
  - **Seat identity, named:** this session runs as Claude Fable 5.1. `TEAM.md` says Fable 5 is not
    an operating default in any seat. Jim put this seat in charge knowing that; recorded, not
    laundered. Every decision below made under this window is marked *(delegated)*.
- **2026-09-02 — F-5 built (option A, rev 2) — *(delegated)*.** Branch `worktree-f5-move-hygiene`.
  What was decided in the build, beyond the approved plan:
  - **The brief's citations were stale, as HANDOFF warned, and the design survived the re-grep.**
    `move_messages` is at `client.rs:540` still; `groupByFolder` moved to `imapSmtpProvider.ts:656`;
    the pool ownership question resolved exactly as rev 2 predicted: the drain runs *inside*
    `move_messages`, i.e. inside the command's checkout, before `release_ok` — so the channel is
    read by the session that owns it and an evicted session takes its channel with it.
  - **A defect the brief did not know about, fixed at root:** `async-imap`'s unsolicited channel is
    `bounded(100)` with a best-effort `try_send`, and **nothing in Velo ever read it**, so it fills
    over a session's life and the `COPYUID` would be the response dropped. The drain now discards
    the backlog *before* `UID MOVE` (`copyuid::discard_pending`), logged at debug.
  - **The COPY fallback yields no mapping, by construction, and that is accepted.** RFC 4315 puts a
    COPY's `COPYUID` on the *tagged* OK, which `async-imap`'s `check_done_ok` consumes without
    forwarding (verified at 0.10.4 `client.rs:1403-1440`). Reaching it means bypassing `uid_copy`
    for a hand-run command — a wire change the brief did not approve. Option B's hidden-row
    fallback covers the path, and the live harness showed it is the path a MOVE-less server takes.
  - **Fallback B built minimally, with its migration:** one column (`messages.moved_to`, migration
    25, contract step documented in the migration comment), tombstoned rows hidden from
    `getMessagesForThread` and from every provider action, reaped by `upsertMessage` when an IMAP
    row with the same `message_id_header` arrives. Not built: hiding tombstones from search results
    (an action on one from search is filtered anyway).
  - **Every provider action now filters to live rows first** (`keepLiveMessageIds`): an id that was
    re-keyed away, or tombstoned, is dropped with a warning rather than sent to a folder/UID the
    server no longer has. This is what closes the wrong-target consequence for stale ids held in UI
    state or in the offline queue. Trade-off, recorded: a queued op whose ids were re-keyed before
    it drained becomes a warned no-op instead of a wrong-target write.
  - **Re-key rewrites more than the brief listed:** `attachments.id` (its `{messageId}_{part}` PK,
    so the destination sync's attachment upsert hits instead of duplicating), and the soft
    references in `follow_up_reminders`, `link_scan_results`, `scheduled_emails`, `local_drafts`.
    Foreign keys are deferred for the transaction (`PRAGMA defer_foreign_keys`), which is the only
    way a parent key can change under a child row; verified on the harness with FK enforcement on.
  - **`updateMessageImapFolder` deleted** (wire-or-delete, per F-4 Task 13): zero callers, and it
    could not have helped.
  - **Done-when 4 run live, both ports** (`copyuid::tests::live_dovecot_uid_move_reports_copyuid`,
    `#[ignore]`, run by hand against the Alpine harness): `:11143` → `MoveResult { expunged: true,
    mapping: Some([UidMapping { source_uid: 3, dest_uid: 1 }]) }` — the `COPYUID` arrives on the
    unsolicited channel on the same command turn as the tagged OK, through the real
    `move_messages`. `:11144` (no UIDPLUS, and the harness conf hides MOVE too) → `expunged: false,
    mapping: None`, source still in INBOX flagged — the COPY path, as predicted. Done-when 5 (strike
    F-4's coupling note) is left for the F-4 build, which edits that spec anyway.
- **2026-09-02 — F-5 reviewed by two vendors and merged (#43, squash `2792251`) — *(delegated)*.**
  Both legs returned **CHANGES REQUESTED**; every finding was re-derived against the tree before
  disposition, and the two records are on the PR. What changed the code:
  - **Gemini 3.7 (`agy`)**: H1 — the tombstone reap was keyed on Message-ID alone, so a same-message
    copy syncing in from *another* folder would reap a tombstone whose destination had not synced,
    attachments cascading. Adopted: reap scoped to the folder the fresh row arrived in. M2 —
    destination UIDs were not checked for uniqueness in either validator. Adopted in Rust, TS and
    the DB layer. M3 — a re-key losing the race with the destination sync left a zombie tombstone no
    later reap visits. Adopted: tombstoning deletes outright when the destination already holds the
    message. L4 — re-key and tombstone were two transactions. Adopted: one. L5 recorded (option-B
    semantics), NIT 6 declined (already indexed).
  - **Grok 4.6 (`grok` CLI, diff only)**: M6 — one racing collision rolled back a whole batch of
    re-keys. Adopted: per-pair `SAVEPOINT`. M7 — notice ran before settle. Adopted: settle first,
    notice in `finally`. L9 — the `COPYUID`'s UIDVALIDITY was discarded. Adopted: it travels with the
    mapping and a mapping from the wrong generation is refused. H3 partial — search paths now hide
    tombstones. L8 **declined**: RFC 3501 §9 defines a range as unordered (`2:4` ≡ `4:2`), so the
    normalisation is the RFC reading. H2-A carried into F-4 (see the vault spec's Not-doing);
    H2-B is Decision 1(a)'s accepted no-UIDPLUS ghost; M4 (old→new id alias) is the recorded
    follow-up; L11/L12 documented limits.
  - **Both reviews found real defects the author had missed** (H1/M3 would have lost cached mail in
    a two-copy mailbox; M6 would have degraded whole batches). Same lesson as #39: the cross-vendor
    leg is not a formality, and two legs found *different* things.
  - **CI caught one thing local gates did not:** the first push failed clippy on
    `reversed_empty_ranges` in a test fixture that the local run had not compiled with
    `--all-targets` at that point. Fixed in the first fix-up. CI remains the source of test status.
  - Merge preconditions verified on `ca62b18`: `ci` success on that SHA, `mergeStateStatus` CLEAN,
    no unresolved review conversation. Merged by the build seat under the window's authority.
  - **The vault is reachable from this machine** (`~/Vaults/Pepper Knowledge/...`); the F-4 spec's
    approval line, Task 13 and coupling note were reconciled there directly. HANDOFF's "not
    reachable from this checkout" was wrong and is corrected at wrap-up.
- **2026-09-02 — F-4 built as "part 1", the substrate only (#44) — *(delegated)*.** With ~70 minutes
  of the window left after F-5 landed, the seat cut F-4 (a 4–5 day, 13-task spec) to the pieces
  that delete nothing and that part 2 cannot do without: per-folder attestation from
  `delta_check_folders` (REQ-1.2b, spec Task 8), `exists` on the wire (Task 5), boundary validation
  on `imapSearchAllUids` (the command itself already existed — the spec's Task 5 citation was
  stale), migration 26 (Task 6), and `reconcile.ts` — the pure budget/cap/diff decisions and the
  REQ-1.5 suspect state machine on the harness (Tasks 9 and 11). **The deleting half is deferred
  to part 2 with a written plan** (`docs/briefs/2026-09-02-f4-part2-plan.md`) that itself needs an
  opposite-line read before code; rushing the path that deletes mail into a window's last forty
  minutes was judged the wrong trade.
  - **A defect the seat found in its own code before either review arrived:** the timeout path in
    `delta_check_folders` returned `Ok` after the session was desynchronised, which handed the
    poisoned connection back to the pool (the pre-F-4 code did the same by `continue`ing). Fixed to
    `Err`, which is the pool's eviction signal. Both reviewers then filed it as their HIGH.
  - **Gemini 3.7:** CHANGES REQUESTED (1H 2M 1L 2N), all six adopted — the timeout, the fallback
    `catch` omitting failed folders (the exact omission REQ-1.2b forbids), `clearReappeared` pushing
    the whole server list through DELETEs, `recordMissing` outside a transaction, the index, the
    dedupe.
  - **Grok 4.6:** CHANGES REQUESTED (11). Three duplicated fixes already made. Adopted: `checked`
    redefined (it never meant "a `UID SEARCH ALL` ran" — the part 2 plan attests from two bits);
    `confirmedOnPass` generation-scoped and a single atomic `applySearchAll` as the documented
    entry point (its resurrection scenario — a UID that comes back and vanishes once more — would
    have deleted on one observation if part 2 called the pieces separately); `exists` nullable on
    unchecked rows (`0` reads as "emptied" to the gate); `planDeletions` stops on inconsistent
    counts; `first_seen_at` NOT NULL; `CHECK` on `status`; leftover re-stamp tests and the re-stamp
    documented as required.
  - **Nothing declined this time.** Every finding on #44 was either already fixed or adopted.
  - **Merged** as squash `5a5fe59` after CI on `b964b23` — by the build seat, under the window.
- **2026-09-02 ~07:25 UTC — Opus 5 full review of the window (commissioned as Jim asked; full text
  `docs/reviews/2026-09-02-opus5-window-review.md`).** Verdicts: **#43 — "would not have merged as
  written"** (design good, one live regression); **#44 — mergeable with changes.** Thirteen findings.
  - **HIGH 1, verified and fixed in the same window (`fix(imap)` in the wrap-up PR):**
    `permanentDelete` had become a server-side no-op. `executeEmailAction` deletes the thread
    locally — cascading to its messages — *before* the provider call, and F-5's new
    `keepLiveMessageIds` then found no rows to act on. Mail stayed on the server and came back on
    the next sync. The filter now drops only **tombstoned** ids (`dropTombstonedMessageIds`) and
    passes unknown ids through: a re-keyed-away id names a UID the source folder no longer has and
    UIDs are never reused within a UIDVALIDITY, so the server answers no-op/`NO`, never a wrong
    target. The test that had ratified the regression was rewritten from the requirement. **This
    was a design widening made mid-build** (filtering all seven actions when the brief discussed
    four) and it was self-merged — both named by Opus as the things to do differently.
  - **HIGH 2, recorded for Jim, not fixed:** the re-key transaction relies on `PRAGMA
    defer_foreign_keys` and `SAVEPOINT`, both per-connection state, over a pooled `tauri-plugin-sql`
    connection (`Pool::connect`, default `max_connections = 10`) with no pinning — and
    `withTransaction` deliberately does not block non-transactional reads. Opus verified the sqlx
    defaults in source. Pre-existing for every Velo transaction, but F-5 is the first destructive
    identity rewrite on that assumption. Its own brief: a Rust command owning one connection, or
    serialising all DB access. The window's "recorded, out of scope" answer was too quick.
  - **MEDIUMs, recorded for follow-up:** reap fires one DELETE per upserted IMAP message (batch
    it); the UIDVALIDITY guard is off for never-synced destination folders (write the COPYUID's
    generation into `folder_sync_state`); `isConstraintFailure` is a message-text regex (invert
    the rule); `recordMissingWithin` inserts one row at a time; **the >50% stop is per-pass, not
    cumulative** (an 11-row folder can clear over two passes — part 2 must evaluate against the
    row count at first confirmation).
  - **Governance findings, accepted:** every review record in the repo was authored by the seat
    under review — the raw `agy`/`grok` outputs are now preserved under `docs/reviews/`; a Tier-2
    self-merge under a decision-authority window let a regression reach `main` with no human having
    read the diff — Opus recommends a Tier-2 carve-out from *agents perform the merge*, which is
    Jim's to decide; the vault approval-line edit was adequate but is the field a delegated seat
    should default to leaving alone.
  - **Praised:** cutting F-4 to a non-deleting substrate; the harness and live-Dovecot evidence;
    the LOG entries; finding the timeout bug before the reviewers did.
- **2026-09-02 ~13:00 UTC — F-4 part 2 started on Jim's word (*"start F-4 part 2"*), outside any
  delegation window.** Normal authority: Tier 2, plan approved by Jim's go on the written plan
  (`docs/briefs/2026-09-02-f4-part2-plan.md`), the opposite-line plan read run **in parallel** with
  the non-deleting steps rather than blocking, and its findings adopted before the deleting step
  was written. The merge of this PR is left to Jim (Opus 5's recommendation on Tier-2 data paths,
  not yet decided as a rule).
  - **Built (first PR):** the REQ-2.1 gate (counting the delta check's own new UIDs — the plan
    read's HIGH 1), the full list via `imapSearchAllUids` → `reconcileFolderList` → `applySearchAll`,
    the REQ-2.2 counter (incremented on every `expunged: false` result in the provider, recomputed
    directionally after the store), the REQ-1.2b attestation (`attestPass`: every syncable folder
    checked, every opened gate listed, zero folder errors), end-of-pass deletion under the budget
    with the pending-ops guard and thread/label cleanup (`finishReconcilePass`), and the REQ-3.1
    stop as `ReconcileStopDialog` over `uiStore.reconcileStops` (keyed per folder). Nothing deletes
    unless the pass attested.
  - **Decisions:** tombstones are excluded from the diff and **never deleted by the pass** (plan
    read HIGH 3 — the F-5 reap owns them); the user's "Delete them" removes *every* confirmed row in
    the folder, not one cap's worth (the cap rate-limits unattended passes; a person just approved
    a mass removal — and it closes the re-prompt loop the read raised as M6); the stop freezes
    deletions only, new mail keeps syncing; pass ids cannot overlap because `syncManager.runSync`
    serialises syncs process-wide (verified). **Deferred to a follow-up PR:** REQ-2.3's
    `NOT DELETED` belt (one Rust command) and REQ-4's reconcile queue op.
  - Evidence: 17 harness scenarios in `reconcilePass.test.ts` covering spec Tasks 1–4, 9–11 (first
    sight never deletes; second attested pass deletes; unattested pass keeps; 15-over-cap-10
    batches 10 then 5; >50% stops behind the dialog; ≤10-row folder clears; reappearance clears;
    unlisted folders age nothing; counter recompute incl. G2's re-convergence; generation purge;
    pending-ops defer; tombstones untouched; one pass id across folders), 4 wiring tests in
    `imapSync.test.ts`, 5 dialog tests, 3 provider counter tests. Not yet run: the live Dovecot
    scenarios in the plan's Done-when — flagged in the PR as the remaining manual step.
  - **Reviews of #47, both CHANGES REQUESTED, everything adopted or already fixed.** Gemini 3.7
    (2H 1M 2N): the pending-ops guard cached the thread+message answer per thread and hid a row's
    own queued work; the >50% stop was judged on the filtered subset so queued work could shield a
    mass vanish. Grok 4.6 (6H 3M 1L 2N, read against the first commit): deletion matched rows by
    id alone (now id + folder + UID + live, and a suspect whose row F-5 moved is forgotten); a stop
    could outlive a UIDVALIDITY change (purge + clear on the change; approval refuses a stale
    generation); an empty list against a positive EXISTS passed as complete (now a folder error);
    **a short LIST shrank the attestation universe** (attestation now spans every folder with sync
    state — a server-deleted folder blocks attestation until its state row goes, recorded as the
    "folder gone" follow-up); approval was not one transaction (now is); the pass tail is
    `try/finally`. One semantic recorded rather than changed: **"Keep them" is a threshold, not a
    hold** — once the folder is no longer more than half gone, budgeted removal resumes; the copy
    says so now, and a persistent per-folder hold is an option for Jim.
- **2026-09-02 ~14:00 UTC — Eight roadmap decisions, Jim direct, asked one at a time with a
  recommendation each; Jim took the recommendation on all eight** (`docs/ROADMAP.md` §Decisions).
  1. **#197 remote images:** widen `img-src https:` behind the existing opt-in (¼ day, Tier 2);
     the Rust image proxy is queued as a later privacy enhancement, not the fix.
  2. **#209/#265 custom LLM URL:** a validated Rust fetch command (https or loopback only, no
     off-host redirects) — the CSP stays tight; **not** a widened `connect-src`.
  3. **Speed budget dependency:** `@tanstack/react-virtual` **approved** for list virtualization
     (headless, no transitive deps, same family as the router already in use). Recorded here as
     the dependency approval `CLAUDE.md` requires; the PR still justifies it.
  4. **MCP server:** write the ADR now (runtime, stdio transport, loopback only, Zod on every tool
     argument, authz in every handler, draft-only), build in enhancement wave 3.
  5. **P19/F-3:** **wire** `LinkConfirmDialog` on the email link path (~1 day, Tier 1).
  6. **#278 macOS signing:** not yet — tied to decision 8.
  7. **Grok 4.6:** **promoted to a standing second cross-vendor review leg on Tier 2** — ADR-004,
     roster row moved; diffs only, secrets-free, no repo access, findings verified before adoption.
     The Tier-2 human-merge carve-out stays **not adopted**.
  8. **EX-007 distribution:** not yet — revisit with an ADR after the P0/P1 bug queue (#297, #240)
     lands. EX-007 stays open to its 2027-03-01 expiry.
- **2026-09-02 ~14:30 UTC — F-4 part 3 built on Jim's "continue building"** (the roadmap's first
  item). Plan written before code as §Part 3 of the part-2 plan file. Three pieces, none deleting a
  message row: the REQ-2.3 `NOT DELETED` belt (one Rust command, a per-folder pass clock, runs every
  10th pass only where the no-UIDPLUS signature shows and only when the gate would open), the REQ-4
  reconcile queue op (targeted `UID SEARCH UID <set>` after an unknown-outcome move/delete; absent →
  suspect, present → notice; per-folder compaction with merged UIDs and max attempts; user ops
  first; three strikes → forced full list + notice), and the "folder gone" path (two consecutive
  LIST misses remove a folder's sync state so attestation resumes; **messages kept**, user told).
  Migration 27 adds three advisory counters. Decisions in the build: the belt cannot age suspects
  (it does not know *which* UIDs vanished), so it only ever saves the list when nothing did; the
  queue processor's strike rule is applied to reconcile ops only — user ops keep `incrementRetry`'s
  behaviour; REQ-4.4's "queue UI label" reduces to `params.kind = "repair"` because the queue
  surface is a count badge, not a per-op list.
  - **Merged by the seat as `ef7c91c`** after Jim corrected the deferral: *"read your rules, you
    are in charge of the merges, commits, push, pr, etc."* The standing rule (*Agents perform the
    merge*, with its preconditions) stands; Opus 5's recommended Tier-2 carve-out is **not
    adopted**. Preconditions verified on `6e83323`: CI success, CLEAN, no unresolved conversation.
- **2026-09-02 ~16:30 UTC — PR #50 (F-4 part 3) cross-vendor review, both legs.** Gemini 3.7:
  APPROVE WITH NITS (3, all recorded/declined). Grok 4.6: CHANGES REQUESTED — 3 HIGH, 4 MEDIUM,
  2 LOW, 2 NIT; every finding re-derived against the tree. **Adopted (one follow-up commit on the
  PR):** H1 the reconcile op wrote through `recordMissing`, whose promotion rule ("first sight on
  an earlier pass") would have confirmed a suspect on the *next* list — one targeted SEARCH plus one
  list, and two ops in a row with no list at all; now `insertSuspects` inserts only, under a
  `reconcile:` source id that the next full list *adopts* as first sight, so two list observations
  are still required. H2 a short LIST could count folders as gone — `folderListLooksPartial`
  (> 50 % of known folders omitted, or no syncable folder at all) treats the LIST as partial and
  counts nothing; a folder still in the raw LIST but no longer selectable gets an honest notice.
  H3 the op carries the folder's UIDVALIDITY from enqueue and is dropped if the generation moved
  (compaction no longer merges across generations). M4 a checked folder without EXISTS is treated
  as unchecked rather than gating on `?? 0`; `shouldListFolder` takes a number. M5 the queued
  (offline) move/delete path now enqueues the reconcile op on an unknown outcome, like the online
  one. M6 the queue processor degrades a spent reconcile op *before* marking it failed, and from
  the resource id when its params do not parse. L9 compaction sorts by `created_at`, tolerates a
  malformed sibling, labels the merge `repair`. NIT 11 `purgeAllSuspects` replaces the
  generation-0 sentinel. **Declined with reasons:** M7 (run the op on the `sync` session — there
  are only two kinds; a short SEARCH on `interactive` costs the user nothing visible, whereas
  sharing the sync session would spend a strike on every busy fetch; the H1 fix removes the race
  that made the kind matter), L8 (belt every pass instead of listing — lists more often than the
  spec's letter, never delays a vanish; the counter-only trigger is the no-UIDPLUS signature the
  belt exists for), NIT 10 (`SEARCH RETURN (COUNT)` is an ESEARCH capability, later). Raw outputs
  in `docs/reviews/2026-09-02-pr50-{gemini,grok}-raw.md`.
- **2026-09-02 ~17:45 UTC — #297 (Bcc disclosed over SMTP) built** on Jim's "start the bug-fix
  queue at #297". Verified in the fork before a line was written: `buildRawEmail` emits `Bcc:`
  (`emailBuilder.ts:143`), `extract_envelope` reads it into the envelope (`smtp/client.rs:127`),
  `send_raw_email` transmits the bytes unchanged (`:159`). Plan committed first
  (`docs/briefs/2026-09-02-297-bcc-strip.md`, Tier 2). **Decisions:** strip in Rust inside the
  send command, not in the TypeScript builder — the builder's output is also the Sent and Drafts
  copy, which keeps `Bcc` on purpose so the user can see whom they blind-copied; a hand-written
  header-block scanner (parser-independent, unit-tested for folding, case, obsolete `Bcc :`
  whitespace, bare LF, header-only input, body lines untouched) rather than `mail_parser`'s
  byte offsets, with `mail_parser` used as the **fail-closed guard**: if the parser still sees a
  `Bcc` after stripping, the send is refused with an error rather than transmitted. Gmail path
  untouched (**ASSUMPTION:** the Gmail API strips `Bcc` on submission). TDD: nine Rust tests red
  first, then green; one TypeScript seam test pins that the same bytes go to SMTP and to the
  Sent append.
- **2026-09-02 ~18:30 UTC — PR #52 (#297) cross-vendor review, both legs.** Gemini 3.7: APPROVE
  WITH NITS (1 LOW, 3 NIT) — all four adopted: `Resent-Bcc` stripped and guarded (RFC 5322
  §3.6.6), the mixed `\n\r\n` blank line found so the body is never scanned, a whitespace-led
  first line judged on its own, three boundary inputs as tests. Grok 4.6: APPROVE WITH NITS
  (3 MED, 3 LOW, 1 NIT, a test-gap table) on the first commit's diff — **adopted:** M1 a field
  name folded before its colon (`Bcc\r\n : x`) now counts as a Bcc field; M3 the fail-closed
  guard judged parsed addresses (`bcc().is_some()`), so `Bcc: @` passed it — it now refuses on
  the field *name* via `headers()`; L2's BOM before the first field; the test gaps (guard wiring
  through a `prepare_for_wire_with(raw, strip)` seam with an identity stripper, Bcc-only
  envelope, folded list in the envelope, tab obs-WSP, lookalikes with a real Bcc, empty `Bcc:`
  through the pipeline, multipart body). **Declined with reasons:** L4 bare-CR line endings (not
  RFC 5322, not produced by the builder, the command is webview-only, and `mail_parser` splits
  on CR so the guard refuses), `Bcc (obs):` (a different field name under `ftext`), NIT 7
  `trim_ascii` wider than WSP (over-stripping an illegal name is the safe side). Two Grok
  findings (M5 mixed blank line, L6 whitespace-led first line) were Gemini's already. Raw
  outputs in `docs/reviews/2026-09-02-pr52-{gemini,grok}-raw.md`.
- **2026-09-02 ~19:30 UTC — #240 built (pinned SQLite transactions) on Jim's approval** of the
  plan, the `sqlx` direct dependency (option A) and the 30 s idle watchdog. PR #54. **Dependency
  added:** `sqlx = "0.8"` (`sqlite`, `runtime-tokio`, `json`; default features off) — already
  compiled in through `tauri-plugin-sql` at 0.8.6, so the lockfile gained one edge and no
  package; version must track the plugin's. **Decisions in the build:** (1) the plan's Task 2
  capability entries were dropped — this repo lists no application command in
  `capabilities/default.json` and Tauri 2 permits an app's own commands without them; recorded
  on the PR. (2) Tests run on a **file-backed** pool, not `:memory:`, because an in-memory
  SQLite is private to its connection and the property under test is cross-connection
  visibility. (3) A connection whose COMMIT/ROLLBACK failed is **closed, not returned** to the
  pool — sqlx does not know about a hand-issued BEGIN, so returning it would put a connection
  still inside a transaction back into rotation. (4) The fail-fast `BEGIN IMMEDIATE` proof is a
  second writer with a 100 ms busy timeout, not a 5 s wait. (5) `DbExecutor` =
  `Pick<Database, "execute" | "select">` threads as a trailing optional parameter through the
  nine helpers the audit named; existing callers unchanged. (6) The old
  ROLLBACK-failure logging in `migrations.ts` moved into `withTransaction`, which stays silent
  only when the failure is the watchdog having already reaped the transaction. Gates: Rust
  119 (+7), frontend 2,034 (+5), clippy/tsc/docs/graph clean.
- **2026-09-02 ~21:00 UTC — PR #54 (#240) cross-vendor review, both legs, three rounds.**
  **Process defect on the author's side, recorded:** the first diff sent to both reviewers was
  taken before the new Rust files were staged, so Gemini's round 1 (CHANGES REQUESTED, HIGH
  "Rust files missing") reviewed an incomplete change; Grok's first run on it was stopped. Both
  legs re-ran on the committed diff. From Gemini round 1 the still-valid items were adopted
  (cross-window `VELO_TX_BUSY` retry, `withTransaction<T>` return value, helper routing tests);
  re-entrancy was declined with reasons (no async context in the webview; no nested caller in
  the tree; the watchdog turns a nested call into a loud error after 30 s). **Gemini round 2**
  (CHANGES REQUESTED, 1H 2M 1L 1N): H1 booleans bound as JSON text — parity with the plugin, but
  adopted as INTEGER 1/0 in the safe direction; M2 idle clock stamped before the statement —
  adopted (after); M3 rollback after a failed commit warned spuriously — adopted (no rollback,
  Rust already closed the connection); L4 type aliases — declined (sqlx canonicalises them, the
  plugin matches the same list); N5 reaped id never cleared — adopted. **Grok** (CHANGES
  REQUESTED, 4M 5L 3N, on the pre-round-2 diff): M1 = Gemini M2; **M2 the manager mutex was held
  across `pool.acquire()` and `BEGIN IMMEDIATE`** — adopted: the slot is claimed under the lock
  and the slow part runs outside it, a competing `begin` is refused at once (test: refused in
  < 150 ms while the first waits on an outside writer); M3 5 s retry shorter than a batch —
  adopted (tracks the 30 s watchdog); **M4 no test of the actual failure mode** — adopted (a
  concurrent reader on the pool is never blocked and never sees a partial transaction); L5
  `OpenTx` dropped without `release` recycles a mid-transaction connection — adopted (`Drop`
  detaches, closing it); L6 `TX_UNKNOWN` on a late rollback warned — adopted (silent); L7
  unpinned `sqlx` and no duplicate check — adopted (`=0.8.6`, CI step asserts one copy); L8
  handle assertions on one call site — adopted across both stores and the snooze helper; L9,
  N10–N12 recorded (ids are not UUIDs as the plan said; lockfile format 3 → 4 is the local
  toolchain's default, accepted by the MSRV job). Raw outputs in
  `docs/reviews/2026-09-02-pr54-{gemini-round1,gemini,grok}-raw.md`. Gates after all three
  rounds: Rust 123, frontend 2,045, clippy/tsc/docs/graph clean.
- **2026-09-02 ~23:00 UTC — #241 built (parenthesised `UID FETCH` attribute lists)** on Jim's
  instruction, on its own branch alongside #280. Verified first: RFC 3501 §6.4.5 requires
  parentheses around two or more fetch attributes; three `uid_fetch` sites in
  `imap/client.rs` sent a bare list (initial-sync batch, single-message fetch, delta-sync
  chunk), two sent a single attribute (valid), and the raw diagnostic already used the RFC form.
  Plan committed first (`docs/briefs/2026-09-02-241-uid-fetch-parenthesised.md`, Tier 2 —
  Rust IMAP). **Decisions:** the two lists become `FETCH_FULL` / `FETCH_UID_FLAGS_BODY`
  constants (plus `FETCH_BODY`) and the diagnostic uses the same constant; a **guard test scans
  the client source** for every `.uid_fetch(` site and fails on a bare multi-attribute list —
  and refuses to pass by finding fewer than the five known sites. TDD: the guard red on the
  first bare list (line 289), then green. No live Stalwart to run against; the reporter's
  re-test is recorded as open.
- **2026-09-02 ~23:45 UTC — PR #57 (#241) cross-vendor review, both legs.** Gemini 3.7 and Grok
  4.6 both APPROVE WITH NITS and both found the same real weakness: the guard was line-based
  (a wrapped call was skipped, `.await` on the call line made it panic, `>= 5` let it pass by
  omission, "contains a space" was not RFC `fetch-att`, `.fetch(` and raw command strings were
  unchecked). **Adopted as a rewrite:** the guard moved to `imap/fetch_guard.rs` — a
  bracket-and-string-aware scanner over the client's production source (its own test module
  excluded), covering `.uid_fetch(`/`.fetch(` calls across lines and every tagged
  `… FETCH <set> <attrs>\r\n` command string with `{FETCH_*}` placeholders resolved and any other
  placeholder failing closed; "multi" is two or more top-level tokens; exact site counts (5
  method, 2 raw — the scan found a second, already-correct raw command); nine scanner fixtures.
  `FETCH_FULL` renamed `FETCH_UID_FLAGS_INTERNALDATE_BODY` (Grok N5: RFC 3501's `FULL` is a
  different macro). **Recorded, not adopted:** a wire-bytes test (needs a recording session;
  `async-imap` sends the query verbatim) and a full-attribute response-parser fixture (the
  parser is unchanged; belongs with the reporter's re-test). Raw outputs in
  `docs/reviews/2026-09-02-pr57-{gemini,grok}-raw.md`. Rust 132 tests.
- **2026-09-03 — #252/#253 built (separate encrypted SMTP credentials)** on Jim's instruction.
  Verified first: `AddImapAccount.tsx:387` `password: form.samePassword ? form.password :
  form.password` (identical arms), no SMTP credential column, `buildSmtpConfig` reading
  `imap_password`, the form's SMTP *test* already using the typed SMTP password — the test and
  the save disagreed, which is #252 exactly. Plan committed first
  (`docs/briefs/2026-09-02-252-smtp-credentials.md`, Tier 2 — `accounts.ts` + migration + a
  new encrypted column). **Decisions:** both #252 and #253 in one change — the username is the
  same seam and the same fallback rule; migration 28 adds `smtp_username` and `smtp_password`
  (NULL for every existing row), `smtp_password` joins `ENCRYPTED_FIELDS` so the fail-closed
  decrypt and the re-auth banner cover it with no other change; `buildSmtpConfig` falls back
  **per field** to the IMAP username/password so every pre-28 account produces the identical
  config (pinned by the existing exact-object test plus a null-columns test); one pure
  resolver (`services/imap/smtpCredentials.ts`) feeds both the form's SMTP test and its save,
  which is the structural fix for the disagreement; no edit-account UI (none exists for IMAP
  settings — a separate item). TDD: six tests red across four suites, then green; fixtures
  assemble fake secrets at runtime (the secret scan reads commit history).
- **2026-09-03 — PR #59 (#252/#253) cross-vendor review, both legs.** Gemini 3.7: APPROVE WITH
  NITS (1M 2L 3N). Grok 4.6: CHANGES REQUESTED (3M 3L 2N). **Both found the same real hole:** an
  empty separate SMTP password was tested as `""` but stored as `NULL` (the insert's falsy
  check), so the send fell back to the IMAP password — #252's disagreement in a new place.
  **Adopted:** the form refuses to save an unticked box with an empty SMTP password, and
  `insertImapAccount` stores any string as given (only `null` means "same as IMAP"); the save
  always runs the same resolver the test runs and never builds credentials in a branch of its
  own (Grok M3, structural); `smtp_password` in the parametrised fail-closed test plus a test
  that the failure names "SMTP password" and never carries the ciphertext; the inverse
  per-field fallback, the empty-string rule locked (`??` for password, `||` for username), a
  pre-28 row reading `NULL` after migration 28; the IMAP-username trim in the test path; form
  spacing; `samePassword` renamed `sameCredentials`; the doc comment put back on
  `mapSecurity`. **Declined with reasons:** Grok M2 (decrypt failure falling open to the IMAP
  password) — `decryptAccountTokens` throws for the whole account, so `buildSmtpConfig` never
  sees a nulled field, and the new tests pin that; a component test for the form (Gemini L3,
  Grok M3's test half) — no harness exists, and the property is now enforced by shape. Raw
  outputs in `docs/reviews/2026-09-03-pr59-{gemini,grok}-raw.md`.
- **2026-09-03 — #197 built (remote images: CSP `img-src` widened to `https:`)** on Jim's
  decision 1 of 2026-09-02 and his instruction. Verified first: the block is enforced by the
  sanitizer (`EmailRenderer.tsx:42`, `stripRemoteImages` moving `src` to `data-blocked-src`);
  when the user allows images the HTML keeps `src`, the body is written into a same-origin
  iframe that inherits the window CSP, and `img-src` listed four avatar hosts — so an allowed
  image was refused one layer below the opt-in. Plan committed first
  (`docs/briefs/2026-09-03-197-img-src-csp.md`, Tier 2 — CSP). **Decisions:** `img-src 'self'
  data: https:` — the three explicit hosts are subsumed and dropped; **no `http:`** (a
  plaintext image fetch from the mail client would leak in the clear; the decision names
  `https:`); the sanitizer, the default (block on) and the sandbox flags are untouched; a test
  parses the CSP into directives and pins `img-src` exactly and every other directive exactly,
  so nothing else can move with it. TDD: the CSP test red first. The Rust image proxy stays
  queued as the privacy enhancement.
- **2026-09-02 ~22:30 UTC — #280 built (http scope for local AI; connection-test reason)** on
  Jim's instruction. Verified first: the Ollama client uses `@tauri-apps/plugin-http`'s `fetch`
  (`ollamaProvider.ts:2`), the plugin matches its scope with the `urlpattern` crate, and under
  URLPattern `http://*` matches only the default port — reproduced with Node 26's `URLPattern`
  (same algorithm) for the exact URLs. Plan committed first
  (`docs/briefs/2026-09-02-280-http-scope-local-ai.md`, Tier 2 — capabilities file).
  **Decisions:** four loopback entries (`127.0.0.1` and `localhost`, with and without a path,
  any port); **no `*:*`** (Jim); `http://*` untouched. A committed test
  (`src/config/capabilities.test.ts`) builds every allow entry with `URLPattern` and pins the
  positive URLs, the untouched default-port case and two negatives (a remote host on an odd
  port; the literal `*:*`). The connection test's reason now travels through every layer:
  `ConnectionTestResult = { ok: true } | { ok: false; error }` on the provider interface (three
  implementations, six providers), `aiService.testConnection` reports a provider that cannot even
  be built the same way, `describeError` in `ai/errors.ts` turns the plugin's plain-string scope
  refusal into text, and both settings cards render it after "Connection failed". Option (a)
  of the brief — change the type at every layer — over a side channel or a throwing interface.
  TDD: the scope test red first (positive case failing, negatives passing), the provider tests
  rewritten to the new shape before the code. Gates: 161 files / 2,051 tests, tsc, docs, graph.
- **2026-09-02 ~23:30 UTC — PR #56 (#280) cross-vendor review, both legs.** Gemini 3.7: APPROVE
  WITH NITS (1M 3L 2N). Grok 4.6: APPROVE WITH NITS (1M 3L 3N). **Adopted:** `describeError`
  reads `message`/`error` fields of plain-object rejections and **redacts credentials** (key
  shapes, bearer tokens, key-bearing query parameters) before display; nine more negative
  scope URLs plus an **exact snapshot of the allow list**; origin-only and query-carrying
  positives; `claudeProvider.test.ts`; `isAutoDraftEnabled` false on a failed result; the
  reason truncated and cleared per test; and, from Grok's redirect question, the Ollama
  client's fetch passes `maxRedirections: 0` so a local service cannot redirect the request
  off loopback (the plugin checks its scope on the given URL only). **Declined with reasons:**
  IPv6 `[::1]` entries — the only pattern form that parses cannot be verified for the Rust
  crate in CI and a bad entry breaks startup; `localhost` already covers a `::1` resolution
  because the scope checks URL text. **Recorded for Jim:** Grok M1 — the scope test's oracle is
  Node's `URLPattern`; testing with the plugin's own matcher needs `urlpattern` as a
  dev-dependency (plugin's scope module is private) — a dependency decision (brief §Open for
  Jim). Raw outputs in `docs/reviews/2026-09-02-pr56-{gemini,grok}-raw.md`. Gates after:
  162 files / 2,060 tests.
- **2026-09-02 — Disk-full incident during the #280/#241 builds.** The volume hit 100 % mid-edit
  (four Rust `target/` caches totalled ~25 GB). Recovered by deleting the two **dead** worktrees'
  build caches (`f1-decisions`, `f2-email-links-open`, 8 GB, compiler output only — the
  worktrees themselves and their branches are untouched, still Jim's to remove). The main
  checkout's and this worktree's caches were kept. No source was lost; two edits that failed
  with ENOSPC were re-applied and verified.
