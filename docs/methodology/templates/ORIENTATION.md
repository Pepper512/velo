# ORIENTATION — <project name>

<!-- The repo's front door, written for a fresh reader with zero context —
     which is every agent at every session start (03-agents.md), and you after
     any time away. Keep it under two pages; link out for depth. Staleness
     here is a bug — but this file is a GOVERNANCE PATH: agents REPORT drift
     in their handoff; fixing it is a separate Tier-2 governance PR, never
     folded into the task that noticed it (03-agents.md hard boundaries). -->

## What this is

<!-- Two sentences: what the product does, who it's for, its current stage
     (pre-launch / launched / maintenance). -->

## Stack & shape

<!-- The one-paragraph tour: languages, frameworks, where the code lives
     (map of top-level dirs), where it runs. Details: ADR-000. -->

## Run it

```
# the complete local loop, copy-pasteable:
```

```
# run ALL the gates locally (must match CI):
```

## Boundary manifest

<!-- The machine-read tier map for this repo (02-work-loop.md): paths and
     packages → tier floor. This is what the preflight and CI classifier
     consume, so it is exhaustive and fail-closed: an unlisted new directory
     defaults to Tier 1. Governance paths (this file, CI workflows, package
     scripts, test discovery, denial fixtures, scripts/, the manifest
     itself) are Tier 2. Also serves the human meaning: where validation
     and authz live — what Tier-1 "boundary diff" review means here. -->

## Gate ledger

<!-- The table from 04-gates.md, instantiated honestly for this repo:
     rule → gate → mechanized / per-change / honor-system. -->

| Rule | Gate | Status |
|---|---|---|
|  |  |  |

## Decisions

<!-- Pointers: docs/decisions/LOG.md · ADR index with one-line summaries ·
     open exceptions worth knowing about. -->

## Current state & landmines

<!-- The section that saves the most time: what's half-done, what's
     deliberately ugly and why, what looks wrong but is load-bearing, what
     you'd warn a new contributor about out loud. Date each entry; prune
     ruthlessly. -->
