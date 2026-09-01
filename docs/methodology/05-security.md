# Security Baseline

> Organized by *where attacks happen*, not by tool. Stack-agnostic on purpose —
> concrete library choices live in each project's ADR-000 (see `06-decisions.md`).
> Everything here is either wired into the gates (`04-gates.md`) or reviewed at
> Tier 2. Tags: **[ship]** = blocks first production user, **[GA]** = before
> real money/PII at scale, **[hardening]** = as earned.

## 1. Identity — who is this?

- **[ship]** Sessions verified server-side on every protected call; a decoded
  token's claims are a hint, not a verdict (revocation must actually revoke).
- **[ship]** Auth endpoints (login, signup, reset, magic link, OTP) rate-limited
  per-IP *and* per-account. These are the most-attacked routes you own.
- **[ship]** Credential or role change invalidates other active sessions.
- **[ship]** Cookies: httpOnly, secure, sameSite; host-locked prefix where
  possible. Confirm your auth library's defaults — don't assume them.
- **[ship]** Magic links and OTPs, if used: single-use, ≤10-minute expiry,
  stored hashed. The raw link/token never appears in logs, PR bodies, test
  fixtures, or prompts (a pasted login link is a session handed to every
  vendor that can read the text). Open/click tracking OFF on auth email.
  **Consumption is a deliberate same-origin POST**, never a passive GET —
  corporate mail scanners prefetch links and will burn a single-use GET
  before the human clicks. The consume page: no third-party assets,
  `Referrer-Policy: no-referrer`, token stripped from the URL immediately,
  and query params redacted from every log/error/analytics sink.
- **[ship]** The auth library and every plugin of it are pinned exact and
  audited as a blocking gate — identity libraries are the highest-value
  dependency an attacker can poison, and their advisories arrive in clusters.
- **[GA]** Enumeration resistance: identical response and timing for
  "account exists" vs not, on login and reset.
- **[GA]** Identity change (email) is re-auth-gated, notifies the old address,
  and the token consumed must match the address it was issued for.
- **[GA]** Step-up re-auth for the dangerous verbs: payment changes, exports,
  deletion, admin functions.

## 2. Authorization — can *this* identity touch *this* object?

The most common real-world SaaS breach is object-level authorization missing
on one endpoint. Design for the day you forget:

- **[ship]** Object-level check on every access, at the handler — "logged in"
  is not "allowed." One choke-point function per resource type, so the check
  is grep-able and testable.
