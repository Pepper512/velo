# Team — Organizational Assignments

> Twenty-one positions, primary model + backup/independent reviewer each. This is
> an **organizational** decision: who does what. It is not a credential
> grant — what any named model is actually trusted to read or write is a
> separate decision, governed by `docs/methodology/ROSTER.md`. A model
> appearing as "primary" below may still be a secrets-free, no-repo-access
> row in the roster (Gemini, Grok, Kimi, the two asset-generation rows all
> are).
>
> Source: independent model-landscape audit, three revisions, each checked
> against primary vendor documentation before being applied (not applied on
> request alone) — full reasoning, evidence links, comparison scores, risk
> flags, and the six-task bake-off plan live in the published audit
> ("Roster Verdict," v3, 2026-08-16). This file carries the resulting
> assignments only; see `docs/decisions/LOG.md` for the adoption entry.
>
> Jim is the human Product Owner, Chief Architect, final approver, and only
> authority who may approve specifications, permanent architectural
> decisions, production releases, or methodology changes. No model approves
> its own work.

## Assignments

| # | Position | Primary | Backup / independent reviewer | Credentialed? |
|---|---|---|---|---|
| 1 | Project Manager | Claude Code (Opus 5) (validated by B1B4 bake-off 2-0, 2026-08-25; validated vs Sonnet 5 by P01 bake-off 3-0, 2026-08-26) | Codex (GPT-5.6 Sol) | Both — build-credentialed |
| 2 | Sr. Manager of Software Engineering | Claude Opus 5 (won B1B4 bake-off 2-0, 2026-08-25) | GPT-5.6 Sol | Both — build-credentialed |
| 3 | Engineering Manager — Product & Frontend | Claude Opus 5 | Gemini 3.7 Flash | Opus only; Gemini secrets-free |
| 4 | Engineering Manager — Platform & Delivery | Claude Opus 5 | GPT-5.6 Sol | Both — build-credentialed |
| 5 | Principal SWE — Architecture & Security | Claude Opus 5 | GPT-5.6 Sol (mandatory) | Both — build-credentialed |
| 6 | Principal SWE — Platform & Data | Claude Opus 5 | GPT-5.6 Sol | Both — build-credentialed |
| 7 | Lead SWE — Frontend | GPT-5.6 Sol (won B3 bake-off 2-1, 2026-08-25) | Claude Opus 5 | Both — build-credentialed |
| 8 | Lead SWE — Backend & Integrations | Claude Opus 5 (won B2 bake-off 2-1, 2026-08-25; all backend incl. webhook/payment) | GPT-5.6 Sol | Both — build-credentialed |
| 9 | Senior SWE #1 — Frontend | GPT-5.6 Sol (won B3 bake-off 2-1, 2026-08-25) | Claude Opus 5 | Both — build-credentialed |
| 10 | Senior SWE #2 — Backend & Testing | Claude Opus 5 (won B2 bake-off 2-1, 2026-08-25) | GPT-5.6 Sol | Both — build-credentialed |
| 11 | Product/UI Designer | Claude Opus 5 | GPT-5.6 Sol | Both — build-credentialed |
| 12 | Frontend Designer / Design Engineer | Claude Opus 5 (won 2026-08-20 blind bake-off: 46.0 vs Kimi 38.7 vs Sonnet 32.7) | Kimi K3 (independent drafter, secrets-free — diversity seat retained) | Opus build-credentialed; Kimi secrets-free |
| 13 | Graphic/Visual Designer | GPT Image 2 | Nano Banana 2 (Nano Banana Pro for 4K/spatial work) | Neither — asset-generation rows, no repo access |
| 14 | Specification Writer | Claude Opus 5 | GPT-5.6 Sol (mandatory on High-risk specs); **standing third seat on High-risk specs: Gemini 3.1 Deep Think** (via Antigravity, secrets-free — strongest independent reasoning line, third vendor); Grok 4.6 optional contrarian fourth | Opus + Sol build-credentialed; Gemini + Grok secrets-free |
| 15 | Documentation Lead | Claude Opus 5 (won B5 bake-off 2-1, 2026-08-25; Gemini incumbent last on all 3 ballots) | Claude Opus 5 (same-line backup — acceptable, docs are Tier 0-1) | Opus build-credentialed |
| 16 | Brainstorming / Product Discovery Lead | Grok 4.6 + Gemini 3.1 Deep Think (independent, then synthesized by Claude Opus 5 as PM — position 1) | DeepSeek V4 Pro + Kimi K3 — each runs as a separate independent discovery agent; the PM consolidates all outputs (panel structure, like position 19) | All secrets-free |
| 17 | Research Analyst | Gemini 3.1 Pro / Deep Think | Grok 4.6 (contrarian seat) | Both secrets-free |
| 18 | QA, Test, and Release Lead | GPT-5.6 Sol (B6 skipped 2026-08-25 — B2 not close; terminal evidence stands) | Claude Opus 5 | Both — build-credentialed |
| 19 | Security and Adversarial Reviewer | Opus 5 ↔ GPT-5.6 Sol mutual gate — **routed by the builder's opposite line**: Opus 5 reviews OpenAI-built work, Sol reviews Anthropic-built work; never static, never optional | **DeepSeek V4 Pro — standing third code-review seat on Tier-2 diffs** (secrets-free export; LiveCodeBench 93.5, SWE-bench Verified 80.6 — strongest independent code-reading line outside the two build vendors); Grok 4.6 (panel-only, high-stakes ADRs); Gemini 3.7 Flash optional panel seat | Opus + Sol build-credentialed; all panel seats secrets-free |
| 20 | Accessibility and UX QA | Claude Opus 5 | Gemini 3.7 Flash | Opus build-credentialed; Gemini secrets-free |
| 21 | Local/Offline Engineer | Qwen3-Coder-Next (self-hosted, local weights) | Claude Opus 5 (integrator of record for anything leaving local scope) | Qwen local-only — no cloud egress, no repo credentials (roster row); Opus build-credentialed |

