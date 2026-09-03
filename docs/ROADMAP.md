# Velo fork — roadmap

> Pinned 2026-09-03 at `1b18160` (#71). Sources: the vault build queues
> (`~/Vaults/Pepper Knowledge/10 Projects/Velo/Build Queue/`), the 2026-09-01 issue ledger, parity
> report and effort model, `docs/decisions/LOG.md` and `EXCEPTIONS.md`, and `HANDOFF.md`. Days are
> the effort model's build-days for one credentialed seat, tests and Tier-2 overhead included.
> Re-verify every number before building to it (`HANDOFF.md` §6).

## Where the project is

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` v0.4.21 and being hardened under Jim's methodology before any feature work.
The hardening line is most of the way through; the correctness line for IMAP is done in code (one
manual live check outstanding); the bug-fix queue from the upstream triage is done (only #278,
macOS signing, waits on a decision); the Superhuman-parity enhancements have not started.

| Line | State |
|---|---|
| Methodology, CI gates, exceptions | Landed (#1–#12). EX-003/005/006/007 open by design |
| Optimization audit (20 items, P1–P20) | Landed except **P11** (capability split — needs Jim's manual QA). **P19/F-3 landed** (#71, `1b18160`): the phishing interstitial and banner are wired |
| Dependency audit | **All landed: A, B, C, D (#83), E (#84 `300f4e7`).** Open from E: `List-Unsubscribe` never persisted on IMAP (both parser versions treat it as an address list); a folded `Authentication-Results` shape truncated; async-imap 0.11.3 sends a LIST pattern bare (Velo only passes `*`); the live Dovecot harness unrun (Docker engine dead); Jim's IMAP dev smoke |
| IMAP correctness | Move/expunge (#25/#26), session pooling E2 parts 1–2 (#37/#39), **F-5** (#43/#45), **F-4** (#44/#47/#50) landed. E2 part 3 carry list remains; F-4's live Dovecot Done-when has never been run |
| Bug-fix queue (upstream triage) | **Done.** Every queued item landed (#297 … #281 as #69, `66a9355`); only #278 (macOS signing) remains, "not yet" by decision 6 |
| Enhancement queue (Superhuman parity) | **Wave 1: Auto Reminders (#80, #82) and custom split-inbox tabs (#87) landed.** 8 items left in 3 waves, 29 days. **Live defect found and fixed on the way (#88):** follow-up reminders had never inserted since upstream's migration v6 |

## Next up, in order

### 1. F-4 follow-up — **landed as #50 (`9bec56a`, 2026-09-02)**
- Built: the REQ-2.3 `NOT DELETED` belt, the REQ-4 reconcile queue op (compaction, 3-strike
  degrade, migration 27), the "folder gone" path; then Grok's review follow-up (op inserts only,
  partial-LIST bound, generation-pinned op, queued-path enqueue, degrade-before-fail).
- **Still open, manual:** the live Dovecot Done-when — scenarios 1–5 in
  `docs/testing/dovecot/README.md`, needs the running app; never run.
- Jim's call, from #47's reviews: a persistent per-folder hold behind "Keep them"; a UI refresh
  of stale ids after an F-5 re-key.
- Recorded for later: `SEARCH RETURN (COUNT)` (ESEARCH) for the belt; `exists` from the belt's
  own SELECT.

### 2. Bug-fix queue — the two P0s first (Tier 2)
| Order | Id | What | Days |
|---|---|---|---|
| 1 | **#297** | **Landed #52 (`64de404`, 2026-09-02).** Rust strips `Bcc`/`Resent-Bcc` after the envelope, fail-closed guard, Sent/Drafts keep it | 1.0 ✓ |
| 2 | **#240** | **Landed #54 (`b95468e`, 2026-09-02).** One Rust-held connection per transaction, `BEGIN IMMEDIATE`, idle watchdog; `sqlx =0.8.6` direct (approved). Closes #264; #204 unrelated (ledger corrected); #205 re-test. **Also Opus 5's HIGH 2 on #43 — closed.** Task 6 (manual sync check) open | 7.0 ✓ |
| 3 | #280 | **Landed #56 (`848ccaa`).** Four loopback scope entries (no `*:*`), URLPattern test with an exact allow-list snapshot, connection-test reason shown with credentials redacted, Ollama fetch refuses redirects. **Plugin-matcher test landed #85 (`ea18efc`)** with `urlpattern` as a dev-dependency (Jim, 2026-09-03) | 0.5 ✓ |
| 4 | #241 | **Landed #57 (`51689ef`).** `FETCH_*` constants, three sites parenthesised, source-scanning guard (`imap/fetch_guard.rs`). Reporter's Stalwart re-test open | 0.5 ✓ |
| 5 | #252/#253 | **Landed #59 (`b3725e7`, 2026-09-03).** Migration 28 (`smtp_username`, encrypted `smtp_password`), one resolver for the form's SMTP test and save, per-field fallback to the IMAP credentials | 2.0 ✓ |
| 6 | #197 | **Landed #60 (`2d6d52a`, 2026-09-03).** `img-src 'self' data: https:` behind the sanitizer's opt-in; review found and closed the SVG `href` gap in the blocker. Rust proxy stays queued as a privacy enhancement | 0.25 ✓ |
| 7 | #276 | **Landed #62 (`4630e31`, 2026-09-03).** Upstream PR #275 reviewed, design adopted; one strict parser for `sync_period_days`; `0` = no date filter on Gmail and IMAP; 2 y / 5 y / All time | 1.0 ✓ |
| 8 | #243 | **Landed #63 (`7e767e5`, 2026-09-03).** Grouped unread-per-label query, pills beside Inbox/Spam/user labels, `velo-threads-changed` fired after every local update; first `Sidebar` render test | 1.0 ✓ |
| 9 | #209/#265 | **Landed #65 (`c90d1f0`, 2026-09-03).** Custom OpenAI-compatible endpoint through the Rust `ai_fetch` command (https or loopback only, no redirects, allow-listed headers, caps); OpenRouter/DeepSeek named in the card; four review passes | 3.0 ✓ |
| 10 | #278 | macOS signing — **not yet** (decision 6), tied to the release/signing ADR (EX-007) | 0.25 |
| 11 | #233 | **Landed #67 (`1ea767e`, 2026-09-03).** GNOME 50 runtime, Node 24 extension, `--runtime-repo` on the bundle, dispatchable packaging job with gated uploads; proven by a green dispatched Flatpak build | 0.5 ✓ |
| 12 | #204 | **Landed #68 (`2dfc1b2`, 2026-09-03), Tier 2.** Cancellable connection tests: Rust abort-handle registry (tombstone, drop guard, duplicate-id abort), `connection_test_cancel`, the form's Cancel; three review legs | 0.5 ✓ |
| 13 | #281 | **Landed #69 (`66a9355`, 2026-09-03).** Paste a screenshot into the composer: type allow-list + magic-byte sniff, 5 MiB cap, shipped as the existing CID part | 0.5 ✓ |

### 3. Carried hardening items
- **E2 part 3** — **landed #73 (`1116348`, 2026-09-03)**: the pool owns its sessions (no `Arc`,
  no conditional unwrap), LOGOUT on every clean eviction under a 3 s budget, `StaleCredential`
  and `BadId` refusals at `insert`, session-id shape, the `velo-imap-sessions-invalidated` event
  with nonce, a frontend invalidation epoch with a once-only retry, pending invalidations by
  identity. Four review passes. Done-when 9 and the live half of 10 are `#[ignore]` Dovecot
  tests — **not run** (Docker down); Done-when 2 stays manual. Per-window session binding stays
  undone (ADR-003) — that is P11.
- **PR D** (toolchain majors) and **PR E** (Rust parsers) — **plans written and landed as docs**
  (#77 `1ccafbf`, #78 `2e4707b`; `docs/briefs/2026-09-03-pr-d-toolchain-majors.md`,
  `docs/briefs/2026-09-03-pr-e-rust-parsers.md`), each measured on throwaway copies and reviewed
  by two legs. **Awaiting Jim's approval; no code until then.** Each Approval section names the
  decisions the approval makes.
- **P11** — **landed #75 (`e05f6cd`, 2026-09-03)**: `main.json` unchanged, `content.json` scoped by
  path for `thread-*`/`compose-*`, splash in no file, the three creator sites gated by one
  label-first rule; four review passes. **Jim's 5-step manual QA is open** (spec §Verification).
  Next narrowing (own brief): unsubscribe → Rust, Ollama → `ai_fetch`, then `http` leaves content.
- **P19/F-3** — **landed #71 (`1b18160`)**: `LinkConfirmDialog` and `PhishingBanner` wired on the email link path.

### 4. Enhancement queue — Superhuman parity (after the P0/P1 bugs)
| Wave | Item | Pri | Tier | Days | Gate |
|---|---|---|---|---|---|
| 1 | ~~Auto Reminders default on external sends (skip weekends)~~ **landed #80 (`a7058cb`)** | P1 | 1 | 1.5 | — |
| 1 | ~~Custom split-inbox tabs from smart labels + Reminders tab + hide-empty~~ **landed #87 (`48acaf7`)**; the reminder insert it depends on repaired in #88 | P1 | 1 | 3.0 | — |
| 1 | ~~Instant Intro (reply-all, introducer → Bcc)~~ **landed #90 (`91e01f6`)** | P2 | 1 | 0.5 | — |
| 1 | ~~Speed budget: list virtualization, body prefetch, reduce-effects (#232)~~ **landed #92 (`ca4ba28`)** | P1 | 1 | 6.0 | approved |
| 2 | Share Availability in the composer | P1 | 1 | 4.0 | — |
| 2 | Instant Event — `.ics` first, AI second | P2 | 2 | 3.0 | LLM→calendar boundary |
| 2 | One-line summaries in the thread list | P2 | 1 | 1.5 | — |
| 3 | Local loopback MCP server, draft-only | P2 | 2 | 8.0 | **ADR** |
| 3 | State Auto Labels + opt-in auto-archive | P2 | 1/2 | 3.0 | — |
| 3 | Shortcut coaching + inbox-zero moment | P2 | 0–1 | 3.0 | — |

Deferred, deliberately (≈163 days if all done): Auto Drafts 2.0, Ask AI over calendar/tasks, voice,
contact stats, Daily Brief, autocorrect, #208 SSO, #152/#153, #257 Graph/shared mailboxes (15),
#292 S/MIME (25, ADR), team features (~40), mobile (~60). Non-goals: read statuses, auto-send.

## Decisions — made by Jim, 2026-09-02 (LOG.md has the record)
1. **#197** image CSP → **widen `img-src https:` behind the opt-in** (¼ day). Rust proxy queued as a later privacy enhancement.
2. **#209/#265** custom LLM URL → **validated Rust fetch command** (https/loopback only, no off-host redirects). CSP stays tight.
3. **Speed budget** → **`@tanstack/react-virtual` approved** as the virtualization dependency.
4. **MCP server** → **write the ADR now**, build in wave 3.
5. **P19/F-3** → **wire** `LinkConfirmDialog` (~1 day, Tier 1). **Landed #71 (`1b18160`).**
6. **#278** macOS signing → **not yet**, tied to 8.
7. **Grok 4.6** → **standing second cross-vendor leg on Tier 2** (ADR-004; roster row moved). The Tier-2 human-merge carve-out is not adopted.
8. **EX-007** distribution → **not yet**; revisit with an ADR after #297 and #240 land.

Decisions still gating nothing today: none. Open ADRs to write: MCP server (item 4), release + signing (item 8, later).

## Standing Jim-only chores
- `rust MSRV` required check: `gh api -X POST repos/Pepper512/velo/branches/main/protection/required_status_checks/contexts -f "contexts[]=rust MSRV"`.
- Remove the dead worktrees (`f1-decisions` locked, `f2-email-links-open`, and this session's
  `f5-move-hygiene` — everything in it landed).
- Glance at the vault edits to `SPEC-F-4` (approval line, Task 13, coupling note).

## Totals
Recommended backlog after the F-4 follow-up: **21 days of fixes + 33.5 days of enhancements**, of
which #240, the MCP server and the speed budget are 40%. The cheapest twelve items are 6.5 days and
include both P0 security fixes.

## The prompt for the next session

```
Read HANDOFF.md (tail -30 first, then §1) after `git pull --ff-only`. Verify: git worktree list, gh pr list, gh run list --branch main --limit 2, ListAgents.
Enhancement wave 1 is complete on main (#80/#82 auto reminders, #87 custom split-inbox tabs, #90 Instant Intro, #92 the speed budget) and the follow-up reminder insert is repaired (#88). Next: the Tier 2 follow-up from #88 — a partial unique index on follow_up_reminders(account_id, thread_id) WHERE status = 'pending' (a migration: plan, threat pass and rollback committed before any code; Tier 2 wants the plan approved before code). After it, wave 2 from docs/ROADMAP.md §4 in order — Share Availability in the composer, then Instant Event, then one-line list summaries — briefs first, one PR per item. Review legs: Gemini 3.8 Flash High via agy AND Grok 4.6 via the grok CLI, diffs from committed SHAs; verify every finding against source before adopting; and review every fix you write, not just the change — on #92 five rounds each found a real defect in the previous round's fix. You own commits, pushes, PRs and merges. No dependency beyond the ones already approved; ask before any other.
Do not run the manual checks (P11 QA, F-4 live Done-when, #240 Task 6, E2 Done-when 2, the E2 part 3 and PR E live Dovecot tests, PR E's IMAP dev smoke, the split-inbox tabs glance, the Instant Intro glance, the speed-budget glance on Linux); they are recorded as open for me.
```
