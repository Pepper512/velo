# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Code pin: `7e767e5`** (#63, #243 sidebar unread counts — the last commit on `main` that changed `src/` or
  `src-tauri/`). **The only SHA this file pins.** `git log --oneline 7e767e5..origin/main` —
  anything there that is not `docs:` means the pin is stale and every line number in the briefs
  must be re-grepped before citing.
- **Open PRs: none at writing** (this docs PR excepted). Never trust this line — run
  `gh pr list --repo Pepper512/velo`. #43–#47, #50–#63 all landed 2026-09-02/03.
- **Branches:** `main` plus the two dead worktree branches below. Remote branches for #43 and #44
  were deleted at merge; their local copies linger only inside this session's worktree.
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **Seats, as of 2026-09-02 08:00 UTC.** One build seat (this session ran as **Fable 5.1** under
  Jim's second delegation window, 06:12–08:12 UTC — LOG.md records the window, its terms, and the
  two deviations it named). Name **seats, never session ids**, and run **`ListAgents`** before
  assuming a peer is live.
  - **Merge permission** is with the build seat under the standing rule (green on the exact SHA,
    up to date, no unresolved conversation) — exercised on #43 this session.
  - **Independent review = two cross-vendor legs this session:** Gemini 3.7 via `agy` **and Grok
    4.6 via the `grok` CLI** (`grok -m grok-4.6 --disable-web-search --prompt-file …`). Grok is a
    **standing second Tier-2 leg since ADR-004** (Jim, 2026-09-02) — run both legs on every Tier-2
    PR. Both legs found real defects on every PR this day that the author missed, and they found
    *different* ones (LOG.md; on #50 Grok's three HIGHs were all real while Gemini approved).
    `agy` gotchas unchanged: flags before `--print`, prompt via a `.sh` wrapper, tell it not to use
    tools. Grok gotcha: with a long prompt it "offloads" the text and reads it back with its own
    tools — takes 5–10 minutes, the output file stays near-empty until it finishes.
  - **Worktrees:** the session's own worktree `.claude/worktrees/f5-move-hygiene` (branch
    `docs-post-63` checked out at the end) plus the **two dead ones from before** (their
    `src-tauri/target` build caches were deleted on 2026-09-02 when the disk hit 100 %; the
    worktrees and branches themselves are untouched)
    (`f1-decisions` locked, `f2-email-links-open`) — removal is still **Jim's**. Vitest excludes:
    `--exclude '**/node_modules/**' --exclude '**/.claude/worktrees/*/.claude/**'` when run from
    inside a worktree; the old `'**/.claude/**'` exclude hides the worktree's own tests.
- **State on `main` @ `7e767e5`:** frontend **166** files / **2,119** tests · Rust **132** + 1 ignored
  (the live Dovecot test) · **28** migrations / 32 tables · npm audit 0 · 0 service import cycles.
  **One dependency added, approved by Jim:** `sqlx = "=0.8.6"` direct (already in the graph via
  `tauri-plugin-sql`; CI asserts one copy) — #54, LOG.md. **One dependency question open for
  Jim:** `urlpattern` as a dev-dependency so the http-scope test can use the plugin's own matcher
  (brief SPEC-280 §Open for Jim).

---

## 1. Exact next step

**The full ordered plan is `docs/ROADMAP.md`** (pinned 2026-09-02): F-4 follow-up → bug-fix queue
(#297, #240, …) → carried hardening → Superhuman-parity waves, with the copy-paste prompt for the
next session at the end. **Jim made all eight gating decisions on 2026-09-02** (LOG.md): widen
`img-src` for #197, Rust fetch for #209, `@tanstack/react-virtual` approved, MCP ADR now, wire
P19/F-3, signing and distribution not yet, **Grok 4.6 is a standing second Tier-2 review leg
(ADR-004)** — run both legs on every Tier-2 PR.

**F-4 is complete in code: part 3 landed as #50 (`9bec56a`)** — the REQ-2.3 `NOT DELETED` belt,
the REQ-4 reconcile queue op, the "folder gone" path, migration 27, plus one follow-up commit
adopting Grok's three HIGHs (the op inserts suspects only and the next list *adopts* them; a
short LIST cannot count folders as gone; the op is pinned to its UIDVALIDITY generation). Every
disposition is on the PR and in LOG.md.

