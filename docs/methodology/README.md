# Methodology

**Version 1.3.0** · changelog at the bottom of this file

An engineering methodology for one human directing AI agents. Its premise:
human judgment is the scarce resource, so the system concentrates it where it
matters (decisions, boundaries, irreversible actions) and mechanizes
everything else. It is deliberately **stack-agnostic** — technology choices are
per-project decisions recorded in each repo's ADR-000, so this folder never
goes stale when a framework does.

## The files

| File | What it governs | Read when |
|---|---|---|
| `01-principles.md` | The ten principles everything derives from | Once, carefully; again when a rule feels wrong |
| `02-work-loop.md` | Brief → plan → build → gates → review → land · risk tiers · where review time goes | Starting any task |
| `03-agents.md` | Agent charter: session protocol, hard boundaries, handoffs | Every agent, every session |
| `04-gates.md` | Mechanized enforcement: baseline CI, the gate ledger, what to do when the loop fails | Setting up a repo; after any shipped bug |
| `05-security.md` | Security baseline by attack surface · [ship]/[GA]/[hardening] | Tier-2 work; new project day one |
| `06-decisions.md` | Decision log, ADRs, adversarial panels, dependencies, exceptions | Any decision that outlives the day |
| `07-operations.md` | Live controls, the quarterly hour, dormant controls with activation triggers | Quarterly; when compliance questions arrive |
| `ROSTER.md` | The agent fleet: models, trusted roles, credential scopes, tracking policy | Assigning work; adding/removing an agent or vendor |
| `TEAM.md` | Default 20-position organizational roster (who does what) — companion to `ROSTER.md`, not a credential document | Staffing a new project's team; adjust per-project, don't re-derive from scratch |
| `templates/` | BRIEF · ADR · EXCEPTIONS · INCIDENT · ORIENTATION | As referenced |

New here? Read `01` and `02`, skim `03`–`07`, and start working — the loop
teaches the rest. Agents: your required reading is defined in `03-agents.md`.

## Adopting into a repo

1. Copy this folder to `docs/methodology/` in the repo. The copy is **pinned**:
   repo-local wins over any newer global version until deliberately updated.
2. Create `ORIENTATION.md` at the repo root from the template — including the
   repo's own gate ledger, honestly filled in.
3. Create `docs/decisions/` with `LOG.md`, `EXCEPTIONS.md`, and `ADR-000.md`
   (the stack decision).
4. Wire the baseline CI from `04-gates.md`. Until a gate is wired, its rule is
   honor-system — say so in the ledger.

## Precedence

1. The human's explicit instruction for the current task.
2. The repo's `ORIENTATION.md` and pinned `docs/methodology/`.
3. This global copy.

Conflicts are followed top-down and *named in the handoff* — silent conflict
resolution is how two documents end up both wrong.

## Versioning & drift

- This folder is versioned semantically: patch = wording, minor = new/changed
  rule, major = changed architecture of the system.
- Every repo's pinned copy records its version. A repo more than one **minor**
  behind gets an entry in its exceptions register — drift is allowed, but only
  visibly (the same rule as every other deviation).
- Rule changes happen by the methodology's own standard: twice-contradicted
  rule → fix the rule → changelog entry with reasoning (Principle 10). The
  changelog is this system's decision log about itself.

## Changelog

- **1.3.0** — Round-two external review (Codex, five seats; disclosed
  single-line correlation) — verdict "adopt with blockers fixed," blockers
  now fixed. Control plane: two-phase CI (untrusted secretless PR phase;
  trusted phase only on human-approved SHA) · governance paths (workflows,
  package scripts, test discovery, fixtures, ORIENTATION, boundary manifest)
  get a Tier-2 floor and evaluate from the protected base · coverage-map
  gate proves required negative tests exist, fail closed · approval is a
  platform event preceding the first protected commit · import-graph
  labeler replaced by an auditable fail-closed boundary manifest with local
  preflight (triggers are a Tier-2 floor — resolves the matrix
  contradiction) · negative cases carry immutable IDs/tuples. Correctness:
  webhook "exactly once" replaced by transactional inbox (at-least-once +
  idempotent effects, crash-point tests — naive dedup could permanently eat
  a paid entitlement) · falsifiable RLS harness test (positive sentinels
  both directions, backend-reuse evidence) · migration pairing gate (N−1
  app vs expanded schema; contraction blocked until rollback window closes)
  · jobs get tenant context from verified ingress bindings. Agents: prose
  commands never executed — other agents' work runs only as repo code via
  protected-base entrypoints in the sandbox · trailers renamed
  `Claimed-Agent:` (bookkeeping, not security evidence; crypto provenance
  dormant) · governance never edited in work PRs · secrets-free *export*
  (allowlisted archive, scanned) replaces the clone checklist · shakedown
  as review overlay; degraded mode for a lost build vendor · Tier 3 as
  workflow overlay + mechanized break-glass lane. Ops: quarterly control
  review (90 min, honest name) · mid-deploy DB-outage state machine ·
  queue-health alerts + Stripe reconciliation · internal RTO/RPO at GA.
  Security: magic-link consume via same-origin POST (scanner-safe) · full
  webhook contract · R2 authority envelope. Stack Rev 3 recorded in Notion:
  one host/one image/two supervised processes (web + worker), Vercel
  removed, SSE cut from v1, node-postgres pooled + pg-boss polling,
  Better Auth exact-pin with reopen tripwire.
- **1.2.0** — Adopted the surviving findings of an external five-seat review
  (methodology's own panel process, outside seats). Headline: the control
  plane is now mechanized — unlabeled work defaults to Tier 1 (labels by path
  + import-graph, closing the self-classification hole) · CI is the only
  source of test status · no agent self-merge, mandatory agent trailers,
  brief-link gate · negative-authz suite is a ratchet · new gates for
  two-tenant pooled RLS leak and webhook double-delivery. Security: full RLS
  harness spelled out (owner ≠ app role, FORCE RLS, in-transaction
  `set_config`, jobs included — pooler failure modes are why) · magic-link
  hygiene + pinned-auth-library rules ([ship]). Agents: no executing
  instructions from other agents' output (cross-agent injection boundary) ·
  assumptions touching persistence/auth/money always stop · ORIENTATION is
  always-on context. Decisions: shared-blind-spot checklist in adversarial
  briefs. Operations: scripted access-diff quarterly hour · the 3am kit.
  ROSTER: build fleet cut to Claude + Codex on dated snapshots;
  Gemini/Kimi/Grok research-only on secrets-free clones (resolves the
  pin-vs-latest contradiction). Checkout/billing/legal copy is Tier 1.
- **1.1.0** — Added `ROSTER.md` (multi-vendor agent fleet: track-latest policy
  with pin-when-automated rule, trusted roles, credential scopes as standing
  vendor-trust decisions). New rules in `03-agents.md` (roster-bounded
  operation; cross-model adversarial review) and `06-decisions.md` (panel
  seats differ by model line — same-model agreement is correlated, not
  corroborating).
- **1.0.0** — Initial version. Written from scratch for solo-operator + AI-agent
  development: two-axis risk tiers (blast radius × reversibility), gate ledger
  with honest honor-system tracking, agent charter with hard boundaries,
  attention-budget review model, adversarial decision panels with recorded
  dissent and tripwires, evidence-as-byproduct operations with dormant-control
  activation triggers, and stack-agnostic core with per-project ADR-000.