## Role boundaries worth stating explicitly

Four positions look adjacent and aren't — keep them distinct:

- **Product/UI Designer** (11) — what should exist and why: flows,
  information architecture, interaction model. No code, no pixel output.
- **Frontend Designer / Design Engineer** (12) — how it looks *as running
  code*: the component-level visual system. Touches code, no pixel-gen.
- **Frontend Engineer** (7, 9) — does it work: state, logic, tests, against
  an already-approved visual system. Touches code, no pixel-gen.
- **Graphic/Visual Designer** (13) — standalone brand/marketing pixels, not
  app UI at all. No code, needs actual pixel-gen — the only position neither
  build vendor can fill.
- **Local/Offline Engineer** (21) — the only seat whose inference never
  leaves the machine. Two jobs: (a) drafting/summarization over `local_only`
  data classes (tax/legal/financial/identity/insurance — FILING_STANDARD)
  that no cloud row may read, and (b) cheap bulk mechanical work offline.
  Capability ceiling is real (~71% SWE-bench Verified, below every cloud
  build row) — output is a draft, never merged directly; the Opus 5
  integrator of record owns anything that leaves local scope.

## Standing governance notes

- **Bake-off before reversal.** Don't flip a primary because a competing
  model scored a few points higher on a public index this week. Positions 1
  and 2 in particular have a documented close call (Claude Opus 5 vs. GPT-5.6
  Sol on the Artificial Analysis Intelligence Index, 63 vs. 61) that is
  explicitly *not* grounds for reassignment on its own — see the roster's
  Assignment defaults.
- **Correlated risk.** Claude is sole-primary in 13 of 21 positions (post-bake-off); Sol holds 7, 9, 18 outright. That's
  deliberate (longest-tracked build environment), and it's structurally
  offset, not just noted: every Tier-2 position (5, 6, 8, 10, 18, 19) hard-
  wires a live GPT-5.6 Sol seat, and two different Claude tiers sharing
  alignment training/harness does not count as independent review for
  Tier-2+ work — the mandatory reviewer on positions 5, 14, and 19 is Sol,
  not a second Claude.
