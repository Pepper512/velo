# Principles

> One page. Everything else in this methodology is derived from these. When a
> situation isn't covered by a rule, decide from the principle and log the decision.

## 1. Human judgment is the scarce resource

One person's attention is the binding constraint of this operation. Agents can
produce unlimited plausible work; you cannot produce unlimited verification.
Every process rule exists to concentrate your attention where judgment matters
(decisions, boundaries, irreversible actions) and to mechanize everything else.
A methodology that asks you to "carefully review everything" is a methodology
that fails at 11pm.

## 2. Gates, not vigilance

A rule that only lives in a document will be broken — not by malice, but by a
tired human or a confident agent. Every rule that matters must be enforced by a
machine: a CI check, a test, a schema, a lint rule, a permission boundary.
Rules enforced only by discipline are tracked as **debt** (see `04-gates.md`)
until they are mechanized or consciously accepted.

## 3. Files are memory; chat is vapor

Agents start every session with amnesia. Any decision, constraint, or context
an agent needs tomorrow must live in the repo — in ADRs, briefs, the decision
log, or code comments. If it only happened in a conversation, it didn't happen.
Corollary: the repo must be legible to a fresh reader (human or agent) in one
sitting — that is a hard requirement, not a nicety.

## 4. Ceremony scales with irreversibility, not size

A 500-line refactor that's fully reversible needs less oversight than a
one-line migration that drops a column. Classify work by **blast radius ×
reversibility** (see `02-work-loop.md`), never by line count or how long it
took. The question is always: *if this is wrong, what does it cost to find out,
and can we come back?*

## 5. Agents are brilliant, unaccountable contractors

Treat every agent like a highly skilled contractor you've never met: give
crisp briefs, bound their tools and credentials, verify outputs against the
contract (not the effort), and never let them approve their own work. Their
output — code, prose, and *claims about what they did* — is untrusted input
until a gate or a human confirms it.

## 6. The smallest true version first

Build the narrowest thing that is *correct and complete for one real use*,
then widen. Deterministic logic before heuristics; heuristics before models.
An agent's marginal cost of extra features is near zero, which makes scope
creep the default failure mode — the brief's "Not doing" section is a load-
bearing wall.

## 7. Boundaries are where everything happens

Validation, authorization, encoding, logging, and trust decisions live at
boundaries: request handlers, job dequeues, webhook receivers, model outputs,
third-party responses. Inside a boundary, code trusts its inputs; at a
boundary, nothing is trusted. Most security incidents are a boundary someone
forgot they had.

## 8. Reversibility is engineered, not assumed

Every change ships with its undo: migrations have down-paths or expand/contract
plans, deploys have rollbacks, features have flags, data operations have
backups verified *by restoring them*. When the undo is impossible (sent emails,
charged cards, deleted user data), that is precisely what escalates the work to
the highest tier.

## 9. Evidence is a byproduct, never a project

Compliance artifacts (audit trails, review records, change history) must fall
out of the normal loop — the PR, the CI log, the decision log — at zero
marginal cost. The moment "collecting evidence" becomes its own task, it will
be skipped, backfilled, or faked. Design the loop so that doing the work *is*
documenting the work.

## 10. The methodology is versioned software

This folder has a version, a changelog, and known bugs. Projects pin a copy;
drift is detected, not discovered. When reality contradicts a rule twice, the
rule is wrong — fix the rule, bump the version, and note why. A methodology
that can't absorb its own exceptions becomes fiction within a quarter.
