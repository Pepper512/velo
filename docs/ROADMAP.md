# Velo fork — roadmap

> Pinned 2026-09-02 at `64de404` (#52). Sources: the vault build queues
> (`~/Vaults/Pepper Knowledge/10 Projects/Velo/Build Queue/`), the 2026-09-01 issue ledger, parity
> report and effort model, `docs/decisions/LOG.md` and `EXCEPTIONS.md`, and `HANDOFF.md`. Days are
> the effort model's build-days for one credentialed seat, tests and Tier-2 overhead included.
> Re-verify every number before building to it (`HANDOFF.md` §6).

## Where the project is

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` v0.4.21 and being hardened under Jim's methodology before any feature work.
The hardening line is most of the way through; the correctness line for IMAP is done in code (one
manual live check outstanding); the bug-fix queue from the upstream triage and the
Superhuman-parity enhancements have not started.

| Line | State |
|---|---|
| Methodology, CI gates, exceptions | Landed (#1–#12). EX-003/005/006/007 open by design |
| Optimization audit (20 items, P1–P20) | Landed except **P11** (capability split — needs Jim's manual QA) and **P19/F-3** (orphaned phishing dialog — Jim's product decision: wire or delete) |
| Dependency audit | A, B, C landed. **PR D** (TypeScript 6→7, Vite 8) and **PR E** (Rust parsers: `mail-parser` 0.11, `async-imap` 0.11, `reqwest` 0.13) not started; both Tier 2, plans needed |
| IMAP correctness | Move/expunge (#25/#26), session pooling E2 parts 1–2 (#37/#39), **F-5** (#43/#45), **F-4** (#44/#47/#50) landed. E2 part 3 carry list remains; F-4's live Dovecot Done-when has never been run |
| Bug-fix queue (upstream triage) | **#297 landed** (#52, `64de404`). 12 items left, 20 days; #240's plan drafted, awaiting Jim |
| Enhancement queue (Superhuman parity) | **Nothing started.** 10 items in 3 waves, 33.5 days |

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
| 2 | **#240** | Pinned SQLite transactions — **plan drafted, `docs/briefs/2026-09-02-240-pinned-transactions.md`, needs Jim: approval + `sqlx` direct dependency + 30 s watchdog.** Closes #264, re-verify #204/#205. **Also Opus 5's HIGH 2 on #43.** Plan estimate 3–4 days (model: 7) | 7.0 |
| 3 | #280 | `http://127.0.0.1:*` / `localhost` in the http scope; un-swallow `testConnection` | 0.5 |
| 4 | #241 | Parenthesise multi-item `uid_fetch` (Stalwart "no body") | 0.5 |
| 5 | #252/#253 | Separate encrypted SMTP credentials | 2.0 |
| 6 | #197 | Remote-image CSP — **Jim decides** widen `img-src` vs Rust proxy | 0.25 / 3.0 |
| 7–13 | #276, #243, #209/#265, #278, #233, #204, #281 | P2/P3: all-time sync, unread counts, custom LLM URL (CSP decision), macOS signing ($99/yr, Jim), Flatpak bump, cancel test, paste images | 8.5 |

### 3. Carried hardening items
- **E2 part 3** (#39's carry list): redundant `Arc` + `logout_arc`'s `try_unwrap` skipping LOGOUT,
  evictions without LOGOUT, `bump_credential_version` by ident regardless of version, the
  cross-window invalidation race, the unvalidated session-id wrapper, Done-when 9 and the live
  halves of 2/10 (Dovecot harness). Per-window session binding stays undone (ADR-003).
- **PR D** (toolchain majors) and **PR E** (Rust parsers) — plans to write, Jim approves.
- **P11** capability split — brief exists; needs Jim's 5-step manual QA.
- **P19/F-3** — Jim's product decision, then 1 day.

### 4. Enhancement queue — Superhuman parity (after the P0/P1 bugs)
| Wave | Item | Pri | Tier | Days | Gate |
|---|---|---|---|---|---|
| 1 | Auto Reminders default on external sends (skip weekends) | P1 | 1 | 1.5 | — |
| 1 | Custom split-inbox tabs from smart labels + Reminders tab + hide-empty | P1 | 1 | 3.0 | — |
| 1 | Instant Intro (reply-all, introducer → Bcc) | P2 | 1 | 0.5 | — |
| 1 | Speed budget: list virtualization, body prefetch, reduce-effects (#232) | P1 | 1 | 6.0 | **dependency approval** |
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
5. **P19/F-3** → **wire** `LinkConfirmDialog` (~1 day, Tier 1). Now a queued item, not a decision.
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
Read HANDOFF.md (tail -30 first, then §1). Verify: git worktree list, gh pr list, gh run list --branch main --limit 2, ListAgents.
Then build #240 from its approved plan, docs/briefs/2026-09-02-240-pinned-transactions.md: I approve the plan, the sqlx direct dependency (option A, version tracking tauri-plugin-sql's), and the 30 s idle watchdog. Start with Task 0 (the imapSync helper audit) and post its result on the PR before the Rust work. Tier 2: TDD (Rust tests on an in-memory pool first, then the withTransaction seam with a mocked invoke), capability entries called out in the PR, Gemini 3.7 via agy AND Grok 4.6 via the grok CLI as review legs (diffs only), verify every finding before adopting, merge on green — you own commits, pushes, PRs and merges. After it lands, re-verify #264/#204/#205 against the tree and record what #240 actually closed.
Do not run the F-4 live Dovecot Done-when unless the app can be driven; it is manual and recorded as open.
```