- **[ship]** Database-level tenant isolation as the backstop (row-level
  security or equivalent). The harness that makes it real — every clause
  matters, and poolers break the naive version:
  - the app connects as a role that is **not the table owner** and cannot
    bypass the policies; `FORCE ROW LEVEL SECURITY` on tenant tables so even
    owner-role queries obey them;
  - tenant context is set **inside an explicit transaction**
    (`set_config(..., true)` / `SET LOCAL` between `BEGIN` and `COMMIT`) from
    the verified session — never from client input. Session-level `SET` leaks
    across transaction-mode poolers, and `SET LOCAL` outside a transaction is
    a silent no-op;
  - **background jobs get the same harness** — a worker is a deferred request,
    and a job without tenant context silently runs unscoped;
  - the two-tenant pooled leak test in CI (`04-gates.md` #8) proves all of
    the above continuously, in the same pooling mode production uses.
  App-layer scoping WILL be forgotten once; this harness decides whether
  that's a non-event or a breach.
- **[ship]** Middleware never carries the access decision. It may redirect for
  UX; the handler re-decides. (A whole CVE class exists because frameworks
  let middleware be skipped.)
- **[ship]** Field-level discipline: responses whitelist what the caller may
  see; writes whitelist what the caller may set. No blanket serialization, no
  spreading request bodies into updates.
- **[GA]** Default-deny procedure tiers (public is the explicit exception),
  so a forgotten annotation fails closed.

## 3. Boundaries — validate everything that crosses

- **[ship]** Schema-validate at every entry: API inputs, job payloads on
  dequeue, webhook bodies (after signature verification), third-party API
  responses, file uploads (content-sniffed, size-capped, stored outside the
  app, served by reference), and **all model/LLM output** before it touches a
  shell, query, path, HTTP call, or page.
- **[ship]** Queries parameterized always; raw string interpolation into SQL is
  a CI-greppable offense.
- **[ship]** Webhooks — the full contract, because "verify signatures" alone
  leaves five holes: a dedicated capped **raw-body** route (parse nothing
  before verification); signature freshness window (reject stale signed
  requests); environment check (live/test mode and account match); an
  **event-type allowlist** with pinned payload schema version; no ordering
  assumptions — fetch the authoritative object from the provider before any
  entitlement change; and delivery lands in a **transactional inbox**
  (at-least-once + idempotent effects — see `04-gates.md` #9), queued only
  after verification. Replays are expected traffic, not anomalies.
- **[ship]** Presigned/object-storage URLs are bearer capabilities — give
  them an authority envelope: private bucket, server-generated tenant-bound
  unique keys (a client-chosen key is a cross-tenant overwrite), exact
  method + signed headers, short TTL, no-overwrite, size/type/checksum
  constraints, quarantine-then-validate for uploads, restrictive CORS.
  Proxy sensitive downloads when immediate revocation matters.
- **[ship]** Background jobs derive tenant context from a **verified ingress
  binding** persisted at receipt (provider object/event → tenant, recorded by
  the verified webhook handler) — never from a `tenant_id` field someone put
  in the queue payload. A job has no session; its provenance chain is the
  substitute, so it must be tamper-proof.
- **[GA]** Anything that fetches a user-supplied URL: scheme/host allowlist,
  private-range and metadata-endpoint blocking, no redirects into private space.
- **[GA]** Browser hardening: strict CSP (nonce-based), standard security
  headers, CSRF tokens on cookie-authed mutations.

## 4. Secrets — nothing to steal

- **[ship]** No secret ever enters the repo, a PR, a log line, or a prompt.
  Blocking secret scan (gate #1); anything that ever touched history gets
  rotated, not scrubbed.
- **[ship]** Runtime secrets from a manager; local dev uses non-production
  keys; environment validated at boot and the process refuses to start
  incomplete (fail closed at boot beats failing open at 3am).
- **[ship]** Separate credentials per environment; production secrets
  unreachable from development tooling and agent sessions.
- **[hardening]** Short-lived dynamic credentials where the platform allows.

## 5. Data — smallest surface, provable recovery

- **[ship]** Know what personal data you hold and where (a 20-line inventory
  beats a perfect one that doesn't exist). Never log it.
- **[ship]** Backups exist, are encrypted, and have been **restored once** —
  an unrestored backup is a hope with a cron job.
- **[GA]** Retention: each data class has a lifetime and automated deletion.
  Export and deletion flows exist before someone invokes their rights.
- **[GA]** Money stays in the payment processor's vault (tokenized); card data
  never transits your servers.
- **[GA]** Defined recovery objectives — a lightweight *internal* RTO/RPO
  (one honest paragraph: how long down and how much data loss you'd accept)
  with the backup strategy demonstrably meeting it. The formal,
  contractually-committed version stays dormant until a contract names
  uptime (`07-operations.md`) — but "we never wrote down what we'd accept"
  is not a v1 posture.

## 6. AI in the loop — the new boundary

- **[ship]** Model output is attacker-influenced input. Validate before
  execution. Prompt injection is assumed, not hypothetical.
- **[ship]** Agents run with the least credentials that do the job; each
  downstream call re-checks object-level authz (agents are where those checks
  get silently skipped).
- **[ship]** Irreversible actions require human confirmation per-action
  (`03-agents.md` hard boundaries).
- **[GA]** Caps on tokens, rate, recursion. Third-party prompts/skills/tools
  reviewed as supply-chain artifacts. Model versions pinned. No secrets or PII
  in prompts. Agent actions land in the audit trail.
- **[GA]** Retrieval/memory inputs are untrusted; per-tenant scoping on any
  persistent memory.

## 7. Watching — you can't respond to what you can't see

- **[ship]** Errors and traces flow to one place, PII-scrubbed at the source.
- **[ship]** An append-only audit trail for: auth events, authz denials, admin
  actions, exports/deletions, agent actions. This is the evidence byproduct
  (Principle 9) that later becomes compliance for free.
- **[GA]** Alerts on the attack shapes: auth-failure spikes, authz-denial
  spikes, abnormal velocity in signup/checkout/invite flows.
- **[GA]** A one-page incident runbook: severity levels, what to check first,
  who to notify (including regulatory clocks), where to write down what
  happened. Written on a calm day.

## The one-day version

If a project gets a single day of security work: handler-level authz with the
database backstop (§2) · schema validation at boundaries (§3) · secret scan +
boot-time env validation (§4) · auth rate limits (§1) · one restored backup
(§5) · model output validated (§6). That set eliminates the majority of the
ways solo-operated SaaS actually gets owned.
