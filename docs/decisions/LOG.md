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
- **2026-09-03 — PR #60 (#197) cross-vendor review, both legs.** Gemini 3.7 and Grok 4.6 both
  CHANGES REQUESTED on the same point: once `img-src` is `https:`, the block is entirely the
  sanitizer's, so every image-fetching vector must be neutralised by it. **Verified:** the
  audit-P9 blocker is DOM-based and already removes every fetching attribute (`src`, `srcset`,
  `poster`, `background`, `xlink:href`, …) and inline-style URLs; `<style>`/`<link>` are
  forbidden. **One real gap, adopted:** `href` was excluded for links, and SVG `<image>`/`<use>`
  fetch on render — the four-host CSP had hidden it; a remote `href` is now removed on every
  element that is not `<a>`/`<area>`, with tests for every vector both reviews named. Also
  adopted: the CSP test refuses duplicate directive names (browsers keep the first, a map keeps
  the last), parses inside a helper, and asserts `blob:` absent. **Recorded:** the opted-in
  cookie-bearing GET residual (Grok L4) — the webview holds bearer tokens, not provider
  cookies. The brief's threat pass was corrected: it rests on the blocker's coverage, not on "no
  `src` remains". Raw outputs in `docs/reviews/2026-09-03-pr60-{gemini,grok}-raw.md`.
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
- **2026-09-03 — #276 built ("All time" sync period)** on Jim's instruction, bug-fix queue
  item 7, **Tier 1** (no Tier-2 file touched; no Rust change). The triage said *review upstream
  PR #275, don't rewrite*: reviewed (`gh pr diff 275`, 4 files) and **adopted its design** —
  `0` means no date filter, Gmail omits `after:`, IMAP passes `null` so the existing Rust
  `None → UID SEARCH ALL` branch fires, the per-message cutoff is off, dropdown gains 2 y / 5 y /
  All time. **Tightened:** upstream's `Number.isNaN(parsed) ? 365 : parsed` (copied at both
  sync-manager sites, "0 or negative = all time") became one parser, `services/syncPeriod.ts`,
  accepting exactly `0` or a positive integer and falling back to 365 for negative, fractional,
  hex or non-numeric strings — a negative period is not a meaning anyone chose, and one reader
  cannot drift like #252's duplicated ternary did. The latent bug it also fixes: both sites read
  `parseInt(raw) || 365`, which silently turned a stored `0` into 365. The fork's three IMAP
  search sites differ from upstream's (session-pooled since E2), so the change was re-made by
  hand. TDD: parser cases, both sync-manager sites receiving `0` (and `365` for junk), IMAP
  all-time search with `null` and two 400-day/12-year-old messages kept, Gmail `q` omitted /
  kept. Spec `docs/briefs/2026-09-03-276-sync-all-time.md`, committed before the code.
  Gates: 164 files / 2,101 tests, tsc, graph, docs. One review leg (Tier 1): Gemini 3.7.
- **2026-09-03 — PR #62 (#276) review, one leg (Tier 1).** Gemini 3.7: APPROVE WITH NITS
  (2L 1N). **Adopted all three:** L1 — a delta-sync test that both search sites (a folder with
  no saved state, a UIDVALIDITY resync) pass `null` for all time, plus the mirror case that a
  positive period keeps the SINCE string; L2 — a sync-manager test that an IMAP account with
  a history id hands `0` to `imapDeltaSync` (not only the initial-sync branch); N3 — a doc
  note on `computeSinceDate` that `0` there means "since yesterday" and the period must come
  through `sinceDateForDaysBack`. **Questions answered:** no `SettingsPage` component test
  exists in the repo and the option is a plain `<option value="0">` — not added (the parser
  test pins what `"0"` means); an interrupted all-time initial sync resumes the way any
  initial sync does today (per-folder `folder_sync_state`, `history_id` set at the end) —
  unchanged by this PR, recorded. Raw output in `docs/reviews/2026-09-03-pr62-gemini-raw.md`.
- **2026-09-03 — #243 built (unread counts in the sidebar)** on Jim's instruction, bug-fix
  queue item 8, **Tier 1** (no Tier-2 file; no schema). Verified first: no label had a count
  (only smart folders and Tasks render the pill), the badge's Inbox count is cross-account,
  and no user action fires an event — only `sendMessage` does — so a count refreshed on
  `velo-sync-done` alone would lag the user's own reads and archives by up to 60 s.
  **Decisions:** one grouped query (`getUnreadCountsByLabel`, the folder list's own
  `threads ⋈ thread_labels` join, so the pill equals what the folder shows) into `labelStore`
  rather than smart-folder-style per-label queries; a typed **`velo-threads-changed`** event
  fired by `executeEmailAction` after its local update, whatever the server then says (online,
  queued, or permanently failed — the local rows changed either way), with the sidebar's
  existing 500 ms debounce listening to both events; pills on **Inbox, Spam and user labels**
  only (Drafts would want a total; Starred/Snoozed/Sent/Trash/All Mail are not to-do folders),
  hidden at zero and when collapsed. Not done, recorded in the brief: per-category counts,
  refreshing the taskbar badge on the new event, replacing the inline `velo-sync-done`
  literals. TDD: SQLite-harness test for the query (per-label, per-account, agrees with the
  folder list), store tests (refresh, stale keys dropped, failure keeps the map, clear), the
  three event cases in `emailActions`, and a **`Sidebar` render test** (first one for that
  component: pills at 4/2/1, none at 0, none on uncounted folders, none collapsed, one query
  for both events through the debounce). Spec `docs/briefs/2026-09-03-243-sidebar-unread-counts.md`,
  committed before the code. Gates: 166 files / 2,119 tests, tsc, graph, docs. One review leg
  (Tier 1): Gemini 3.7.
