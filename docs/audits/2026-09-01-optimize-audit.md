# Codebase Optimization Audit — Velo — 2026-09-01

- **Auditor:** Claude Fable 5 (planning/judgment only; mechanical scans delegated to read-only subagents; evidence re-verified by the auditor where marked ✔)
- **Target:** `velo/` @ `ec47a7a` (v0.4.21, upstream `avihaymenahem/velo`), 236 commits
- **Governance:** `docs/methodology/` (pinned), `TEAM.md`, `docs/methodology/ROSTER.md`, `docs/decisions/ADR-000.md`
- **Prompt:** `~/claude-memory/prompts/optimize-audit.md` (executed as written)
- **Status:** Panel/research input. Not a brief. No source file was edited. PM (position 1) converts accepted items into briefs.

## Preflight

- **Sensitive data classes:** none found. Grep hits for `ssn` were all `className` (case-insensitive substring). No `.env`/`.pem`/`.key` committed. All email fixtures synthetic. No `local_only` classes → audit may proceed on this row.
- **AI-addressed text / prompt injection in repo:** none outside Velo's own legitimate prompts (`src/services/ai/prompts.ts`). One **skill-level** concern: `.claude/skills/web-design-guidelines/SKILL.md` instructs the agent to fetch a remote URL at run time and follow whatever rules it returns — a remote-instruction supply-chain vector. Reported under §7 Skills, not acted on.
- **Tool availability (rule 2):** `jscpd`, `knip`/`ts-prune`, `dependency-cruiser`/`madge`, `@vitest/coverage-v8` are **not installed and were not installed**. Deterministic approximations were scripted with Node stdlib (scratchpad `dup.mjs`, `graph.mjs`) and shell; each measurement below names its method. `cargo clippy`, `cargo audit`, `npm audit`, `tsc`, `vitest` are present and were run (`npm ci` from the committed lockfile populated `node_modules`; no dependency added).

---

## 1. Executive summary

Velo is a disciplined codebase on the axes tooling already enforces — TypeScript strict with 1 `: any` and 0 `as any`/`@ts-ignore` in 42k lines, a single DOMPurify chokepoint with 0 `innerHTML`, typecheck clean, 1,559/1,560 tests passing, and a Rust backend with 3 clippy warnings and no `unwrap()` outside tests. The debt is where no tool is watching: **error handling is log-and-continue (79 of 218 catch blocks are console-only), the documented UI→Services→Native layering is bypassed by 49 UI files importing `services/db/*` directly and by a 40-file import cycle that pulls the router into Gmail sync, and 52% of source files (0% of components) have no test while every DB test mocks SQLite.** The top three risks are: (1) the Rust IMAP layer interpolates username, password, and folder names into the wire protocol unquoted and has two reachable panic/abort paths (OAuth URL decoder, uncapped server literal); (2) credential decryption failures fall through to using ciphertext as the password, and a destructive one-shot "repair" in `runMigrations` deletes IMAP attachment/sync state with no test; (3) the LLM boundary (smart replies, categorization, Ask Inbox, auto-draft) returns model output to the composer with only a regex tag-strip and no tests, while email bodies are interpolated into prompts with no delimiter escaping. No PR-level CI exists to make any fix gate-verifiable, so that is sequenced first.

---

## 2. Prioritized improvement list

Format per item: **Problem/where · Evidence · Why · Fix · Acceptance (gate-verifiable) · Tier.** "✔" = auditor re-read the cited lines. Tiers per `docs/methodology/02-work-loop.md`; auth/credentials/migrations/deps/infra start at Tier 2.

### P1 — IMAP wire-protocol injection at the Rust command boundary
- **Where:** `src-tauri/src/imap/client.rs:968, 973, 1005, 1066, 1072, 1079` ✔; `src-tauri/src/commands.rs:126-140`.
- **Evidence:** `format!("a1 LOGIN \"{}\" \"{}\"\r\n", config.username, config.password)`; `format!("a2 SELECT \"{folder}\"\r\n")`; `uid_range` and `flags` interpolated verbatim. 23 `#[tauri::command]`s, **zero** argument validation (no host/port/folder/flag/`uid_range`/`since_date` checks). All commands return `Result<_, String>`.
- **Why:** A folder name, username, or flag containing `"` or `\r\n` injects arbitrary IMAP commands. Folder names come from the server (`LIST`) and from user input; the webview is a semi-trusted caller. Per ADR-000 "Standard → this stack," each command must validate its own arguments — Tauri capabilities are the middleware, not the check.
- **Fix (tightest):** one `fn imap_quote(&str) -> Result<String, MailError>` that rejects `\r`/`\n`/NUL and backslash-escapes `"`/`\`, applied at all six sites; `uid_range` validated against `^[0-9,:*]+$`; flags validated against an allowlist. No new crate.
- **Acceptance:** Rust unit tests for `imap_quote` (reject CRLF/NUL, escape quote/backslash, pass-through ASCII/UTF-8) and one per command site with a hostile folder name; `cargo test` + `cargo clippy -D warnings` green in PR CI (Batch D0); existing `vitest` IMAP tests unchanged.
- **Tier:** 2 (credentials path). Threat pass + rollback (revert commit; no data migration).

### P2 — OAuth loopback server: reachable panic, no read timeout, port chosen by caller
- **Where:** `src-tauri/src/oauth.rs:132-136` ✔ (`&s[i+1..i+3]` byte slice with only a length guard); `:47-52` ✔ (single 4096-byte `read()` with no timeout); `:16-19` (port is an IPC argument, tries `port..port+3`); `:58-60` (state compare present, runs after the panic point).
- **Evidence:** Input `?code=%€x` panics on a non-char-boundary slice. Any local process can connect to `127.0.0.1:<port>` during the 300 s accept window.
- **Why:** Crash of a Tauri command mid-auth; a stalled client hangs the command for the process lifetime; the webview can bind arbitrary ports.
- **Fix:** decode on `bytes` with `std::str::from_utf8(&bytes[i+1..i+3])` guarded (or `char_indices`); wrap `read()` in `tokio::time::timeout`; hard-code the port range in Rust (17248–17251) and drop the argument, or allowlist it. Replace the hand-rolled decoder with the `percent-encoding` crate only if Jim approves the dependency — otherwise fix in place.
- **Acceptance:** Rust tests: `%€x`, `%`, `%2`, `%zz`, valid `%2F`; a test that a stalled connection returns `Err` within the timeout; `cargo test` green in PR CI.
- **Tier:** 2 (auth). Rollback: revert; no state.

### P3 — `imap_raw_fetch_diagnostic` sends OAuth tokens as a `LOGIN` password and logs the full session at `info`; DevTools ships in release
- **Where:** `src-tauri/src/imap/client.rs:1066` ✔ (always `LOGIN`, ignores `auth_method`; contrast the correct branch at `:962` ✔), `:1101` (`log::info!` of the whole transcript), `commands.rs:270`; `src-tauri/Cargo.toml` `features = ["tray-icon","devtools"]`, `lib.rs:43,95` ✔; `src/components/settings/SettingsPage.tsx:1716`.
- **Why:** Access token transmitted as a plaintext password to a server that may echo it into a `BAD` response, which is then written to the persistent log in release builds. DevTools available to end users on a window that renders untrusted email.
- **Fix:** `#[cfg(debug_assertions)]` on the diagnostic command, its registration, and the transcript log; route it through `authenticate()`. Make `devtools` a debug-only Cargo feature; gate `open_devtools` registration and the Settings button the same way.
- **Acceptance:** `cargo build --release` produces a binary where `open_devtools` and `imap_raw_fetch_diagnostic` are unregistered (compile-time cfg + one integration check); `grep -c RAW.IMAP.DIAGNOSTIC` on a release log after a diagnostic attempt = 0.
- **Tier:** 2 (credentials/logging). Rollback: revert.

