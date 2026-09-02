# Agent Roster

> The companion file `03-agents.md` and `06-decisions.md` refer to as "the
> roster." It lists the agent fleet: who's available, what each is trusted to
> do, and what each can reach. This file changes freely (its own log below) —
> no methodology version bump required. The *rules* about agents live in the
> core docs; this is the cast list.
>
> **This file is a vendor/model trust and credential-access register, not the
> organizational staffing chart.** Positions, responsibilities, and reporting
> relationships live in `TEAM.md` at the repo root. A model appearing in
> `TEAM.md` does not by itself grant anything listed here — credential scope
> is decided in this file, separately, and requires its own roster-log entry.

## Tracking policy

- **Build rows are dated snapshots, not "latest" — recorded to the limit of
  what the vendor exposes.** A build row records: the model/channel ID string
  the vendor publishes, client/tool version, adoption date, previous version
  (the rollback), and the shakedown window. Where a vendor cannot attest a
  fixed snapshot, the row is honestly labeled a **moving channel** and
  carries permanently elevated review instead of pretending to be pinned.
- **Shakedown is a review overlay, not a tier renumbering:** during the
  window, Tier-0 work gets Tier-1 review, Tier-1 gets Tier-2 review, and
  Tier-2 keeps its tier but requires full-diff human review plus cross-model
  review (Tier 3 is an incident workflow, not "stricter Tier 2"). Tier-0
  autonomy is mechanically disabled for the row during shakedown.
- **Research rows float on latest stable.** Exploration output feeds a brief
  and never merges directly, so churn risk is contained by the role itself.
- **Automated/pipeline use always pins exactly** — model invoked with no human
  in the loop (CI, product features, scheduled jobs) = exact version in that
  repo's ADR. Snapshots are for collaborators; pins are for components.
- **Model availability is checked per SURFACE, not per vendor.** The same
  model can be simultaneously Active on one access path (e.g. a general API
  catalog) and deprecated on another (e.g. a product's ChatGPT-signed-in
  harness). Record status against the surface this roster actually uses, not
  whichever surface a vendor announcement happens to describe. (Confirmed
  necessary in practice: GPT-5.3-Codex was Active in OpenAI's general API
  catalog while simultaneously deprecated inside Codex under ChatGPT sign-in
  — the roster follows the Codex-harness status, since that's the surface in
  use. See roster log, 2026-08-16.)

## Roles

- **Build** — implement from a brief (`02-work-loop.md`).
- **Adversarial review** — review another agent's work with a "find what's
  wrong" brief. Must be a *different model line* than the builder wherever
  practical — same-line review shares the builder's blind spots. Same-vendor
  is not the only correlation that matters: two different model tiers from
  the same vendor (e.g. two Claude models) can share alignment training,
  refusal classifiers, and the same harness, which is a real but easy-to-miss
  form of correlated failure — treat it the same as same-line review for
  Tier-2+ work.
- **Panel seat** — champion/attacker/ops seat in decision panels
  (`06-decisions.md`). Seats differ by mandate AND model line; correlated
  errors make same-model agreement weak evidence.
- **Research** — throwaway exploration, summarization, option-scouting.
  Lowest credential tier; output is input to a brief, never merged directly.
- **Asset generation** — produces final media (image/graphic) artifacts
  delivered as files, never repo-credentialed. Output is untrusted model
  output like any other (`05-security.md` §3) and is reviewed before use,
  not merged automatically. Distinct from Build: an asset-generation row
  never needs and never gets repository access — there is no code for it to
  read or write.

## The fleet

Build access is deliberately narrow — **two vendors** — because every
build-trusted row is a vendor that can read the code and a credential surface
that can leak. Research seats are cheap; build seats are trust.

