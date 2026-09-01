# HANDOFF — Velo (Pepper512 fork)

> Living document, edited in place. Pinned to repo state at the top; next step first.
> **The last 30 lines are a self-contained resume card** — `tail -30 HANDOFF.md` is enough to pick
> up work without reading the rest.

- **Branch:** `main` @ `be2610b` — "docs: Batch H — CI-checked doc counts, rewrite two risky skills (P20) (#14)"
- **Open PRs:** none. Working tree clean. CI green on `main`; Release Please **skipped** (EX-007 guard holding).
- **Remotes:** `origin` = `github.com/Pepper512/velo` (fork, protected `main`) · `upstream` = `avihaymenahem/velo`
- **Workspace:** the repo is `Velo-Build/velo/`; the workspace root holds only a pointer `CLAUDE.md`. Always `cd velo`.
- **State:** frontend **1,751** tests (was 1,562) · Rust **47** (was 6) · **0** prod npm advisories (was 3)
  · **0** import cycles containing a service (was 54) · EX-001/002/004 closed; EX-003/005/006/007 open.

---

## 1. Exact next step

**The whole accepted audit backlog is merged. Nothing is half-finished.** Pick one:

- **(A) E2 — IMAP session pooling (P15 Tier 2).** The only remaining item with user-visible
  performance impact: removes a TLS handshake per action and takes the password off the hot IPC
  path. **Tier 2** — write the brief first (`docs/briefs/` has three worked examples), get Jim's
  approval, *then* build.
- **(B) Unblock Jim's two items** — §2. Both need him, not an agent.
- **(C) Low-risk cleanup** — P16 (1)(2)(4)(5) dedupe (~380 lines), P13 (c)(d)(e), P14 remainder,
  `react-best-practices` skill trim.

### Resume commands

```bash
cd /Users/jpepper/Developer/Claude/Velo-Build/velo
git checkout main && git pull origin main
npm ci                                   # node_modules is gitignored
npx tsc --noEmit && npx vitest run --reporter=dot
npm run graph:check && npm run docs:check
(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)
gh repo set-default Pepper512/velo       # gh otherwise resolves PR numbers against upstream
```

### Re-verify before acting — these may have gone stale

- **`main` still at `be2610b`?** `git log --oneline -3`.
- **Upstream drift:** `git fetch upstream && git log --oneline main..upstream/main`. Empty all
  session; if security-relevant `src-tauri/` commits appear, rebase the plan on them first.
- **CI green?** `gh run list --branch main --limit 2`. Release Please must read **`skipped`**, never
  `failure` — a failure means the EX-007 guard was removed or bypassed.
- **Line numbers cited in the audit and briefs** were verified against earlier commits and **eight
  batches have since moved code**. Re-grep before editing anything they reference.
- **The audit's measurements are not trustworthy** — §6.

---

## 2. Immediate / time-sensitive

**No credentials to rotate. None were created, read, or logged this session.**

Two items are blocked on **Jim personally**. Finishing them unasked would be wrong.

### 2a. P11 — capability split (needs manual QA)

Brief: `docs/briefs/2026-09-01-batch-g-p11-capabilities.md`. Written, **not built**, because:

1. **The audit's proposed split is not viable as written.** It would give pop-out windows
   "read-only sql", but `ThreadWindow.tsx` calls `runMigrations()` and renders the full `Composer`
   (draft auto-save writes every 3 s), and `ActionBar`/`MessageItem` expose one-click unsubscribe,
   which POSTs to **arbitrary sender-supplied URLs** — so `http` cannot be narrowed until unsubscribe
   moves to a Rust command with URL validation.
2. **Its acceptance cannot be automated** — the audit says so: *"no automated harness exists for
   capability denial"*. An over-narrow grant fails at **runtime**, in a window that only opens on
   user action. Neither `cargo build` nor CI catches it.

**Jim:** approve the brief, then run its five QA steps against a dev build. **Step 5** — an
`fs|remove` invoke from a pop-out console being **denied** — is the only positive security
assertion. If it succeeds the split achieved nothing; if steps 1–4 fail it went too far.

### 2b. P19 — phishing detection is dark (product decision)