### P4 — Uncapped server-controlled allocation in IMAP literal parsing
- **Where:** `src-tauri/src/imap/client.rs:1259, 1278` (`vec![0u8; literal_size]`), `:1393-1400` ✔ (`extract_literal_size` parses `{N}` with no bound).
- **Why:** A hostile/broken server sending `{4294967295}` aborts the process. Reachable from `imap_fetch_messages` via the `ASYNC_IMAP_EMPTY` fallback.
- **Fix:** `const MAX_LITERAL: usize = 64 * 1024 * 1024;` checked in `extract_literal_size` before allocation; return `Err`.
- **Acceptance:** Rust test feeding `{99999999999}` returns `Err`, no allocation; `cargo test` green.
- **Tier:** 1.

### P5 — Credential decrypt failure falls through to the ciphertext
- **Where:** `src/services/db/accounts.ts:39-75` ✔ (five `catch (err) { console.warn("...using raw value") }` blocks for access token, refresh token, IMAP password, OAuth client secret, CalDAV password); root-cause context `src/utils/crypto.ts:15` (`cachedKey` module-global, no recovery), `:54` (key file read with no length/format validation), `:138` (`isEncrypted` = `parts[0].length === 16`, misclassifies a 16-char plaintext prefix).
- **Evidence:** 79/218 catch bodies repo-wide are console-only (brace-matcher over all non-test TS). No test asserts this fallback (`crypto.test.ts` seeds only a valid key).
- **Why:** A corrupt/rotated `velo.key` turns every account into "wrong password" with no user-visible cause and ships an AES blob to the mail server as a credential. This is the credential-at-rest row in ADR-000's dissent.
- **Fix:** make `decryptAccountTokens` fail closed: throw a typed `CredentialDecryptError`, surface a re-auth banner (the `CalendarReauthBanner` pattern exists), never return ciphertext. Validate the key file (32 bytes after base64) at load; make `isEncrypted` structural (`iv:ct` with base64 alphabet check).
- **Acceptance:** Vitest: corrupt key → `CredentialDecryptError`, no network call attempted; truncated key file → error at load; 16-char plaintext → `isEncrypted === false`. Negative test that `getAccounts()` never resolves with an `isEncrypted()`-true value in a credential field. `vitest` green in PR CI.
- **Tier:** 2 (credentials). Rollback: revert; no data change. **Related, separately briefed:** OS-keychain storage (ADR-000 tripwire).

### P6 — `runMigrations` is untested and runs a destructive one-shot repair on every launch path
- **Where:** `src/services/db/migrations.ts:825-924`; repair block `:898-923` ✔ deletes all IMAP `attachments` and `folder_sync_state`, nulls `history_id`, then sets a settings flag — a failure between the deletes and the flag insert repeats the deletes next launch. `:891` `ROLLBACK.catch(() => {})`. `migrations.test.ts:3-40` tests a **copy** of `splitStatements`, never the production function at `:784`.
- **Evidence:** 924-line file, one export, 0 tests of that export. 53 of 133 test files mock `services/db/*` (90 `vi.mock`s); **no test executes SQL** against any SQLite (grep for `:memory:`/`better-sqlite3`/`sql.js` = 0).
- **Why:** Runs on every startup; can delete user data; the only thing between users and a re-delete loop is a flag write that isn't in the same transaction. Migrations are Tier 2 by definition.
- **Fix:** wrap repair + flag in one transaction; move the repair into a numbered migration so it goes through the `_migrations` ledger; export `splitStatements` and delete the copy in the test. Build the in-memory SQLite harness (P12) so `runMigrations` runs twice idempotently in a test.
- **Acceptance:** tests: fresh DB → 23 migrations applied; second run → 0 applied; simulated failure after first DELETE → nothing deleted and flag unset; `splitStatements` production function tested directly. Gate: `vitest` in PR CI; migration-pairing gate from `04-gates.md` recorded N/A-with-reason (SQLite, no down migrations exist — document this).
- **Tier:** 2 (migration). Rollback: users on the fixed build cannot be downgraded (no down migrations) — the plan must say so.

### P7 — `mailto:` deep link → header injection and unhandled rejection
- **Where:** `src/utils/mailtoParser.ts:32` (`decodeURIComponent` throws `URIError` on `%zz`), `:67-75` (`%0A`/`%0D` decoded and stored verbatim); `src/services/deepLinkHandler.ts:38, 51` ✔ (`handleUrl(url)` called without `await`/`.catch`); `src/utils/emailBuilder.ts:116` ✔ (`Subject: ${draft.subject}` — no CRLF strip, no RFC 2047 encoding anywhere in the file).
- **Why:** A hostile `mailto:` link from any web page reaches the composer: a malformed escape becomes an unhandled rejection; a CRLF in subject becomes a forged header in the outgoing MIME. Non-ASCII subjects are sent raw (RFC 5322 violation).
- **Fix:** try/catch around `decodeURIComponent` returning a parse error; strip `\r\n` from every header value in `emailBuilder` and RFC-2047-encode non-ASCII (stdlib only: `btoa`/`TextEncoder`); `.catch` on both `handleUrl` call sites.
- **Acceptance:** tests: `mailto:%zz` → no throw, no draft; `mailto:a@b.c?subject=x%0ABcc:evil@x` → single folded subject, no injected `Bcc` header; `subject=héllo` → `=?utf-8?B?...?=`; `vitest` green.
- **Tier:** 1.