**#297 landed as #52 (`64de404`)** — the Bcc header no longer leaves the client over SMTP: a Rust
header-block scanner strips `Bcc`/`Resent-Bcc` after the envelope is built, a fail-closed guard
re-parses the outgoing bytes and refuses if a Bcc field is still present, Sent/Drafts copies keep
the header. Spec `docs/briefs/2026-09-02-297-bcc-strip.md`; Gemini and Grok both approve-with-nits,
every finding adopted (LOG.md).

**#240 landed as #54 (`b95468e`) — SQLite transactions are pinned.** Rust holds one connection
from the plugin's own pool per transaction (`db/tx.rs`: `BEGIN IMMEDIATE`, single open
transaction, 30 s idle watchdog, drop guard, binding parity with the plugin except booleans →
INTEGER); `withTransaction` and the migration runner run on that handle; the nine helpers the
Task 0 audit named take a trailing optional `DbExecutor`. Three review rounds (Gemini ×2, Grok)
all adopted or declined with reasons in LOG.md, including **one author process slip**: the first
diff sent to reviewers omitted the new Rust files. Closes upstream #264; #204 is unrelated
(ledger corrected); #205 is "re-test", a half-applied migration can no longer be produced but an
already-broken database is not repaired.

**#280 landed as #56 (`848ccaa`) and #241 as #57 (`51689ef`).** #280: four loopback http-scope
entries (no `*:*`), a URLPattern test that pins the allow list exactly, the connection test's
reason shown on both AI cards with credentials redacted, and the Ollama client refusing
redirects. #241: `FETCH_*` constants, three sites parenthesised, and a source-scanning guard in
`imap/fetch_guard.rs`. Both had two review legs, every finding dispositioned (LOG.md). Two
process notes from this stretch, recorded in LOG.md: the disk filled to 100 % (dead worktrees'
build caches removed), and the secret scan reads a PR's commit *history*, so a flagged test
fixture has to be kept out of every commit — #56 was rebuilt as two clean commits for that.

**#252/#253 landed as #59 (`b3725e7`) and #197 as #60 (`2d6d52a`).** #252: migration 28 adds
`smtp_username` + encrypted `smtp_password`, one resolver feeds the form's SMTP test and save
(the identical-ternary bug), `buildSmtpConfig` falls back per field so pre-28 accounts are
unchanged, an empty separate password is refused. #197: `img-src 'self' data: https:` behind
the sanitizer's opt-in; both reviews forced the right question and found one real gap — SVG
`<image>`/`<use>` `href` fetched on render and the old four-host CSP had hidden it — now
stripped by the blocker. Every review finding dispositioned (LOG.md). **The bug-fix queue's
P0/P1 tier is done:** #297, #240, #280, #241, #252/#253, #197.

**#276 landed as #62 (`4630e31`) and #243 as #63 (`7e767e5`)** — both Tier 1, one review leg
each (Gemini), every finding dispositioned in LOG.md. #276: upstream PR #275 reviewed and its
design adopted — `0` = no date filter (Gmail omits `after:`, IMAP passes `null` so the
existing Rust `UID SEARCH ALL` branch fires, per-message cutoff off), 2 y / 5 y / All time
options; one parser (`services/syncPeriod.ts`) replaces the two `parseInt(x) || 365` sites
that silently ate a stored `0`. #243: one grouped unread-per-label query into `labelStore`,
pills beside Inbox, Spam and user labels, and a typed **`velo-threads-changed`** event fired
by `executeEmailAction` after its local update so the counts (and smart-folder counts) refresh
on the user's own actions instead of the next sync; a first `Sidebar` render test. Carry from
the #63 review: on a permanent provider error the local rows keep the change while the store
reverts (pre-existing, `emailActions`).

