# The Work Loop

> How work moves from idea to production when one human directs AI agents.
> The loop is the same for every task; only the ceremony scales (see Tiers).

## The loop

```
IDEA
 └─► BRIEF        human writes (or approves) a brief: outcome, constraints, not-doing
      └─► PLAN    agent proposes an approach; human approves it (Tier 2+)
           └─► BUILD   agent builds exactly the brief; questions > assumptions
                └─► GATES   CI verifies mechanically (see 04-gates.md)
                     └─► REVIEW  human reviews what deserves human review (see below)
                          └─► LAND    merge, deploy, log
                               └─► LOG   decision log entry if anything was decided
```

Rules of the loop:

1. **No work without a brief.** A one-sentence brief is fine for Tier 0. The
   brief is the contract; agents build the brief, not their interpretation of
   your mood. Template: `templates/BRIEF.md`.
2. **One task in flight per agent.** Finish and land before starting the next.
   Parallel agents are fine; parallel half-finished tasks under one agent are not.
3. **Questions beat assumptions.** An agent that hits ambiguity stops and asks.
   An assumption that must be made anyway is written into the PR as
   `ASSUMPTION:` — assumptions are reviewable objects, not silent defaults.
4. **The gates always run.** No tier skips CI. "It's tiny" is how tiny
   disasters ship.
5. **Land means done.** Merged, deployed (or deployable), logged. A task that
   is "done except deploy" is not done; it is inventory, and inventory rots.

## Tiers: blast radius × reversibility

Classify every task before starting. When in doubt, round **up**.

|  | **Reversible** (rollback/flag/restore exists and is tested) | **Irreversible** (or rollback is theoretical) |
|---|---|---|
| **Contained** (one module/feature; no auth, money, PII, schema, infra, deps) | **Tier 0 — Autonomous** | **Tier 2 — Supervised** |
| **Wide** (crosses boundaries; touches auth, money, PII, schema, infra, deps, or public API) | **Tier 1 — Checked** | **Tier 2 — Supervised** |

**Tier 0 — Autonomous.** Agent works from the brief alone. Gates verify. Human
reads the PR summary and the diff *stat*, spot-checks at will, merges.
Examples: styling, docs, test additions, internal refactor with tests, UI copy
— *except* copy in checkout, billing/dunning email, or anything legal-adjacent,
which is Tier 1: users act on those words and cards get charged.

**Tier 1 — Checked.** Agent proposes a short plan **in the PR body before any
product file changes on the branch** — a plan written after the code is a
summary, not a plan. Human approves plan, agent builds, human reviews the
**boundary diff** — every file where the change touches a trust boundary — plus
the tests. Examples: new feature in existing patterns, new internal endpoint,
non-trivial refactor.

**Tier 2 — Supervised.** Plan approved *before code*, including a threat pass
(`templates/BRIEF.md` § Threat) and a written rollback path. Human reviews the
full diff. Anything the change makes possible-but-wrong gets a negative test.
Examples: auth/authz changes, payments, migrations, data deletion/export, new
dependencies, infra/deploy changes, anything touching more than one tenant's
data, public API changes.

**Tier 3 — Incident.** Not a permission level — a **workflow overlay**: any
rostered build agent may execute incident repair under per-action human
confirmation, regardless of its normal max tier. Production is broken or
actively exploited. Smallest safe fix now, with a second set of eyes if
available (a second agent adversarially reviewing counts). If the normal
gates themselves depend on the failed provider, use the **break-glass lane**
(`04-gates.md`): redeploy a previously green immutable artifact or ship a
narrowly scoped no-schema patch with offline checks and one explicit human
action — full gates run retroactively. Within 24h: retroactive brief,
decision-log entry, and a follow-up task for the real fix. Speed is allowed;
amnesia is not.

### Automatic tier assignment (mechanized — see `04-gates.md`)

Tiers are assigned by machine, not by the agent's description of the work:

- **Unlabeled work defaults to Tier 1, never Tier 0.** Tier 0 is a label the
  gate grants, not one the agent claims. This closes the "internal refactor
  with tests" laundering path: dangerous work cannot self-classify downward.
- **Automatic triggers are a Tier-2 FLOOR, and they run before code.** The
  matrix above is how a human reasons; the trigger list below overrides it
  upward — work matching a trigger is at least Tier 2 even when it looks
  reversible-and-contained. Because Tier 2 requires plan approval *before
  code*, classification cannot wait for CI: the classifier runs as a local
  preflight before protected files may change, and CI re-checks it.
- **Triggers come from the boundary manifest, not import analysis.** Each
  repo maintains a reviewed manifest (in ORIENTATION.md) mapping paths and
  packages to tiers: auth/session/payment/webhook/migration/RLS code, CI
  workflows, package scripts, test discovery config, denial fixtures,
  `scripts/`, infra, lockfile — and the domain packages that boundary code
  consumes. A manifest is auditable and fails closed; inferring the same
  from the import graph (dynamic imports, barrels, codegen) is not reliably
  computable, and an always-red classifier just trains the human to
  rubber-stamp. The manifest itself is a governance path (Tier 2 to change).
- **The negative-test suite is a ratchet, mechanically.** Every case carries
  an immutable ID and an expected principal/resource/status tuple; any diff
  to negative tests, denial fixtures, test-discovery config, or the
  middleware-disabled harness is auto-classified Tier 2. A refactor that
  inverts allow/deny and rewrites the test to match must clear Tier-2
  review, not Tier-0 merge — and "weakened" is detectable because the
  expected tuples are data, not prose.

## Where human review time goes

You have a finite review budget. Spend it top-down:

1. **Interfaces and contracts** — schemas, API shapes, migration files. Errors
   here are expensive and survive rewrites. Always read these fully.
2. **Boundary code** — handlers, authz checks, validation, webhook processing.
   Read fully on Tier 1+.
3. **Negative tests** — do the tests prove the forbidden thing is forbidden?
   The absence of a negative test on a Tier-2 change is a review finding.
4. **Everything else** — read the agent's summary, skim the diff, trust the
   gates. This is not laziness; it is the design. If skimming feels unsafe,
   the gates are too weak — fix the gates, not the reading effort.

**Approval fatigue is a real vulnerability.** If you notice yourself approving
without reading, stop batching approvals and either (a) narrow the day's work
to fewer, bigger decisions, or (b) have a second agent adversarially review
before it reaches you. Rubber-stamping Tier-2 work is the single most likely
way this whole system fails.

## Definition of done

A task is done when: the brief's outcome is observably true · gates are green ·
tier-appropriate review happened · it is merged and deployed (or explicitly
staged with a reason) · anything decided along the way is in the decision log ·
and the agent has written a handoff note a stranger could resume from.