- **Position 12 (Kimi) is not settled.** It stays in the seat because it's a
  genuinely independent, credential-free design specialist, not because it's
  confirmed best-in-class — and a live, unresolved provenance dispute
  (`docs/methodology/ROSTER.md`, Kimi fleet-table entry) is a reason for more
  scrutiny before promotion, not less.
- **Strongest-in-seat policy (Jim, 2026-08-25).** Optimization criterion is
  capability, not cost. Where evidence is decisive the strongest eligible
  model holds the seat now; where cross-vendor uncertainty remains, the
  incumbent holds until the queued bake-off settles it. Eligibility rules
  are unchanged: retention/ZDR gates (no Fable 5 in seats that read
  sensitive context), roster credential scope, and cross-line review
  requirements all still apply. Note Fable 5 loses to Opus 5 on the overall
  index anyway (62 vs 63) — its only measured edge is SWE-bench Pro
  (80.0 vs 79.2) and long-horizon runs, so no seat currently requires it.

## Bake-off queue (approved by Jim 2026-08-25 — run these)

Maps to the six task definitions in the published audit. Judges blind,
cross-vendor, panel structure per `06-decisions.md`.

- **B1 — Sr. Manager seat (2):** Sol vs Opus 5. Task: unattended
  long-horizon planning/synthesis. The documented 63-vs-61 close call gets
  settled by evidence, not index.
- **B2 — Backend seats (8, 10):** Opus 5 vs Sol. Task: end-to-end feature
  build (webhook + payment path included). Sol carries Terminal-Bench 88.8
  and Coding-Agent-Index 80; Opus carries SWE-bench Pro 79.2 — genuinely
  uncertain.
- **B3 — Frontend seats (7, 9):** Opus 5 vs Sol. Task: frontend build
  against approved visual system. Sonnet eliminated as primary by the
  2026-08-20 design bake-off (last of three).
- **B4 — PM long-horizon validation (1):** Opus 5 vs Sol. Task: unattended
  long-horizon orchestration. Validates the same-line PM upgrade.
- **B5 — Documentation (15):** Gemini 3.7 Flash vs Sonnet 5 vs Opus 5.
  Task: doc set from a real diff. Cheap to run.
- **B6 — QA/Release (18), optional:** Sol vs Opus 5. Task: planted-bug
  adversarial review + release checklist. Sol's terminal evidence is strong;
  run only if B2 is close.

## Change log