**Next: the rest of the P2/P3 tail — #209/#265 first** (custom OpenAI-compatible base URL;
Jim's decision 2: a **validated Rust fetch command**, https/loopback only, no off-host
redirects, CSP stays tight — **Tier 2**: Rust + capabilities, plan with threat pass and
rollback before code, both legs), then #233 (Flatpak runtime bump, Tier 1), #204 (cancel the
connection test — Tier 2 if it reaches the Rust IMAP client), #281 (paste inline images,
composer, Tier 1). #278 (macOS signing) stays "not yet". After the tail: the carried
hardening items (E2 part 3, P11, P19/F-3 `LinkConfirmDialog`) and PR D/E plans. **Open for
Jim:** the `urlpattern` dev-dependency (above); reporter re-tests for #280 (real Ollama), #241
(Stalwart), #252 (a relay with split credentials), #197 (a newsletter with the block off),
#276 (an all-time resync on a large IMAP mailbox). **Manual, still open:** #240's Task 6 and
F-4's live Done-when; both need the running app.

**Still open on F-4:** the live Dovecot Done-when (scenarios 1–5 in
`docs/testing/dovecot/README.md`; manual, needs the running app — never run) and, Jim's call, a
persistent per-folder hold for "Keep them". **Merges are the build seat's** under the standing
rule — Jim reaffirmed it on 2026-09-02; Opus 5's Tier-2 carve-out was not adopted.

