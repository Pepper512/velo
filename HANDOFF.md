# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Code pin: `2c235a5`** (#94, SPEC-FUI migration 29 — the last commit on `main` that changed
  `src/` or `src-tauri/`). **The only SHA this file pins.** `git log --oneline 2c235a5..origin/main` —
  anything there that is not `docs:` means the pin is stale and every line number in the briefs
  must be re-grepped before citing.
- **Open PRs at writing: two.** **#95** (`share-availability`) — the **approved** Share
  Availability brief, no code yet; this is where the next build happens. **#96**
  (`docs-post-fui`) — this docs pin, **green except `npm audit`, which is failing on an npm
  registry outage, not a finding** (see §2). Never trust this line — run
  `gh pr list --repo Pepper512/velo`.
- **Branches:** `main` plus the branches pinned by the dead worktrees below, plus **about twenty
  merged feature branches** (`f297-bcc-strip`, `f240-pinned-tx`, `docs-post-*`, …) that nobody
  pruned after #43–#71. All merged; `git branch -d` is safe on every one of them. A chore, not a
  risk.
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **Seats, as of 2026-09-03.** One build seat (this session ran as **Fable 5.1**, Jim present
  and directing: "go", the platform question, the review-model change, then the P11 prompt). Name **seats, never
  session ids**, and run **`ListAgents`** before assuming a peer is live.
  - **Merge permission** is with the build seat under the standing rule (green on the exact SHA,
    up to date, no unresolved conversation) — exercised on #73.
  - **Independent review = two cross-vendor legs, and the Gemini leg is now 3.8 Flash High.**
    Jim, 2026-09-03, mid-review: *"you should be on gemini 3.8 Flash High"* — not 3.7. So:
    `agy --model gemini-3.8-flash-high --mode plan --print-timeout 20m --print="$(cat prompt)"`
    from a `.sh` wrapper (flags **before** `--print`; tell it not to use tools; inline the diff
    from committed SHAs), **and** Grok 4.6 (`grok -m grok-4.6 --disable-web-search
    --prompt-file …`, ~14 minutes, output file stays near-empty until it finishes). On #73 the
    two found *different* real defects again, and a follow-up pass on the fix delta found two
    more — when a review makes you write new logic, review the new logic.
  - **Worktrees:** this session's `.claude/worktrees/e2-part3-pool-carry` (branch
    `worktree-e2-part3-pool-carry`, everything in it landed via #73 and this docs PR) plus the
    **three dead ones from before** (`f1-decisions` locked, `f2-email-links-open`,
    `f5-move-hygiene`). Removal is **Jim's** (`git worktree remove` is refused to the agent
    seat). Vitest excludes when running from inside a worktree:
    `--exclude '**/node_modules/**' --exclude '**/.claude/worktrees/*/.claude/**'`.
  - **The format-on-save hook runs `rustfmt` on any `.rs` file you Edit or Write, and the crate
    is not rustfmt-clean.** A stray `cargo fmt` reformats twelve untouched files. Patch
    `commands.rs`-sized files by script (`python3` from the scratchpad) when you want a clean
    reviewer diff; `pool.rs` is clean and safe to Edit.