- 2026-08-26 — **Sonnet 5 unseated (Jim's decision, literal swap).** P01 bake-off
  (Sonnet 5 vs Opus 5, PM seat, blind, judges Sol/Gemini 3.1 Pro/Grok 4.6):
  Opus 5 won 3-0; Sonnet 5 reported unevidenced week-1 progress in the
  unattended replan (categorical evidence-discipline failure). Jim then
  directed: drop Sonnet 5 from every seat for Opus 5. Rows changed: 15
  backup, 16 synthesizer (also fixes the stale "Sonnet 5 as PM" text), 18
  backup, 21 integrator of record. Anthropic line is now Opus 5 only; seat
  count and Tier-2 Sol coverage unchanged. Historical bake-off scores and
  earlier log lines left verbatim. Record:
  /Volumes/DevEnvironment/projects/My-claude-projects/Development-Team-Utilization/bakeoffs/2026-08-26-P01/RESULTS.md.
  Also noted: `gemini` CLI is dead for this account (IneligibleTierError);
  Gemini seats run through `agy` (Antigravity). Roster side: ROSTER.md log v8.

- 2026-08-25 (bake-offs run) — Queue executed same day: B1B4, B2, B3, B5
  run blind with cross-vendor panels (Gemini via agy, Kimi K3, Grok 4.6;
  Sol judged B5). Results: Opus 5 won long-horizon (2-0), backend (2-1),
  docs (2-1, Gemini incumbent last on every ballot); Sol won frontend
  (2-1). B6 skipped per its own condition. Seat changes: 2 and 10 to
  Opus 5; 7 and 9 to Sol (Opus 5 backup); 8 Opus 5 made permanent; 15 to
  Opus 5; 1 validated; 18 held. Kimi vendor quota exhausted mid-run —
  B1B4 decided by a 2-judge panel (agy + grok), both non-contestant
  vendors. Full record: bakeoffs/2026-08-25/RESULTS.md (+ sealed mapping,
  ballots, submissions). METR caution on Sol stands: positions 7/9 are
  execution seats — CI speaks for test status, opposite-line review per
  position 19 is mandatory.
- 2026-08-25 (later) — **Strongest-in-seat directive (Jim):** capability now
  the seat criterion, cost secondary; where uncertain, bake off. Flipped on
  decisive evidence: 1 PM Sonnet→Opus 5, 3 EM Product Sonnet→Opus 5, 20
  A11y QA Sonnet→Opus 5 (same-line strict upgrades, no trust change); 12
  Frontend Designer Kimi→Opus 5 (2026-08-20 blind bake-off 46.0/38.7/32.7;
  Kimi retained as independent drafter seat). Interim Opus 5 on 7/8/9
  pending Opus-vs-Sol bake-offs (Sonnet eliminated from frontend primaries
  by same bake-off). Held pending bake-offs: 2, 10, 15, 18. Queue B1–B6
  added above. Claude-primary concentration rises — structural offset
  unchanged: every Tier-2 position keeps a live Sol seat, and position-19
  routing by builder's opposite line still governs review.
- 2026-08-25 — Jim's decision (recorded, not panel-derived): this file is the
  single agreed TEAM.md and becomes the truth for **Block Buzz** agents via
  `bootstrap-project`. Divergent "Vault (Aug 20)" draft (Fable 5 as PM, Kimi
  K3 primaries on 6/9/12/15/17, DeepSeek "Algorithms" seat) is **rejected** —
  no change-log or roster-log backing, contradicts the 2026-08-20 panel
  (zero primaries flipped), and Fable 5 is explicitly not an operating
  default in the roster. Three additions after a fresh model-landscape
  check (web, 2026-08-25): (1) position 14 gains a standing third
  spec-review seat — Gemini 3.1 Deep Think (top published reasoning:
  HLE 48.4 no-tools, ARC-AGI-2 84.6); (2) position 19 gains a standing
  third code-review seat — DeepSeek V4 Pro on Tier-2 diffs (secrets-free);
  (3) new position 21, Local/Offline Engineer — Qwen3-Coder-Next
  self-hosted, the only seat allowed near `local_only` data classes.
  Noted but NOT adopted (would need new vendor-trust rows + bake-off):
  Qwen3.8-Max API (beats Sol on SWE-bench Pro 67.7 vs 64.6 but PRC cloud
  surface — separate trust decision from local weights), GLM-5.3 (top
  open-source Terminal-Bench, candidate security panel seat), MiniMax M3
  (best open-weight composite 68.8). Roster side: ROSTER.md log v7.

- 2026-08-20 — Six-seat cross-vendor panel (Claude, Sol, Gemini, Grok, Kimi
  polled live; DeepSeek simulated and discounted — no CLI available) reviewed
  all 20 seats: **zero incumbent primaries flipped, no ties**. Adopted from
  the panel: Codex's position-19 refinement (the mutual gate routes by the
  builder's opposite model line, never static) and Jim's position-16
  decision (DeepSeek V4 Pro + Kimi K3 added as separate independent
  discovery agents; the PM consolidates — panel structure like position 19).
  Full record, ballots, and recorded dissent: the panel's CONSENSUS.md
  (2026-08-20). Roster side of the day's changes: ROSTER.md log v4/v5.
- 2026-08-16 — Adopted into this workspace from the "Roster Verdict" audit,
  v3, after two rounds of external cross-vendor review, both re-verified
  against primary sources. See `docs/decisions/LOG.md`.