| Agent | Vendor | Track | Trusted roles | Max tier | Credential scope | Notes |
|---|---|---|---|---|---|---|
| Claude (Claude Code / Cowork) | Anthropic | dated snapshot: `claude-opus-5` (adopted 2026-08-16; `claude-sonnet-5` unseated 2026-08-26 — available, holds no seat) | Build · Adversarial review · Panel · Research | 2 (with per-action confirmation on irreversibles) | Repo write on own branch, no merge rights; scoped runtime secrets; no prod secrets | Primary build agent; longest track record here. `claude-fable-5` is intelligence-tier, not an operating default — 30-day retention only, not ZDR-eligible; do not pin for regulated/sensitive work. `claude-mythos-5` is invitation-only (Project Glasswing) and out of scope for this roster. |
| Codex (in Codex CLI/IDE/cloud, ChatGPT sign-in) | OpenAI | dated snapshot: `gpt-5.6-sol` (adopted 2026-08-16) | Build · Adversarial review · Panel | 2 | Repo write on own branch, no merge rights; no prod secrets | First-choice cross-vendor reviewer of Claude-built work, and the current build-execution assignment inside Codex. `gpt-5.3-codex` and `gpt-5.2` are **deprecated in Codex under ChatGPT sign-in** (confirmed, learn.chatgpt.com/docs/models) even though `gpt-5.3-codex` remains Active in OpenAI's general API catalog — do not assign either to a build-execution role; `gpt-5.6-sol` is the current default. `gpt-5.3-codex-spark` is a separate text-only research-preview model (ChatGPT Pro only), not assigned to any role. Separately: `gpt-5.6-sol` showed the highest pre-deployment cheating rate METR has measured when run as an autonomous coding agent under test-scored conditions (exploited hidden test suites) — this is why CI, never the agent, speaks for test status, and why Sol's roster role in review-heavy positions is judgment, not unsupervised autonomous execution. |
| Gemini (via Antigravity, Gemini API/CLI) | Google | latest stable | Research · Panel seat | 0 | **Secrets-free clones only**; no repo write | Antigravity platform row below; promote to build only via a roster-log decision. **Surface correction 2026-08-20:** the `gemini` CLI (0.45.x) is deprecated for the individual tier (IneligibleTierError — Google migrated individuals to Antigravity); the live surface on this machine is Antigravity/`agy` — poll Gemini seats through it, not gemini-cli. `gemini-3.7-flash` (GA 2026-08-13) is notably strong and cheap on coding evals but is 3 days old at adoption — treat as a moving channel under shakedown review, not a pin candidate, until it stabilizes. |
| Antigravity (platform) | Google | latest stable (2.x) | Orchestration surface for Gemini agents | inherits Gemini row | Same as Gemini row; platform tool grants reviewed like MCP/tool grants | Platform, not a model (`03-agents.md` hard boundaries apply). |
| Kimi (Kimi Code, Kimi K3) | Moonshot AI | latest stable | Research · Frontend-design input (**provisional**, see promotion gate below) | 0 | Secrets-free clones only; no repo write | Different training lineage — useful panel diversity, and Moonshot's own API data-security documentation confirms submitted API data is not used for training (verified 2026-08-16; does not extend to the consumer kimi.com chat product, which is unconfirmed and should not be assumed to follow the same policy). Beijing-headquartered — PRC jurisdiction applies regardless of server location. **Open item, unresolved as of adoption:** a 2026-07-22 White House OSTP accusation that Moonshot covertly distilled Anthropic's Fable 5 to build Kimi K3; Treasury has threatened sanctions if confirmed, independent researchers have raised credible timeline-based skepticism, no enforcement action taken. Treat as open, not fact — but it is a live reason for caution on top of the jurisdiction question, not a reason to remove the row. |
| Grok (Grok 4.6, Grok Build) | xAI | latest stable | **Adversarial review (Tier-2 diffs, standing second cross-vendor leg — ADR-004, 2026-09-02)** · Research · Panel seat (attacker mandate) | 0 | Secrets-free clones only; no repo write; diffs and inline context only during review | A deliberately different voice. **Promoted 2026-09-02 (ADR-004):** four-for-four on Tier-2 diffs (#43, #44, #47 in this repo) finding real defects the other leg missed; credential scope unchanged. `grok-4.6` (launched 2026-08-12, verified) is a genuine intelligence peer on the Artificial Analysis Intelligence Index (61, tied with `gpt-5.6-sol`), which strengthens its panel-seat value — it does not change its credential scope. Acknowledged safety failures (image-generation safeguard failures, active multi-jurisdiction regulatory investigation) keep this row research/panel-only regardless of capability. |
| DeepSeek (DeepSeek API) | DeepSeek | latest stable | Research · Panel seat (logic/algorithms mandate) | 0 | **Secrets-free clones only**; no repo write | `deepseek-v4-pro` GA 2026-08-13 (verified against vendor coverage 2026-08-20): MIT-licensed open weights, 1M-token context, strong code/math reputation. Days old at adoption — a **moving channel** under shakedown review, not a pin candidate, and capability claims are unverified locally until a bake-off. Hangzhou-headquartered — PRC jurisdiction applies, same posture as the Kimi row. Added by explicit human decision 2026-08-20; see roster log. |
| Qwen (local — Qwen3-Coder-Next, self-hosted) | Alibaba (weights) / runs on Jim's hardware | pinned local snapshot: `qwen3-coder-next` GGUF/MLX quant, recorded per machine | Research · Local-only drafting (position 21) | 1 (draft only; integrator of record required for anything leaving local scope) | **Local machine only — no cloud egress by construction**; no repo credentials; may read `local_only` data classes (tax/legal/financial/identity/insurance) that no cloud row may touch | 80B MoE, ~3B active, ~46GB at 4-bit; ~71.3% SWE-bench Verified — real capability ceiling below every cloud build row, so output is always a draft. Jurisdiction question is moot for inference (weights run locally; nothing is submitted to any vendor). **Distinct from Qwen3.8-Max (API)** — that is a PRC-cloud surface and would need its own vendor-trust row + roster-log decision; do not conflate the two. Added 2026-08-25 by Jim's decision; see roster log v7. |
| GPT Image 2 | OpenAI | dated snapshot: `gpt-image-2-2026-04-21` | Asset generation | 0 | Tightly scoped image-API access only; no repo secrets | Primary graphic-generation assignment — #1 on the independent Artificial Analysis text-to-image leaderboard as of adoption. |
| Nano Banana 2 (Gemini 3.1 Flash Image) | Google | latest stable | Asset generation | 0 | Tightly scoped image-API access only; no repo secrets | Backup graphic-generation assignment. Google's own description positions this as "our best image generation and editing model" — the current flagship, not a discount tier. Nano Banana Pro (Gemini 3 Pro Image) is a specialized option for higher-resolution/Search-grounded work, used when that specifically justifies the extra cost/latency, not as a default. |

A **secrets-free export** is not a clone with files deleted — deletion
checklists leak (git history, dumps, fixtures, remotes, generated artifacts).
It is a **generated, allowlisted archive from a reviewed commit**: no `.git`,
no CI/infra files, no fixtures or dumps, no symlinks — and the actual export
is secret-scanned before handoff, with its manifest hash recorded. Research
agents receive it in a session with no integrations, no browser/MCP state,
no credentials, and restricted egress: they explore code shape, not the keys
to it.

**Degraded mode** (a build vendor is unavailable): Tier-2 work touching
auth/money/schema/CI proceeds with full-diff human review plus a *review-only*
third-line agent on a secrets-free export — never by granting a research row
build credentials, and never by skipping the second reader silently.

**Secrets-free draft → credentialed integration (standing mode).**
Research-row agents may produce drafts — code, docs, design — against a
secrets-free export as a normal operating mode, not only in degraded mode.
The pipeline is always: **research-row drafter → build-row integrator of
record → human merge.** The integrator converts the draft into a real branch,
runs the protected-base entrypoints, authors the PR, and owns its correctness
as if it were the author — "the drafter wrote it" is never a defense. No
agent ever merges (`03-agents.md`); there is no such thing as a model
"committer of record." Drafts are untrusted model output (`05-security.md`
§3) and are validated like any other external input. Each drafter↔integrator
pairing is recorded per position in `TEAM.md` and requires its own
roster-log entry; the position-12 Kimi design seat is the template. A
drafting seat never becomes a build seat through this mode — credential
scope still changes only via a roster-log decision.

**Tier 3 overlay:** in a declared incident, either build row may execute
repair above its normal ceiling under per-action human confirmation
(`02-work-loop.md` Tier 3), with mandatory retroactive review.

**Every row is a standing vendor-trust decision.** Adding a row = deciding that
vendor's models may read the code and data in scope. Record it once with the
ADR dependency block (`templates/ADR.md`): blast radius = what the scope
exposes, exit path = revoke tokens + remove integration. Removing a row =
revoking its credentials the same day, not just retiring the habit.

## Kimi K3 promotion gate

Kimi's frontend-design seat is provisional. All of the following must pass
before any credential-scope conversation starts, and a credential-scope
change itself still requires a separate roster-log decision:

1. **Local blind bake-off** against the incumbent (Claude Opus 5), on a real visual-direction/prototyping brief. Public benchmark
   or Arena rank is **not sufficient** on its own — it must be a local
   comparison.
2. **Security review.**
3. **Data-handling review** — reconfirm the API-not-used-for-training policy
   holds at review time (Moonshot's own docs, re-checked, not assumed from
   this entry).
4. **Code quality and accessibility** pass on bake-off output.
5. **One successful production-integration cycle**, supervised by the
   Claude-Opus-5 production-integration seat that currently owns
   integration of Kimi's design output.
6. **Any open distillation, export-control, or supply-chain allegation
   against the vendor must be treated as an open item requiring explicit
   resolution**, not silently carried forward. As of adoption, the OSTP
   distillation accusation (see fleet table above) is exactly such an open
   item and should be revisited, not ignored, before promotion.

## Pin list (production / automated use)

Per the tracking policy above, automated or pipeline use pins exactly.
Current pins as of adoption:

`claude-opus-5` · `gpt-5.6-sol` · `grok-4.6` · `kimi-k3`
(research-only, no repo access) · `deepseek-v4-pro` (research-only, no repo
access; moving channel under shakedown) · `gpt-image-2-2026-04-21` ·
`gemini-3.1-flash-image` (Nano Banana 2) · `qwen3-coder-next` (local
weights, position 21 — local-only, no cloud egress, no repo access)

**Not pinned as production defaults:** `claude-fable-5` / `claude-mythos-5`
(intelligence options, not operating defaults — retention/access terms) ·
`gemini-3.7-flash` (moving channel, 3 days old at adoption — revisit once its
shakedown window clears) · `gpt-5.3-codex` / `gpt-5.2` (deprecated on the
surface this roster uses) · `gemini-3.1-pro` / `gemini-3.1-deep-think`
(research row, floats on latest stable by design).

## Assignment defaults

- Tier-0/1 build → either Build-trusted row; pick by fit, not loyalty.
- Tier-2 build touching **auth, money, schema, or CI** → adversarial review by
  the *other* build line (with the shared-blind-spot checklist,
  `06-decisions.md`), then the human. Other Tier-2 work → human review alone
  is acceptable; cross-model review is a tool, not a tax.
- Decision panels → minimum two model lines across the seats; the attacker
  seat is never the same line as the champion it attacks.
- Research → cheapest adequate row; its output feeds a brief, never a merge —
  and per `03-agents.md`, nothing another agent wrote gets executed verbatim.
- **Bake-off before reversal.** A primary does not flip because a competing
  model gained a few points on one public index this week. Reversing a
  primary requires a local bake-off result, not a benchmark headline —
  otherwise the roster thrashes instead of improving. (Confirmed necessary:
  the Artificial Analysis Intelligence Index moved twice during the review
  that produced this roster; treating every movement as an action item would
  have meant reassigning roles weekly.)

- **Roster reviews are advocacy, not evidence.** Any model's review of this
  roster — external or internal — is panel input under `06-decisions.md`,
  not a decision. A reviewer that recommends expanding its own vendor's
  seats, credentials, or authority has a conflict of interest: treat that
  part of the recommendation as advocacy, re-verify it against primary
  sources, and require a bake-off or roster-log decision before acting on
  it. (Origin: a 2026-08-20 review session in which a Claude-authored
  critique recommended creating a Claude-model "committer of record" role —
  an authority the no-agent-merge rule exists to deny any model.)

## Roster log

- 2026-08-26 — v8: `claude-sonnet-5` removed from every seat and from the
  pin list by Jim's decision after the P01 bake-off (Opus 5 3-0 over
  Sonnet 5, PM seat; see TEAM.md change log). Sonnet stays a permitted
  Anthropic model under the Claude row (same vendor-trust decision, same
  scope) but is pinned nowhere. Kimi promotion-gate incumbent and
  production-integration seat text updated to Opus 5. Access-path note:
  Gemini CLI (`gemini`) returns IneligibleTierError on this account;
  Antigravity CLI (`agy`) is the Gemini door for now.

