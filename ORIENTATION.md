# ORIENTATION — Velo (Pepper512 fork)

> The repo's front door, written for a fresh reader with zero context — which
> is every agent at every session start (`docs/methodology/03-agents.md`).
> Agents report drift here in their handoff; fixing it is a separate governance
> PR, never folded into the task that noticed it.

## What this is

Velo is a local-first desktop email client (Tauri v2 / Rust + React 19) with
Gmail (OAuth PKCE) and IMAP/SMTP accounts, SQLite storage, and optional AI
features via user-supplied keys. This repository is Jim's **fork** of
`avihaymenahem/velo` (v0.4.21 at fork time), run under the methodology in
`docs/methodology/`. Stage: hardening — executing the 2026-09-01 audit backlog
(`docs/audits/2026-09-01-optimize-audit.md`, all 20 items accepted).

## Stack & shape

Pinned in `docs/decisions/ADR-000.md` (inherited Tauri/Rust/React/SQLite stack,
with the mapping of Jim's standard onto a single-user desktop app).

```
src/            React 19 UI (components/, stores/) + services/ (business logic) + utils/
src-tauri/      Rust: tray, OAuth loopback, IMAP (async-imap), SMTP (lettre), 23 commands
docs/           architecture.md, development.md (upstream) · methodology/ · decisions/ · audits/
.github/        ci.yml (PR gates) · release-please / release / packaging (upstream)
```

Run it: `npm ci && npm run tauri dev` (see `docs/development.md`).

## Boundary manifest (tier floors by path)

| Path | Floor | Why |
|---|---|---|
| `src-tauri/src/{oauth.rs,imap/,smtp/,commands.rs}` | Tier 2 | credentials cross IPC; wire-protocol construction |
| `src/utils/crypto.ts`, `src/services/db/accounts.ts` | Tier 2 | credential encryption / decryption |
| `src/services/db/migrations.ts` | Tier 2 | schema + destructive repairs; no down-migrations exist |
| `src/services/ai/**` (output handling, prompts) | Tier 2 | LLM output is untrusted input |
| `src-tauri/tauri.conf.json` (CSP), `src-tauri/capabilities/` | Tier 2 | security config |
| `package.json`, `Cargo.toml`, lockfiles, `.github/workflows/` | Tier 2 | dependencies / infra |
| `src/utils/{sanitize,imageBlocker,mailtoParser,emailBuilder}.ts`, `src/services/search/` | Tier 1 | untrusted-content boundaries |
| everything else | Tier 1 | unlabeled work never defaults to Tier 0 |

## Gate ledger

`.github/workflows/ci.yml` (added 2026-09-01, PR `chore/ci-baseline`). Status
below is what the workflow enforces; anything "honor-system" is in
`docs/decisions/EXCEPTIONS.md`.

| Rule (`04-gates.md`) | Gate | Status |
|---|---|---|
| Typecheck | `tsc --noEmit` | wired |
| Tests | `vitest run` in `TZ=UTC` and `TZ=America/Chicago` | wired |
| Frozen-lockfile install | `npm ci`; `cargo build --locked` | wired |
| Lint | `cargo clippy -D warnings` (3 pre-existing lints allowed — EX-002); **no TS linter** | Rust wired · TS honor-system |
| Dependency audit | `cargo audit` (EX-003 ignore); `npm audit --omit=dev --audit-level=critical` (EX-004) | wired at reduced level |
| Secret scan | gitleaks (full history) | wired |
| Provenance / SBOM | — | not wired |
| Negative-authz suite, tenant-isolation harness | N/A — single-user desktop app (ADR-000) | N/A |
| IPC-boundary + LLM-output validation tests (replacement gates) | — | not yet (audit P1, P10) |
| Migration pairing | N/A — SQLite, no down-migrations (ADR-000/P6) | N/A, documented |
| Preview deploy | N/A — desktop; release builds via upstream `release.yml` | N/A |
| Branch protection on `main` | required check `ci`, linear history, history rewrites blocked | set after first green run |

## Decisions

- `docs/decisions/LOG.md` · `ADR-000.md` (stack) · `ADR-001.md` (better-sqlite3 test harness) · `EXCEPTIONS.md`
- `TEAM.md` — organizational roster · `docs/methodology/ROSTER.md` — credential register

## Current state & landmines

- **2026-09-01** — Forked to `Pepper512/velo`; methodology moved into the repo; CI baseline PR opened.
- The committed `Cargo.lock` lagged `Cargo.toml` by one version (release-please bumps the
  manifest only) — fixed in the CI PR; watch for it on every release-please PR.
- `icalHelper.test.ts` was TZ-dependent (fixed); the CDT matrix leg exists to catch the next one.
- All-day calendar boundaries are **local** midnight throughout `icalHelper.ts`.
- 79/218 catch blocks are log-and-continue; the eight that lose user data are audit P14.
- `services/emailActions.ts` imports the router and mutates stores — the 40-file import
  cycle (audit P13). Don't add to it.