`phishingDetector.ts` (486 lines) is imported by exactly four files: its own test and **three other
orphans** (`PhishingBanner`, `LinkConfirmDialog`, `phishingScanner`). Nothing in `ThreadView` or
`MessageItem` references phishing. **The feature does not run.**

`SECURITY.md` claimed it *"flag[s] suspicious links before you click them"* — untrue of any shipped
build, so a user could click a link believing Velo had screened it. **That claim is corrected**; the
code is untouched. **Jim decides: re-wire it, or delete it and drop the claim.**

---

## 3. What we're doing and why

Velo is a local-first Tauri v2 (Rust) + React 19 desktop email client, forked from
`avihaymenahem/velo` (v0.4.21). Jim is hardening it under his engineering methodology
(`docs/methodology/`, pinned copy). A 2026-09-01 optimization audit raised 20 items; **all 20 were
accepted**, and all are landed except the two above.

The audit's framing held up: the code was disciplined where tooling enforced it and weak wherever
nothing watched. These batches added the watchers.

---

## 4. What just happened (2026-09-01)

Thirteen PRs merged — batches **D0 → A → B → C → G-deps → E → F → H**.

| PR | What |
|---|---|
| #2 `252bb1a` | HANDOFF; closes EX-001 |
| #3 `6fe932a` | Release automation upstream-only (EX-007) |
| #4 `f7e890b` | **Batch A** — IMAP injection, OAuth panic, token-as-password, literal cap; closes EX-002 |
| #5 `2f61d4b` | Agents perform merges; EX-005 rewritten |
| #6 `9a206e7` | Batch B brief (approved before code) |
| #7 `df51f4e` | **Batch B** — credentials fail closed, migrations atomic, LLM boundary, SQLite harness |
| #8 `5a5e77e` | **Batch C** — sanitizer corpus, header injection, FTS5 escaping, ADR-002 |
| #9 `6d67fd4` | dompurify 3.3.1→3.4.14 (18 XSS advisories) |
| #10 `1ab7518` | tiptap 3.19→3.31; advisories to **0**; closes EX-004 |
| #11 `19f14ce` | P11 brief |
| #12 `3d76f1b` | **Batch E** — services/router cycle broken, typed IMAP errors |
| #13 `dc02f09` | **Batch F** — xAI Grok, provider/PKCE/route dedupe, typed settings keys |
| #14 `be2610b` | **Batch H** — CI-checked doc counts, two risky skills rewritten |

**Real bugs fixed**, not items ticked: IMAP command injection at nine sites · an OAuth panic firing
*before* the CSRF check could run · OAuth tokens sent as plaintext IMAP passwords and written to
release logs · a remote kill-switch via uncapped allocation · **credential ciphertext sent to mail
servers as passwords** · a migration that could delete attachments *every launch* · prompt injection
through an unescapable delimiter · unparseable model output reaching the compose path · **five live
tracking-pixel bypasses** · `mailto:` header injection · FTS5 crashes on any quote character · a
sidebar highlighting the wrong item on two pages · a skill executing **remote instructions from a
mutable URL**.

---

## 5. Decisions

**Made** (all in `docs/decisions/LOG.md`):
- Release automation is **upstream-only** on this fork (guard, not delete) → **EX-007**.
- **Agents perform merges** once every required check is green *on the exact commit merged*; EX-005
  rewritten to accept the residual risk rather than leave a falsified mitigation.
- **ADR-002** — three-bucket error policy (propagate / surface / log).
- **Grok is available, not default**; `getActiveProviderName` still falls back to Claude.
- **AI model defaults deliberately unchanged** — fast/cheap tier per provider, because Velo runs one
  model for *all* features and the highest-volume one is background categorisation on every sync.

**Pending Jim:** P11 approval + QA (§2a) · P19 re-wire-or-delete (§2b) · confirmation of the
per-provider model default proposal (never answered; the conservative reading shipped).

**Deliberately deferred + reason:**
- **E2 session pooling** — Tier 2, changes credential lifecycle; needs its own brief.
- **P13 (c)(d)(e)** — (a)+(b) killed *all* service cycles, which was the point. 49 components still
  import `services/db/*`; `graph:check` reports the trend but does not gate it — a gate nobody can
  turn green gets deleted.