- 2026-08-25 — v7: added local Qwen row (`qwen3-coder-next`, self-hosted) by
  Jim's explicit decision — Research + local-only drafting, Tier 1 draft
  ceiling, no cloud egress by construction; the only row permitted to read
  `local_only` data classes. Same day, TEAM.md: position 14 gains Gemini 3.1
  Deep Think as standing third spec-review seat on High-risk specs; position
  19 gains DeepSeek V4 Pro as standing third code-review seat on Tier-2
  diffs (both secrets-free, no credential change to either row). Landscape
  check (web, 2026-08-25) noted but did NOT adopt: Qwen3.8-Max API
  (SWE-bench Pro 67.7 vs Sol 64.6, but PRC-cloud surface = new vendor-trust
  decision), GLM-5.3 (top open-source Terminal-Bench; candidate security
  panel seat), MiniMax M3 (best open-weight composite). Any of those enters
  only via its own roster-log decision + bake-off.

- 2026-08-20 — v6: Kimi promotion-gate condition 1 executed — local blind
  bake-off (frontend-design challenge, Kimi K3 vs Claude Opus 5 vs Claude
  Sonnet 5; judges Sol/Gemini/Grok blind, independent, unanimous):
  Opus 46.0, Kimi 38.7, Sonnet 32.7 of 50. Kimi beat the Sonnet incumbent
  on visual direction and code cleanliness; all three judges found the same
  fidelity defect (imprecise-date rule shown but not enforced in logic) and
  a11y gaps, so condition 4 (code quality + accessibility pass) is only
  PARTIALLY met. Conditions 2, 3, 5, 6 remain open. Reading: supports Kimi
  as a drafter behind a credentialed integrator; does not support any
  credentialed promotion. Full record: bake-off harness output (2026-08-20).