### P8 — Search: FTS5 syntax reaches SQLite unescaped; one unparameterized query
- **Where:** `src/services/search/searchQueryBuilder.ts:27-33` ✔ (`messages_fts MATCH $1` with `parsed.freeText` raw); `src/services/search/searchParser.ts:21` (unbalanced quote keeps the leading `"`); `src/services/db/pendingOperations.ts:151-153` ✔ (`AND account_id = '${accountId}'`, no params — the only such site among 231 query calls).
- **Why:** Typing `foo"` in the main search box raises `fts5: syntax error` at runtime — invisible to the suite because SQLite is always mocked. `pendingOperations.ts:151` is low exploitability (`accountId` is an internal UUID) but is a house-style violation a lint rule would catch.
- **Fix:** quote free text for FTS5 (`"` → `""`, wrap tokens in quotes; enable `NEAR`/prefix only when explicitly requested); parameterize `:151` like its siblings at `:140-143`.
- **Acceptance:** tests with `"`, `*`, `-`, `NEAR`, `(`, unbalanced quote produce valid MATCH expressions (verified against real SQLite in the P12 harness); a CI grep gate for `= '${` in `src/services/db` = 0 until a linter exists.
- **Tier:** 1.

### P9 — Sanitizer and remote-image blocker have no adversarial tests; `style` attribute allowed
- **Where:** `src/utils/sanitize.ts:11-21` (forbids `<style>` tag, allows `style` attr); `src/utils/imageBlocker.ts:12-21` (rewrites only quoted `<img src>` and `url()` — not `srcset`, `<picture><source>`, `<video poster>`, `<link rel=prefetch>`, `<input type=image>`, unquoted `src=`); `src/components/email/EmailRenderer.tsx:238-240` (`sandbox="allow-same-origin"`, no `allow-scripts` — correct, but same-origin means DOMPurify is the sole layer). `sanitize.test.ts` contains 0 occurrences of `svg`, `math`, `<base`, `meta`, `srcset`, `javascript:`, `data:`.
- **Why:** SECURITY.md promises "remote images blocked by default" and puts "XSS via email content escaping the sandbox" in scope. Tracking pixels via `srcset`/`<source>` currently bypass the privacy guarantee; CSS `url()` in `style=` can exfiltrate.
- **Fix:** add the attack-corpus tests first (TDD); then extend `stripRemoteImages` to the missing vectors and consider `FORBID_ATTR: ["style"]` or a CSS `url()` strip; evaluate `sandbox=""` (no same-origin) with `srcdoc` instead of `doc.write`.
- **Acceptance:** a `sanitize.attacks.test.ts` corpus (≥15 vectors) all neutralized; `imageBlocker` test proves no `http(s)://` remains in any attribute after stripping; opposite-line adversarial review (position 19) signs the corpus.
- **Tier:** 1 (rendering) — escalate to 2 if the iframe sandbox mode changes.

