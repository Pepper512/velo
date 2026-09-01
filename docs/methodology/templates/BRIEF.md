# Brief

<!-- The contract for a unit of work. Tier 0: the Outcome line alone may be
     enough. Tier 1: Outcome + Not doing + Done when. Tier 2: everything,
     including Threat and Rollback, approved BEFORE code. -->

- **Task:**
- **Tier:** 0 / 1 / 2 / 3 — because: <!-- blast radius × reversibility, see 02-work-loop.md -->
- **Date / owner:**

## Outcome

<!-- One or two sentences. What is observably true when this is done, stated so
     a stranger could check it. "Users can X" beats "implement X support." -->

## Not doing

<!-- The load-bearing section. Adjacent work explicitly out of scope.
     Agents: anything you're tempted to add goes in the handoff as a proposal. -->

## Done when

<!-- Checkable conditions. Include the negative ones: "…and anonymous users
     get 403," "…and the old path still works." -->

## Constraints & context

<!-- Decisions already made (link LOG.md / ADRs), patterns to follow,
     performance/cost bounds, deadlines that are real. -->

## Threat (Tier 2 only — 15 minutes, written into this brief)

<!-- For each new/changed surface, one line each:
     - Who could pretend to be someone else here? (spoofing)
     - What crosses a trust boundary, and where is it validated? (tampering)
     - What must land in the audit log? (repudiation)
     - What data could leak, to whom? (disclosure)
     - What can be made expensive or abused at scale? (DoS)
     - Where is authz decided, and what happens if that code is skipped? (elevation) -->

## Rollback (Tier 2 only)

<!-- The tested way back: flag to flip, migration down-path/expand-contract
     step, restore point. "Redeploy previous version" only counts if state
     changes allow it — say why. -->

## Approval

- Plan approved by: __________ date: ______ <!-- Tier 1+: before build. Tier 2: before ANY code. -->