- 2026-08-20 — v5: Gemini surface correction — `gemini` CLI deprecated for
  the individual tier (IneligibleTierError, confirmed live); the Gemini row's
  surface is now Antigravity/`agy`, per the surface-tracking policy. Same
  day: the six-seat panel's consensus adopted into `TEAM.md` (position 16
  restructured as a discovery panel — DeepSeek + Kimi as independent agents,
  PM consolidates; position 19 gate now routes by builder's opposite line).
- 2026-08-20 — v4: added DeepSeek (`deepseek-v4-pro`) as a research/panel
  row, secrets-free only, by explicit human decision — verified against
  primary coverage first (GA 2026-08-13, MIT open weights, 1M context);
  PRC-jurisdiction posture matches the Kimi row, and the row is a moving
  channel under shakedown until it stabilizes. Two rule additions adopted
  from the same day's methodology review: the **self-dealing rule** for
  roster reviews (assignment defaults), and **secrets-free draft →
  credentialed integration** formalized as a standing operating mode with an
  integrator-of-record definition (no agent ever merges; there is no model
  "committer of record"). Context: an external Claude review of TEAM.md had
  recommended both a DeepSeek build-adjacent seat and agent committers —
  the former adopted properly via this entry, the latter rejected as a
  charter violation.
- 2026-08-16 — v3 (adopted into this workspace): merged two rounds of
  external cross-vendor review, each checked against primary sources before
  being applied. Corrected GPT-5.3-Codex from "Active" to "deprecated on the
  Codex-under-ChatGPT-sign-in surface, Active elsewhere" — surface-specific
  status is now a tracking-policy requirement, not a one-off note. Retracted
  an earlier false claim that Kimi's API has no training opt-out (Moonshot's
  own docs confirm submitted API data is not used for training); replaced it
  with a new, separately-sourced, unresolved OSTP distillation accusation as
  the live reason for Kimi's continued provisional status. Restored Kimi K3
  to the frontend-design research row with a formal promotion gate. Verified
  Artificial Analysis Intelligence Index figures directly (Opus 5: 63, Fable
  5: 62, Sol: 61, Grok 4.6: 61, Kimi K3: 60, Sonnet 5: 55, Gemini 3.7 Flash:
  56, Gemini 3.1 Pro: 48, GPT-5.3-Codex: 46). Added GPT Image 2 and Nano
  Banana 2 as asset-generation rows (new role category). Added the
  bake-off-before-reversal rule to Assignment defaults. Full reasoning and
  the 20-position organizational assignment this roster supports: `TEAM.md`.
- 2026-08-16 — v2: build fleet narrowed to Claude + Codex (dated snapshots);
  Gemini, Kimi, Grok moved to research/panel on secrets-free clones. Adopted
  from external review: credential-sprawl and cross-agent injection findings,
  plus the ROSTER-vs-security-baseline pin contradiction.
- 2026-08-16 — v1: initial roster (five vendors, latest-stable tracking).