### P10 — LLM output boundary: model text reaches the composer with a regex tag-strip; email bodies interpolated into prompts unescaped
- **Where:** `src/services/ai/aiService.ts:116-135` (`generateSmartReplies` falls back to splitting raw model text by newline; sanitization = `replace(/<[^>]*>/g,"")`), `:157-183` (`categorizeThreads` interpolates the snippet inside `<email_content>` with no delimiter escaping; output allowlisted by `validThreadIds`+`VALID_CATEGORIES` — sound, untested), `askInbox.ts`, `composeFromPrompt`/`transformText` (no tests, no output validation). Best-defended path for reference: `taskExtraction.ts:24-56`.
- **Evidence:** 8 of 10 `aiService.ts` exports never named in a test. No Zod (0 hits) — see ADR-000.
- **Why:** Jim's hard rule: LLM output is untrusted input; email → prompt → composer/send is this app's primary injection surface. A body containing `</email_content>` + forged `id:category` lines is a live test case.
- **Fix:** a single `parseModelOutput<T>(raw, guard)` with hand-written type guards (Zod pending Jim's approval); escape/strip the delimiter tag from interpolated content; smart-reply fallback must produce `[]` not raw text; cap lengths. Tests with injection corpora.
- **Acceptance:** tests: `</email_content>` in body does not change any thread's category; smart replies on non-JSON → `[]`; extra-key JSON accepted, wrong-shape rejected; `vitest` green. Threat pass documented in the brief.
- **Tier:** 2 (per ADR-000 Standard→stack row "LLM output").

### P11 — Tauri capabilities are one flat grant for all windows; `http` plugin is a CSP bypass
- **Where:** `src-tauri/capabilities/default.json` ✔ — applies to `main`, `splashscreen`, `thread-*`, `compose-*`; grants `sql:*`, `fs:allow-write-file`/`remove`, `http:default` with `http://*`, `https://*`, `core:webview:allow-create-webview-window`. Plugin-http used only at `src/services/ai/providers/ollamaProvider.ts:2` and `src/services/unsubscribe/unsubscribeManager.ts:63` (arbitrary `List-Unsubscribe` URLs).
- **Why:** Pop-out windows render untrusted email and hold the same SQL/FS/HTTP powers as `main`; the CSP `connect-src` allowlist is moot when the plugin allows everything. A renderer compromise (P9) becomes full local data + network access.
- **Fix:** split into `main.json` (current set) and `content.json` for `splashscreen`/`thread-*`/`compose-*` (events + window controls + read-only sql if needed); narrow `http` to CSP origins plus a documented broad entry scoped to the unsubscribe flow (or move unsubscribe POSTs to a Rust command with URL validation).
- **Acceptance:** `tauri build` succeeds; a `thread-*` window attempting `fs.writeTextFile` is denied (manual QA step recorded by position 18 — no automated harness exists for capability denial; declared); CSP unchanged.
- **Tier:** 2 (infra/security config). Rollback: revert JSON.

### P12 — Test infrastructure: no PR CI, no real-SQLite tests, one timezone-dependent test
- **Where:** `.github/workflows/` has `release.yml` (runs `npm run test` only at release), `release-please.yml`, `packaging.yml`, `update-homebrew.yml` — **no PR workflow**; no `tsc`, `cargo clippy`, `cargo audit`, `npm audit`, secret scan. `src/services/calendar/icalHelper.test.ts:48-62` ✔ fails on any machine west of UTC (fixture `"2025-12-25T00:00:00Z"` vs local-midnight `formatDateOnly` at `icalHelper.ts:155-160`; `parseICalDateTime:178-184` is consistently local, so this is a test bug, not a shipped bug).
- **Evidence:** vitest 2026-09-01 (TZ=CDT): 1 failed / 1,559 passed / 1,560; 132/133 files. `tsc --noEmit` exit 0. clippy 3 unique warnings. **Also:** the committed `src-tauri/Cargo.lock` records the `velo` crate at `0.4.18` while `Cargo.toml` says `0.4.21` ✔ (observed as a 1-line lockfile change after `cargo clippy`; reverted) — release-please bumps `Cargo.toml` but the lockfile is not regenerated, so a `cargo build --locked` gate would fail on HEAD. Batch D0 must decide whether to add `--locked` and fix the release-please config to update the lockfile.
- **Why:** Everything else in this list is unverifiable without it; "CI is the only source of test status." `EXCEPTIONS.md` already records the gap.
- **Fix:** `ci.yml` on PR: `npm ci`, `tsc --noEmit`, `vitest run` with `TZ=UTC` (plus a second matrix leg `TZ=America/Chicago` to catch this class), `cargo clippy -D warnings`, `cargo audit`, `npm audit --omit=dev --audit-level=high`, secret scan (gitleaks action pinned to a commit SHA), frozen lockfile. Fix the ical fixture to construct local dates. **Real-SQLite harness needs a dev dependency (`better-sqlite3` or `sql.js`) — ASK JIM; do not add without approval.**
- **Acceptance:** CI green on a no-op PR; CI red on a PR that reintroduces the fixture; branch protection requires it. Clears the EXCEPTIONS.md entry.
- **Tier:** 1 (CI wiring); the dev-dep addition is its own Tier-2 dependency block.

### P13 — `emailActions.ts` crosses every layer and drags the router into a 40-file import cycle
- **Where:** `src/services/emailActions.ts:1-2` (imports `uiStore`/`threadStore`; mutates at `:92,124,318`), `:6` (raw `getDb()` + ~15 `db.execute` from `:147`), `:7` (`router/navigate`, used `:80,101`), `:499` (`window.dispatchEvent("velo-sync-done")`). `services/quickSteps/executor.ts:49-200` (7 store mutations). `services/queue/queueProcessor.ts:62`. `stores/smartFolderStore.ts:10` imports `db/connection` (raw SQL in a store). `stores/uiStore.ts:89-153` (14 fire-and-forget `setSetting` writes, all `.catch(() => {})`).
- **Evidence (graph.mjs, 256 files / 860 edges):** components/hooks → `services/db/*`: **102 edges from 49 files**; services → stores: 11; stores → services: 10; services → React: **0** (good). **1 SCC of 40 files, 54 simple cycles**, all through `router/navigate.ts → router/index.ts → routeTree.tsx → App.tsx` and `emailActions.ts:7 → router/navigate`. Hubs: `emailActions` (in 15/out 7), `tokenManager` (17/6). Chain: `gmail/sync → smartLabelManager → smartLabelService → filterEngine → emailActions → router → App`.
- **Why:** A Gmail delta sync transitively imports the page tree. Services cannot be tested without the router; stores own persistence so a failed settings write silently diverges from SQLite until restart. The architecture doc's central claim (three layers) is not what the graph shows.
- **Fix (auditor keeps the API design — premium-reasoning item):** (a) `emailActions` returns `{ nextThreadId? }` and callers navigate; delete the `router/navigate` import. (b) Optimistic store mutations move to a thin UI adapter (`hooks/useEmailActions`); services return results. (c) `uiStore` persistence moves to a `settingsService` that surfaces failures (toast) — pairs with P14. (d) Lazy route components to break `router/index → routeTree → App`. (e) Read-facing service functions so components stop importing `services/db/*` — incrementally per screen, not as a sweep.
- **Acceptance:** `graph.mjs` (or dependency-cruiser once approved) reports 0 cycles containing a `services/*` file and 0 `services → stores` edges except a named adapter; the count of components importing `services/db/*` trends down per PR (reported in each PR); `vitest` green; no behavioral change (QA script from position 18: archive/next-thread, snooze, quick step, undo-send).
- **Tier:** 1 (architecture, reversible per PR). Sequence (a)→(d) first — they are small and kill most cycles.

### P14 — Error-handling policy: log-and-continue in the paths that lose user data
- **Where (worst 8 of 79):** `src/services/email/imapSmtpProvider.ts:408, 418` (sent message not saved locally / not APPENDed to Sent — user sees "sent"); `src/services/emailActions.ts:313` (remote mutation succeeded, local DB update failed — divergence with no reconciliation); `src/services/queue/queueProcessor.ts:83` (flush failure dropped), `:38` (malformed `op.params` → `JSON.parse` throws → possibly retried forever every 30 s; no retry ceiling after `incrementRetry:49`); `src/services/gmail/sync.ts:243, 408` (per-thread sync and filter failures swallowed); `src/services/imap/imapSync.ts:956` (a folder can stop syncing indefinitely); `src/services/composer/draftAutoSave.ts:53` (auto-save failing silently while the user types). 20 no-op `.catch(() => {})`, 16 of them in `uiStore`.
- **Why:** These are the "user believes X happened, it didn't" bugs — the most expensive class in a mail client. No `no-floating-promises` lint exists to catch new ones.
- **Fix:** define a three-bucket policy in `docs/decisions/` (propagate / surface-to-user / log-with-metric) and apply to the 8 sites above only; add a retry ceiling + dead-letter status to `pending_operations`; make `draftAutoSave` and send-path failures user-visible. Do **not** sweep all 79.
- **Acceptance:** tests for each of the 8 (failure → user-visible state or thrown typed error); queue test: poison op reaches `failed` after N attempts and stops; `vitest` green.
- **Tier:** 1.

### P15 — Rust: typed errors, session reuse, connection-setup dedupe
- **Where:** `commands.rs` — 15 `connect()`/`logout()` pairs, each a fresh TCP+TLS+auth; `imap/client.rs:284` ↔ `commands.rs:47` control flow via string prefix `ASYNC_IMAP_EMPTY:`; 44 copies of the timeout suffix string, 53 hand-rolled `tokio::time::timeout`; `imap/client.rs:1119-1153` ≡ `1451-1513` (STARTTLS sequence), TLS connector built 3× (`1143`, `1410`, `1495`); `smtp/client.rs:41-48` ≡ `60-67`; `imap/types.rs:3-13` ≡ `smtp/types.rs:3-13`. `ImapConfig.password` crosses IPC on **every** call. No global state at all (so no lock-across-await risk — a real strength).
- **Fix:** `enum MailError { Auth, Network, Timeout{op}, Protocol(String), NotFound, Empty }` with `Serialize` (frontend gains a discriminant; sentinel string goes away); one `open_stream()` covering tls/starttls/plain; shared `MailServerConfig`. **Session pooling** (`tauri::State<tokio::sync::Mutex<HashMap<SessionId, Session>>>`, take the session out of the map before `.await`) removes the password from the hot IPC path — Tier 2, separate brief after P1–P4 land.
- **Acceptance:** `cargo test` + clippy green; TS side switches `e.startsWith("ASYNC_IMAP_EMPTY:")` to a typed check with a test; `grep -c "check your server settings" imap/client.rs` = 1.
- **Tier:** 1 (errors/dedupe); 2 (pooling — credentials lifecycle).

### P16 — Duplication: seven extractions worth doing (measured 3.95% exact-clone rate)
- **Evidence (dup.mjs, 8-line window, 255 files / 35,599 normalized lines):** 1,405 duplicated lines, 88 clone runs. Largest: `ComposerWindow.tsx:104-174` ≡ `ThreadWindow.tsx:102-172` (59) ≡ `App.tsx:461-490` (theme/font/accent effects + boot sequence; marker `--color-sidebar-active` in exactly those 3 files); `FilterEditor.tsx:221-254` ≡ `SmartLabelEditor.tsx:255-288` (34); `EventCreateModal.tsx:73-107` ≡ `EventDetailModal.tsx:99-133` (32); `openaiProvider.ts:9-43` ≡ `copilotProvider.ts:15-49` ≡ `ollamaProvider.ts:22-57` (27); `gmail/auth.ts:38-60` ≡ `oauth/oauthFlow.ts:27-49` (PKCE, 22 — security code with two implementations); `ThreadView.tsx:30-57` ≡ `ContextMenuPortal.tsx:378-401` (pop-out, 23+20); `upsertMessage(...)` 22-field literal ×3 (`gmail/sync.ts:113-136`, `imapSync.ts:295-321`, `:563-589`); six settings editors share a CRUD scaffold caught only at the tails (17 lines × 6 footers) — ~150–190 lines by judgment.
- **Already factored, leave alone:** background checkers (`backgroundCheckers.ts`, 7/7 consumers), dialogs (`ui/Modal.tsx`, 11 consumers), `db/*` helpers (`buildDynamicUpdate`, `selectFirstBy`, `existsBy`).
- **Bonus bug found via dup:** `hooks/useRouteNavigation.ts:19-42` ✔ vs `router/navigate.ts:197-226` ✔ — `useActiveLabel` lacks the `/attachments` and `/tasks` branches → sidebar highlights "inbox" on those pages.
- **Fix, in payoff order:** (1) `useAppChrome()` + `bootstrapWindow()` (~130 lines, removes a live theme-token drift hazard); (2) `useCrudEditor` + `<EditorFormFooter>` + `<MatchCriteriaFields>` (~170); (3) `createOpenAICompatibleProvider` + route ollama through `createProviderFactory` (~60, lowest risk); (4) `parsedToUpsertInput` mapper (~45); (5) `openThreadWindow()` (~40); (6) `routeIdToLabel()` shared (~31, fixes the bug); (7) `services/oauth/pkce.ts` (~22).
- **Acceptance:** dup.mjs (re-run, same params) reports ≤2.5%; existing tests pass; new test for `routeIdToLabel` covering `/attachments`, `/tasks`; theme change in one window reflected in pop-outs (QA script).
- **Tier:** 0 for (3),(4),(5),(7); 1 for (1),(2),(6).

### P17 — Stringly-typed settings keys and DOM event bus
- **Where:** `getSetting`/`setSetting` — 139 refs in 23 files, **41 distinct key literals, 0 centralization** (`theme`, `font_size`, `color_theme` each in 4 files). Custom `window` events: 9 names, 27 dispatch sites, all inline literals; `velo-sync-done` has 7 producers / 4 consumers and is the only mechanism making service writes visible to the UI; `velo-calendar-sync-done` (`syncManager.ts:202`) has **no listener**.
- **Why:** Rename = silent break; the event bus is invisible to the import graph, which is why the layers look decoupled while being functionally entangled.
- **Fix:** `constants/settingsKeys.ts` (`SettingKey` union, typed `getSetting<K>`), `constants/events.ts` (typed `dispatchVeloEvent`/`onVeloEvent`); delete the dead calendar event or add its listener. Mechanical — Qwen may draft.
- **Acceptance:** no remaining `getSetting("` string-literal call sites (all via constants); tsc catches a misspelled key (verified by an intentional typo in a CI dry run); `vitest` green.
- **Tier:** 0/1.

### P18 — Dependency vulnerabilities (measured 2026-09-01)
- **npm audit --omit=dev:** 4 (1 critical `seroval` via `@tanstack/router-core@1.159.4`; 1 high `linkify-it` via `@tiptap/pm → prosemirror-markdown → markdown-it`; 2 moderate `markdown-it`, `dompurify@3.3.1`). All deps: 12 (2 critical, 6 high).
- **cargo audit (752 crates):** `lettre 0.11.19` RUSTSEC-2026-0141 (9.1 critical) — **Boring TLS backend only; Velo uses `tokio1-native-tls`, so not reachable — record as accepted/N/A with reason**; `quick-xml 0.37.5/0.38.4` ×2 (7.5 high, via `plist → tauri`); `h2 0.4.13` (via `reqwest`).
- **Fix:** bump `@tanstack/react-router`, `@tiptap/*`, `dompurify` (each a Tier-2 dependency change with a dependency block; DOMPurify is the XSS chokepoint — its bump gets the P9 corpus as regression); `cargo update` for `quick-xml`/`h2` if tauri/reqwest allow; record `lettre` acceptance in `docs/decisions/EXCEPTIONS.md` with expiry.
- **Acceptance:** `npm audit --omit=dev --audit-level=high` = 0 in CI; `cargo audit` = 0 unaccepted; P9 corpus green after the DOMPurify bump.
- **Tier:** 2 (deps). Owner: Jim approves each bump.

### P19 — Orphaned modules: phishing UI appears wired out
- **Where (graph.mjs orphans, 9):** `components/email/PhishingBanner.tsx`, `components/email/LinkConfirmDialog.tsx`, `services/phishing/phishingScanner.ts` (still reads `phishing_sensitivity` at `:48`), `services/google/calendar.ts` (superseded by `calendar/googleCalendarProvider.ts`?), `services/db/localDrafts.ts`, `components/ui/ConfirmDialog.tsx`, `components/help/HelpTooltip.tsx`, `hooks/useContextMenu.ts`, `utils/imageResize.ts`.
- **Why:** SECURITY.md and `docs/architecture.md` advertise phishing detection with a banner and link confirmation; if the banner and dialog are unreachable, the feature is partially dark. `utils/phishingDetector.ts` (486 lines) is still imported — verify what renders.
- **Fix:** confirm reachability by hand (dynamic import or JSX not caught by regex?) before deleting anything; either re-wire `PhishingBanner`/`LinkConfirmDialog` or remove them and update SECURITY.md. **Judgment call — not measured beyond the static import graph.**
- **Acceptance:** either a component test rendering `PhishingBanner` from `ThreadView` on a flagged thread, or the files deleted and docs corrected; `knip` (if approved) = 0 unused files.
- **Tier:** 1.

### P20 — Documentation drift (counts and provider list)
- **Where:** `docs/architecture.md:42` says 34 tables, `:193` says 35; `:193` and `CLAUDE.md:174` say 19 migrations — actual **23** (`grep -c version: src/services/db/migrations.ts`); "AI: Anthropic, OpenAI, Gemini" — actual providers on disk: **claude, openai, gemini, ollama, copilot** (CSP also allows LM Studio and `models.github.ai`); `docs/development.md:43` says 130 test files, `CLAUDE.md:170` says 132 — actual 133; "8 Zustand stores" in the data-flow section vs 9 in the table.
- **Fix:** correct once; then stop hand-maintaining counts — replace with pointers or a tiny `docs:check` script the `document-feature` skill runs.
- **Acceptance:** a `docs:check` script (no deps) diffs counts vs. the tree in CI; Documentation Lead review.
- **Tier:** 0.

---

## 3. Delegation map

Seats per `TEAM.md`; credentials per `ROSTER.md` (only Opus 5 and GPT-5.6 Sol touch the repo; DeepSeek V4 Pro reviews secrets-free exports only; Qwen3-Coder-Next drafts offline behind the Opus integrator). Position 19 review is **mandatory** and routed by the builder's opposite line. Batches are dependency-ordered; each batch = one reviewable brief (or a small set), sequenced so earlier batches don't conflict with later ones. Auditor (Fable 5) retains only the API/invariant designs flagged "auditor designs."

| Batch | Task(s) | Files touched | Tier | Assigned seat | Opposite-line reviewer | Why this seat |
|---|---|---|---|---|---|---|
| **D0** (first) | P12 PR CI (`ci.yml`: tsc, vitest `TZ=UTC` + CDT leg, clippy, cargo/npm audit, secret scan, frozen lockfile); fix `icalHelper.test.ts` fixture; **ask Jim** re: in-memory SQLite dev dep | `.github/workflows/ci.yml` (new), `src/services/calendar/icalHelper.test.ts`, `docs/decisions/EXCEPTIONS.md` | 1 (dep ask → 2) | **#18 GPT-5.6 Sol** (QA/Test/Release) | **#19 → Claude Opus 5** | Release/CI is position 18's remit; everything downstream needs this gate to be "done" |
| **A** | P1 IMAP quoting/validation; P2 OAuth decoder+timeout+port; P3 diagnostic gating + devtools cfg; P4 literal cap | `src-tauri/src/imap/client.rs`, `commands.rs`, `oauth.rs`, `lib.rs`, `Cargo.toml`, `src/components/settings/SettingsPage.tsx:1716` (button gate) | **2** | **#8 Claude Opus 5** (Backend & Integrations) | **#19 → GPT-5.6 Sol** + **DeepSeek V4 Pro** (third seat, secrets-free diff export) | Backend/protocol work; Tier 2 requires threat pass + rollback in plan, mandatory dual review |
| **B** | P5 fail-closed credential decrypt + key validation; P6 migration repair transactional + `runMigrations` tests; P10 LLM output parser + prompt delimiter escaping | `src/services/db/accounts.ts`, `src/utils/crypto.ts`, `src/services/db/migrations.ts` (+test), `src/services/ai/aiService.ts`, `askInbox.ts`, `prompts.ts` (+tests) | **2** | **#8 Claude Opus 5** (P5, P10); **#10 Claude Opus 5** (P6 + tests) | **#19 → GPT-5.6 Sol** + **DeepSeek V4 Pro** | Credentials, migrations, and the LLM boundary are Tier 2 by rule; testing-heavy → #10 |
| **C** | P7 mailto/header injection; P8 FTS5 quoting + parameterize `:151`; P9 sanitizer/imageBlocker attack corpus + fixes; P14 the 8 error-handling sites + queue retry ceiling | `src/utils/mailtoParser.ts`, `emailBuilder.ts`, `services/deepLinkHandler.ts`, `services/search/*`, `services/db/pendingOperations.ts`, `utils/sanitize.ts`, `utils/imageBlocker.ts`, `services/email/imapSmtpProvider.ts`, `services/emailActions.ts:313`, `services/queue/*`, `composer/draftAutoSave.ts` (+tests) | 1 | **#10 Claude Opus 5** (Backend & Testing) | **#19 → GPT-5.6 Sol** (adversarial corpus sign-off) | Test-first boundary hardening is #10's remit; Sol's adversarial pass on the XSS corpus is the evidence |
| **G** | P11 capability split + `http` scope; P18 dependency bumps (each its own dependency block) | `src-tauri/capabilities/*.json`, `package.json`, `package-lock.json`, `src-tauri/Cargo.lock`, `docs/decisions/EXCEPTIONS.md` (lettre acceptance) | **2** | **#8 Claude Opus 5** | **#19 → GPT-5.6 Sol** + **DeepSeek V4 Pro** | Infra/security config + deps; Jim approves each bump |
| **E** | P13 decoupling (a)–(d) — **auditor designs the `emailActions` result API and adapter boundary**; P15 Rust `MailError` enum + `open_stream()` dedupe (pooling deferred to E2) | `src/services/emailActions.ts`, `quickSteps/executor.ts`, `queue/queueProcessor.ts:62`, `stores/uiStore.ts`, `stores/smartFolderStore.ts`, new `hooks/useEmailActions.ts`, `services/settingsService.ts`, `router/*` (lazy routes); `src-tauri/src/{imap,smtp}/*`, `commands.rs` | 1 | **#8 Claude Opus 5** (services + Rust); **#7 GPT-5.6 Sol** (UI adapter, lazy routes) | Opus-built → **Sol**; Sol-built → **Opus** | Cross-layer change split at the adapter boundary so each half has an opposite-line reviewer |
| **E2** | P15 session pooling (`SessionId` commands; password off hot IPC path) | `src-tauri/src/commands.rs`, `imap/client.rs`, `lib.rs`, `src/services/imap/tauriCommands.ts` | **2** | **#8 Claude Opus 5** | **#19 → GPT-5.6 Sol** + **DeepSeek V4 Pro** | Credential lifecycle change; after A lands |
| **F** | P16 dedupe (1)–(7) incl. `routeIdToLabel` bug; P17 settings-key + event constants; P19 orphan verification | `App.tsx`, `ComposerWindow.tsx`, `ThreadWindow.tsx`, `components/settings/*Editor.tsx`, `components/calendar/Event*Modal.tsx`, `services/ai/providers/*`, `services/oauth/*`, `gmail/auth.ts`, `hooks/useRouteNavigation.ts`, `router/navigate.ts`, new `constants/settingsKeys.ts`, `constants/events.ts` | 0/1 | **#7/#9 GPT-5.6 Sol** (frontend); **#8 Claude Opus 5** (providers, PKCE, upsert mapper); **#21 Qwen3-Coder-Next** may draft the constants sweep offline → **Opus 5 integrator of record** | Sol-built → **Opus 5**; Opus-built → **Sol** | Mechanical frontend extraction is Sol's line (B3 bake-off); security-adjacent PKCE/provider code stays with Opus |
| **H** | P20 docs corrections + `docs:check` script; §7 skills rewrites | `velo/docs/*.md`, `velo/CLAUDE.md`, `SECURITY.md` (if P19 removes phishing UI), `.claude/skills/*` | 0 | **#15 Claude Opus 5** (Documentation Lead) | Same-line backup acceptable for Tier 0 docs per TEAM.md; skills → **GPT-5.6 Sol** review (they are executable instructions) | Docs remit; skills change agent behavior so they get a real reviewer |

**Auditor-retained items (premium reasoning, not delegated):** the `emailActions` result-API design and adapter boundary (P13a–c); the error-handling policy buckets (P14); the decision on iframe sandbox mode (P9) if it changes; migration ordering for P6's move of the repair into a numbered migration.

---

## 4. Explicitly deferred (noticed, recommend NOT fixing now)

| Item | Why leave it |
|---|---|
| `SettingsPage.tsx` at 2,323 lines / 1 export (also `AddImapAccount.tsx` 951, `EmailList.tsx` 760, `ContextMenuPortal.tsx` 728) | Ugly but correct and low-churn; splitting without component tests is churn with no gate. Revisit **after** P12 lands and only when a feature touches the file. |
| `helpContent.ts` (1,341) and `migrations.ts` (924) size | Data/DDL tables; size is benign. |
| `db/*` `if (updates.x !== undefined) fields.push(...)` ladders (26 sites) | A generic helper costs type safety for ~20 lines. |
| 38 weak assertions (`toBeDefined`/`not.toThrow`) = 2.4% of tests | Within tolerance; no file is exclusively weak. |
| Rust: `futures` crate (1 use, re-exported by async-imap), `tokio` `sync`/`macros` features, `serde_json` (0 uses) | Remove `serde_json` opportunistically inside Batch A; the rest is noise. |
| Non-constant-time `state` compare in `oauth.rs:58` | Loopback-only, single-use listener; fix opportunistically in P2, not worth its own item. |
| `services/gmail/syncManager.ts` hosting calendar sync | Naming smell; moving it is churn across the SCC — fold into P13 only if it falls out naturally. |
| `imapSmtpProvider.ts` intra-file `groupByFolder` repetition (~25 lines) | Legitimate parallel implementation; two private helpers if someone is already in the file. |
| Switching npm → pnpm / adding Biome / adding Zod | Each is a dependency decision for Jim (ADR-000 follow-ups), not an audit fix. |
| `landing/` package | Out of ADR-000 scope; not examined. |

---

## 5. Coverage declaration

**Examined:** all non-test `.ts/.tsx` under `velo/src/` (256 files, ~42k lines) via scripted scans + targeted reads; all of `velo/src-tauri/src/` (~3k lines Rust); `tauri.conf.json`, `capabilities/default.json`, `Cargo.toml`, `package.json`, `tsconfig.json`, `.github/workflows/` (names and test steps only), `SECURITY.md`, `docs/*.md`, `CLAUDE.md`, `.claude/skills/*`.

**Not examined — silence here is not a clean bill:**
- `landing/` (separate npm package, marketing site) — not opened beyond the false-positive check.
- GitHub Actions YAML **security** (action SHA pinning, `GITHUB_TOKEN` permissions, OIDC) — only grep'd for test/typecheck steps. A separate CI-security pass is warranted before Batch D0 adds workflows.
- Rust `#[cfg(test)]` modules — counted, not read.
- Runtime/dynamic behavior — no app was launched, no IMAP/Gmail account exercised, no capability denial tested. All Tauri/IPC findings are static.
- UI rendering — no component tests exist, none were written; component findings are static.
- `Cargo.lock`/`package-lock.json` transitive review beyond `audit` output.
- Git history — not mined for reverted fixes or hot files.

**Measurement limits:**
- Duplication: exact-hash 8-line window after normalization → **under-reports** renamed-identifier near-clones (settings editors and providers were assessed by judgment). `jscpd` would measure tokens; not installed.
- Coupling: regex import parser (static `import`/`export from`/`import()`), not TS-program-aware; dynamic requires and JSX-only references could make the orphan list (P19) over-report. `dependency-cruiser` would resolve tsconfig paths and types; not installed.
- Coverage: file-level "sibling test exists" proxy; **no line/branch coverage**. `@vitest/coverage-v8` not installed.
- Dead exports: **unmeasured** (`knip`/`ts-prune` not installed). The orphan list is file-level only.
- Subagent scans: five read-only agents produced the raw findings; the auditor independently re-read ~12 of the highest-severity citations (marked ✔). Unmarked line references are agent-reported and should be re-verified by the assigned builder before work starts.

---

## 6. Metrics baseline — 2026-09-01

No prior artifact in `docs/audits/`; this is the baseline. Re-run with the same methods to compute deltas.

| Metric | Value | Method |
|---|---|---|
| Source size (TS, non-test) | 256 files / 42,469 lines | `find`/`wc` |
| Rust size | ~3,026 lines, 23 `#[tauri::command]`s | `wc`, `grep` |
| Test files / cases | 133 / 1,560 | vitest |
| Test result (TZ=CDT) | **1 failed**, 1,559 passed (`icalHelper.test.ts`) | `vitest run` |
| Typecheck | 0 errors | `tsc --noEmit` |
| Clippy | 3 unique warnings (too-many-args 9/7, `match`→`?`, `map_or`) | `cargo clippy --all-targets -W clippy::all` |
| File-level test coverage | 127/244 = **52.0%**; components **0%** | sibling-test script (§5 limits) |
| Real-SQLite tests | **0**; 53 files / 90 `vi.mock` of `db/*` | grep |
| Exact duplication | **3.95%** (1,405 / 35,599 normalized lines; 88 runs) | `dup.mjs`, window 8 |
| Import graph | 860 edges; **1 SCC of 40 files; 54 cycles** | `graph.mjs` Tarjan + bounded DFS |
| Layer violations | UI→db 102 edges/49 files; services→stores 11; stores→services 10; services→React 0 | `graph.mjs` |
| Orphan files | 9 | `graph.mjs` |
| Catch blocks console-only | 79 / 218 (36%); no-op `.catch(()=>{})` 20; empty catch 0 | brace-matcher |
| Type escapes (non-test) | `: any` 1 · `as any` 0 · `as unknown as` 3 · `@ts-ignore` 0 · `!.` 22 | grep |
| Unparameterized SQL | 1 / 231 query sites (`pendingOperations.ts:151`) | grep |
| Direct `invoke(` outside `services/imap/` | 9 sites, 0 runtime-validated | grep |
| Settings keys | 41 distinct literals, 139 refs, 23 files, 0 centralized | grep |
| DOM event names | 9, 27 dispatchers, 1 with no listener | grep |
| Files > 600 lines | 8 | `wc` |
| `npm audit --omit=dev` | 1 critical / 1 high / 2 moderate (all deps: 2/6/2/2) | npm 11.19 |
| `cargo audit` | 1 critical (lettre, **N/A** — native-tls), 2 high (quick-xml ×2), 1 h2 | cargo-audit 0.22.1, 752 crates |
| Dead exports | **unmeasured** | needs `knip` |
| Line/branch coverage | **unmeasured** | needs `@vitest/coverage-v8` |

---

## 7. Skills audit (`velo/.claude/skills/`, 5 skills)

Ranked by improvement potential; rewrites proposed for the top 4.

1. **`commit`** — *rewrite.* Step 6 unconditionally pushes to the current branch (and sets upstream if none). This conflicts with the methodology (no agent lands work; Jim approves; branch protection) and with the harness rule that agents commit or push only when asked and never on the default branch. Rewrite: commit only; never push; refuse on `main`/`master`; print the suggested PR-creation command instead. Keep the excellent type/scope table.
2. **`web-design-guidelines`** — *rewrite or remove.* Instructs the agent to `WebFetch` a raw GitHub URL and "apply all rules from the fetched guidelines" including "output format instructions" — remote instructions executed at run time = prompt-injection/supply-chain vector (flagged in preflight). Rewrite: vendor the rules into the skill at a pinned commit; no run-time fetch.
3. **`document-feature`** — *sharpen.* Good skill, right idea (keeps docs in sync), but hardcodes "13 existing categories" and asks the agent to "keep counts accurate" by hand — the exact drift found in P20. Rewrite: read categories from `helpContent.ts`; replace hand counts with the `docs:check` script; add one complete worked example of a card.
4. **`react-best-practices`** (vendored Vercel, 57 rules, Next.js-centric) — *trim.* Roughly half the rules (RSC, `next/image`, server actions, ISR) don't apply to a Vite/Tauri SPA and will mislead. Keep the React-19/rendering/bundle rules; delete Next.js sections; add a Velo-specific trigger ("Zustand selectors, iframe rendering, virtualized `EmailList`").
5. **`composition-patterns`** — fine as is; generic but accurate for React 19. Low priority.

---

## Handoff

- **This document is the only write.** No file under `velo/` was modified. `npm ci` populated `velo/node_modules` (gitignored) and `cargo clippy`/`cargo audit` populated `velo/src-tauri/target` and `~/.cargo/advisory-db`; both are build artifacts, not source.
- **Next actor:** PM (position 1, Claude Opus 5) converts Jim's accepted items into briefs per `02-work-loop.md`. Tier 1+ needs a plan approved by Jim before code; Tier 2 (A, B, G, E2, and the P12 dev-dep) additionally needs a threat pass and written rollback path.
- **Decisions Jim must make before any batch starts:** (1) fork vs. contributor vs. vendored (ADR-000 tripwire) — determines whether CI lives in `velo/.github` and whether these PRs go upstream; (2) dev-dependency for in-memory SQLite (P12); (3) whether Zod is approved (P10 shape; ADR-000 follow-up); (4) which of the four `npm audit` bumps to take now (P18).
- **Log:** audit entry appended to `docs/decisions/LOG.md`; Jim's accept/defer decisions to be appended there when made.
- `ASSUMPTION:` the audit artifact belongs in the workspace `docs/audits/` (beside `docs/decisions/`), not inside the upstream clone, until the fork/contributor decision is made.
