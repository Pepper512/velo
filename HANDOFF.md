# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.

- **Branch:** `main` @ `dc02f09` — **every batch in the audit's order is merged** except the two items
  that need Jim (below). Batch H lands with this PR.
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **State:** frontend **1,751** tests (was 1,562) · Rust **47** (was 6) · **0** prod npm advisories (was 3)
  · **0** import cycles containing a service (was 54) · EX-001/002/004 closed.

---

## 1. Exact next step — two decisions only Jim can make

Everything else in the backlog is landed. These two are blocked on a human, not on effort.

### 1a. P11 — the capability split needs manual QA

Brief: `docs/briefs/2026-09-01-batch-g-p11-capabilities.md`. **Written, not built**, for two reasons:

1. **The audit's proposed split is not viable as written.** It would give pop-out windows "read-only
   sql", but `ThreadWindow.tsx` calls `runMigrations()` and renders the full `Composer` (draft
   auto-save writes every 3 s), and `ActionBar`/`MessageItem` expose one-click unsubscribe, which
   POSTs to **arbitrary sender-supplied URLs** — so `http` cannot be narrowed until unsubscribe moves
   to a Rust command with URL validation. The brief proposes a smaller, honest narrowing instead.
2. **Its acceptance cannot be automated.** The audit says so itself: *"no automated harness exists for
   capability denial"*. An over-narrow grant fails at **runtime**, in a window that only opens on user
   action — neither `cargo build` nor CI catches it.

**What Jim does:** approve the brief, then run the five QA steps in its *Verification* section against
a dev build. **Step 5** — an `fs|remove` invoke from a pop-out console being **denied** — is the only
positive security assertion. If it succeeds, the split achieved nothing; if steps 1–4 fail, it went
too far.

### 1b. P19 — phishing detection does not run, and Jim must choose

`phishingDetector.ts` (486 lines) is imported by exactly four files: its own test and **three other
orphans** (`PhishingBanner`, `LinkConfirmDialog`, `phishingScanner`). Nothing in `ThreadView` or
`MessageItem` references phishing. **The feature is entirely dark.**

`SECURITY.md` claimed it *"flag[s] suspicious links before you click them"* — untrue of any shipped
build, so a user could click a link believing Velo had screened it. **That claim is now corrected**;
the code is untouched.

Neither of the audit's two options was taken, deliberately: re-wiring is building a security-visible
feature whose rendering cannot be verified without running the app, and deleting 486 lines of
working, tested logic is a product decision. **Choose: re-wire it, or delete it and drop the claim.**

---

## 2. Also outstanding, in priority order

| Item | Why it is not done |
|---|---|
| **E2 — P15 session pooling** | Tier 2: changes credential lifecycle (removes the password from the hot IPC path). Needs its own brief and threat pass. The one real runtime speedup left — removes a TLS handshake per action. |
| **P13 (c)(d)(e)** | (a)+(b) killed **all** the service cycles, which was the point. (c) `uiStore` persistence → `settingsService`, (d) lazy routes, (e) read-facing service functions so components stop importing `services/db/*` (**49 files still do** — `npm run graph:check` reports the trend). |
| **P14 remainder** | The send-path and sync sites are bucket 2 in `ADR-002` and need UI surfaces that are design decisions, not mechanical edits. |
| **P16 (1)(2)(4)(5)** | `useAppChrome`/`bootstrapWindow`, `useCrudEditor`, `parsedToUpsertInput`, `openThreadWindow`. Pure dedupe, no risk, ~380 lines. |
| **Skills (4)(5)** | `react-best-practices` still carries ~28 Next.js rules that mislead in a Vite/Tauri SPA. No risk, just noise. |

---

## 3. Standing instruction — verify the audit before building to it

**Six of its claims have now failed verification.** It remains the right backlog for *what* to fix;
its **measurements are not reliable**. Spot-check anything from it before sizing or sequencing work.

| # | Claim | Reality |
|---|---|---|
| 1 | `serde_json` is unused (§4) | `tauri::generate_context!()` requires it — removing it fails with `E0433` |
| 2 | P1 has six IMAP injection sites | **Nine** — `async-imap` leaves `uid_store`, `uid_search`, `append` unvalidated |
| 3 | Components 0% tested (§6) | 32 component test files existed; the metric script missed `.test.tsx` |
| 4 | P9 lists six missing image vectors | **Five were already handled**; five *different* ones were live and unlisted |
| 5 | P14: poison queue op retried forever | `classifyError` defaults non-retryable **and** `incrementRetry` already had a ceiling |
| 6 | `useContextMenu` is orphaned (P19) | It has **nine** importers |

Three CI gates now enforce what used to be prose: `graph.mjs --check` (no service import cycles),
`docs-check.mjs --check` (documented counts match the tree), and `cargo check --release` (the
dev-only commands really do compile out).

---

## 4. How to run / develop

```bash
cd velo
npm ci && npm run tauri dev            # full app (Vite :1420 + Tauri)
npx tsc --noEmit                       # typecheck
npx vitest run                         # 1,751 tests; add TZ=America/Chicago for the CI matrix leg
npm run graph:check                    # import-graph layering
npm run docs:check                     # documented counts vs. the tree
cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings
```

**`cargo build --release` does not work on this machine** — it fails inside `sqlx 0.8.6` with
`dlopen(libsqlx_macros….dylib): mis-aligned LINKEDIT string pool`, before any Velo code compiles.
Not ours. To check the `#[cfg(not(debug_assertions))]` arm locally:
`cd src-tauri && cargo check --locked --config 'profile.dev.debug-assertions=false'`.

Process: `CLAUDE.md` Part I, `ORIENTATION.md`, `docs/methodology/`, `docs/briefs/`, `docs/decisions/`.
