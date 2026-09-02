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
