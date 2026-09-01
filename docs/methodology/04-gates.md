# Gates

> The mechanized half of the methodology. A rule is either enforced by a gate,
> or it is honor-system debt. This file tracks both. Principle 2: gates, not
> vigilance.

## The gate ledger

Every repo keeps this table in its ORIENTATION.md, honestly. The right-hand
column is the point: unmechanized rules are *known weaknesses*, reviewed
whenever the loop fails (a bug ships, a rule gets skipped).

| Rule | Gate | Status |
|---|---|---|
| No secrets in repo | secret scan (blocking) | mechanized |
| Types are sound | typecheck (blocking) | mechanized |
| Tests pass | test suite — **CI is the only source of test status; agents never author the pass bit** | mechanized |
| Style is consistent | formatter/linter (blocking) | mechanized |
| Deps are known-good | SCA + provenance audit (blocking) | mechanized |
| No dep without decision | lockfile-diff requires linked ADR | mechanized |
| Unlabeled work can't be Tier 0 | missing tier label → Tier 1 review requirements apply | mechanized |
| Tier-2 work gets flagged pre-code | boundary-manifest preflight (local) + CI re-check; triggers are a Tier-2 floor | mechanized |
| Brief exists | PR must link `briefs/…` (Tier 1+) or match the Tier-0 title template | mechanized |
| Plan/approval precedes code | approval is a platform review event by the human, before the first protected-file commit — not an editable checkbox | mechanized |
| No agent self-merge | agent credentials lack merge rights; human merges | mechanized |
| Agent attribution | required `Claimed-Agent:` commit trailer (bookkeeping, not security evidence) | mechanized |
| PR code can't reach secrets | untrusted CI phase: secretless, read-only, ephemeral; deploy phase runs only on a human-approved SHA | mechanized |
| Gates guard themselves | governance paths (workflows, package scripts, test discovery, fixtures, manifest, ORIENTATION) → Tier-2 floor; checks evaluate from the protected base, not the PR copy | mechanized |
| Required tests exist | coverage-map gate: every non-public procedure/job/webhook effect maps to anon/forged/cross-tenant cases, fail closed | mechanized |
| Authz enforced at handlers | negative test suite, run with middleware disabled | mechanized |
| Negative suite can't erode | immutable case IDs + expected tuples; any diff to cases/fixtures/harness → Tier 2 | mechanized |
| Tenant isolation survives pooling | falsifiable RLS harness test (see #8) | mechanized |
| Webhooks land exactly-once *in effect* | transactional inbox with crash-point tests (see #9) | mechanized |
| Rollback pairing works | N−1 app tested against expanded schema; contraction blocked until rollback window closes | mechanized |
| Forbidden actions stay forbidden | negative tests per Tier-2 change | per-change |
| Review budget spent top-down | — | honor system |
| Decision log stays current | PR template prompt | nudge only |

The first version of this ledger carried the loop's entire control plane
(briefs, test claims, self-approval) in the honor-system column — a direct
violation of Principle 2, caught in external review. The honor-system column
is for rules that genuinely *can't* be mechanized, not rules that haven't
been yet.

## Baseline CI (every repo, blocking, in this order — fail fast and cheap)

CI runs in **two phases with different trust**. The *untrusted phase* (gates
1–11) runs on every PR: secretless, read-only tokens, ephemeral workspace,
restricted egress — agent-authored code executes here and can steal nothing.
The *trusted phase* (previews needing real config, deploys) runs only on an
exact SHA a human has approved. Check definitions, runner config, and the
policy scripts they invoke come from the **protected base branch**, never
the PR's copy — CI attests *execution*; whether the right checks exist is a
governance question the PR cannot answer about itself.

1. **Secret scan** — on diff and on history for new branches. A hit blocks and
   triggers rotation; scrubbing history is not remediation, rotation is.
2. **Install with frozen lockfile** — deterministic builds; the lockfile is the
   dependency decision record made executable.
3. **Typecheck** (strict; no escape-hatch types in production code).
4. **Lint/format** — one tool, zero config debates, autofix locally.
5. **Tests** — unit + integration. New logic without tests fails review, not
   CI (CI can't know); coverage *ratchets* (may rise, may not fall).
6. **Dependency audit** — vulnerabilities (fail on fixable high/critical) and
   provenance/signature verification; alert when the count of provenance-
   verified packages drops.
7. **Negative authz suite + coverage map** — every protected resource called
   with no credentials, forged credentials, and *someone else's* credentials,
   asserting denial at the handler (middleware disabled in the harness), with
   exact statuses — an RLS filter returning empty is defense-in-depth, not a
   substitute for 401/403/404. The **coverage map** derives the inventory of
   procedures, jobs, and webhook effects at runtime and fails closed unless
   every non-public operation maps to generated negative cases — a new
   endpoint the suite doesn't know about is a red gate, not a silent gap.
   Cases carry immutable IDs and expected tuples (ratchet).
8. **Tenant-isolation harness test — falsifiable, not green-by-accident.**
   Seed positive sentinels for tenants A and B; assert own-visible AND
   other-hidden in *both directions* (a broken context that hides everything
   must fail, not pass). Exercise: no-context (must error, not return
   unscoped), commit, rollback, interleaved transactions on one pooled
   connection, and the request wrapper *and* job wrapper. Verify the
   connected role is non-owner/non-bypass and `FORCE RLS` is set. Prove the
   pool actually reuses backends (repeated `pg_backend_pid()` evidence or a
   constrained-pool harness) — otherwise the test never met the failure mode
   it exists for.
9. **Webhook inbox test — at-least-once with idempotent effects, not
   "exactly once."** The inbox row records received/processing/succeeded/
   failed; the entitlement effect and its success marker commit in ONE
   transaction. Tests crash the processor at each boundary — after receipt,
   after enqueue, mid-effect, before acknowledgement — and assert the paid
   user always ends up entitled exactly once. Naive duplicate-suppression
   (row exists → skip) permanently eats the entitlement when the first
   attempt's effect failed: that exact case is in the suite.
10. **Migration pairing gate** — expand/contract only: the *expand* step
    applies cleanly to a prod-schema copy, **the N−1 app runs green against
    the expanded schema** (that's what makes app rollback real — app
    rollback never rolls back applied migrations), and *contract* steps are
    blocked until the rollback window has closed and old workers drained.
11. **Tier preflight re-check** — CI re-runs the boundary-manifest
    classification and fails if the PR's tier label is below the floor or
    the Tier-1+ brief/plan-approval evidence is missing.
12. **Preview deploy** (trusted phase, human-approved SHA) — reviewers review
    behavior, not just code.

Supply-chain posture for the pipeline itself: CI configuration is Tier-2 by
definition (it's the thing that enforces everything else) · third-party CI
actions pinned to immutable revisions · CI tokens least-privilege and
short-lived · cloud access via OIDC federation, not stored keys.

Deferred until the product earns them (record as conscious debt, with the
trigger that un-defers them): SBOM archiving, artifact signing, SLSA-graded
build isolation, container image scanning if not yet containerized, SAST
beyond the linter. Trigger examples: first enterprise customer, first
compliance questionnaire, first incident with supply-chain scent.

## Local = CI (for the deterministic subset)

The **deterministic gates** (1–7, 11) run locally with one command
(`make check` or equivalent) and must match CI exactly — if they can
disagree, local is wrong; fix the drift the day it's noticed. The **hosted
gates** (8–10 against real pooling, 12) are honestly CI-only: local runs
their Compose approximations, and the ledger says so rather than pretending
parity.

## When a gate fires

A red gate is information, never an obstacle to route around. Overrides
(`--no-verify`, skipping CI, force merge) are Tier-2 actions requiring the
human, a reason in the PR, and an entry in the exceptions register if the
underlying cause survives the day. An agent that bypasses a gate has ended its
session's trust — that session's work gets full-diff review.

**Break-glass (Tier 3 only).** When the gates themselves depend on a failed
provider (database down → RLS/migration/preview gates can't go green) the
mechanized break-glass lane allows exactly two moves: redeploy a previously
green immutable artifact, or ship a no-schema patch that passes the offline
deterministic gates. Either requires one explicit human action and
auto-creates the incident record; full gates run retroactively on recovery.
Break-glass without an incident record is a firing offense for the process.

## When the loop fails

Every shipped bug is a gate-design question before it is a code question:
*which gate should have caught this, and why didn't it?* The answer is usually
one of: the rule was honor-system (mechanize it) · the gate existed but had a
hole (patch it) · no gate could catch it (accept, and say so in the ledger).
The bug's fix PR updates the gate ledger in the same diff — that's what makes
the system self-strengthening instead of self-documenting.