**Before that, read the Opus 5 full review** (`docs/reviews/2026-09-02-opus5-window-review.md`;
verdicts and dispositions in LOG.md). Its HIGH 1 — permanent delete had become a server-side
no-op after F-5 — is **fixed (#45, `ef7c91c`)**. Its HIGH 2 — the re-key transaction depends on
per-connection SQLite state over a pooled, unpinned `tauri-plugin-sql` connection — is **open and
Jim's to scope**: it is pre-existing for every `withTransaction` in Velo, but F-5 made it
load-bearing for a destructive identity rewrite. Own brief; candidate fix is a Rust command owning
one connection. The five MEDIUMs (per-message reap cost, UIDVALIDITY guard off for never-synced
folders, regex constraint detection, per-row inserts in `recordMissing`, and the **>50% stop
eroding across passes** — part 2 must evaluate it against the row count at first confirmation)
are recorded in LOG.md and belong to the next F-5/F-4 follow-up.

**Carried, no PR:** E2 part 3 carry list (unchanged from the previous handoff — the `Arc`/
`logout_arc` item, evictions without LOGOUT, `bump_credential_version` by ident, the cross-window
invalidation race, the unvalidated session-id wrapper, Done-when 9 and the live halves of 2/10) ·
**PR D** (TypeScript 5.9→6→7, Vite 8; Tier 2, needs Jim's plan approval) · **F-5 follow-ups**
recorded on #43: an old→new id refresh for UI state after a re-key (Grok M4), `withTransaction`
connection pinning (pre-existing, both reviewers), tombstones still visible to `threads.message_count`
until the destination syncs.

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

Expected on `main`: **166 test files, 2,119 tests; Rust 132 passed, 1 ignored.**

### Re-verify before acting

- `git log --oneline 7e767e5..origin/main` — a non-`docs:` commit there means the pin is stale.
- `gh pr list --repo Pepper512/velo` — none open at writing; this line ages fastest.
- `git worktree list` — three worktrees at writing (this session's plus two dead ones).
- `gh run list --branch main --limit 2` — `ci` success, Release Please **skipped**.
- **`ListAgents`** before assuming a peer seat exists.

---

## 2. Immediate / time-sensitive

**No credentials to rotate.** The Dovecot harness's throwaway credentials were used against
`127.0.0.1` only; the containers were torn down (`down -v`) at the end of the window.

**Jim only:**
1. **Make `rust MSRV` a required check** — unchanged since 2026-09-01:
   `gh api -X POST repos/Pepper512/velo/branches/main/protection/required_status_checks/contexts -f "contexts[]=rust MSRV"`.
2. **Remove the two dead worktrees** (unchanged; `f1-decisions` is locked, unlock first) — and now
   also this session's `.claude/worktrees/f5-move-hygiene` (everything in it landed via #43, #44
   and the wrap-up docs PR; its local branches `worktree-f5-move-hygiene`, `f4-vanished-uid-part1`
   and `docs/window-wrapup` can go with it).
3. ~~Mark the F-4 approval in the vault spec~~ — **done this session.** The vault
   (`~/Vaults/Pepper Knowledge/10 Projects/Velo/…`) **is reachable from this machine**; the earlier
   "not reachable from the checkout" note was wrong. The spec's approval line, Task 13 and the
   F-5 coupling note were reconciled directly. Jim should glance at the edit.

Still parked, unchanged: **P11** · **P19/F-3**.

---

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is hardening it under his methodology (`docs/methodology/`,
pinned). The optimization audit is landed; dependency audit A/B/C landed, D next (plan to write),
E parked. **IMAP correctness line:** move/expunge shipped (#26); E2 pooling landed (#37/#39);
**F-5 landed (#43)** with its permanent-delete regression fixed in #45; **F-4 part 1 landed (#44), part 2 planned.**

**Governance this session, in one paragraph.** Jim put the Fable seat in charge for two hours with
every project decision pre-approved and named the review legs; every decision made is in LOG.md
marked *(delegated)*; two deviations were named up front (Grok as reviewer, the Fable seat itself);
the vault was edited directly once it turned out to be reachable; an Opus 5 full review was
commissioned at the close as Jim asked.

---

## 4. What just happened (2026-09-02 06:12 → ~08:10 UTC)

| PR | Merged | What |
|---|---|---|
| #43 `2792251` | build seat | **F-5, option A rev 2.** Rust drains `COPYUID` from `async-imap`'s unsolicited channel inside the pooled checkout (no parser owned; backlog discarded before `UID MOVE` — a defect the brief did not know about); TS re-keys the row + attachments + soft refs in one transaction (deferred FKs, per-pair savepoints), tombstones the rest (`messages.moved_to`, migration 25), hides tombstones from thread view/search/actions, reaps on destination sync (folder-scoped), refuses a mapping from the wrong UIDVALIDITY generation; every provider action filters to live rows first. Live Dovecot: `:11143` mapping on the same turn, `:11144` COPY path with none. Gemini CHANGES REQUESTED (1H 2M 2L 1N) + Grok CHANGES REQUESTED (15) → 9 adopted, rest answered/recorded/declined with reasons on the PR |
| #44 `ef7c91c` | build seat | **F-4 part 1.** `DeltaCheckResult` per-folder attestation (`checked`/`error`/nullable `exists`; timeout → `Err` → pool evicts), `imapDeltaSync` skips unchecked and records fallback failures, `imapSearchAllUids` validated, migration 26, `reconcile.ts` (pure budget/cap/diff + generation-scoped suspect state machine + atomic `applySearchAll`) on the harness. Gemini CHANGES REQUESTED (1H 2M 1L 2N) and Grok CHANGES REQUESTED (11): everything adopted or already fixed, nothing declined. Nothing in it deletes; the part 2 plan is in `docs/briefs/` |

**Findings worth remembering.** *Both cross-vendor legs found defects the author missed, and
different ones* (#43: Gemini the reap scoping and the zombie race, Grok the whole-batch rollback
and the UIDVALIDITY generation). *CI caught a clippy lint the local run had not compiled* (first
push of #43) — CI stays the source of test status. *`async-imap`'s unsolicited channel was never
read by Velo* — it fills and drops silently; anything that needs an untagged response must clear
it first. *The vault is reachable.* *Spec citations were stale again* (F-4 Task 5's command already
existed) — re-grep, always.

---

## 5. Decisions

**Made by Jim directly this session:** the delegation window and its terms (LOG.md, verbatim).

**Made under delegation, all in LOG.md, marked *(delegated)*:** every F-5 build decision beyond the
brief (channel discard, COPY-fallback-has-no-mapping accepted, live-row filter on every action,
extra tables the re-key rewrites, option-B minimal build), every review disposition on #43 and
#44 (adopted / recorded / declined — each with its reason on the PR), the merge of #43, the
F-4 part 1 scope cut (substrate only), the vault edits, the part 2 plan.

**Deliberately deferred + reason:** F-4 part 2 (the deleting half; needs a plan read, not a
window's last 40 minutes) · the `withTransaction` connection-pinning question (pre-existing, every
transaction shares it; own brief) · the UI old→new id refresh after a re-key (small, separate) ·
Grok L8 on #43 **declined** (RFC 3501 defines a range as unordered) · Gemini NIT on a `moved_to`
index **declined** (already indexed via `message_id_header`).

**Operational notes that bit us:** the worktree guard refuses heredocs and `$(cat …)` — use the
file tools and `.sh` wrappers · `cd` persists between Bash calls; a `cd src-tauri` left later
`npx vitest` runs finding "no test files" · the harness translator rejects a `$n` used twice —
bind the value twice · `runMigrations` in a harness test leaves its BEGIN/COMMIT in `statements`;
slice from your own start index · Grok's long-prompt path is slow but works.

---

## 6. Standing instruction — verify measurements before building to them

Two audits, ten falsified numbers, plus this session's: **the vault was reachable** when HANDOFF
said it was not; **a spec task was already done in the tree**; **the reviewer's HIGH on the timeout
path was real** and the author had written the opposite in a comment. Check the direction of
staleness; treat review lanes as independent samples; a clean merge can still be wrong — including
ours.

---

<!-- ─────── RESUME CARD · `tail -30 HANDOFF.md` is self-contained ─────── -->

## 7. Resume card

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · **code pin `7e767e5`** (#63,
#243 sidebar unread counts; the only SHA pinned — `git log --oneline 7e767e5..origin/main`
shows what is above it) · **no open PRs** · CI green · 166 files / 2,119 tests / Rust 132 + 1
ignored · 28 migrations · npm audit 0 · `sqlx =0.8.6` is a direct dependency (approved).

**Next action: #209/#265 — custom OpenAI-compatible base URL through a validated Rust fetch
command (Jim's decision 2; Tier 2: Rust + capabilities, plan with threat pass and rollback
before code, both review legs).** Then #233, #204, #281 (#278 stays "not yet"). Verify each
in the tree, spec from the vault template, tier by the files touched, TDD, merge on green.
Landed so far from the bug-fix queue: #297, #240, #280, #241, #252/#253, #197, #276, #243.
Open for Jim: `urlpattern` dev-dependency (SPEC-280). Manual and open: #240 Task 6, F-4's
live Done-when, the "Keep them" hold; reporter re-tests for #280, #241, #252, #197, #276.
Generate reviewer diffs from committed SHAs; keep fake credentials out of literal form; a PR
that conflicts with `main` gets no CI run — rebase first. The build seat merges its own green
PRs.

**Seats:** one build seat. Independent review = Gemini via `agy` **and** Grok via `grok` CLI
(a standing second Tier-2 leg since ADR-004). Both found real defects on every PR this day —
on #50 Grok's three HIGHs were real while Gemini approved. Don't merge Tier 2 on one pair of eyes.

**Jim only:** `rust MSRV` required-check `gh api` (§2) · remove the three worktrees
(`f1-decisions` locked, `f2-email-links-open`, `f5-move-hygiene`) · glance at the vault edits
(F-4 spec task list, queue lines) — the vault **is** reachable from this machine.

**Verify first:** `git worktree list` · `gh pr list` · `ListAgents` · `gh run list --branch main --limit 2`.

**Get running:** `git checkout main && git pull && npm ci`, then
`npx vitest run --reporter=dot --exclude '**/.claude/**' --exclude '**/node_modules/**'`,
`npx tsc --noEmit`, `npm run graph:check && npm run docs:check`,
`(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)`.
Live Dovecot: `docs/testing/dovecot/README.md` (F-5 section). Work in your own worktree
(`EnterWorktree`); inside one, use plain commands and the file tools, and cd back to the root.

**Read §6:** verify numbers, check which side is stale, treat review lanes as independent, and
remember a clean merge can still be wrong — including ours.