- **State on `main` @ `2c235a5`:** frontend **185** files / **2,462** tests · Rust **206** +
  4 ignored (the live Dovecot tests) · **29** migrations / 32 tables · npm audit 0 · 0 service
  import cycles. **One dependency added since the last pin, pre-approved:**
  `@tanstack/react-virtual` 3.14.10 exact (LOG.md 2026-09-02 decision 3; SLSA provenance on it
  and `@tanstack/virtual-core`; no transitive deps). **Dependencies changed this session, each on Jim's explicit approval:** the
  PR D and PR E majors (TypeScript 7.0.2, Vite 8.2.2, plugin-react 6.1.1; mail-parser 0.11.8,
  async-imap 0.11.3, socket2 0.6.5, reqwest 0.13.4, with `hashify` 0.2.9 the one pre-1.0
  transitive addition) and `urlpattern` 0.3.0 as a dev-dependency (#85). Nothing else.

---

## 1. Exact next step

> **Build Share Availability from the approved brief on branch `share-availability` (PR #95).**
> The scope decision is already made — **Google-backed calendars only; the button is present
> but disabled for a CalDAV calendar** — so the brief's task list can be worked straight
> through, tests first.
>
> ```bash
> cd /Users/jpepper/Developer/Claude/Velo-Build/velo
> git worktree list                      # share-availability is the live worktree
> cd .claude/worktrees/share-availability
> git pull --ff-only && npm ci
> npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'
> ```
>
> **Re-verify before acting — these are the assumptions most likely to have gone stale:**
> - `git log --oneline 2c235a5..origin/main` — anything there that is not `docs:` means the pin
>   is stale and **every line number cited in the brief must be re-grepped**. The brief cites
>   `Composer.tsx:640-662`, `TemplatePicker.tsx:25-45`, `calendarEvents.ts:76-92`,
>   `icalHelper.ts:56-122`, `providerFactory.ts:47-55`.
> - `gh pr list --repo Pepper512/velo` — #95 and #96 were open at writing; #96 may have merged.
> - **The branch is behind if #96 landed** — rebase `share-availability` on `origin/main`
>   before building, or the docs counts will conflict.
> - `gh run list --branch main --limit 2` — main green.
> - **`ListAgents`** before assuming a peer seat is live.
> - The CalDAV recurrence gap the scope depends on: confirm `parseVEvent` still handles no
>   `RRULE`/`EXDATE`/`RECURRENCE-ID` (`grep -n "RRULE\|EXDATE\|RECURRENCE-ID" src/services/calendar/icalHelper.ts`
>   should find nothing). If someone has since added recurrence expansion, the "disable for
>   CalDAV" decision is obsolete and should be re-put to Jim.

**The full ordered plan is `docs/ROADMAP.md`**: the bug-fix queue is done except #278 ("not
yet"), F-3/P19 landed (#71), E2 part 3 landed (#73), P11 landed (#75), **the dependency audit
is complete — PR D (#83) and PR E (#84) built from their approved plans**, the queued-send
reminder (#82) and the `urlpattern` scope test (#85) landed, and enhancement wave 1 is three
items in: Auto Reminders (#80), **custom split-inbox tabs (#87)** and **Instant Intro (#90)**,
with the follow-up reminder insert repaired on the way (#88 — it had never worked since
upstream's migration v6). **Enhancement wave 1 is complete (the speed budget, #92) and #88's
Tier 2 follow-up has landed (#94, migration 29).** **Next: build Share Availability from the
approved brief in PR #95** — Google-backed calendars only, the button disabled for CalDAV
(see the next-action block in §7 for why) — then the rest of wave 2: Instant Event, one-line
list summaries. **CalDAV recurrence expansion is a recorded next calendar brief.**

**SPEC-FUI landed as #94 (`2c235a5`) — migration 29, the pending-reminder index.** Brief
`docs/briefs/2026-09-03-followup-pending-unique-index.md`, **approved by Jim before any code**
as Tier 2 requires. The migration demotes any older duplicate pending row to `'cancelled'`
(nothing is deleted) and then creates
`idx_followup_pending_unique ON follow_up_reminders(account_id, thread_id) WHERE status =
'pending'`. **It fixes no live bug** — #88 already holds the invariant in one pinned
transaction — and the brief says so plainly; the index is the backstop for a future caller
that skips that transaction. Every SQL claim was measured on real SQLite before the plan was
written. The demotion is keyed on `rowid`, not `id`, because `TEXT PRIMARY KEY` does not imply
`NOT NULL` and one NULL in a `NOT IN` list would silently demote nobody and leave the index to
throw — which, since `runMigrations` is step 1 of app init and its catch surfaces only
credential errors, would mean a quietly un-migrated database. The contract step (`DROP INDEX`)
is named in the migration's comment and not run, per the pairing gate.

**SPEC-SB landed as #92 (`ca4ba28`) — the speed budget, in three commits.** Brief
`docs/briefs/2026-09-03-speed-budget.md` (Tier 1, committed before code; one correction made
before any code — the first draft blamed the follow-up checker for a needless reload every
minute, but its query is due-only, so every reminder it touches changes state).
**SB-1 Reduce effects:** the existing "Reduce motion" toggle now also removes every
`backdrop-filter` (the glass classes, the Tailwind utilities, the composer overlay's animated
blur) and the hover/press/stagger animations, and defaults **on** for Linux when nothing is
stored — a session value, so the user's first touch of the toggle is what persists
(`services/effects/reduceEffects.ts`, `uiStore.restoreReduceMotion`). **SB-2 Open instantly:**
`services/threads/messageCache.ts` is a 30-entry stale-while-revalidate cache of
`getMessagesForThread`, cleared on `velo-sync-done`, generation-gated so a read in flight
across a sync cannot repopulate it; `EmailList` warms the next three and previous one threads
150 ms after a selection settles; `ThreadView` paints the cached copy on its first render, so
`j`/`k` shows messages with no skeleton. **SB-3 Virtualized list:** `EmailList` renders only
the rows in view over a flat item model (`services/inbox/listItems.ts`: bundle headers,
expanded children, threads with the pinned divider computed on the visible sequence — fixing a
latent bug — and the two footers), with `@tanstack/react-virtual` 3.14.10. **Five review
rounds, nine legs; every round found a real defect in the previous round's fix**, three of them
the same shape: something acting on the frame after a folder switch, when the previous folder's
rows are still mounted under the new key. The settled rule: the loader tags what it loaded
(`staggerSet.folder`, `loadedFolder`, a load sequence number) and nothing acts on rows that
belong to another folder. **Recorded, not fixed:** two `loadThreads` calls still race on a fast
folder switch and the older can land its *rows* last (pre-existing); estimates ignore the root
font scale until measurement corrects them; `ResizeObserver` is stubbed as a no-op in the tests,
so re-measure on density or pane changes is untested. **Jim's glance is open:** on Linux, first
launch should show flat panels and a quiet WebKitWebProcess; anywhere, scroll a large folder
and `j` to the bottom, then drag a row onto a label.

**SPEC-II landed as #90 (`91e01f6`) — Instant Intro.** Brief
`docs/briefs/2026-09-03-instant-intro.md` (Tier 1, committed before code). `b` on a thread, or
the handshake after Forward on the action bar, opens the composer in reply-all on the last
message with the introducer (`reply_to`, else `from_address`; blanks count as absent) moved to
Bcc, my own addresses (account email + send-as aliases) removed, and the body opening
"Thanks {first name}, moving you to Bcc." above the usual quote. Unavailable, with the reason on
the button, when: no sender address; the sender does not accept replies; the last message is my
own; nobody is left to be introduced to. Pure module `src/services/composer/instantIntro.ts`
(`replyAllRecipients` is the first shared copy of the reply-all rule the four hand-written sites
compute — consolidating them is a recorded follow-up); `openComposer` now accepts `fromEmail`
so the From alias, resolved from the *original* headers, travels in the one atomic open; the
alias list in `ThreadView` is keyed by the account it was loaded for. **Three review passes**
(Gemini 3.8 Flash High ×3, Grok 4.6 ×2): both first-round Highs/Mediums about the composer
clobbering From were declined against `Composer.tsx:216`; the alias race, the reason strings,
the blank `reply_to`, the atomic open and the account-switch tear were adopted; the third pass
approved. Dispositions in LOG.md and on the PR. **Recorded, not fixed:** `resolveFromAddress`
compares whole header chips (a display-name chip never matches an alias; same for Reply All);
`Smith, Alice` yields "Smith"; the Settings recorder writes `Shift+X` for a Shift-letter rebind
but the dispatcher looks single keys up by `e.key`, so no Shift-letter binding can ever fire —
pre-existing, Jim's call. **Jim's glance is open:** press `b` on an introduction thread.

**SPEC-AR landed as #80 (`a7058cb`) — auto reminders on external sends.** Brief
`docs/briefs/2026-09-03-auto-reminders.md` (Tier 1, committed before code). Sending to an
address outside the sender's domain (own addresses and aliases excluded) sets a follow-up
reminder N days later at 09:00 local, Saturday/Sunday rolled to Monday; the composer shows
"Remind me if no reply in N days" (override wins); Settings → Sending has the toggle and the
delay (1/2/3/7, default 3), persisted as `auto_reminders_enabled` / `auto_reminders_days`.
`EmailProvider.sendMessage` returns `{ id, threadId? }` so the reminder has a thread. An
existing reminder is never overwritten; no thread id → warn, no row; a queued offline send
sets nothing. Pure module `src/services/followup/autoReminders.ts`, tests first. Review
dispositions in `docs/decisions/LOG.md` (2026-09-03, PR #80) and on the PR.

**P11 landed as #75 (`e05f6cd`) — the Tauri capability grant is split.** Spec
`docs/briefs/2026-09-01-batch-g-p11-capabilities.md` (rewritten from the 2026-09-01 draft,
re-grepped, plan committed and the PR opened before any code). `capabilities/main.json` is the
main window's grant, byte for byte the old `default.json`; `capabilities/content.json` is what
`thread-*` and `compose-*` windows demonstrably call, **scoped by path**: `core:path`, event
listen/unlisten (no emit — `main` opens a composer on `single-instance-args`), sql
load/select/execute, opener open-url with the default URL set, dialog save, `velo.key`
read-only, the attachment cache as the only write root, `.eml` export to a dialog-picked path
through the runtime scope the dialog plugin extends, `http` with main's scope (**the recorded
residual**: unsubscribe POST and Ollama; the next narrowing is unsubscribe → a Rust command and
Ollama → `ai_fetch`). Removed from pop-outs: webview creation, `fs:remove`, notifications,
badge, autostart, shortcuts, deep-link, updater, process, `os`, title-bar window controls, and
any write beside the key or the database file. The splash page (static HTML) is in no file.
`ThreadView`, `Composer` and `ContextMenuPortal` hide or guard "Open in new window" by one
label-first rule (`src/utils/windowKind.ts`: `getCurrentWindow().label` inside Tauri, the URL
outside; an unknown label fails closed) that `main.tsx` also routes by. **Four review passes**
(Gemini 3.8 ×3, Grok 4.6), every finding dispositioned on the PR and in LOG.md; six declined
against plugin source (the dialog plugin *does* extend the fs scope — `tauri-plugin-dialog`
`commands.rs:194-198`; decorations are stripped from `main` only — `lib.rs:344`). The trade
named for Jim: popping the reply composer out of a thread pop-out is no longer offered.
**Jim's five-step manual QA is open, not done** — the spec's *Verification* section; the merge
landed behind it per the roadmap instruction; `git revert` restores the flat grant.

**The PR D / PR E plans are written and landed as docs — #77 (`1ccafbf`) and #78
(`2e4707b`) — and STOP there: no code, no dependency change until Jim approves each.**
`docs/briefs/2026-09-03-pr-d-toolchain-majors.md` (TypeScript 5.9 → 6.0.3 → 7.0.2, then Vite
8.2.2 + plugin-react 6.1.1; four rebase-merged commits with legal revert sets; the browser floor
pinned to Vite 7's; a packaged-bundle smoke before the Vite commit merges; `npm audit
signatures` into CI) and `docs/briefs/2026-09-03-pr-e-rust-parsers.md` (`mail-parser` =0.11.8
fail-closed with `full_encoding`, `async-imap` =0.11.3, `socket2` =0.6.5, `reqwest` =0.13.4 on
`native-tls-no-alpn` with `.use_native_tls()` explicit; a MIME fixture suite first, invariant
versus hardening; five rebase-merged commits; `hashify` 0.2.9 the one pre-1.0 transitive
addition). **Every claim in both was measured without touching the repo** — the compilers from
the npx cache, a throwaway copy of `src-tauri` and a throwaway copy of the project — and each
plan took two review legs (Gemini 3.8 Flash High, Grok 4.6) with every finding dispositioned in
LOG.md. **Corrections to the vault dependency audit are recorded in the specs** (the reqwest
duplicate stays; `base64` is not collapsible; `mail-parser` 0.11's empty default features;
0.11.2's quoting change is COPY/LIST; reqwest 0.13's `native-tls` now carries ALPN).

**Decisions each plan asks of Jim, in its Approval section:** PR D — the native-binary trust
(unattested Microsoft compiler binaries; attested VoidZero bundler binaries), the browser floor,
the CI signatures step, the rebase merge. PR E — `hashify`, the live-harness merge gate, the
rebase merge. **Next, once either is approved: build it as its spec says** (D is ~1 day, E ~1
day). Until then the next unblocked work is **enhancement wave 1** (ROADMAP §4: Auto Reminders
1.5 d, custom split-inbox tabs 3 d, Instant Intro 0.5 d, the speed budget 6 d with the already-
approved `@tanstack/react-virtual`) — Tier 1 items, briefs first.

**Open for Jim:** the `urlpattern` dev-dependency; the **rebrand inventory**
(`docs/audits/2026-09-03-rebrand-inventory.md` — the `com.velomail.app` identifier decision is a
one-way door needing an ADR; the inventory recommends keeping it); the F-3 follow-up questions;
**P11's five-step QA** (`npm run tauri dev`, pop out a thread: opens; reply and send;
unsubscribe; save an attachment; `plugin:fs|remove` and `plugin:webview|create_webview_window`
denied in devtools); whether to keep the reply-composer pop-out path (strike it and P11's
`thread-*` grant gets webview creation back); PR D/E plan approvals; reporter re-tests for
#280, #241, #252, #197, #276, #209, #233, #281; the "Keep them" hold. **Manual, still open:**
#240's Task 6, F-4's live Done-when, E2's Done-when 2, and the two E2 part 3 live tests
(`cargo test --locked -- --ignored live_dovecot` with the harness up).

### Resume commands

```bash
cd /Users/jpepper/Developer/Claude/Velo-Build/velo
git worktree list                        # who is where — before anything else
git checkout main && git pull origin main
npm ci
npx tsc --noEmit && npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'
npm run graph:check && npm run docs:check
(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)
gh repo set-default Pepper512/velo
```

Expected on `main`: **173 test files, 2,299 tests; Rust 173 passed, 3 ignored.**

### Re-verify before acting

- `git log --oneline e05f6cd..origin/main` — a non-`docs:` commit there means the pin is stale.
- `gh pr list --repo Pepper512/velo` — none open at writing; this line ages fastest.
- `git worktree list` — four worktrees at writing (this session's plus three dead ones).
- `gh run list --branch main --limit 2` — `ci` success, Release Please **skipped**.
- **`ListAgents`** before assuming a peer seat exists.

---

## 2. Immediate / time-sensitive

**No credentials to rotate.** None were created, read or logged; the Dovecot harness was not
started (Docker down). Credentials live where they always have — `velo.key` for the encrypted
account fields, the OAuth tokens in the local database; nothing in this session touched either.

**One blocked merge, and it is not a code problem.** **PR #96** (this docs pin) is green on
every check except `npm audit (prod deps)`, which failed **twice** with
`503 Service Unavailable — POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`.
The same command run locally on the same tree reports **`found 0 vulnerabilities`**, and the PR
changes no dependency. It was **not merged**: the standing rule is never to merge a red gate to
clear a queue. **To finish it:** re-check that the failure is still the 503 and not a real
advisory (`gh run view <id> --repo Pepper512/velo --log-failed`), then
`gh run rerun <id> --repo Pepper512/velo --failed`, and merge when it goes green. The same
flake hit #92 earlier in the session and cleared on its own.

**Jim only:**
1. **Make `rust MSRV` a required check** — unchanged since 2026-09-01:
   `gh api -X POST repos/Pepper512/velo/branches/main/protection/required_status_checks/contexts -f "contexts[]=rust MSRV"`.
2. **Remove the dead worktrees** — see the list in §7; `share-availability` is the live one and
   must stay.
3. **Glance at the vault edits** to `SPEC-F-4` (approval line, Task 13, coupling note) — unchanged
   from the previous handoff. The vault queue line for E2 part 3 was **not** written this session
   (the vault was not opened); the repo-side spec carries the landed status.

**Agent seat, cheap:** prune the merged local branches (`git branch -d` each; all merged).

Still parked, unchanged: **#278** (decision 6) · **PR E** · the Rust image proxy (privacy
enhancement) · E2 option (d) (raw fetch over the pooled session).

---

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is hardening it under his methodology (`docs/methodology/`,
pinned). The optimization audit is landed; dependency audit A/B/C landed, D next (plan to write),
E parked. **IMAP correctness line, complete for now:** move/expunge (#26), pooling (#37/#39/#73),
F-5 (#43, #45), F-4 (#44/#47/#50), the bug-fix queue (#52–#69), F-3/P19 (#71). What is left is
the capability split (P11) and the toolchain majors (PR D/E), then features.

**It runs on Windows and Linux as well as macOS** (Jim asked, 2026-09-03): Tauri v2; upstream
ships `.msi`/`.exe`, `.deb`/`.AppImage` (plus the Flatpak and RPM packaging #233 touched) and
`.dmg`; the release workflow's matrix builds on `ubuntu-22.04` and `windows-latest`. Two caveats:
the fork's own CI runs on Ubuntu only, so a Windows-only compile break would surface only in a
release build; and the release workflow is guarded to upstream (EX-007), so the fork has never
cut a Windows or Linux bundle. The platform-specific code is small (one Windows AUMID line, two
Linux blocks in `lib.rs`) and untouched by the hardening work.

**Governance this session, in one paragraph.** Jim was present: "go" on the E2 part 3 plan
(with the roadmap prompt as the standing instruction), the platform question, and the
review-model change mid-review. Every review finding across four passes is dispositioned on the
PR and in LOG.md; one HIGH was declined with the reason verified against the MSRV. The build seat
merged #73 under the standing rule.

---

## 4. What just happened (2026-09-03)

| PR | Merged | What |
|---|---|---|
| #94 `2c235a5` | build seat | **SPEC-FUI.** Migration 29: a partial unique index on `follow_up_reminders(account_id, thread_id) WHERE status = 'pending'`, preceded by a demotion of any older duplicate pending row to `'cancelled'` so the creation can never throw. Tier 2 — plan, threat pass and rollback approved by Jim before any code. Two legs both APPROVE, then a follow-up pass found the NULL-id test proved nothing (the NULL has to be on the *survivor*) — fixed and verified red against the old query |
| #92 `ca4ba28` | build seat | **SPEC-SB.** The speed budget in three commits: Reduce effects (every backdrop-filter and the hover/stagger animations, on by default on Linux), a 30-entry stale-while-revalidate message cache warmed for the selected thread's neighbours, and the virtualized list over a flat item model with `@tanstack/react-virtual` 3.14.10; five review rounds, nine legs, each round finding a real defect in the previous fix |
| #90 `91e01f6` | build seat | **SPEC-II.** Instant Intro: `b` / handshake → reply-all with the introducer in Bcc, own addresses out, "Thanks {name}, moving you to Bcc." above the quote; pure module + 28 tests, `b` dispatch (2), action-bar button (3), store `fromEmail` on open (1); three review passes, two Highs declined against source, five findings adopted |
| #88 `3b63d73` | build seat | **SPEC-FUR.** Follow-up reminders could never be inserted (upstream's `ON CONFLICT` upsert aimed at a plain index); select-then-update-or-insert in one pinned transaction, on the SQLite harness; sibling audit of all 19 ON CONFLICT statements clean; partial unique index recorded as the Tier 2 follow-up |
| #87 `48acaf7` | build seat | **SPEC-SIT.** Custom split-inbox tabs: a pure module with a Zod schema at the settings boundary, category/label/Reminders tabs, hide-when-empty, a requested tab never hidden, the strip by visible tab, the list by tab kind, a Settings editor; 25 pure + SQLite cases; two legs, both Highs on cross-account labels declined against the label store |
| #85 `ea18efc` | build seat | **SPEC-280-U.** The http scope matched by tauri-plugin-http's own matcher: both capability files, the exact allow list, the accepted and refused URL tables, with `urlpattern` 0.3.0 as a dev-dependency (Jim's decision 4; normal tree unchanged) |
| #84 `300f4e7` | build seat | **PR E.** mail-parser 0.11.8 (fixture suite first; two header lookups fixed — a named REQ-1.1 deviation; the `full_encoding` premise corrected to Shift_JIS), async-imap 0.11.3 (duplex wire test: names quoted once, LIST pattern sent bare), socket2 0.6.5, reqwest 0.13.4 with native-tls pinned on three builders and a form-body mock test; per-commit CI re-run where the concurrency group had cancelled it; Docker engine dead so the live harness stays open |
| #83 `675cc27` | build seat | **PR D.** TypeScript 6.0.3 → 7.0.2 (native, `tsc` 3.2 s → 0.4 s), Vite 8.2.2 + plugin-react 6.1.1, browser floor pinned to Vite 7's, `check-dist` in the build; packaged debug bundle smoke done by the agent through the accessibility tree; Gemini's "Vite 7 default is modules" declined against vite@7.3.6's shipped constant |
| #82 `4cdb231` | build seat | **SPEC-QSR.** Auto reminders on queued offline sends: the wish rides on the queued op, the reminder is set when the queue's send succeeds; reminder creation moved into the action layer |
| #80 `a7058cb` | build seat | **SPEC-AR.** Auto reminders on external sends: rule + weekend-skipping due time in a pure module, composer checkbox, Settings → Sending toggle and delay, providers return the thread id; two review legs, findings verified against source |
| #75 `e05f6cd` | build seat | **P11.** The capability grant split: `main.json` unchanged, `content.json` scoped by path for `thread-*`/`compose-*`, splash in no file, the three creator sites gated by one label-first rule; four review passes; Jim's five-step QA open |
| #73 `1116348` | build seat | **E2 part 3.** Pool owns `Option<S>`; LOGOUT on every clean eviction under a 3 s budget; `StaleCredential` + `BadId`; session-id shape; the invalidation event with nonce; frontend invalidation epoch with once-only retry; pending invalidations by identity; `imapIdentityOf` shared by the config builder and the session manager (host lower-cased). Four review passes; Rust 159 → 173, frontend 2,249 → 2,273 |

**Findings worth remembering.** *The carry item understated the bug*: #39 said a bump could
evict a session opened on the new credential (one wasted login); the re-grep found the other
interleaving — a bump landing inside `imap_session_open`'s one round trip inserted a session
tagged with the *retired* generation that survived until the next bump. *Then Grok found the
dual*: a config built before another window's bump whose Rust command starts after it — Rust
cannot see that one, so the frontend epoch closes it. *Then Gemini 3.8 found two holes in the
epoch fix* (identity recorded after the token-refreshing build; the retry reusing the old
row). *Review the fix, not just the change.* Also: `Instant::duration_since` saturates since
Rust 1.60 — a reviewer will call it a panic; check the MSRV before adopting. And: the vitest
module cache makes listener-registration tests order-dependent; `vi.resetModules()` + a fresh
`import` is the pattern.

---

## 5. Decisions

**Made by Jim, 2026-09-03 (the two that gate current work):**
1. **Migration 29: build it as planned** — including the `threads.splitTabs.test.ts`
   resolution **option 1** (re-frame the test rather than preserve its now-impossible
   duplicate seed). Landed as #94.
2. **Share Availability ships for Google-backed calendars only; the button is disabled for a
   CalDAV calendar**, because CalDAV recurrence is never expanded and a weekly meeting would
   compute as free. **CalDAV recurrence expansion (`RRULE`/`EXDATE`/`RECURRENCE-ID`/`UNTIL`/
   `COUNT`, timezone-aware `BYDAY`) is its own next calendar brief** — bigger than Share
   Availability itself, explicitly not folded into it.

**Pending approval: nothing.** Both open questions were answered; #95's brief is approved and
its Approval section says so.

**Made by Jim earlier this session:** "go" on E2 part 3 under the roadmap prompt · the
Gemini review leg is **3.8 Flash High** (supersedes "3.7 first, 3.8 if Grok is slow").

**Made by the build seat, all in LOG.md with reasons:** the ownership design (owned `Option<S>`
+ `BoxFuture` HRTB over the alternatives) · refuse a stale generation at `insert` rather than
re-tag · Rust-side emit · frontend epoch + nonce for the dual race · pending invalidations by
identity · every review disposition (adopted / residual / declined).

**Deliberately deferred + reason:** **CalDAV recurrence expansion** (larger than the feature it
would unblock; its own brief) · **a keyboard shortcut for Share Availability** (the vault's
`⌘⇧A` collides with `action.selectFromHere`, and Ctrl combos fire while typing in the composer;
rebinding a shipped shortcut is its own decision) · **the four hand-written reply-all copies**
(#90 left `replyAllRecipients` as the shared rule; consolidating them is behaviour-preserving
work of its own) · **the `loadThreads` row race** (#92: two loads on a fast folder switch, the
older can land its rows last — pre-existing, the new state is sequence-guarded) ·
**`getThreadLabelIds` N+1 per page** · per-window session binding (ADR-003) · LOGOUT on the
error path (protocol state unknown; a destructor cannot await) · a join set for spawned LOGOUTs
(three rare paths, bounded at 3 s) · E2 option (d) · the logging pass (#39 finding 5).

**Operational notes that bit us:** `cd src-tauri && …` in one Bash call **persists the cwd**
into the next call — use `(cd src-tauri && …)` subshells · the worktree guard refuses `for`
loops with computed `sed` arguments — plain `grep -n` instead · `gh pr checks` may be refused;
`gh pr view --json statusCheckRollup` works · Grok's long-prompt path offloads the prompt and
reads it back with its own tools (~14 min) · a test that resolves an async mock synchronously
cannot see a race in the awaited region (Gemini 3.8 N7) — hold the mock open with a deferred
promise.

---

## 6. Standing instruction — verify measurements before building to them

Two audits, ten falsified numbers, plus this session's: **a carry-list item described the
smaller of two interleavings**; **a reviewer's HIGH was a saturating call, not a panic** (check
the MSRV); **the handoff on disk was 30 commits behind origin** at session start (pull before
reading). Check the direction of staleness; treat review lanes as independent samples; a clean
merge can still be wrong — including ours.

---

<!-- ─────── RESUME CARD · `tail -30 HANDOFF.md` is self-contained ─────── -->

## 7. Resume card

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · **code pin `2c235a5`** (#94,
SPEC-FUI; the only SHA pinned — `git log --oneline 2c235a5..origin/main` shows what is above it) ·
**two open PRs: #95** the approved Share Availability brief (no code yet — build here) and
**#96** this docs pin (**green but for `npm audit`, which is failing on a registry 503, not a
finding — re-run it, do not merge red**) · main CI green · 185 files / 2,462 tests / Rust 206 +
4 ignored · **29** migrations · npm audit 0 locally · one dependency added this session,
pre-approved: `@tanstack/react-virtual` 3.14.10 exact.

**Jim confirmed those approvals in-session on 2026-09-03 and the build seat ran his prompt to the
end:** SPEC-QSR (#82), **PR D (#83, six rebase-merged commits)**, **PR E (#84, seven rebase-merged
commits)** and **SPEC-280-U (#85, the `urlpattern` dev-dependency test)** are on `main`; both plan
Approval lines are filled in. Toolchain now: TypeScript 7.0.2 (native), Vite 8.2.2, mail-parser
0.11.8, async-imap 0.11.3, socket2 0.6.5, reqwest 0.13.4 with native-tls pinned.

**Next action: build Share Availability from the approved brief in PR #95** — Jim approved the
scope on 2026-09-03: **Google-backed calendars only; the button is present but disabled for a
CalDAV calendar**, because `parseVEvent` expands no recurrence (`icalHelper.ts:56-122` — no
`RRULE`/`EXDATE`/`RECURRENCE-ID`), so a weekly standup is stored once and every later
occurrence would compute as *free*. The brief's tasks are risk-first and its two in-scope
defect fixes stand: the panel fetches fresh (nothing keeps the calendar cache warm — there is
no background calendar sync) and non-confirmed events do not block a slot. **CalDAV recurrence
expansion is the next calendar brief.** Then the rest of wave 2: Instant Event, one-line list
summaries. **Wave 1 is complete and #88's Tier 2 follow-up has landed.** Landed since the last
pin: **#94 migration 29** (`2c235a5`) — a partial unique index on
`follow_up_reminders(account_id, thread_id) WHERE status = 'pending'`, preceded by a demotion
of any older duplicate pending row to `'cancelled'` so the creation can never throw (nothing is
deleted). It fixes no live bug — #88 already holds the invariant in one pinned transaction —
and the plan says so. Before it: **#92 the speed budget** (`ca4ba28`), #90 Instant Intro, #87
split-inbox tabs, #88 the reminder-insert repair, #82, #83 (PR D), #84 (PR E), #85. **Review legs:** Gemini
**3.8 Flash High** via `agy` **and** Grok 4.6 via the `grok` CLI; diffs from committed SHAs;
verify every finding against source — and **review every fix you write**: #92 took five rounds
and *each one found a real defect in the previous round's fix*, three of them the same shape
(acting on the frame after a folder switch, when the previous folder's rows are still mounted
under the new key). Wrong-but-confident findings were common too: "the composer clobbers From"
(#90), "`readPlatform` never awaits" (plugin-os is synchronous), "split-mode tab changes never
re-run the loader" (the category is in its deps). Open for Jim: **P11's five-step QA**; PR E's
IMAP dev smoke; glances at the split tabs, at `b` on an introduction thread, and at the speed
budget on Linux; the rebrand `com.velomail.app` ADR; the F-3 follow-ups; reporter re-tests; the
findings PR E recorded (`List-Unsubscribe` never persisted on IMAP, a folded
`Authentication-Results` shape truncated, `__dirname` in `vite.config.ts`); **#90's gaps**
(Shift-letter rebinds can never fire — recorder vs dispatcher; `resolveFromAddress` ignores
display-name chips; four hand-written reply-all copies to consolidate onto
`replyAllRecipients`); **#92's gaps** (two `loadThreads` calls still race on a fast folder
switch and the older can land its rows last; row estimates ignore the root font scale until
measurement corrects them; `ResizeObserver` is a no-op in the tests, so re-measure on density
or pane changes is untested; `getThreadLabelIds` is an N+1 per page; "Select all" selects the
store while the count shows the filtered list). Manual and open: #240 Task 6, F-4's live
Done-when, E2 Done-when 2, the E2 part 3 and PR E live Dovecot tests (Docker's engine on this
Mac answers EOF; the app lives in a quarantine folder).

**Seats:** one build seat. Don't merge Tier 2 on one pair of eyes.

**Jim only:** `rust MSRV` required-check `gh api` (§2) · remove the **eight** worktrees
(`f1-decisions` locked — unlock first; `f2-email-links-open`; `f5-move-hygiene`;
`e2-part3-pool-carry`, locked, which also carried P11; `instant-intro`; `speed-budget`;
`followup-index`; and `share-availability`, which is the **live** one — its branch holds the
approved brief and is where the build continues. Everything in the others landed via #90, #92,
#94 and their docs PRs) · glance at the vault edits to `SPEC-F-4`.

**Verify first:** `git worktree list` · `gh pr list` · `ListAgents` · `gh run list --branch main --limit 2`.

**Get running:** `git checkout main && git pull && npm ci`, then
`npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'`,
`npx tsc --noEmit`, `npm run graph:check && npm run docs:check`,
`(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)`.
Work in your own worktree (`EnterWorktree`); inside one, use plain commands, `(cd …)` subshells,
and the file tools; the rustfmt hook reformats any `.rs` file you Edit.

**Read §6:** verify numbers, check which side is stale, treat review lanes as independent, and
remember a clean merge can still be wrong — including ours.

---

### THE NEXT ACTION, in one place

1. **Build Share Availability** on branch `share-availability` (PR #95), from the approved
   brief `docs/briefs/2026-09-03-share-availability.md`. Scope is settled: **Google-backed
   calendars only, the button disabled for CalDAV.** Tests first, per the brief's task list.
   Rebase on `origin/main` first if #96 has landed.
2. **Before writing anything**, run the re-verification list in **§1** — above all
   `git log --oneline 2c235a5..origin/main`, because a non-`docs:` commit there means every
   line number the brief cites must be re-grepped.
3. **Also outstanding:** re-run PR #96's `npm audit` job and merge it when green (§2). It is
   failing on an npm registry 503, not a finding — `found 0 vulnerabilities` locally.