- **P14 remainder** — send-path and sync sites are ADR-002 bucket 2 and need UI surfaces that are
  design decisions, not mechanical edits.
- **P16 (1)(2)(4)(5)** — pure dedupe, ~380 lines, no risk.
- **`react-best-practices` skill** — still carries ~28 Next.js rules that mislead in a Vite/Tauri SPA.

**Operational notes that bit us:**
- `~/.claude/hooks/git-guard.sh` blocks `git add -A/.` and text-matches protected-branch wording
  across the *whole* Bash command — heredocs and PR bodies included. Author such text with Write and
  pass it via `--body-file` / `git commit -F`; keep `git push` in its own call.
- Branch protection is **strict**: every merge invalidates the branches behind it, and PRs that all
  append to `LOG.md`/`EXCEPTIONS.md` conflict rather than merely going out of date. Sequence
  doc-touching PRs one at a time.

---

## 6. Standing instruction — verify the audit before building to it

**Six of its claims failed verification.** It is still the right backlog for *what* to fix; its
**measurements are not reliable**.

| # | Claim | Reality |
|---|---|---|
| 1 | `serde_json` is unused (§4) | `tauri::generate_context!()` requires it — removing it fails with `E0433` |
| 2 | P1 has six IMAP injection sites | **Nine** — `async-imap` leaves `uid_store`, `uid_search`, `append` unvalidated |
| 3 | Components 0% tested (§6) | 32 component test files existed; the metric script missed `.test.tsx` |
| 4 | P9 lists six missing image vectors | **Five were already handled**; five *different* ones were live and unlisted |
| 5 | P14: poison queue op retried forever | `classifyError` defaults non-retryable **and** `incrementRetry` already had a ceiling |
| 6 | `useContextMenu` is orphaned (P19) | It has **nine** importers |

**#4 is the one that mattered:** building to the audit's vector list would have shipped a fix that
missed every real bypass. It is why the image blocker is DOM-based rather than a longer regex.

Three CI gates now enforce what used to be prose: `graph.mjs --check`, `docs-check.mjs --check`, and
`cargo check --release`.

---

<!-- ─────── RESUME CARD · `tail -30 HANDOFF.md` is self-contained ─────── -->

## 7. Resume card

**Where:** `cd /Users/jpepper/Developer/Claude/Velo-Build/velo` · `main` @ **`be2610b`** · no open PRs · clean · CI green.
**Status:** the whole accepted audit backlog (20 items) is **merged** — 1,751 frontend tests, 47 Rust, 0 prod advisories, 0 service import cycles.

**Next action — pick one:**
- **(A)** Write the brief for **E2 / P15 session pooling** (Tier 2 → Jim approves before code). The
  only item left with user-visible performance impact.
- **(B)** Nudge Jim on his two blocked items: **P11** needs his manual QA (acceptance cannot be
  automated); **P19** needs a re-wire-or-delete call (phishing detection is dark; the false
  SECURITY.md claim is already corrected).
- **(C)** Low-risk cleanup: P16 (1)(2)(4)(5) dedupe, P13 (c)(d)(e), P14 remainder.

**Verify first:** `main` still `be2610b` · `git fetch upstream && git log --oneline main..upstream/main`
empty · `gh run list --branch main --limit 2` shows CI **success** + Release Please **skipped** ·
re-grep any line numbers the audit or briefs cite.

**Get running:**
```bash
git checkout main && git pull origin main && npm ci
npx tsc --noEmit && npx vitest run --reporter=dot
npm run graph:check && npm run docs:check
(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)
```

**Two traps:** `cargo build --release` is broken on this machine (sqlx proc-macro dylib — not ours;
use `cargo check --locked --config 'profile.dev.debug-assertions=false'`). The git-guard hook
text-matches protected-branch wording anywhere in a Bash command — pass long text via `--body-file`
or `git commit -F`, never a heredoc.

**Read §6 next:** six audit claims failed verification — trust its backlog, not its numbers.