- **2026-09-03 — PR #63 (#243) review, one leg (Tier 1).** Gemini 3.7: CHANGES REQUESTED
  (2M 2L 1N). **Adopted:** M1 — the sidebar test dispatched both events in one block, so an
  unwired `velo-threads-changed` listener would have passed on the strength of sync-done;
  split into one test per event (plus one for a sync-done inside a user action's window).
  M2 — `refreshUnreadCounts` for the previous account could resolve after the new account's
  and overwrite its map; a module-level sequence makes the newest request the only one that
  sets state (a test races two refreshes and resolves the old one last). L4 — the shared
  handler re-queried the label list and the smart-folder searches on every user action; the
  debounce now takes a flag: a sync reloads labels, a user action refreshes counts only
  (smart-folder counts included — they are unread counts too and had the same lag), with
  the flag OR-ed across the window. N5 — the folder-list agreement test now seeds a second
  account. **Declined with reason:** L3 — "fire again after the optimistic revert": the
  revert changes the store, not the database (`revertOptimisticUpdate`), so a re-query
  would return the same map; the real gap is pre-existing — on a permanent provider error
  the local rows keep the change while the store reverts — and belongs to `emailActions`,
  not to this PR (recorded here as a carry). **Questions answered:** snoozing stores the
  thread without `INBOX` and with `SNOOZED` (`applySnoozeOverride`), so the count is exact;
  bulk actions loop over `executeEmailAction`, N events collapse into one debounced query.
  Raw output in `docs/reviews/2026-09-03-pr63-gemini-raw.md`.
- **2026-09-03 — #209/#265 built (custom OpenAI-compatible endpoint through a validated Rust
  fetch)** on Jim's instruction, bug-fix queue item 9, **Tier 2** (a new `#[tauri::command]`
  taking a user-controlled URL; credentials in flight; the AI output boundary). Jim's decision 2
  applied: **`ai_fetch` in Rust** (`src-tauri/src/ai_fetch.rs`) — `https:` to any host or
  `http:` to loopback only (`localhost`, `127.0.0.0/8`, `::1`), no user-info, GET/POST only,
  four request headers forwarded (`authorization`, `content-type`, `accept`, `user-agent`),
  `redirect::Policy::none()` with a 3xx refused *without* its `Location`, three response
  headers returned, 8 MiB body cap, 120 s timeout; errors and the log line carry the host and
  status, never the URL's query (`reqwest::Error::without_url`). Verified first: every cloud
  provider uses the OpenAI SDK through the webview's `fetch`, gated by the static CSP
  `connect-src` — a user-typed host cannot be added at runtime; only Ollama uses the http
  plugin, whose scope is `https://*` + loopback, checked on the given URL only, redirects
  followed. Upstream PR #242 (`custom-provider`) reviewed: its provider/settings shape and key
  names adopted; its transport (the plugin, redirects followed, no validation), its default
  base URL `http://localhost:11434/v1` (a silent duplicate of Ollama — unset now means
  `NOT_CONFIGURED`) and its interface change across every provider rejected; the API key made
  optional (a LAN gateway; a placeholder is sent, the SDK refuses an empty string).
  TypeScript: `rustFetch` (a `fetch`-shaped wrapper over `invoke`; the result is **zod-
  validated** before a `Response` is built — an `invoke()` result is a boundary; 204/205/304
  built with a null body), `customProvider` (SDK with `fetch: rustFetch`), `custom` in
  `AiProvider`/settings keys/provider manager, a settings card mirroring Ollama's with an
  inline pre-check of the same rule, help text naming OpenRouter (#265) and DeepSeek.
  **No dependency added** (reqwest 0.12, serde, tokio, zod already direct). **No capability
  entry** (app commands ride `core:default`, like `db_tx_*`); `tauri.conf.json` and
  `capabilities/default.json` byte-identical. TDD: Rust — the URL table (accepts/refuses,
  including `localhost.example.com` and the AWS metadata address) and five socket tests
  against a `TcpListener` on 127.0.0.1 (302 refused and not disclosed, header allow-lists in
  both directions, body cap, 401 relayed, connection error without the URL); TS — the
  mirrored URL table, `rustFetch` shape/response/malformed/abort, the provider's config and
  cache, the manager's six `custom` cases. Threat pass and rollback in the brief. Gates:
  cargo test 143 (+10), clippy `-D warnings`, 168 files / 2,165 tests, tsc, graph, docs.
  Both review legs to follow.
- **2026-09-03 — PR #65 (#209/#265) review, three legs.** Gemini 3.7 Flash: APPROVE WITH
  NITS (2L 3N). Grok 4.6: CHANGES REQUESTED (2M 5L 3N) — twelve minutes on a 1,400-line
  prompt; **Jim (2026-09-02): "replace Grok with Gemini-2.7 from now on if Grok is slow"** —
  no such model in `agy` (3.6/3.7/3.8 Flash, 3.1 Pro), so the second leg ran on
  **Gemini 3.1 Pro (high)**, a different family from the first leg: APPROVE WITH NITS (2N).
  A same-vendor second leg is weaker evidence than a cross-vendor one; Grok's late verdict
  is taken as the third. **Adopted:** Gemini L1 — a socket test with no `content-length`
  proves the cap holds in the chunk loop; L2 — one process-wide `reqwest::Client` in a
  `OnceLock` carrying the redirect policy, timeout per request; N3 — `||` for a saved empty
  model name; N4 — `rustFetch` races `invoke` against the `AbortSignal` (the Rust request
  runs to its own timeout — IPC cannot be cancelled; Gemini 3.1 Pro N2 says the same and
  accepts it); Grok 1/2 + Gemini N5 + Gemini 3.1 Pro N1 — the URL tables on both sides now
  pin the parser-differential forms: `127.1`, `0177.0.0.1`, `2130706433`, `0x7f.1` accepted
  as 127.0.0.1; `10.1`, `167772161`, `0x0a000001`, `0.0.0.0`, `[::]`, `[::ffff:127.0.0.1]`,
  `[::ffff:10.0.0.1]`, `[::ffff:169.254.169.254]`, `[fe80::1]`, `[fd00::1]`, `127` (= 0.0.0.127),
  `0127.0.0.1` (octal, = 87.0.0.1), `localhost.`, `localhost%2eexample.com`, `%0d%0a`
  refused, whitespace cannot smuggle a host; Grok 3 — a **304 is not a redirect** and passes
  with its empty body (socket test); Grok 5 — the **request** body and each header value are
  capped too (8 MiB / 8 KiB, refused before any connection); Grok 6 — the three AI cards'
  `catch` now goes through `describeError` (redaction) like the success path; Grok 8 — any
  `@` in the authority as written is refused on both sides, so the empty `https://:@host/`
  form cannot be normalised past the check, while `@` in a path or query is fine; Grok 9 —
  a `Request` input's body is read when `init.body` is absent; Grok 10 — the card says Azure's
  `api-key` header is not supported. **Declined with reasons:** Grok 4 (clamp `retry-after`,
  `maxRetries` 0/1, reject non-UTF-8) — the OpenAI SDK ignores a `retry-after` above 60 s and
  uses its own backoff, retries are the same two every provider makes, and a lossy body only
  fails JSON parsing the same way a rejection would; Grok 7 (bind the command to the saved
  base URL's origin, or an explicit capability) — Rust has no access to the settings table,
  app commands cannot be permission-gated without generating permissions, and the reach is
  strictly narrower than the http plugin's scope already granted to the same JavaScript —
  recorded as the threat pass's residual; Grok Q3 (system proxy on loopback) — `reqwest`
  honours `NO_PROXY`; a user's own proxy configuration intercepting their own loopback is
  their configuration, not a boundary the app owns. **Questions answered:** plugin scope is
  `http://*` + `https://*` at this pin (Grok Q1); https to a private address stays allowed and
  a self-signed certificate must be in the OS trust store (`native-tls`) or the gateway used
  over `http://127.0.0.1` (Gemini Q2, Grok Q2); 8 MiB of response text is far beyond any
  chat completion (Gemini 3.1 Pro Q1). Raw outputs in `docs/reviews/2026-09-03-pr65-{gemini,
  grok,gemini31pro}-raw.md`.
- **2026-09-03 — PR #65: Gemini 3.8 Flash, two runs, and the comparison Jim asked for.**
  Jim: *"see if gemini 3.8 flash is available"* — it is (`gemini-3.8-flash-high`), and it is
  the standing second leg from now on when Grok is slow. Run A, on the tree after the
  Gemini/Grok adoptions: APPROVE WITH NITS (1L 3N) — **adopted** hex IPv4 forms in the TS
  table, octet bounds in the TS loopback check (never looser than Rust's parser), a
  `retry-after` assertion in the socket echo test; the LOW (a trickle to the 120 s timeout
  after the webview aborted) is the residual already recorded. Run B, on the **same diff
  Grok and Gemini 3.1 Pro saw** (`fe67514..31574df`): APPROVE WITH NITS (1M 3L 2N) —
  in-flight abort (its MEDIUM; the other legs' NIT), the chunk-loop cap test, `retry-after`,
  `0.0.0.0`/`[::]` rows, client pooling, and one finding **nobody else made**: Test
  Connection read the saved values, so a test before Save tested the old endpoint or failed
  `NOT_CONFIGURED` — **adopted**: the custom card tests the fields as typed. **How it did
  against Grok on the same diff:** it matched Grok on five items and was minutes rather than
  twelve, but missed four code fixes Grok found — the 304 pass-through, the request body and
  header caps, the unredacted `catch`, and the empty-user-info form — and the broader
  parser-differential rows. It matched Gemini 3.7 Flash almost item for item. **Reading:**
  Grok remains the deeper second leg when time allows; 3.8 Flash is the fast fallback Jim
  asked for, not a replacement in depth — same-vendor evidence on top of that. Raw outputs
  in `docs/reviews/2026-09-03-pr65-gemini38-raw.md` (run A) and `…-gemini38cmp-raw.md`
  (run B).
- **2026-09-03 — #233 built (Flatpak runtime)** on Jim's instruction, bug-fix queue item
  11, **Tier 1** (packaging files only; the runtime pin bump named in the brief for Jim to
  object to — no Cargo/npm dependency, no capability). Verified first: manifest and
  packaging workflow pin `org.gnome.Platform` **46** (Flathub EOL 2025-04-17; 48 followed
  2026-03-24; **50** is current) and `node20//23.08` while the app requires Node ≥ 24;
  `build-bundle` had no `--runtime-repo`, so `flatpak install velo.flatpak` could not
  fetch a missing runtime — the reporter's error; the job was `workflow_call` only.
  **Decisions:** GNOME **50** (49 dies on GNOME 51's release in weeks; bare freedesktop
  lacks webkit2gtk-4.1); `org.freedesktop.Sdk.Extension.node24//25.08` (Node 24.20.0, the
  base GNOME 49/50 are built on — confirmed from the extension's Flathub manifest);
  `--runtime-repo=https://flathub.org/repo/flathub.flatpakrepo` on the bundle;
  `workflow_dispatch` with an optional tag and an upload step gated on it, so a bump can be
  proven on a branch. TDD: `src/config/flatpakManifest.test.ts` red (6/6) against the old
  files — manifest, workflow, CONTRIBUTING and architecture must agree on runtime and
  extension, the extension major must equal `package.json` `engines.node`'s floor, the
  bundle must carry `--runtime-repo`, the job must be dispatchable with a gated upload.
  **Not doing:** Flathub publication / `.flatpakref` (distribution decision, EX-007).
  Proof of the build: one dispatched packaging run on the branch, recorded on the PR.
- **2026-09-03 — PR #67 (#233) review, one leg (Tier 1).** Gemini 3.7 Flash: APPROVE WITH
  NITS (1M 2L 1N); it confirmed GNOME 50 sits on freedesktop-sdk 25.08, the node24 path,
  webkit2gtk-4.1 on 50, and that `--runtime-repo` is what makes `flatpak install` of the
  file offer the runtime (`--repo-url` is for OSTree update remotes; `.flatpakref` needs a
  hosted repo — correctly deferred). **Adopted all four:** M1 — the test asserted only that
  the upload `if:` mentioned `tag_name`; it now matches the exact gate; L2 — the version
  lookaheads were hard-coded to 50/24 and would have failed the next legitimate bump; now
  interpolated; L3 — a branch dispatch naming a shipped tag could `--clobber` a release
  asset: the gate is now `tag given AND (release workflow OR dispatched from that tag's own
  ref)`, applied to **both** upload steps (the SRPM upload had no gate at all — the first
  dispatched run showed it failing on the empty tag); N4 — the extension is read from under
  `sdk-extensions:` only. A bug in the test itself surfaced while doing M1: the `m` flag
  made `$` match a line end, so the step capture stopped at the first line — fixed, and
  every `Upload … to release` step is now enumerated and checked. **Questions:** no aarch64
  bundle is planned (runners are x86_64; recorded); release checksums are a follow-up for
  the release ADR. Raw output in `docs/reviews/2026-09-03-pr67-gemini-raw.md`.
- **2026-09-03 — #204 built (cancel an in-flight connection test)** on Jim's instruction,
  bug-fix queue item 12, **Tier 2** (new commands on the Rust IMAP/SMTP client path; the
  form carries credentials). Of the issue's three complaints, "database is locked" was
  closed by #240 and the first-attempt `AUTHENTICATIONFAILED` is provider-specific; the
  residual is the test that "cannot be broken". Verified first: the form awaited two raw
  `invoke`s with no way to stop them and the IMAP test's timeout ladder holds a silent host
  for up to ~90 s; an IPC call cannot be cancelled from the webview. **Decision:** abort at
  the task boundary — `connection_tests.rs` keeps an `AbortHandle` per caller-minted id
  (never a config), `imap_test_connection`/`smtp_test_connection` take an optional `testId`
  and run as a spawned task when given (wire shape backward-compatible), and
  `connection_test_cancel(testId) -> bool` aborts it; over a UI-only cancel (the socket and
  the credential-carrying attempt would run on) and over threading a cancellation token
  through `connect` (more invasive for the same effect). TypeScript: `tauriCommands`
  wrappers, a pure `connectionTestRun` (ids, a generation so a late result after Cancel or a
  re-test is dropped, cancel only the ids still in flight), and the form's Cancel button
  beside "Testing..."; the form's two raw `invoke` calls are gone. TDD: Rust — registry
  unit tests and the real IMAP test against a `TcpListener` that accepts and never answers,
  cancelled after 100 ms and back in under a second; TS — the run module (distinct ids,
  delivery, cancel invokes both ids and drops late results, finished tests not cancelled,
  re-test supersedes) and the wrapper shapes. Spec
  `docs/briefs/2026-09-03-204-cancel-connection-test.md`, committed before the code.
  Gates: cargo test 154 (+5), clippy `-D warnings`, 169 files / 2,199 tests, tsc, graph,
  docs. Both review legs to follow (second: Grok if affordable, else Gemini 3.8 Flash).
- **2026-09-03 — PR #68 (#204) review, leg 1.** Gemini 3.7 Flash: APPROVE WITH NITS (1L 3N);
  it confirmed the abort closes the socket at the current await point, that the registry
  never sees a config, and the wire shape (`null` → `None`, 53-bit id → `u64`).
  **Adopted:** L1 — a `start()` over a run still in flight now cancels the old ids first
  (they would have held their sockets to the timeout); N2 — lazy `useRef`, one run per
  mount; N3 — spawn and register under one registry lock, so a cancel racing the call
  either finds the handle or is answered `false` before the task exists; N4 — a panicking
  task is reported and its entry removed, and the real **SMTP** test against a silent
  socket is cancelled in under a second like the IMAP one. **Declined:** a component test
  for unmount cleanup — no `AddImapAccount` test exists and the cleanup is one effect over
  the tested `cancel()`. A failed cancel IPC is now warned, still swallowed. The first
  push failed CI's Rust job on `in_flight` being unused outside tests — `#[cfg(test)]` now.
  Raw output in `docs/reviews/2026-09-03-pr68-gemini-raw.md`.
- **2026-09-03 — PR #68 (#204) review, legs 2 and 3.** Grok 4.6 (twelve minutes again, run
  in parallel with the fallback): CHANGES REQUESTED (4M 4L 1N). Gemini 3.8 Flash (Jim's
  fallback rule): CHANGES REQUESTED (1H 2M 2L 1N). Both reviewed the diff at `25ee8e0`.
  **Real defects, all adopted:** (1) **cancel-before-register** — the sync cancel command
  can be polled before the async test command's first poll; a lock around spawn+register
  (Gemini 3.7 N3) does not cover that. `cancel` now leaves a **tombstone** for an id it has
  not seen; the test command finds it and never spawns; tombstones expire after 60 s and
  are swept on every registry write (Grok 1 = Gemini 3.8 M3; test with no sleep at all).
  (2) **`mapSecurity` fail-open** — my rewrite defaulted an unknown value to `"none"`, i.e.
  a password on a plaintext socket; the form's union is `ssl|starttls|none` so no live
  path hit it, but it is exactly the wrong default on a credential path. Now an exhaustive
  `switch` over `SecurityType` with a `never` arm (Grok 3 = Gemini 3.8 H1). (3) a `start`
  over a running run orphaned the old tasks (Grok 2 = Gemini 3.8 M2 = Gemini 3.7 L1) —
  adopted earlier. (4) SMTP abort unproven (Grok 4) — the silent-socket SMTP test, and
  now both socket tests assert the **server saw EOF**, i.e. the abort really closed the
  socket (Gemini 3.8 L4). **Grok's LOWs, adopted:** a **drop guard** — the command future
  dropped mid-flight (webview teardown) used to detach the task and leak the entry; the
  guard aborts and removes, scoped by a per-registration sequence so a displaced
  registration's cleanup cannot remove the one that replaced it (found by the duplicate-id
  test); a **duplicate id** now aborts the displaced test instead of orphaning it; the
  modal's own close path cancels too (the parent does unmount the form, so this is a belt);
  a panic in the work yields a fixed string and the detail goes to the log. **Gemini 3.8's
  extras:** the SMTP wrapper's `testId` pinned; `isRunning()` now guards a double click.
  **Declined:** none. **Questions answered:** app commands need no capability entry
  (`core:default`, as `db_tx_*`/`ai_fetch`); lettre's transport is async — the SMTP
  silent-socket test proves the abort in <1 s; the modal unmounts the form; the security
  union has no `"tls"`; `crypto.getRandomValues` exists in every webview Tauri ships on.
  **Comparison:** Grok and Gemini 3.8 each found the three MEDIUM-class defects Gemini 3.7
  missed; Grok alone found the drop-guard and duplicate-id leaks. Raw outputs in
  `docs/reviews/2026-09-03-pr68-{grok,gemini38}-raw.md`.
- **2026-09-03 — #281 built (paste an image from the clipboard)** on Jim's instruction, the
  last bug-fix queue item, **Tier 1** (composer only). Verified first: the triage's "M"
  assumed two halves were missing; only one is — the TipTap image node (`allowBase64`) is
  configured and `emailBuilder.extractInlineImages` already turns a data-URL `<img>` into a
  `multipart/related` CID part; what nothing handled was an image *file* on the clipboard
  (ProseMirror's default paste is text/HTML). **Change:** a pure `pasteImage.ts` boundary —
  the image file wins over accompanying text; only `image/png|jpeg|gif|webp` (SVG refused:
  it can carry script); 5 MiB cap; the `data:` URL built from the file's own bytes and
  checked for its declared type — and an `editorProps.handlePaste` that inserts the image
  node at the cursor or shows the refusal for five seconds in the composer's existing
  status line; text/HTML pastes fall through unchanged, dropped files still go to
  attachments by design. TDD: ten helper cases (null for text-only, PNG picked, file over
  text, each admitted type, SVG/BMP refused with the reason, cap boundary, `files` fallback,
  data-URL read) and a builder test pinning that a data-URL `<img>` ships as a CID part with
  no data URL left in the HTML. Help card updated. Spec
  `docs/briefs/2026-09-03-281-paste-inline-images.md`, committed before the code.
  Gates: 171 files / 2,219 tests, tsc, graph, docs. One review leg (Tier 1): Gemini 3.7.
- **2026-09-03 — PR #69 (#281) review, one leg (Tier 1).** Gemini 3.7 Flash: APPROVE WITH
  NITS (1M 2L 1N). **Adopted all four:** M1 — the refusal notice reused the composer's
  `saveError` line, which the 3 s draft auto-save clears on success and a real save error
  owns: now a dedicated transient notice with its own five-second timer, and the save
  error is never touched; L2 — the async insert after the read now checks
  `view.isDestroyed` (composer closed mid-read) before dispatching; L3 — the declared type
  is matched case-insensitively (`image/PNG` happens) **and the first bytes are sniffed**
  against the type's magic numbers (PNG/JPEG/GIF/WebP), so a payload labelled `image/png`
  that is really SVG or HTML is refused before it can become a `cid:` part — defence in
  depth, since `<img>` executes nothing; the URL's type is normalised to lower case so the
  extractor's `Content-Type` is canonical; N4 — tests for a non-image file (falls through
  as `null`, not a refusal), an upper-case type, spoofed bytes, each type's magic, and empty
  or truncated files. jsdom's `Blob` has no `arrayBuffer()`, so the head is read through
  `FileReader` like the body. **Questions answered:** a non-image file falls through to the
  default paste on purpose (attachments have their own button and drop path); Velo has no
  toast system — hence the local notice. Raw output in
  `docs/reviews/2026-09-03-pr69-gemini-raw.md`.
- **2026-09-03 — F-3 / P19 built (phishing interstitial and banner wired)** on Jim's
  instruction and decision 5, **Tier 1** (email components, the link seam, a pure detector
  helper; no Rust, CSP, capability or dependency). Verified first: every anchor click already
  funnels through `openEmailLink` (F-2), while `LinkConfirmDialog`, `PhishingBanner` and
  `scanMessageLinks` had no caller — the help page promised a confirmation on *every* click
  and `SECURITY.md` said the feature was not surfaced. **Decisions:** the gate analyses the
  exact `href` the DOM resolved with the detector's own `analyzeLink` (plain-text linkified
  anchors included) and asks only when the score crosses the *same* per-sensitivity line the
  banner uses (`linkNeedsConfirmation`, 60/40/20) — not on every click; detection-off and an
  allowlisted sender open directly; a setting or allowlist read that fails **fails closed**
  (gate on, sender unknown); in-page anchors keep F-2's silent no-op and are never analysed
  (`isOpenableHref` extracted from the seam). The banner is wired too, because the scan
  result exists once the gate reads the same settings and audit P19's acceptance names it —
  Jim can strike it. "Trust this sender" allowlists and hides. TDD: `linkGuard.test.ts`
  (thresholds, fixtures pinned against the detector's rule scores, sensitivity moves the
  line, disabled, allowlisted, no-context, fail-closed), renderer click tests (flagged →
  dialog and no opener; Go Back / Open Anyway; safe → opens; `#top` never analysed), banner
  tests (shown, clean, trust, scan error). Two F-2 click tests now `waitFor` the opener,
  since the gate awaits its settings first. Help card and `SECURITY.md` rewritten to what is
  true. Spec `docs/briefs/2026-09-03-f3-link-confirm.md`, committed before the code.
  One review leg (Tier 1): Gemini 3.7.
- **2026-09-03 — PR #71 (F-3) review, one leg (Tier 1).** Gemini 3.7 Flash: CHANGES
  REQUESTED (1H 2M 3L 1N). **Adopted:** H1 — the gate's promise had no `.catch`, so a
  detector exception would have left a dead click; now a visible notice with a Copy-link
  action and **no open** (a security gate fails closed, and a dead click is also a failure);
  M2 — a dialog left open survived a message change and "Open Anyway" would have opened the
  previous message's URL: cleared whenever the message changes (test); M3 — `mailto:`/`tel:`
  reached the detector: only web schemes are analysed (`isWebHref`), the rest go straight
  to the seam (test); L4 — a middle click (`auxclick`) routes through the same gate (test);
  L5 — a collapsed message is not scanned until expanded (a 50-message thread must not fire
  50 scans; test); N7 — tests for the rejection path, `mailto:`, the message change, the
  middle click. **Declined, documented:** L6 — the banner fires on a *message* (max score
  OR suspicious-link count), the dialog on a *link* (score only), so three 30-point links
  show a banner and no dialog. Intentional: the count rule is a message-level smell, and a
  dialog on a link the detector rates below the line would nag; recorded in the spec. **Questions
  recorded for follow-up:** disable "Trust this sender" when SPF/DKIM failed (a spoofed
  `From:` could allowlist a real address); a trust from one message should dismiss sibling
  banners in the thread. Raw output in `docs/reviews/2026-09-03-pr71-gemini-raw.md`.
- **2026-09-03 — E2 part 3 built (SPEC-E2-3, PR #73), Tier 2**, on Jim's roadmap
  instruction and "go". Plan (`docs/briefs/2026-09-03-e2-part3-pool-carry.md`, threat pass
  and rollback) committed and the PR opened **before any code**. **What the re-grep found
  beyond the carry list:** (1) the carry item said a bump could evict a session opened on
  the new credential (one wasted login) — the other interleaving is worse: a bump landing
  during `imap_session_open`'s one round trip inserts an entry tagged with the *retired*
  generation, authenticated with whichever credential the frontend had, and it survives
  until the next bump or reap; (2) `imap_session_close` and `imap_sessions_invalidate`
  awaited an **unbounded** LOGOUT while the reaper and exit hook bounded theirs; (3) the
  cap's victim and a clean release into a vanished entry were dropped without LOGOUT, and
  so was a fresh session refused by `TooManySessions`. **Decisions:** the pool owns
  `Option<S>` (no `Arc`, no async mutex) and moves the session into the guard and back;
  every path that removes a *clean* session from the map returns it to the caller —
  `insert` returns the cap's victim, `release_ok` returns an orphan, refusals hand the
  session back with the error (`Result<Option<S>, (PoolError, S)>`); one `logout(session)`
  helper, 3 s budget, replaces `logout_arc`; `with_pooled_session` hands the operation
  `&mut ImapSession` through a `BoxFuture` (one allocation per command, nothing beside the
  round trip), guard still held across the await; **`StaleCredential`** is a new pool error
  and `velo:pool:StaleCredential` sentinel — `insert` refuses any generation that is not
  current, the open LOGOUTs the refused session, the frontend rebuilds the config and opens
  once more; `bump_credential_version` filters `< next` explicitly; the frontend waits for
  its own pending invalidation before opening; Rust emits `velo-imap-sessions-invalidated`
  `{username, host}` after evicting and each window's session manager forgets matching
  ids (listener registered lazily on first `withSession`, because pop-outs mount their own
  roots); session ids are refused before the map unless exactly 32 lowercase hex. **Kept
  as designed:** error / panic / cancellation still drop the socket without LOGOUT (module
  doc says why). **Live halves:** Done-when 9 and 10 are `#[ignore]` tests against the
  Dovecot harness (`mod live_tests`, README section); **Docker is down on this machine, so
  they compile but were not run** — recorded, not claimed. Done-when 2 stays manual. TDD:
  pool tests 19 → 31 plus 2 in `commands.rs` (Rust 159 → 171, 3 ignored); nine
  `sessionManager` tests, seven of which were run against the committed module first and
  failed there. `poolBoundary.test.ts` unchanged in substance (one mock line for the event
  plugin). Gates: 172 files / 2,258 tests, tsc, clippy, graph, docs. **Process note:** the
  format-on-save hook runs `rustfmt` on any `.rs` file edited, and the crate is not
  rustfmt-clean — a stray `cargo fmt` reformatted twelve untouched files, which were
  restored, and `commands.rs` was rebuilt from the committed file by script so the reviewer
  diff carries only the change. No dependency, no capability, no schema.
- **2026-09-03 — PR #73 (E2 part 3) review, first leg (Tier 2).** Gemini 3.7 Flash via
  `agy`, diff `5ae7a7c..6d4b49a`: CHANGES REQUESTED (1H 1M 2L 1N); its own threat matrix
  passed ownership, cancellation, the `StaleCredential` interleaving, the once-only reopen,
  the id validator and the event payload. **Adopted, all five.** H1 —
  `invalidateAccountCredentials` returned early when this window had never opened a session
  for the account, so a password change made in the Settings window before its first sync
  never reached the pool and the sessions other windows held kept the revoked credential.
  **Pre-existing since #39** (the old test even asserted the early return) but squarely
  inside REQ-2's guarantee: the identity now comes from the account record through a new
  `imapIdentityOf(account)` in `imapConfigBuilder.ts`, which `buildImapConfig` uses too so
  the two cannot drift; no token refresh, no password; an account that no longer exists is
  the only no-op (two tests replace the old one). M2 — a rejected `listen` left the
  once-flag set, locking the window out of cross-window invalidation for its lifetime: the
  flag is reset in the `.catch` (test through a fresh module instance). L3 — the refused
  session's LOGOUT in `imap_session_open` is spawned, not awaited, because the frontend is
  waiting on that error to reopen. L4 — `imap_sessions_invalidate` LOGOUTs the evicted
  sessions concurrently (`join_all`), as at exit, so two slow servers cost one budget before
  the other windows hear about it. N5 — the `Drop` comment named the wrong path. Raw output
  in `docs/reviews/2026-09-03-pr73-gemini-raw.md`.
- **2026-09-03 — PR #73 (E2 part 3) review, second leg (Tier 2).** Grok 4.6 via the `grok`
  CLI on the same diff `5ae7a7c..6d4b49a` (~14 minutes): CHANGES REQUESTED (1H 1M 6L 2N).
  Its ownership, cancellation, HRTB, first-open and once-only-retry checks passed. Two
  findings duplicated Gemini's (M2 = Gemini H1, L3 = Gemini M2 plus "await the listener
  before the first open", which was adopted on top). **Adopted:** **H1 — the dual race.**
  A config built before another window's bump whose Rust command *starts after* it reads
  the current generation, connects with the retired credential (an access token that still
  logs in, in the OAuth-revocation case), and `insert` accepts it — `StaleCredential` can
  only see a generation that moved *during* the command. Real, and the mirror of the
  interleaving the build had closed. Closed on the frontend: a per-account invalidation
  epoch, bumped by this window's own invalidation and by another window's event; the open
  snapshots it before building the config, and if it moved when Rust answers, the id is
  closed (Rust LOGOUTs it) and the open retried once with a rebuilt config; the identity
  is recorded *before* the open so a first-ever open can be matched to the event; the
  broadcast now carries the caller's nonce (bounded at 64 chars) so the invalidating
  window ignores its own echo instead of reopening for nothing. L4 — the event is emitted
  right after the bump, before the LOGOUTs, and a failed broadcast is logged. L6 — `insert`
  shape-checks the id in every build and refuses an id already in the map (`BadId`, a new
  pool error) rather than overwriting the sitting session inside the lock. L7 — the
  listener drops a payload that is not `{username, host, nonce}` strings. N9 — the wait on a
  pending invalidation is bounded at 8 s. N10 — the live folder-isolation test reads *back*
  from A after B (own marker per folder; UID list unchanged). **Recorded as accepted
  residuals in the spec's threat pass, not changed:** L5 — spawned LOGOUTs are best-effort
  and outside the exit drain (a join set for three rare paths is not worth the machinery;
  documented on `spawn_logout`); L8 — an in-flight operation completes against a socket
  the invalidation meant to kill, then the orphan is logged out; the alternative Grok
  offered, failing `release_ok` after a bump, would report a completed server-side side
  effect as a failure and was **declined**; L7's second half — any renderer can emit the
  event, which is a cache-drop DoS bounded by the cap, not an authz bypass. Raw output in
  `docs/reviews/2026-09-03-pr73-grok-raw.md`. **Independent samples, again:** Gemini found
  the listener lock-out and the sequential LOGOUTs; Grok found the dual race, the overwrite
  and the test's missing half; neither found the other's.
- **2026-09-03 — PR #73 (E2 part 3) review, third leg on the follow-up delta only
  (Tier 2).** Gemini 3.8 Flash High via `agy` on `6d4b49a..b10d912` — the epoch and nonce
  logic was new code no reviewer had seen: CHANGES REQUESTED (2H 2M 2L 1N). **All seven
  adopted.** H1 — the retry reused the `DbAccount` row read before the open, and a
  password-based account carries its credential *in that row*, so the "rebuilt" config on a
  retry rebuilt the retired password: each attempt now re-reads the row. H2 — the identity
  was recorded after `await buildImapConfigWithFreshToken`, which can refresh a token over
  the network, so an event landing during the build on a window's first open was unmatched
  and the epoch never moved: the identity is now recorded first and synchronously (from
  `imapIdentityOf`, which does not depend on the credential), then the epoch snapshot, then
  the row re-read — an event before the snapshot is in the snapshot and ahead of the read,
  an event after it is caught by the compare. M3 — two local accounts on one IMAP identity:
  Rust evicts by identity, so a local invalidation now forgets and bumps every matching
  local account (`forgetIdentity`, shared with the event handler). M4 — after the 8 s wait
  gave up, the stalled invalidation's late echo carried this window's own nonce and was
  skipped, leaving a dead id cached (one `NoSuchSession`, self-healing): on timeout the
  nonce stops counting as own. L5 — an account without an IMAP host made `imapIdentityOf`
  throw out of `invalidateAccountCredentials`; guarded (only IMAP accounts call it today).
  L6 — a rejected invalidate left its nonce in the own-set forever; removed on rejection.
  N7 — the in-flight test resolved the config build synchronously and so could not have
  seen H2; a test with the build held open now does. **Jim, mid-review: the Gemini leg is
  3.8 Flash High from here on**, not 3.7 — recorded in memory; the final full-diff pass on
  this PR runs on it. Raw output in `docs/reviews/2026-09-03-pr73-gemini38-delta-raw.md`.
- **2026-09-03 — PR #73 (E2 part 3) review, fourth pass: the whole diff at `3dda5d6`
  on Gemini 3.8 Flash High.** CHANGES REQUESTED (1H 2M 1L 1N). **Declined, with the
  reason verified:** H1 claimed `Instant::duration_since` in `reap` panics when a worker
  stamps `last_used` between the `Instant::now()` and the lock — it has been saturating,
  not panicking, since Rust 1.60 (the crate's MSRV is 1.89, CI-checked), and the line is
  #37's, untouched by this PR. **Adopted:** M2 — the retry carried the account snapshot,
  not the re-read row, and re-stamped the identity from the snapshot: the row is now the
  truth for the identity and is what the retry carries. M3 — pending invalidations were
  keyed by account id while Rust evicts by identity, so a sibling account on the same
  username and host did not wait and could cache an id the bump had just evicted (dead,
  not stale — one `NoSuchSession`): keyed by identity now, and the open looks up by the
  account's identity (test). L4 — the Rust doc comment still said the event fires "once the
  LOGOUTs are done" (stale since Grok L4); corrected, and the frontend's timeout comment now
  says plainly that a late echo can only come from a command that has not run yet. N5 —
  hostnames are case-insensitive (RFC 4343) and the pool keys on the string:
  `imapIdentityOf` lower-cases the host, which flows into the config too, so Rust sees one
  spelling. Raw output in `docs/reviews/2026-09-03-pr73-gemini38-final-raw.md`. Four passes
  on this PR; the reviewers stopped finding new interleavings at the identity edge cases,
  which is where a fifth pass would look.
- **2026-09-03 — P11 built (SPEC-P11, PR #75), Tier 2**, on Jim's roadmap instruction. Plan
  (`docs/briefs/2026-09-01-batch-g-p11-capabilities.md`, rewritten from the 2026-09-01 draft
  and re-grepped at `2d764a9`, threat pass and rollback) committed and the PR opened **before
  any code**. **What the re-grep changed:** the draft said only `App.tsx` opens pop-outs;
  `ThreadView` and `Composer` both call `new WebviewWindow` and both render inside the pop-out
  roots, so dropping `core:webview:allow-create-webview-window` from content windows needed
  the two "Open in new window" buttons hidden inside a pop-out (where the thread's is a no-op
  on itself and the composer's would spawn a copy and close itself). Everything else on the
  draft's removal list was confirmed main-only by import (window controls in `TitleBar`,
  badge, notifications, autostart, shortcuts, deep-link, updater, process, `os`,
  `fs:remove`); the splash page runs no script. **Decisions:** two files — `main.json` byte for
  byte today's grant, `content.json` for `thread-*`/`compose-*` (`core:default`, `sql` with
  execute, `opener`, `dialog`, `fs` under `$APPDATA`, `http` with the identical scope); no
  file for `splashscreen`; one `windowKindFromSearch` rule shared by `main.tsx` and the two
  button gates. **Kept, with reasons:** `sql:allow-execute` (migrations, draft auto-save) and
  `http` (unsubscribe POST, Ollama) — the next narrowing is unsubscribe → Rust and Ollama →
  `ai_fetch`, own brief. **Not done, by design:** routing window creation through a Rust
  command (would let `main` drop webview creation too — own brief); the iframe sandbox (P9).
  **Trade named for Jim:** popping the reply composer out of a thread pop-out is no longer
  offered. **Jim's five-step manual QA is open, not done** — the draft gated the merge on it;
  the 2026-09-03 roadmap instruction says merge on green and record it as open (the fork
  ships nothing, EX-007, so the blast radius is a dev build on this machine). TDD:
  `capabilities.test.ts` rewritten (partition, subset, forbidden by id and plugin prefix,
  required, identical `http` scope in both files with the SPEC-280 assertions run against
  both, `main` equal to a literal snapshot) and `windowKind.test.ts`, both red before the
  files existed; `cargo check --locked` regenerated `gen/schemas/capabilities.json` with the
  two grants (tauri-build validates identifiers). No dependency, no schema, CSP untouched.
- **2026-09-03 — PR #75 (P11) review, first leg (Tier 2).** Gemini 3.8 Flash High via `agy`,
  diff `2d764a9..40153dd`: CHANGES REQUESTED (2H 3M 1L 1N). **Declined, each verified
  against the tree:** H1 — the `http` scope in content windows (`http://*`, loopback on any
  port) is the residual the spec records, with the follow-up named (unsubscribe → Rust,
  Ollama → `ai_fetch`); the any-loopback-port shape is Jim's #280 decision and the reviewer's
  narrowing to 11434 would break LM Studio users. H2 — "`fs:scope` limited to `$APPDATA`
  breaks saving attachments to Downloads": the scope is **identical to today's**, and saving
  works today because the dialog plugin extends the fs scope to the picked path
  (`tauri-plugin-dialog-2.7.3/src/commands.rs:195`, `allow_file`); no regression by
  construction. M4 — "`core:window:allow-close` breaks the compose window's close button":
  `closeComposer` only resets store state; nothing reachable from a pop-out calls
  `getCurrentWindow().close()` (grepped) — the pre-existing behaviour is unchanged. M5's
  first half — the identical `http` scope in both files is asserted on purpose until the
  follow-up lands. **Adopted:** M3 — the pop-out gate keyed on the query string while the
  grant is keyed on the window label; `isPopoutWindow()` now reads the label from Tauri's
  metadata first and falls back to the URL rule outside Tauri (dev server, tests); `main.tsx`
  still routes by URL as before (tests for both). M5's second half — a literal
  `CONTENT_PERMISSIONS` snapshot, so nothing can be added to content without a test going
  red. L6 — the two handlers guard themselves as well as hiding their buttons. N7 —
  `opener:default` carried `reveal-item-in-dir`; content now holds `opener:allow-open-url`
  and `opener:allow-default-urls` only (the subset test expands main's `opener:default`
  from the ACL manifest so the narrowing still reads as a subset). Raw output in
  `docs/reviews/2026-09-03-pr75-gemini38-raw.md`.
- **2026-09-03 — PR #75 (P11) review, second leg (Tier 2).** Grok 4.6 via the `grok` CLI on
  the same diff `2d764a9..40153dd` (~25 minutes): CHANGES REQUESTED (2H 3M 2L 3N). **Adopted:**
  **H1 — the content grant's `$APPDATA/**` read/write reached `velo.key` and the database
  file**; the grant is now path-level: the key is `exists` + `read-text-file` only (a pop-out
  decrypts credentials in the page and never creates the key — `crypto.ts` does that on the
  first-run branch `main` takes), the attachment cache is the only write root, `.eml` export
  writes to a dialog-picked path through the runtime scope, `fs:default` (recursive read of
  the app directories) and the blanket `fs:scope` are gone; tests pin the write roots and the
  two key permissions. H2 — the same label-vs-URL finding as Gemini M3, adopted further: the
  root in `main.tsx` is picked by the same label-first call as the gate. L7 — `dialog:default`
  → `allow-save` (only `save` is called from a pop-out); `sql:default` → explicit
  load/select/execute; `core:default` → `core:path:default` + event listen/unlisten and **no
  emit** (`main` listens for `single-instance-args` and opens a composer on it — a pop-out
  must not be able to send it) and no menu/tray/app/image/resources/window/webview sets.
  M4's wording — the identical `http` scope is asserted as a **residual**, named as such in
  the test and the file description, not as a requirement. M5 — a source scan pins that
  `new WebviewWindow` appears in exactly the three known files and that the two
  pop-out-reachable creators and `main.tsx` use the one rule. N — the composer comment now
  says which path is given up (reply-composer pop-out from a thread pop-out); the splash
  window's static URL is stated in the spec. **Declined, each verified:** M3 — "window
  controls needed / windows bricked": `lib.rs:344` strips decorations from `main` only,
  pop-outs are created with native decorations, and nothing reachable from a pop-out calls
  `getCurrentWindow()`; M4's second half — `opener:allow-default-urls` *is* a scheme allow
  list (`mailto`, `tel`, `http`, `https` — from the manifest), so `file://` and custom
  schemes are refused; L6's `window.open` — no email markup reaches `window.open`
  (scripts are sanitised out, anchors are intercepted by F-2's `openEmailLink`); L7's
  "skip migrations in pop-outs" — idempotent and the same binary, not worth a behaviour
  change; N `?thread=&account=` — pre-existing, and moot inside Tauri now that the label
  decides. Raw output in `docs/reviews/2026-09-03-pr75-grok-raw.md`.
- **2026-09-03 — PR #75 (P11) review, third leg on the follow-up delta (Tier 2).** Gemini 3.8
  Flash High on `40153dd..46f874d` (the label gate was new logic): CHANGES REQUESTED (1H 2M 1L
  1N). **Adopted:** H1 — `main.tsx` still routed by URL while the gate keyed on the label;
  one `currentWindowKind()` now serves both (as Grok H2). M2 — the label is read through the
  public `getCurrentWindow()` (synchronous; throws outside Tauri, caught), not by reaching
  into `__TAURI_INTERNALS__`. M3 — the expansion table is checked against the generated ACL
  manifest whenever a local build has produced it (`it.skipIf` in CI, where `gen/` does not
  exist), scoped entries are compared by path and URL against main's scope, and the `.length`
  assertion is replaced by a strict-difference check. N5 — tests for main-inside-Tauri and
  malformed metadata. **Declined:** L4 — `revealItemInDir` has no caller in the tree
  (grepped). Raw output in `docs/reviews/2026-09-03-pr75-gemini38-delta-raw.md`.
- **2026-09-03 — PR #75 (P11) review, fourth pass: the whole diff at `df71117` on Gemini
  3.8 Flash High.** CHANGES REQUESTED (3H 2M 2L 1N). **Declined, each verified against
  source:** H1 — "the dialog plugin does not extend the fs scope, so saving to a picked path
  is denied": it does — `tauri-plugin-dialog-2.7.3/src/commands.rs:194-198` (the `save`
  command calls `allow_file` on the window's fs scope) and `tauri-plugin-fs/src/commands.rs:1564`
  ORs that runtime scope with the permission's own; today's `$APPDATA`-only grant saves to
  Downloads by exactly this path. H2 — "`ContextMenuPortal` creates windows from inside a
  pop-out": it is rendered by `App.tsx` only (grepped); adopted anyway as a one-line guard so
  every creator site sits under the same rule, and the source scan now asserts all three.
  H3 — `sql:allow-execute` in content windows: the recorded residual (draft auto-save and the
  sent copy write from a pop-out; moving them behind Rust commands is its own brief). L6 —
  the manifest check skipping in CI: the frontend job has no `cargo`, and the check ran and
  passed locally at this SHA; committing a copy of the manifest would be a second source of
  truth. N8 — event snooping through `allow-listen`: main's emits are `tray-check-mail` (no
  payload), `single-instance-args` (argv, a `mailto:` at most) and the session-invalidation
  identity (username, host) — no token or secret rides an event; recorded. **Adopted:** M4 —
  `pathSubsumed` refuses a `.` or `..` segment outright (a literal entry that needs
  normalising is wrong); M5 — an unscoped write permission in content must be on an explicit
  list (`fs:allow-write-text-file`, the dialog-picked `.eml` export) and every other write must
  name its paths; L7 — a label that is neither `main` nor a pop-out glob is `"unknown"`, not
  `"main"`: the gate fails closed (no button that needs main's grant) and `main.tsx` warns
  before rendering the main root, which then fails loudly on its first plugin call. Raw output
  in `docs/reviews/2026-09-03-pr75-gemini38-final-raw.md`. Four passes; no fifth — the last
  round's real findings were test-tightening, and its HIGHs were re-litigations of verified
  facts.
- **2026-09-03 — PR D and PR E plans written (SPEC-PR-D #77, SPEC-PR-E #78), plans only,
  for Jim's approval; no dependency, lockfile or source change.** On Jim's roadmap
  instruction. Evidence gathered without touching the repo: TypeScript 6.0.3 and 7.0.2 run
  from the npx cache against today's tsconfig (one and two errors, all `baseUrl`; zero after
  the one-line fix); a throwaway copy of `src-tauri` with the four crate bumps (`mail-parser`
  0.11.8 breaks exactly three lines, its `usize → u32`; `async-imap` 0.11.3, `reqwest` 0.13.4
  and `socket2` 0.6 compile unchanged; crate count 374 → 374, `hashify` the one new crate;
  `cargo audit` clean beyond today's allowed warnings); a throwaway copy of the project with
  TypeScript 7 + Vite 8 + plugin-react 6 installed (tsc 0, build 0 with both pages and zero
  inline scripts, vitest 2,298 passed, lockfile 355 → 316, native packages 76 → 72, no
  `@types/node`, no new install script). **Corrections to the vault audit, recorded in the
  specs:** the reqwest duplicate stays (`tauri-plugin-http` 2.6.0 pins 0.12); `base64` is not
  collapsible by Velo alone; `mail-parser` 0.11's default feature set is empty, so
  `full_encoding` is a behaviour cliff; `async-imap` 0.11.2's quoting change is COPY/LIST
  (SELECT was already quoted), and reqwest 0.13's `native-tls` now carries ALPN — today's
  handshake is `native-tls-no-alpn`.
- **2026-09-03 — PR #77 (PR D plan) review, two legs.** Gemini 3.8 Flash High: CHANGES
  REQUESTED (4H 4M 2L 1N); Grok 4.6: CHANGES REQUESTED (7H 5M 2L 1N). **Adopted:** the
  `baseUrl` fix as its own commit on 5.9.3 (bisect; Gemini M6); the legal revert sets and a
  **rebase merge** instead of squash — commits 1 and 2 stack under TypeScript 7, and a
  squash leaves no per-commit revert (Grok H1); a **throwaway build of the whole stack**
  before approval, which Grok H3/H7 asked for and which is now §5 of the spec; the browser
  floor **pinned to Vite 7's** (`build.target`/`cssTarget`), lifting it a named decision for
  Jim with the webview minimums (Gemini M8, Grok H4); a **production-bundle smoke** via
  `tauri build --debug` before commit 4 merges — the dev server never runs Rolldown or the
  minifiers (Gemini H1, Grok H5); an automated `dist` check (Gemini L9, Grok H5); `npm audit
  signatures` in CI from commit 1 (Gemini H4 — the house gate list names it; Tier 1 wiring,
  approved with the plan); caches cleared on rollback (Gemini H3, Grok M10); REQ-1.4/1.5
  carved out for the measured transitive changes (Grok M11, L14); the native-binary
  publishers and attestation status written into the threat pass as a trust decision, with
  the blast radius stated as build-time execution plus altered shipped JS/CSS (Grok H6);
  `noEmit` quoted (Grok H2); `showConfig` compared (Grok M8); speed demoted to an observation
  (Grok L13); wording (Gemini L10, N11). **Declined, each verified:** Gemini H2 — "npm cannot
  filter platform binaries listed under both `dependencies` and `optionalDependencies`":
  npm's documented rule is that the optional entry overrides, and this lockfile already
  carries 51 `@esbuild/*`/`@rollup/rollup-*` platform packages that way with Linux CI green
  since PR A; Gemini M5 — dropped React dedupe: measured, one copy and every hook test green
  under plugin-react 6; Gemini M7 / Grok H2's emit half — `tsconfig.json:12` sets `noEmit`,
  and a misspelled `rolldownOptions` is caught by the page-emission check (the throwaway
  build shows the rename took); Grok M9 — CI runs `tsc`, `vitest` and the build
  (`ci.yml:40-47`); Grok M12 — no bundler-owned source patterns in `src/` (grepped) and the
  suite plus REQ-2.3 cover CJS interop. Raw outputs in
  `docs/reviews/2026-09-03-pr77-plan-d-{gemini38,grok}-raw.md`.
- **2026-09-03 — PR #78 (PR E plan) review, two legs.** Gemini 3.8 Flash High: CHANGES
  REQUESTED (3H 4M 2L 1N); Grok 4.6: CHANGES REQUESTED (6H 8M 5L 3N). **Adopted:** reqwest
  **feature unification** with the updater plugin's rustls, confirmed in the scratch feature
  tree, answered by `.use_native_tls()` on the three builders and a feature-tree gate in place
  of the naive `cargo tree -i rustls` (Gemini H1, Grok H1); **`native-tls-no-alpn`** so the
  OAuth handshake is byte-identical to today's — 0.12's `native-tls` had no ALPN, 0.13's does
  (Grok H2); **exact `=` pins** and `default-features = false` on `mail-parser` with the
  manifest quoted and a fail-closed proof step (Grok H6, M-version-path); **invariant versus
  hardening fixtures**, covering every persisted field — addresses, threading headers, Date,
  Content-ID, charsets, sections — with the 0.11.x panic cases as disposition fixtures
  (Gemini M5, M6; Grok H3, M-corpus); the `u32` fix as a boundary conversion with unchanged
  signatures (Gemini M4, Grok M-map); **five commits, one crate each, landed by rebase merge**
  (Gemini L8, Grok M-commits); the async-imap **source diffstat** (8 files, +498/−243) and
  the LOGIN change named, with a **duplex-stream wire test in CI** capturing LOGIN, SELECT,
  UID COPY, UID MOVE, CREATE and LIST bytes (Grok H4, M-diff); a mock-server test pinning the
  token request's form body (Grok M-oauth); what the parser persists and why a revert is safe
  (Gemini H2, Grok M-rollback); a STRIDE block (Gemini L9); `hashify` named as the one pre-1.0
  transitive addition Jim's approval covers, with correlated-trust stated as colour not
  control (Gemini N10, Grok H5, L-provenance); MSRV wording (Grok M-MSRV); per-commit
  `--all-targets` checks and the scratch check's limits stated (Grok M-scratch); the parse
  size cap as a pre-existing residual (Grok M-blast); the live-harness merge gate as **Jim's
  decision** on the plan — the standing instruction records manual checks as open, both
  reviewers asked for a blocking gate (Gemini H3, Grok H2). **Declined, each verified against
  source:** Gemini H1's mechanism — reqwest 0.13 picks native-tls whenever `__native-tls` is
  compiled (`tls.rs:621-635`), so no silent switch; Gemini M7 / Grok H4's premise — 0.10.4
  already quotes SELECT/MOVE/CREATE/DELETE/STATUS/APPEND through the same `quote!` macro
  (`client.rs:1476`); 0.11.2 added COPY and LIST, and LIST names arrive decoded from
  `async-imap`'s `Name`, never pre-quoted. Raw outputs in
  `docs/reviews/2026-09-03-pr78-plan-e-{gemini38,grok}-raw.md`. **Both plans stop here: no
  code until Jim approves each.**
- **2026-09-03 — SPEC-AR (Auto Reminders on external sends) built, PR #80, Tier 1.**
  Enhancement wave 1 item 1 (`docs/ROADMAP.md` §4), brief at
  `docs/briefs/2026-09-03-auto-reminders.md` committed before code. A pure module
  `src/services/followup/autoReminders.ts` holds the rule (recipient domain differs from the
  sender's and is not an own address or alias), the due-time math (+N days at 09:00 local,
  Saturday → Monday, Sunday → Monday), the effective decision (override wins, else rule),
  the day-choice normaliser (1/2/3/7, default 3) and `scheduleAutoReminder`, which never
  overwrites an existing reminder (`existing`), warns and sets nothing without a thread id
  (`no-thread`) and reports insert failures (`failed`) without touching the send outcome.
  Tests first (22 cases, red then green). REQ-5: `EmailProvider.sendMessage` now returns
  `{ id, threadId? }` — Gmail from the API response, IMAP from the thread the Sent copy was
  saved under (the reply's thread, or the new message's own id), with provider tests
  asserting both. Composer: "Remind me if no reply in N days" checkbox in the footer, shown
  only when the setting is on, defaulting to the external rule; the decision is taken at
  Send from what the user saw and the reminder is set after a successful send with a message
  id (a queued offline send has none, so nothing is set). Settings → Sending: "Auto
  reminders on external sends" toggle and a "Remind after" select; both persisted
  (`auto_reminders_enabled`, `auto_reminders_days`) and restored at boot. Help entry
  extended. Not done, per the brief: auto-drafts, scheduled-send reminders, a Reminders tab,
  domain allow-lists, checker changes. Gates run here: `tsc` clean, vitest 174 files /
  2321 tests green, `graph:check` and `docs:check` green (test-file counts bumped 173 → 174,
  services 95 → 96). CI is the source of the pass bit. No dependency added.
- **2026-09-03 — PR #80 (SPEC-AR) review, two legs.** Gemini 3.8 Flash High: CHANGES
  REQUESTED (2H 3M 2L 2N); Grok 4.6: CHANGES REQUESTED (1H 2M 3L 3N). **Adopted, each verified
  against source:** the domain rule now compares the **bare address** — reply-all prefills the
  recipient chips straight from the raw To/Cc headers (`ThreadView.tsx` splits
  `to_addresses` on commas), so a chip can read `"Alice" <alice@acme.com>` and the old
  `lastIndexOf("@")` slice returned `acme.com>` (Gemini H1, Grok M1; four new cases plus the
  empty-domain `foo@  `); the **delay is frozen at Send**, not read when the undo timer fires
  (Gemini M1); hours are set after every date move in `autoReminderDueAt`, with a DST case
  asserted (Gemini M2); `setAutoRemindersDays` normalises before state or disk (Gemini L2, Grok
  L3); a **warn** when the user wanted a reminder but the send failed or was queued offline
  with no message id (Grok M2, the REQ-1.4 half); the help tip names the setting instead of
  "3 days" (Grok L1); an IMAP test for the local save throwing — a reply still reports the
  input thread, a new message none (Grok's missing test). **Declined, each verified:** Gemini
  H2 / Grok H1 "the existing-reminder guard skips on cancelled or triggered rows" —
  `getFollowUpForThread` is `… AND status = 'pending' LIMIT 1` (`followUpReminders.ts:45`), so
  only a pending row is ever returned; Gemini M3 plus-addressing of own aliases — outside the
  brief's address rule, noted for a later pass; Gemini L1 boot write-back — the same pattern as
  the `send_and_archive` restore (`App.tsx:256-259`), one write at boot; Grok L2 "dead catch" —
  the lookup can throw, only the insert is caught inside the scheduler. **Follow-up recorded,
  not built:** Grok M2's other half — a queued offline send goes out later from the queue
  processor with no reminder; the brief scoped reminders to immediate sends, so this is Jim's
  call (same hook as the scheduled-send non-goal). Raw outputs in
  `docs/reviews/2026-09-03-pr80-auto-reminders-{gemini38,grok}-raw.md`. Fix commits `ab0ec19`
  and the Grok fix on the same branch; suite 174 files / 2,326 tests.
- **2026-09-03 — PR #80 fix-delta pass (Gemini 3.8 Flash High on `865d732..00759c7`).**
  CHANGES REQUESTED (2H 2M 1L 1N). **Adopted:** a stray `<`/`>` in a typed chip is dropped
  rather than read into the domain (H2's real part); the DST case moved onto the transition
  Sunday so the weekend roll runs across it (N1); the alias case now uses an own address on
  another domain, proving the exemption rather than same-domain (its "wrong thing" note).
  **Declined, each verified:** H1 "undefined thread id reaches the query" —
  `scheduleAutoReminder` warns and returns `no-thread` before any lookup
  (`autoReminders.ts:113-115`); H2's multi-address chip — `AddressInput` adds one string per
  chip and reply-all splits on commas first; M1 "`mockReset` breaks later tests" — the original
  is a bare `vi.fn()` (`imapSmtpProvider.test.ts:72`), which `mockReset` restores exactly, and
  the suite is green; M2 / L1 — a sender without a domain counting as external, and the warn on
  a failed send, are deliberate and tested. Raw output in
  `docs/reviews/2026-09-03-pr80-auto-reminders-gemini38-delta-raw.md`. Lesson, again: a
  follow-up pass on a fix delta finds real polish (three adopted) but its Highs were both
  wrong this time — verify before adopting.
- **2026-09-03 — SPEC-QSR (Auto Reminders on queued offline sends) built, PR #82, Tier 1.**
  Jim's decision 5 (2026-09-03): "carry the wants-reminder flag and frozen delay on the queued
  op, create the reminder when the queue processor's send succeeds, retire the PR 80 warn for
  that path." Brief `docs/briefs/2026-09-03-queued-send-reminder.md` committed first. The
  `sendMessage` action gains an optional `autoReminderDays` (presence = wanted; the delay
  frozen at Send), which rides in the queued row's JSON `params` with no schema change.
  Reminder creation moves to the action layer — `afterSuccessfulSend` in `emailActions.ts`,
  called after the online provider call and after a successful queued execution — dated from
  the actual send, on the provider's thread falling back to the reply's, through the same
  scheduler as #80; anything the scheduler throws is logged, the send stands. The composer
  passes `{ autoReminderDays }` when it wants a reminder and no longer schedules or warns
  itself. Seven cases in `emailActions.test.ts`, red first. No dependency. Gates here: `tsc`
  clean, full suite green, `graph:check`, `docs:check`.
- **2026-09-03 — PR #82 (SPEC-QSR) review, two legs.** Gemini 3.8 Flash High: APPROVE (2L
  2N); Grok 4.6: APPROVE (2L 3N). **Adopted:** the hook is invoked only for `sendMessage` at
  both call sites (Gemini L1); an empty provider thread id falls back to the reply's (Gemini
  L2, `||`); the hook runs **after** the provider try/catch so a reminder problem can never be
  classified as a provider failure (Grok L1); nine test cases from the two gap lists —
  retryable-failure enqueue carries the wish, provider without a message id warns, a pending
  reminder is never doubled (a re-executed row is safe), the empty-thread fallback, the
  queue's JSON round trip with the stored delay dating the reminder under a fake clock, the
  provider's thread winning, no thread anywhere, a stray field on a non-send action.
  **Declined, verified:** Grok L2 "type the result instead of asserting" —
  `executeViaProvider` returns `unknown` by design (a union of provider results) and a runtime
  shape check is the right thing at that boundary. Both reviewers' double-reminder analysis
  agrees with the brief: the scheduler's pending guard covers a re-executed row; a reminder
  failure after a successful queued send is logged, not retried (Not doing). Raw outputs in
  `docs/reviews/2026-09-03-pr82-queued-send-reminder-{gemini38,grok}-raw.md`.
- **2026-09-03 — PR D built, PR #83, Tier 2, four commits for rebase merge.** Plan
  `docs/briefs/2026-09-03-pr-d-toolchain-majors.md`, approved by Jim 2026-09-03 (decision 2
  of the next-session prompt; Approval line filled in commit 1). Commit 1 `970d2ea`: `baseUrl`
  gone, `"@/*": ["./src/*"]`, `npm audit signatures` in CI's frontend job. Commit 2 `cb2ca45`:
  TypeScript 6.0.3 (lockfile: the one entry). Commit 3 `3260522`: TypeScript 7.0.2, the native
  compiler (lockfile: +20 `@typescript/typescript-*` optional platform packages, nothing else;
  `tsc --noEmit` 3.19 s → 0.40 s). Commit 4 `9c82667`: Vite 8.2.2 + plugin-react 6.1.1,
  `rolldownOptions`, browser floor pinned to Vite 7's (`target`/`cssTarget`),
  `scripts/check-dist.mjs` in the build script (lockfile 375 → 316: esbuild, Rollup and
  Babel out; rolldown, 15 `@rolldown/binding-*`, `@oxc-project/types`, a second `lightningcss`
  in; `esbuild`, `@typescript/typescript6`, `@types/node` absent). Every REQ-2.1 gate green on
  every commit locally and in CI on the exact SHA; suite 174 / 2,341 unchanged; `npm audit`
  0 / 0; signatures 242 verified, 118 attested, none invalid; dist 26 files / 2.21 MB → 51 /
  2.19 MB, `check-dist` green. **One notice recorded as a follow-up, not changed (REQ-1.4):**
  Vite 8 flags `__dirname` in `vite.config.ts` as unsupported by the future
  `configLoader: 'native'` (`import.meta.dirname`). **REQ-2.3:** `npm run tauri build --
  --debug` produced `Velo.app`; the DMG step failed in `bundle_dmg.sh` (not needed for the
  smoke; the release profile is already known not to build here). The smoke on the packaged
  app is recorded in the PR.
- **2026-09-03 — PR #83 (PR D) review, two legs, plus the REQ-2.3 smoke.** Gemini 3.8 Flash
  High: CHANGES REQUESTED (1H 2M 2L 1N); Grok 4.6: APPROVE (1L 2N). **Adopted:** `check-dist`
  inspects whole `<script>` blocks after stripping comments — a block passes only with a
  non-empty `src` (not `data-src`) and an empty body, an unclosed tag fails (Gemini M1, Grok
  N1); a missing or empty page is a failure and every check runs whenever the file exists
  (Grok L1); the brief's threat pass records `npm audit signatures` as network-dependent
  (outage → re-run, never remove) and as running after `npm ci`, so not an install-script
  gate (Gemini L2, Grok N2). **Declined, each verified against source:** Gemini M2 "Vite 7's
  default is `'modules'`" — Vite 7.3.6's shipped code defines
  `ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET = ["chrome107","edge107","firefox104","safari16"]`
  and uses it as the `build.target` default and the Lightning CSS targets (`'modules'` was Vite
  5/6), so the pin keeps the floor where it was; Gemini L1 relative `base` — the default `/`
  is this repo's fixed config; Gemini N1 `__dirname` — REQ-1.4 says commit 4 changes nothing
  else, recorded as a follow-up (Grok agrees); Gemini H1 — a process gate, met: CI green on
  every commit including 4, and the smoke below. **REQ-2.3 done by the agent:** the debug
  bundle (`Velo.app`; the DMG step failed in `bundle_dmg.sh`, not needed) launched on the
  real profile and driven through the accessibility tree — Inbox (23 conversations), a
  thread rendered, Settings/Attachments/Calendar rendered, the composer with the SPEC-AR
  control, and a `compose-*` pop-out window rendering the full composer with its own
  pop-out button correctly absent (P11); discarded empty, quit. Mouse clicks through the
  bridge were unreliable (one landed on a sidebar item); indexed accessibility actions were
  used; nothing archived, deleted or sent. Raw outputs in
  `docs/reviews/2026-09-03-pr83-pr-d-{gemini38,grok}-raw.md`. **Landing:** rebase merge
  (REQ-1.6), six commits — the four planned plus two review-fix commits on `check-dist`
  and the brief.
- **2026-09-03 — PR E built, PR #84, Tier 2, five commits for rebase merge.** Plan
  `docs/briefs/2026-09-03-pr-e-rust-parsers.md`, approved by Jim 2026-09-03 (decision 3;
  Approval line filled in commit 5). Commit 1 `a081246`: the REQ-0 fixture suite in
  `imap/client/parser_fixtures.rs` — 14 invariant and 10 hardening cases pinned from a probe
  of 0.9.4, not from the RFCs. Commit 2 `2bce89d`: `mail-parser =0.11.8`, `default-features =
  false`, `full_encoding`; the three `u32 → usize` boundary conversions; lockfile +`hashify`
  0.2.9. **Named deviation from REQ-1.1:** the `List-Unsubscribe-Post` and
  `Authentication-Results` lookups moved from `HeaderName::Other(..)` to 0.11's known variants
  — 0.11's `HeaderName` equality never matches `Other` against a known name, so the invariant
  suite showed both fields vanishing from every IMAP message. **REQ-3 correction:**
  `full_encoding` gates the multi-byte decoders only (single-byte tables are built in), so a
  Shift_JIS invariant fixture was added and the fail-closed proof measured on it. Hardening
  moves under 0.11: obsolete zone names parsed; stray-`=` quoted-printable decoded leniently.
  Commit 3 `7249a2a`: `async-imap =0.11.3`; `imap/wire_bytes.rs` pins the measured bytes over
  a duplex stream (quoted once, escaped once; `&AOQ-` untouched; LIST `"" *`; CR/LF refused
  before any byte); one new ignored live test (folder with a space through the pool).
  Commit 4 `f8bfc2b`: `socket2 =0.6.5`, one copy. Commit 5 `3d02c7f`: `reqwest =0.13.4` with
  `native-tls-no-alpn` + `json` + `form`; `.use_native_tls()` on the three builders with build
  tests; the mock-server test pins the token request's `Content-Type` and body encoding.
  Gates: every REQ-2.1 gate green locally at every commit (the release-profile check is CI's,
  this Mac's sqlx dylib problem being known); suite 173 → 203 passed, 4 ignored; audit exit 0
  throughout; sqlx single. **Findings recorded, not fixed:** `List-Unsubscribe` is parsed as
  an address list on both parser versions and never persisted on the IMAP path (one-click
  unsubscribe cannot work on IMAP accounts today); a folded `Authentication-Results` of one
  shape keeps its first line on both. **REQ-2.5:** Docker's engine on this machine answers
  `Error reading remote info: EOF` (Docker Desktop lives in a quarantine folder); the harness
  could not be started; the four ignored live tests stay open for Jim under the standing
  instruction.
- **2026-09-03 — PR #84 (PR E) review, two legs.** Gemini 3.8 Flash High: APPROVE (2L 1N);
  Grok 4.6: APPROVE (2L). **Adopted:** the scripted IMAP server ends on the LOGOUT command
  token, not a substring (Gemini L1); the token mock-server test bounds its wait at 10 s
  (Gemini L2); the wire test also pins LIST with a pattern that would need quoting (Grok L1)
  — and the measurement contradicted the finding's expectation: async-imap 0.11.3 sends the
  LIST **pattern bare and unescaped** (`LIST "" Sent Mail`, `LIST "" a"b\c`), only the
  reference is quoted; Velo passes `*` and nothing else as the pattern, so no production
  path is affected, and the fact is now pinned in CI; the plan's §5, REQ-0.1 and Design now
  name Shift_JIS as the fail-closed guard instead of the single-byte charsets (Grok L2).
  **Acknowledged:** Gemini N1 — `walk` returns `()`, so the third boundary conversion is
  `if let Ok(..)`, the same skip as `.ok()?`. Both reviewers confirmed from the diff: the
  header-lookup deviation is the only `HeaderName::Other` use in the crate; the pinned
  invariant values (trimmed multipart bodies, synthesised HTML, un-squeezed snippet spaces,
  `Some("")` text for HTML-only mail) are 0.9.4 behaviour correctly locked, not bugs;
  `usize::try_from(u32)` cannot fail on this crate's targets; the duplex server is faithful
  so the bytes are the library's. Per-commit CI: the runs for commits 3 and 4 were cancelled
  by the workflow's concurrency group when the next push arrived; both were re-run alone on
  their exact SHAs and passed. Raw outputs in
  `docs/reviews/2026-09-03-pr84-pr-e-{gemini38,grok}-raw.md`. **Landing:** rebase merge,
  seven commits — the five planned plus two review-fix commits.
- **2026-09-03 — SPEC-280-U built, PR #85, Tier 1: the http scope matched by the plugin's own
  matcher.** Closes SPEC-280's "Open for Jim" (Grok M1 on #56). Brief
  `docs/briefs/2026-09-03-280-urlpattern-scope-test.md` committed first.
  `src-tauri/src/http_scope_matcher.rs`, test-only: rebuilds every `http:default` allow entry
  of both capability files the way `tauri-plugin-http`'s private `parse_url_pattern` does
  (parse, then `*` for an empty search, hash, and empty-or-`/` pathname) and asserts, with the
  `urlpattern` crate, the exact eight-entry allow list with no `*:*`, the accepted table and
  the thirteen refused URLs the TypeScript test refuses. **Dependency, asked and approved
  (Jim, 2026-09-03, decision 4):** `[dev-dependencies] urlpattern = "0.3.0"` — need: the
  plugin's scope module is private, so this is the only way to test with the matcher the
  binary runs; transitive cost: zero, the version the plugin already pulls, `cargo tree -e
  normal` byte-identical, the lockfile gains one line and no package; not shipped. The crate's
  `quirks` API builds pattern and input from strings, so `regex` and `url` were not named.
  Gates: suite 206 / 4 ignored, clippy clean, build, audit exit 0, sqlx single.
- **2026-09-03 — PR #85 (SPEC-280-U) review, two legs.** Gemini 3.8 Flash High: APPROVE (2N);
  Grok 4.6: APPROVE (1L 2N). **Adopted:** a matcher error fails the test rather than reading
  as "refused" (Gemini N1, Grok N1); `Path::join` for the capability path (Gemini N2); the
  match input is the plugin's exact input — `UrlPatternMatchInput::Url(tauri::Url::parse(..))`
  — instead of the URL parsed as a pattern string, so `*`, `%` or `:name` in a future URL
  cannot diverge from the plugin (Grok L1; `tauri::Url` is the graph's one `url` crate,
  re-exported, so no dependency was named). **Kept:** the `*:*` assertion alongside the
  exact-list one (Grok N2; REQ-1 asks for both). Raw outputs in
  `docs/reviews/2026-09-03-pr85-urlpattern-{gemini38,grok}-raw.md`.
- **2026-09-03 — SPEC-SIT (custom split-inbox tabs) built, PR #87, Tier 1.** Enhancement wave 1
  item 2. Brief `docs/briefs/2026-09-03-split-inbox-tabs.md` committed first. A pure module
  `src/services/inbox/splitTabs.ts` holds the tab list — category tabs keep the category name
  as their id so the router param and the `g p/u/o/c/n` shortcuts are unchanged, label tabs are
  `label:<id>`, Reminders is `reminders` — with a Zod schema at the settings boundary (the
  default, today's five categories, on anything invalid: bad JSON, wrong shape, an unknown
  kind, a duplicate, an id that does not match its kind, an empty list), the visibility rule
  (a label the account does not have is not a tab; a hide-when-empty tab with a known total of
  zero is dropped; an unknown count keeps the tab; never everything hidden), the active-tab
  fallback, and the add/remove/move/hide helpers. Two queries in `db/threads.ts` (INBOX ∩ label;
  every thread with a pending reminder, soonest due first — inbox or not, because the reminder
  hangs on the sent thread) and `db/splitTabCounts.ts` (total + unread per tab in at most three
  grouped queries), driven on the SQLite harness. `uiStore.splitInboxTabs` persisted as
  `split_inbox_tabs`, restored at boot without a write-back. `CategoryTabs` now takes the
  visible tabs (icon by kind, a colour dot for labels); `EmailList` loads by tab kind and
  resolves the router's request against the visible set; the five shortcuts only navigate to a
  configured tab; a `SplitTabsEditor` under Settings → General → Inbox view mode (reorder,
  remove, hide-when-empty, add a category, any of the account's labels with smart labels
  marked, or Reminders); the help card updated. Tests first: 16 pure cases, 4 SQLite cases, the
  tab-strip tests rewritten (5). Gates: `tsc` clean, 176 files / 2,361 tests, `graph:check`,
  `docs:check` (counts bumped 174 → 176, services 96 → 98). No dependency added (Zod was
  already approved and in use at the model-output boundary).
- **2026-09-03 — PR #87 (SPEC-SIT) review, two legs.** Gemini 3.8 Flash High: CHANGES REQUESTED
  (3H 3M 2L 1N); Grok 4.6: CHANGES REQUESTED (1H 6M 2L 3N). **Adopted, each verified against
  source:** the add path enforces the same 32-tab cap as the boundary schema, or a 33rd tab would
  persist and reset everything at the next boot (Gemini M1, Grok M2); the Reminders count is
  `COUNT(DISTINCT thread)` — the table has no unique index on `(account_id, thread_id)`, so two
  pending rows on one thread are possible (Gemini H1, Grok M1); `t.id` as the paging tie-breaker
  in both new queries (Gemini M2); the editor clears its candidate on an account switch and names
  a label from another account (Gemini M3, L1; Grok L1); `"All"` passes through
  `resolveActiveTab` untouched so the unified path is exactly as it was (Grok H1); a tab the
  router asks for is never hidden by hide-when-empty, which is what stops `g n` on an empty
  Newsletters from yanking the user to the first tab and stops a URL-named tab from vanishing
  after the first counts load (Grok M5, M4's jump half); counts are dropped the moment the
  account changes (Grok M3); the hide-when-empty checkbox is announced once (Grok L2); seven
  test cases from the two gap lists, plus an editor component test. **Declined, each
  verified:** Gemini H2 / Grok M6 "a label from another account can render a tab" — the label
  store holds the active account's labels only (`labelStore.loadLabels` replaces the list from
  `getLabelsForAccount`); Gemini H3 / Grok M4's rest — counts are unknown on first paint only
  and kept across navigation, and the URL is the user's request, not display state, so nothing
  navigates on their behalf (fail open on display, as the brief says); Gemini L2 likewise.
  **Finding, recorded and fixed in its own PR next:** while verifying Gemini H1 on real SQLite,
  `insertFollowUpReminder`'s `ON CONFLICT(account_id, thread_id)` upsert failed — SQLite
  refuses an ON CONFLICT target without a unique index, and upstream's migration v6
  (2026-02-12) created a plain one. Follow-up reminders, manual and automatic (#80, #82), cannot
  be inserted today; the error is swallowed by the callers' catches. Raw outputs in
  `docs/reviews/2026-09-03-pr87-split-tabs-{gemini38,grok}-raw.md`.
- **2026-09-03 — SPEC-FUR: follow-up reminders could never be inserted (live upstream defect),
  PR #88, Tier 1.** Found while verifying Gemini H1 on #87 against real SQLite:
  `insertFollowUpReminder`'s `INSERT … ON CONFLICT(account_id, thread_id) DO UPDATE` fails with
  *"ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"* — SQLite requires a
  unique index as the conflict target, and upstream's migration v6 (2026-02-12) created a plain
  one. Reproduced with `better-sqlite3` on the migration's exact DDL. Consequence: the manual
  reminder from the action bar and the automatic ones from #80 and #82 have all been failing,
  the errors swallowed by the callers' catches; the Reminders tab from #87 would always have been
  empty. Fix, no migration: UPDATE the pending row if there is one, else INSERT; cancelled and
  triggered rows are history and are left beside a new pending one. Brief
  `docs/briefs/2026-09-03-followup-reminder-upsert.md`, test
  `followUpReminders.upsert.test.ts` on the SQLite harness (red on the old statement, green on
  the new). **Lesson:** a mocked database cannot catch a statement SQLite rejects at prepare
  time; anything with ON CONFLICT, a trigger, or a constraint belongs on the harness.
- **2026-09-03 — PR #88 (SPEC-FUR) review, two legs.** Gemini 3.8 Flash High: CHANGES
  REQUESTED (1H 1M 1L 1N); Grok 4.6: CHANGES REQUESTED (1M 2L 2N). **Adopted, each verified:**
  the update-then-insert runs in one pinned transaction — the brief had claimed every reader
  tolerated a duplicate pending row, but the checker fires every due pending row, so two
  concurrent sets of one thread would have notified twice (Gemini H1, Grok M1); existence is
  decided by a SELECT inside the transaction and the row updated by id, so a driver reporting
  0 changes for a no-op UPDATE cannot cause a second insert (Grok L2); the triggered-history
  and same-values cases are pinned (Grok L1, L2); the brief now names the **partial unique
  index** (`WHERE status = 'pending'`) as the schema-level fix and the Tier 2 follow-up,
  correcting its earlier "a unique index would collide with history" (Gemini M1, Grok N1).
  **Declined, verified:** Gemini L1 (the `selectFirstBy` stub) — the repository's harness
  pattern mocks the connection module and `vi.importActual` cannot rebind the module-local
  `getDb` the real helper closes over; Grok agreed the stub is a call-time redirect and fine.
  **Sibling audit (Gemini N1, Grok N2), done:** all 19 `ON CONFLICT` statements in
  `services/db` prepared against the migrated schema — this was the only invalid target. Raw
  outputs in `docs/reviews/2026-09-03-pr88-followup-upsert-{gemini38,grok}-raw.md`.
- **2026-09-03 — SPEC-II (Instant Intro), Tier 1, PR #90.** Brief
  `docs/briefs/2026-09-03-instant-intro.md`, committed before code. One key (`b`) or the
  handshake on the action bar opens a reply-all on the thread's last message with the
  introducer (`reply_to ?? from_address`, as Reply All targets it) moved to Bcc, the account's
  own addresses removed, and the body opening "Thanks {first name}, moving you to Bcc." above
  the usual quote. **Decisions:** (1) the rule is a pure module,
  `services/composer/instantIntro.ts`, whose `replyAllRecipients` is the first shared copy of
  the reply-all rule the four hand-written sites compute — replacing them is a later,
  behaviour-preserving pass; (2) the intro opens the full composer, not the inline reply,
  because Bcc needs a field; (3) `b` because the dispatcher looks single keys up by `e.key`, so
  Superhuman's ⌘⇧I written as `Shift+I` could never match — **and the Settings recorder writes
  exactly that string for any Shift-letter rebind**, a pre-existing gap recorded for Jim;
  (4) unavailable, with the reason on the button, when there is no introducer address, the
  last message is my own, or nobody is left once I and the introducer are set aside;
  (5) the composer resolves the From alias from the reply's To/Cc, and the intro has removed me
  from both, so `ThreadView` resolves it from the original headers and sets it after opening —
  the composer's own resolution skips when `fromEmail` is already set; (6) the subject is not
  given a second `Re:` (Reply All today always prefixes — a small, deliberate difference).
  `bareAddress` moved from `autoReminders.ts` to `utils/emailUtils.ts` unchanged, now shared.
  Tests: the module (17), the `b` dispatch (2), the action-bar button (3); the `ThreadView`
  wiring has no render test, like its reply handlers — Jim's manual check covers it.
- **2026-09-03 — PR #90 (SPEC-II) review, Gemini 3.8 Flash High leg:** CHANGES REQUESTED
  (1H 1M 1L 1N). **Declined, verified against source — H F-01** ("the composer's own effect
  clobbers the From alias set by `ThreadView`"): the composer's only automatic From write is
  `if (!store.fromEmail && mapped.length > 0)` (`Composer.tsx:216`), inside the async
  alias-loading effect; `ThreadView` sets `fromEmail` synchronously right after `openComposer`,
  before any commit, so the guard sees it set and skips. The reviewer flagged the dependence on
  code outside the diff; the diff's comment described exactly that guard. **Adopted — M F-02:**
  aliases start `null` (not loaded) rather than `[]`, are reset on account change, and the intro
  is not computed until they are known — the button reads "Instant Intro is not ready yet" for
  the milliseconds the SQLite read takes, never a half-known own-address list. **Adopted —
  L F-03:** `instantIntroUnavailableReason` in the module (tested) names the three cases — no
  sender address, the last message is your own, nobody to introduce you to — instead of one
  string for all. **Adopted — N F-04:** the first name drops surrounding quotes/punctuation
  (`"Alice" Smith` → Alice); `Smith, Alice` still yields "Smith" — a surname-first display name
  cannot be told from a first name, recorded. Raw output in
  `docs/reviews/2026-09-03-pr90-instant-intro-gemini38-raw.md`.
- **2026-09-03 — PR #90 (SPEC-II) review, Grok 4.6 leg:** CHANGES REQUESTED (2M 3L 2N).
  **Same finding as Gemini, already fixed — M II-1** (aliases race, stale across accounts) and
  **L II-3** (one reason string). **Adopted — M II-2 / L II-4:** the two-step open (`openComposer`
  then `setFromEmail`) became one atomic call: `openComposer` accepts `fromEmail`, and the pure
  `composerOptionsForIntro(message, intro, quoteHtml, aliases)` builds the whole payload —
  recipients, subject, opener + quote, thread ids, the From alias resolved from the *original*
  headers — so the React path Grok said was untested is now three module tests plus a store
  test; `ThreadView` is one line. Grok's clobber theory (the same as Gemini's F-01) stays
  declined against `Composer.tsx:216`, and Grok marked it unproven. **Adopted — L II-5:** a
  blank `reply_to` now falls through to `from_address` (Reply All today would address nobody;
  the intro no longer inherits that). **Notes, no change — N II-6** (the `noReply` rule lives
  in `ThreadView`/`ActionBar`, as the brief's REQ-1.3 says) and **N II-7** (the tooltip says
  `(b)` like Forward's `(f)`; a rebind does not update either — pre-existing pattern).
  **Found while adopting II-2:** `resolveFromAddress` compares whole lower-cased header chips,
  so a display-name chip (`Alias <alias@acme.com>`) never matches an alias and the
  default/primary fallback answers instead — the same for Reply All today; recorded, not this
  PR's. Raw output in `docs/reviews/2026-09-03-pr90-instant-intro-grok-raw.md`.
- **2026-09-03 — PR #90 (SPEC-II) follow-up pass on the fix delta (`be1fb84..b577f9a`), two
  legs.** Gemini 3.8 Flash High: CHANGES REQUESTED (2M 1L 1N); Grok 4.6: CHANGES REQUESTED
  (2M 1L 2N). *Review the fix, not just the change* held again: both legs found the same two
  holes in the first round's fixes. **Adopted, both legs — the account-switch tear** (Gemini
  F-02, Grok F-01): resetting the alias list inside the effect left one render with the new
  account's email beside the old account's aliases; the list is now stored *with the account
  id it was loaded for* and read as unknown whenever that id differs from the active one — a
  reset in render, not after paint. **Adopted, both legs — the key path's own guard** (Gemini
  F-01/F-03, Grok F-02/F-03): the handler still used `reply_to ?? from_address` for the no-reply
  test (blank `reply_to` slipped through) and did not gate on the reason the button shows; the
  no-reply rule moved into `instantIntroUnavailableReason` (judged on the reply target after
  the blank fall-through, tested), and the handler refuses whenever that reason is non-null —
  one rule for the key and the button. Grok's remark that the delta "does not show
  `buildInstantIntro` rejecting own-from" is answered outside the delta (it does, at
  `own.has(introducer)`); the gate makes the agreement explicit anyway. **Declined — Gemini
  N F-04** (the primary address may be missing from the alias table, so From could resolve to
  a secondary alias): `composerOptionsForIntro` resolves exactly as the composer's own
  reply-all path does (`Composer.tsx:216-223`, the mapped aliases only); parity, recorded.
  **Notes — Grok N F-04/F-05** (the composer's effect and the button's disable are outside the
  delta): verified earlier (`Composer.tsx:216`) and in `ActionBar.tsx` (`disabled={noReply ||
  introUnavailableReason !== null}`). Raw outputs in
  `docs/reviews/2026-09-03-pr90-instant-intro-delta-{gemini38,grok}-raw.md`.
- **2026-09-03 — PR #90 (SPEC-II) third, narrow pass on `b577f9a..223102b` (Gemini 3.8 Flash
  High): APPROVE (2N).** N-01: with the no-reply rule inside `instantIntroUnavailableReason`,
  the button's `noReply ||` is redundant — kept, harmless, the button reads like its neighbours.
  N-02: the handler's `aliases ?? []` relies on the reason being non-null whenever the aliases
  are unknown — it is ("Instant Intro is not ready yet" whenever `ownAddresses` is null). Merged
  as `91e01f6` (squash) on green for `223102b`. Raw output in
  `docs/reviews/2026-09-03-pr90-instant-intro-delta2-gemini38-raw.md`.
- **2026-09-03 — SPEC-SB (speed budget), Tier 1, PR #92.** Brief
  `docs/briefs/2026-09-03-speed-budget.md`, committed before code; one PR, three rebase-merged
  commits (SB-1 reduce effects, SB-2 open instantly, SB-3 virtualized list), each reviewed on
  its own diff. **Correction before code:** the brief's first draft blamed the follow-up
  checker for a needless list reload every minute; its query is due-only
  (`followUpReminders.ts:55-62`), so every reminder it touches changes state and the reload is
  warranted — withdrawn (`1cc8e85`). The per-minute reload that remains is sync's own; a
  changed-flag from the sync path is a recorded follow-up. **Decisions:** the existing
  `reduce_motion` key widens in effect rather than a second toggle; the Linux default is a
  session value (`restoreReduceMotion`, not persisted) so the user's first touch is what sticks;
  bodies are local, so "prefetch" is a SQLite stale-while-revalidate cache, not a network
  warm-up; `@tanstack/react-virtual` 3.14.10 exact (approved 2026-09-02 decision 3; SLSA
  provenance on both packages; no transitive deps).
- **2026-09-03 — PR #92 SB-1 (`b7861ca`) review, two legs.** Gemini 3.8 Flash High: CHANGES
  REQUESTED (4M 3L); Grok 4.6: CHANGES REQUESTED (1H 3M 4L 1N). **Adopted:** the hover rule no
  longer zeroes `box-shadow` — shadows stay, only the lift transform goes (Gemini M F-03, Grok
  L F6); the boot path always reads the platform and restores the resolved value
  unconditionally, so a junk stored value behaves as "absent" the way the resolver's test says
  (Gemini M F-04 + L F-06, Grok L F7); `backdrop-filter: none` added to `.backdrop-animate`
  for clarity — the base rule carries no static filter, the blur came only from the keyframes
  the same rule already disables (Gemini M F-02, Grok M F3: belt and braces, not a fix);
  `readPlatform` awaits `platform()` and has an async-stub test (Grok **H F1** — **declined as
  a bug**: `@tauri-apps/plugin-os` 2.x declares `platform(): Platform`, synchronous, verified in
  `dist-js/index.d.ts:39`; adopted as hardening); the CSS comment names the tab (Grok L F5);
  the brief's REQ-1.1 copy updated to the shipped description, which keeps the old toggle's
  "fixes flickering" promise (Gemini L F-05, Grok M F2). **Declined, verified:** "help says
  Settings > General but the toggle is in Appearance" (Gemini M F-01) — Appearance is a
  `Section` inside the General tab (`SettingsPage.tsx:442-444`), and the help already says
  "Settings > General" six times for that section. **Declined, accepted risk:** the boot
  restore can land after a toggle made in the first milliseconds of a session (Grok M F4) —
  the same shape as every other setting restored in that boot effect, and the user's toggle
  persists regardless. **Notes:** first paint on a fresh Linux install still shows the blobs
  until the async restore lands (Grok L F8) — spec-compliant, recorded; the override rules are
  unlayered after `@import "tailwindcss"` and so beat layered utilities (Grok N F9); the
  default loader of `readPlatform` is untested because it imports the Tauri plugin (Gemini L
  F-07). Raw outputs in `docs/reviews/2026-09-03-pr92-sb1-reduce-effects-{gemini38,grok}-raw.md`.
- **2026-09-03 — PR #92 SB-1 follow-up pass on `b7861ca..9df6584`, two legs.** Gemini: CHANGES
  REQUESTED (1M 1L 2N); Grok: APPROVE (2L 1N). **Adopted:** the boot path loads the OS plugin
  only when the stored value is neither "true" nor "false" — a returning user with a saved
  choice no longer waits on a dynamic import (Gemini M1, Grok L R2-2); a test for a plugin
  whose `platform()` call rejects (Gemini L1). **Notes:** `backdrop-filter: none` on
  `.backdrop-animate` is belt and braces (Gemini N1); `persisted` is informational (Gemini N2);
  the hover rule no longer touches `box-shadow` at all, so whatever shadow the base hover rule
  declares still applies, un-animated (Grok L R2-1 — and the base rule's hover shadow is the
  8 px lift shadow, static, cheap). Raw outputs in
  `docs/reviews/2026-09-03-pr92-sb1-delta-{gemini38,grok}-raw.md`.
- **2026-09-03 — PR #92 SB-2 (`4878153`) review, two legs.** Gemini: CHANGES REQUESTED (2H 2M
  2L); Grok: CHANGES REQUESTED (1H 2M 2L 1N). **The "binary diff" High (Gemini F-01, Grok
  F2) was real and mine:** the cache's key separator had been written as a literal NUL byte,
  so git treated `messageCache.ts` as binary and neither leg could read it; replaced by the
  ASCII escape `\u0000`, and every changed file scanned for NULs before each commit from now
  on (a scratchpad script). **Adopted — first paint (Gemini H F-02, Grok H F1):** the cached
  copy was applied in an effect, one paint late, and the render before that effect showed the
  *previous* thread's messages under the new header (a pre-existing flash the old code had
  too); messages are now stored with the thread they belong to and read back during render
  only for the current thread, with the cache peeked in a memo keyed by thread — a cached
  thread paints on its first render, an uncached one shows the skeleton, and the previous
  thread never leaks. **Adopted — warm-up thrash (Gemini M F-03, Grok M F3):** the effect is
  keyed on the neighbour ids themselves, so a reload that leaves them unchanged neither
  restarts the timer nor cancels a warm-up in flight. **Adopted — singleton coverage (Gemini
  M F-04, Grok M F2):** tests for the 30-entry default, `velo-sync-done` clearing the app
  instance, and account/thread key separation. **Adopted — clear-during-load race (Grok M
  F2):** a generation counter; a load that started before a clear returns its rows but does
  not store them. **Adopted — fingerprint (Grok L F4):** `sameMessages` also compares body
  lengths, so a draft saved locally (same id and date) replaces the cached copy. **Adopted
  (Gemini L F-05):** an explicit lower bound in the neighbour loop. **Declined, verified:**
  "`getMessagesForThread` is now an unused import in `ThreadView`" (Grok L F5) — it is still
  the reload after a send (`ThreadView.tsx`, the inline-reply `onSent`). **Notes:** cancel does
  not abort the SELECT in flight, by design (Grok N F6). Raw outputs in
  `docs/reviews/2026-09-03-pr92-sb2-open-instantly-{gemini38,grok}-raw.md`.
- **2026-09-03 — PR #92 SB-2 follow-up pass on `4878153..2766bd0`, two legs.** Gemini: CHANGES
  REQUESTED (2H 2M 2L); Grok: CHANGES REQUESTED (3M 4L 2N) — and the two legs found the *same*
  four holes in the first round's fix. **Adopted, both legs — the stuck skeleton** (Gemini H
  F-01, Grok M F3): the effect re-peeked the cache and, when a neighbour warm-up landed between
  render and effect, found a hit equal to the fresh rows and skipped the state write — so the
  render that had painted a miss stayed on the skeleton; the effect now compares against what
  that render painted (`cachedMessages` from the closure). **Adopted, both legs — the
  fingerprint** (Gemini H F-02, Grok M F1): lengths could miss a same-length draft edit; the
  compare is now ids, dates, read/starred flags and the body strings themselves (string
  equality is a pointer-or-length check first). **Adopted, both legs — account-scoped state**
  (Gemini L F-05, Grok M F2): the keyed state carries the account id, as the cache key does.
  **Adopted, both legs — a pure peek** (Gemini M F-04, Grok L F4): reading the cache during
  render no longer touches LRU order; the load that always follows does. **Adopted, both legs
  — singleton tests** (Gemini L F-06, Grok L F6): 31 loads evict to 30; `afterEach` clears.
  **Adopted (Grok L F5):** the prefetch key joins ids with the same NUL character the cache key
  uses, via `String.fromCharCode(0)` — no escape to mistype. **Declined, verified — Gemini M
  F-03** ("no selection warms the first three threads"): `prefetchOrder` returns `[]` for a
  null or absent selection (`neighbours.ts`, both guards; tested). **Residual, recorded (Grok
  L F7):** a thread load in flight across a sync paints pre-sync rows until the thread is
  reopened — the same as before SB-2; the generation counter keeps the cache clean, the open
  view is not subscribed to sync. Raw outputs in
  `docs/reviews/2026-09-03-pr92-sb2-delta-{gemini38,grok}-raw.md`.
- **2026-09-03 — SB-3 (virtualized list) decisions.** `@tanstack/react-virtual` 3.14.10 exact
  (SLSA provenance on both packages; `npm audit signatures` verifies 120 attestations
  locally). One flat item model (`services/inbox/listItems.ts`, pure, 9 tests): bundle
  headers, expanded children, threads with the divider computed on the **visible** sequence
  (the old code read the previous row from a different array — the latent bug named in the
  brief), two footers; per-kind, per-density estimates, measured after mount. `EmailList`
  positions rows with `translateY`, scrolls the selection into view through
  `scrollToIndex` keyed on the selection only (a reload while the user scrolled away must not
  snap back), loads more when the last rendered row is within five of the end, and plays
  `stagger-in` only on the first paint of a loaded list (reset per folder). The render test
  (`EmailList.virtual.test.tsx`) stubs what jsdom lacks — `offsetHeight`/`clientHeight`
  (the virtualizer reads the viewport from them), `scrollHeight` (it clamps `scrollToIndex`
  to `scrollHeight - clientHeight`), a `scrollTop` backing field and `scrollTo` — and proves
  200 threads render as 16 rows, a far selection scrolls into the window, and the divider sits
  on the first unpinned row. `ThreadCard` is not memoised: with 16 rows on screen a reload
  re-renders 16 cards, not 200. **Lesson recorded:** twice this session a single-space
  literal I typed arrived as a NUL byte; every changed file is now scanned for NULs before a
  commit (`nulscan.py` in the session scratchpad — worth a repo script if it recurs).
- **2026-09-03 — PR #92 SB-2 third, narrow pass on `2766bd0..909eca9` (Gemini 3.8 Flash High):
  APPROVE (2N).** N-01: a dropped `useMemo` cache would only re-run a benign effect; N-02: the
  fingerprint does not compare draft recipients/subject — a draft save updates `date`. Raw
  output in `docs/reviews/2026-09-03-pr92-sb2-delta2-gemini38-raw.md`.
- **2026-09-03 — PR #92 SB-3 (`5dfef06`) review, two legs.** Gemini: CHANGES REQUESTED (2H 3M
  1L); Grok: CHANGES REQUESTED (2H 3M 4L 2N). **Adopted, both legs — the deep link** (Gemini H
  F-01, Grok H F-01): the scroll-to-selection effect was keyed on the selection only, so a
  selection known before the list loaded never scrolled; it is now keyed on the selection *and*
  on whether the selection is present in the item model — a scroll when it first appears, none
  on a reload that merely reorders (test: a far selection set before mount scrolls into the
  window). **Adopted, both legs — the stagger** (Gemini M F-04, Grok M F-03): found by my own
  re-read minutes before the reviews landed — the reset effect and the "flip to false" effect
  ran in the same commit while the old list was still showing, and the virtualizer's measure
  re-render would have stripped the class within a frame; the rows of a folder's first loaded
  paint are now remembered as a set and keep the class, later rows never get it (test).
  **Adopted (Gemini M F-03, Grok L F-06):** a selected bundle child scrolls into view too.
  **Adopted (Gemini L F-06):** a row whose thread is missing from the map renders a placeholder
  of its estimated height instead of an empty wrapper measured at 0. **Adopted (Grok L F-07):**
  the item model never emits a thread as both a bundle child and a plain row (test). **Adopted
  (Gemini M F-05, Grok M F-04 — tests):** a selection known before load, a bundle header first
  with bundled rows held out until expanded, and `loadMore` firing near the end with the
  second page requested at offset 50. **Declined, verified — the loadMore loop** (Gemini H
  F-02, Grok H F-02): `loadMore` guards on `hasMore`/`loadingMore` itself (`EmailList.tsx`,
  unchanged), `hasMore` is `dbThreads.length === PAGE_SIZE` after every page, and the effect's
  dependencies do not change when a page adds no rows — no loop, no duplicate fetch; an
  explicit `hasMore`/`loadingMore` guard was added to the effect anyway so it stays quiet once
  everything is loaded. **Declined, verified — drag-to-label with a row that unmounts mid-drag**
  (Grok M F-05): `DndProvider.tsx:112-128` mounts a `DragOverlay`, and `handleDragStart`
  (`:78-84`) copies the payload from `event.active.data.current` at drag start — the visual and
  the drop payload survive the source row unmounting; the brief already names this as the hand
  check. **Notes:** estimates ignore the root font scale, corrected by measurement on mount
  (Grok L F-08); the first fifteen *items* get the stagger, bundle headers among them count but
  never animate (Grok M F-03 tail); the prefetch-key helper change rode in this commit and was
  named in its message (Grok L F-09); the tests stub `ResizeObserver` as a no-op, so re-measure
  on density or pane changes is untested — the initial measure goes through `measureElement` on
  ref attach, which the stubs do exercise (Gemini M F-05, Grok M F-04). Raw outputs in
  `docs/reviews/2026-09-03-pr92-sb3-virtualized-list-{gemini38,grok}-raw.md`.
- **2026-09-03 — PR #92 SB-3 follow-up pass on `5dfef06..7249e32`, two legs.** Gemini: CHANGES
  REQUESTED (2H 1M 1L); Grok: CHANGES REQUESTED (1M 3L 1N). Both found the same two holes in
  the *fix*, and both were right — the third time this session that reviewing the fix paid.
  **Adopted, both legs — the stagger latch was still wrong** (Gemini H F-02, Grok M M1): the
  render-time latch fired on the folder-switch frame, when `folderKey` had already changed but
  the previous folder's rows were still on screen and `isLoading` was still false — so it
  stored the *old* rows' keys under the *new* folder, animating the outgoing list and never
  the incoming one. It was also a ref written during render, which React 19 forbids. The set is
  now captured inside `loadThreads` from the rows that load just returned
  (`markStagger(mapped)`, both query paths) and held in state: it can never be another
  folder's, `loadMore` never re-triggers it, and it survives the measure re-renders.
  **Adopted, both legs — presence as a scroll key** (Gemini H F-01, Grok L L1): a reload that
  dropped and re-added the selected thread would have re-scrolled a user who had scrolled away;
  the effect now latches the id it scrolled for and scrolls at most once per selection.
  **Adopted (Gemini M F-03):** `selectedPresent` guards on a truthy id and a defined
  `threadId`, so a bundle header cannot match an undefined selection. **Adopted (Grok L L2):**
  the load-more test also asserts that a scroll leaving the tail far away does *not* page.
  **Not tested, recorded (Grok L L3):** a selected bundle child cannot be shown to scroll —
  bundle children sit at the top of the item model, where `align: "auto"` correctly does
  nothing; dropping the `kind === "thread"` filter is inert there and matters only if bundles
  ever move down the list. Raw outputs in
  `docs/reviews/2026-09-03-pr92-sb3-delta-{gemini38,grok}-raw.md`.
