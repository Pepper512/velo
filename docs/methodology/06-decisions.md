# Decisions

> How choices get made, recorded, and protected from being made twice.
> Decisions are the primary product of the human in this system — the agents
> produce code; you produce judgment. This file is about not wasting either.

## The decision ledger (per repo)

Two artifacts, different weights:

- **`docs/decisions/LOG.md`** — the decision log. Append-only, one line per
  decision: date, what was decided, one-clause why, link to more if it exists.
  Anything you'd otherwise say in chat and lose. Ten seconds to write. Agents
  read it at session start (`03-agents.md`).
- **`docs/decisions/ADR-NNN.md`** — full records (`templates/ADR.md`) for
  decisions that are expensive to reverse, security-relevant, or likely to be
  re-litigated. An ADR exists to end an argument permanently — including
  arguments with your future self.

**ADR-000 is the stack.** Every project's first ADR pins its languages,
frameworks, and services — with the date and reasoning. The methodology itself
is deliberately stack-agnostic: technology defaults are *project* decisions
that age and get revisited; principles don't. When you notice the same
ADR-000 choices recurring across projects, extract them into a personal
`STACK-DEFAULTS.md` that new ADR-000s copy from — the default lives one file
away from the reasoning, never inside the methodology.

## When to decide alone, and when to convene a panel

Most decisions: decide, log one line, move on. Speed of decision is a solo
operator's structural advantage — don't squander it on ceremony.

Convene an **adversarial panel** when a decision is expensive to reverse AND
the honest answer isn't obvious: architecture forks, build-vs-buy, major
dependency adoption, pricing/data-model shapes. The panel is agents:

1. **Frame it** — write the question, the constraints, and what "winning"
   means, in one paragraph. A fuzzy question produces confident fuzzy answers.
2. **Seat 2–4 agents with mandates, separately.** Each gets the same framing
   and a distinct mandate — champion option A · champion option B · attack
   whatever the others produce · represent operations at 2am. Mandates prevent
   the panel from collapsing into one synthesized opinion wearing four hats.
   Run them in independent sessions; shared context breeds agreement. **Seats
   differ by model line too, not just mandate** (pick from `ROSTER.md`): two
   sessions of the same model share training and share blind spots, so their
   agreement is correlated, not corroborating. The attacker seat in
   particular is never the same line as the champion it attacks. Know the
   limit: cross-model diversity catches novel mistakes, not *fashionable*
   ones — errors common in shared training data get blessed by every line.
   So the adversarial brief always includes the current shared-blind-spot
   checklist (middleware-as-authz, session-level `SET` under pooling,
   framework-default caching, and whatever the last incident added), and
   "another model approved" is never a merge condition — the human is.
3. **You judge.** Read the cases, decide, and record — including the strongest
   surviving argument *against* your choice. That recorded dissent is the
   tripwire: it names the observable condition under which the decision gets
   reopened ("revisit if X happens"), which is what licenses everyone to stop
   relitigating it meanwhile.
4. **The loser gets documented, not deleted.** A well-specified rejected
   alternative is insurance. "We chose A; B is fully written down; reopen B
   only if <tripwire>" ends the Slack-relitigation problem before it starts.

## Dependency decisions (the most common Tier-2 decision)

Every new dependency answers, in its ADR block: what breaks or gets rewritten
if it dies · why not the standard library, existing deps, or 40 lines of code ·
who maintains it and how it's been maintained lately · what it drags in
transitively · how it leaves (the removal path). Small, boring, and dull-but-
maintained beats clever-and-fresh on every critical path. The lockfile gate
(`04-gates.md`) makes this unskippable mechanically.

## Exceptions — rules bend visibly or not at all

When reality demands deviating from any rule in this methodology:

- The deviation is **named in the PR** — rule, reason, risk, mitigation.
- If it outlives the week, it goes in `docs/decisions/EXCEPTIONS.md`
  (`templates/EXCEPTIONS.md`) with an owner (you) and an **expiry date**.
- Expired exceptions block new work in their area until renewed or resolved —
  that's the mechanism that keeps the register from becoming a graveyard.
- A rule that accumulates two exceptions is wrong. Fix the rule
  (Principle 10), don't file a third.

## Assumption management

Agents surface `ASSUMPTION:` entries (`02-work-loop.md`); the review either
confirms them (they become decisions — log line) or corrects them (the work
adjusts). An unreviewed assumption that ships is a decision nobody made —
the review checklist treats any surviving `ASSUMPTION:` in a merged PR as a
process failure to fix, not a note to shrug at.
