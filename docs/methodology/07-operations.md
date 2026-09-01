# Operations & Compliance Posture

> The honest solo-operator version. The test for every control in this file:
> *does it run when nobody is making you run it?* Controls that exist only on
> paper are liabilities — they document a standard you're visibly not meeting.
> So this file keeps the set small, live, and mostly automatic, and stages the
> rest behind explicit activation triggers.

## Live controls (running now, evidence as byproduct)

| Control | How it runs | Evidence (automatic) |
|---|---|---|
| Change management | Every prod change is a PR through the gates | PR + CI history |
| Access control | MFA + hardware-key on every account that can touch prod, repo, DNS, payments, email | Provider settings |
| Least privilege | Agents get scoped, short-lived creds; prod secrets unreachable from dev/agent sessions | Secrets-manager config |
| Audit trail | App audit log (`05-security.md` §7) + PR/commit/deploy history | The logs themselves |
| Backup & restore | Automated backups; **restore actually performed** once per quarter | Restore-test log line in ops journal |
| Dependency hygiene | Automated update PRs; security patches within days, others batched | Merged-PR history |
| Vulnerability response | Fixable high/critical blocks deploy (gate #6); the rest triaged monthly | CI logs + exceptions register |
| Incident response | One-page runbook (`05-security.md` §7), tested by walking through it once | The runbook + incident notes |

**The ops journal.** One append-only file (or the decision log — same spirit):
restore tests, incident notes, monthly triage, anything operational you did.
One line each. This is the "operating evidence over time" that audits want,
produced at the moment of doing rather than reconstructed at audit time.

## The quarterly control review

One recurring 90-minute block, four times a year, plus automated monthly
nudges (dependency-triage reminder fires monthly on its own; security
patches follow the vuln SLA clock, not the calendar). This is the scheduled
*review* burden — deliberately sized to actually happen, and honestly named:
it is not the entire compliance burden, it is the part that runs on a
calendar. Scripted, not heroic: the parts that can be commands are commands.

1. Restore one backup, verify contents, log it (rehearsed; budget realistic
   time, not aspiration).
2. Access sweep **by diff**: a script lists every credential, API key, OAuth
   grant, and agent scope, and diffs against last quarter's list — you review
   the delta, not the inventory. Revoke the dead ones, log the sweep.
3. Exceptions register: renew, resolve, or let block (`06-decisions.md`).
4. Gate ledger: did anything ship broken this quarter? Which gate should have
   caught it? (`04-gates.md`).

If the quarterly review gets skipped twice in a row, that fact goes in the
exceptions register — the process auditing itself.

## Dormant controls, with activation triggers

Pre-deciding *when* each control turns on prevents both premature process and
panicked retrofitting. Do not activate early; do not renegotiate the trigger
in the moment.

| Dormant control | Activates when |
|---|---|
| Written policy set (security, access, IR, retention, vendor) | First enterprise customer or compliance questionnaire — draft from the live-controls table, which is the real policy |
| SOC 2 program + compliance automation platform | A deal actually requires the report (the audit trail + PR history + ops journal mean the evidence period is already accruing) |
| Formal vendor register with attestations | Same trigger; until then the dependency ADRs *are* the vendor diligence |
| Team controls: onboarding/offboarding, access reviews of *people*, separation of duties among humans, training | First hire or first contractor — activate before day one, not after |
| Pen test | Before GA of anything moving money or holding sensitive PII at scale |
| Formal DR objectives with tested failover | First customer whose contract names uptime (a lightweight internal RTO/RPO paragraph exists from GA regardless — `05-security.md` §5) |
| Cryptographic agent provenance (broker-issued identities, signed session→SHA binding) | When a second human joins, or when any external party relies on agent attribution — until then `Claimed-Agent:` trailers are bookkeeping and documented as such |

The point of this table in an audit or diligence conversation: "here is what
runs today, here is the trigger schedule, here is the evidence trail already
accruing" is a *stronger* position than a binder of policies with no operating
history — and it's true.

## Production honesty rules

- Anything not reproducible from the repo (one-off console changes, manual
  infra edits) is either codified within the week or written in the ops
  journal as a known divergence. Snowflake infrastructure is where 2am
  debugging goes to die.
- Deploys are boring: one command, rollback rehearsed, deploy-then-verify
  habit (the preview environment made this cheap — use it in prod form too).
- The bus-factor document: one page, kept with the ops journal — where
  everything runs, how to reach it, what to do first if the operator is
  unreachable and something is on fire. Written for a competent stranger.
  Update it in the quarterly hour.
- **The 3am kit** — answers that must exist in writing *before* they're
  needed, because they cannot be derived under pressure: which provider's
  status page maps to which symptom · the rollback command and what it does
  NOT roll back (applied migrations — hence expand/contract, and the N−1
  pairing gate that makes rollback real) · **the mid-deploy database-outage
  state machine**: migrations run under a lock and the expand step is
  transactional; if the database fails after migration starts and before
  traffic shifts, verify the migration journal/schema fingerprint, abort the
  traffic switch, keep the old app serving (degraded deliberately, not
  accidentally), and reconcile actual schema state after recovery before
  rolling forward or back · how to replay a failed webhook/job: the replay
  command *shows the inbox state first* and is safe to run twice
  (at-least-once + idempotent effects make replay boring; the runbook says
  how) · **queue-health alerts exist before they're needed**: oldest
  runnable job age, retry exhaustion, dead-letter count — one stuck
  entitlement job is invisible in aggregate error rates, so a scheduled
  Stripe-to-entitlements reconciliation backstops it · point-in-time
  database recovery: where the button is and how far back it goes · the
  feature-flag mechanism by name, and the one-line kill switch for risky
  features · a pre-written one-sentence status message to users, with where
  to post it.
