# Brief — Batch A: Rust security hardening

- **Task:** Close audit items **P1–P4** plus **EX-002** in `src-tauri/` (IMAP wire protocol, OAuth loopback server, the raw
  diagnostic command, DevTools in release builds, IMAP literal allocation).
- **Tier:** **2** — the changed surfaces are the credential path (IMAP `LOGIN`/XOAUTH2,
  OAuth token capture) and the parser that consumes hostile server bytes.
  `CLAUDE.md` Part I names "Rust IMAP/SMTP/OAuth" as Tier 2 outright.
  Blast radius: every IMAP account and every OAuth sign-in. Reversibility: high —
  no schema change, no migration, no persisted-state change (see **Rollback**).
- **Date / owner:** 2026-09-01 · PM/agent drafts and builds under Jim's pre-approval (see **Approval**).
- **Source:** `docs/audits/2026-09-01-optimize-audit.md` §P1–P4, §EX-002, §4.
- **Base:** `main` @ `b751b94`. Verified 2026-09-01: `git log b751b94..upstream/main -- src-tauri/`
  is **empty** — no upstream drift in the Rust tree, so every audit line number still holds.

---

## Outcome

A hostile or broken IMAP server, a hostile folder/flag/date value crossing the Tauri
IPC boundary, or a malformed OAuth redirect can no longer inject IMAP commands,
crash the app, or write a credential to the log — and the release binary no longer
ships the DevTools hook or the raw-IMAP diagnostic command at all.

Concretely, when this is done:

- Every string Velo interpolates into an IMAP wire command is either quoted and
  CRLF-rejected, or validated against a character allowlist, at the point of
  construction.
- `start_oauth_server` cannot panic on a malformed redirect, cannot hang forever on
  a stalled local client, and no longer takes its listening port from the webview.
- `imap_raw_fetch_diagnostic` and `open_devtools` do not exist in a release build.
- A server-declared IMAP literal larger than 64 MiB is an error, not an allocation.
- `cargo clippy -D warnings` passes with **no `-A` allowances** in `ci.yml`, closing EX-002.

---

## Not doing

Named explicitly so the diff stays reviewable and so nobody "helpfully" folds these in:

- **No IMAP session pooling / connection reuse** (P15, Batch E2). Every command still
  opens and closes its own session. That is the one real runtime speedup available
  here and it changes credential lifecycle — it gets its own Tier 2 brief.
- **No typed error enum** (`MailError`, also P15). Commands keep returning
  `Result<_, String>`. The audit's P1 text suggests `Result<String, MailError>` for the
  new quoting helper; **we return `Result<String, String>`** to match the file's existing
  convention. Converting the error type is a whole-module refactor and would swamp the
  security diff. Recorded here as a deliberate deviation from the audit's wording.
- **No new dependency.** Specifically **not** adding `percent-encoding` (the audit
  offered it for P2 conditional on Jim's approval) and **not** adding a regex crate for
  the UID-set check. Both fixes are ~15 lines of hand-written byte matching. If Jim
  would rather have `percent-encoding`, say so and it becomes a dependency decision
  per `06-decisions.md` — but the default is no.
- **No fix for the two pre-existing OAuth bugs found while verifying** (see
  *Observations* below): the useless 17249–17251 fallback, and `oauthFlow.ts` using
  `localhost` where the server binds `127.0.0.1`. Both are correctness, not security,
  and both deserve their own brief.
- **Minimal frontend work.** Planned: dropping the `port` argument at the two
  `start_oauth_server` call sites and gating the DevTools button.
  **Actual (wider — flagged):** `set_flags` and `append_message` now take unrendered
  flag names rather than a pre-built `"(\\Seen)"` string, so the rendering that has to
  be trusted happens in `imap::wire` against an allowlist. That changed
  `imapAppendMessage`'s signature, its 2 call sites in `imapSmtpProvider.ts`, and 4
  assertions in `imapSmtpProvider.test.ts`. Still no component refactor and no
  `SettingsPage.tsx` split (that waits for component tests, per audit §4).
- **No `zod` yet.** Its first use is Batch B; the dependency block goes in that PR.
- **P5–P20 are out of scope.** Batch A is A.

---

## Done when

Checkable conditions, including the negative ones.

**P1 — IMAP wire protocol**

1. A new `src-tauri/src/imap/wire.rs` exposes, with unit tests for each:
   - `quote_string(&str) -> Result<String, String>` — rejects `\r`, `\n`, NUL; escapes
     `\` then `"`; wraps in `"`. (Matches `async-imap`'s own `validate_str` semantics
     so behaviour is uniform across the raw and library paths.)
   - `validate_uid_set(&str) -> Result<&str, String>` — non-empty, ≤ 4 KiB, and every
     byte in `[0-9,:*]`.
   - `build_flag_list(&[String]) -> Result<String, String>` — each entry is a system
     flag (`\Seen \Answered \Flagged \Deleted \Draft`) or an RFC 3501 atom
     (no `( ) { } %  * " \ ]`, no control bytes, no space); renders `(\Seen \Flagged)`.
   - `validate_search_date(&str) -> Result<&str, String>` — exactly `DD-Mon-YYYY`.
   - `validate_mailbox(&str) -> Result<&str, String>` — rejects `\r`, `\n`, NUL.
2. Applied at every site where a caller-controlled string reaches the wire:
   | Site | Value | Reaches the wire via |
   |---|---|---|
   | `client.rs:968` | `username`, `password` | hand-built `a1 LOGIN "{}" "{}"` |
   | `client.rs:964` | `username` | XOAUTH2 SASL blob (`\x01`-delimited) |
   | `client.rs:973` | `folder` | hand-built `a2 SELECT "{}"` |
   | `client.rs:1005` | `uid_range` | hand-built `a3 UID FETCH {}` |
   | `client.rs:1066/1072/1079` | same three, diagnostic path | hand-built |
   | `client.rs:429` (`set_flags`) | `flags` | `uid_store(uid_set, query)` — **`async-imap` does not validate `query`** |
   | `client.rs:534` (`append_message`) | `folder`, `flags` | `session.append(...)` — **`async-imap` does not validate either** |
   | `client.rs:770, 823` | `since_date` | `uid_search("SINCE {date}")` — **`async-imap` does not validate `query`** |
   | `commands.rs:126-140` | `flags: Vec<String>` | replaced wholesale by `build_flag_list` |
3. **Negative test per site:** a folder named `x"\r\na9 DELETE INBOX`, a flag
   `Seen)\r\na9 LOGOUT`, a `since_date` of `1-Jan-2020 OR ALL`, and a `uid_range` of
   `1:* BODY[]` each return `Err` (or are safely escaped) and **never** produce a
   second command line. Asserted on the generated command string, not by talking to a server.
4. **Verified non-issues, asserted by a test so they stay non-issues:** `folder` reaching
   `session.select`, `uid_copy`, `uid_mv`, and `status` *is* already validated inside
   `async-imap` 0.10.4 (`validate_str`, `client.rs:343/909/928/1064`), and every `uid_set`
   Velo builds comes from `Vec<u32>` and cannot contain a separator. Those sites are left
   alone; the brief records why so the next reader does not "fix" them.

**P2 — OAuth loopback**

5. `urlencoding_decode` never slices `&str` by byte index. Tests: `%€x`, `%`, `%2`,
   `%zz`, `%2F`, `%2f`, `+`, and a bare `%` at end-of-input all return without panic
   and with the documented value. (Today `%€x` panics: `€` occupies bytes 1–3, and
   `&s[1..3]` splits it.)
6. The socket read is wrapped in `tokio::time::timeout` (30 s). A connection that opens
   and sends nothing returns `Err` within the timeout instead of hanging the command for
   the process lifetime. Covered by a test that binds a real loopback socket and stalls.
7. `start_oauth_server` no longer takes `port`. The range is a Rust `const [17248, 17249,
   17250, 17251]`. This also removes the `port + 3` integer overflow reachable by passing
   `65533`. The two JS call sites drop the argument.
8. **Negative:** the webview can no longer cause Velo to bind an arbitrary TCP port.

**P3 — Diagnostic command and DevTools**

9. `raw_fetch_diagnostic`, `imap_raw_fetch_diagnostic`, and its `generate_handler!` entry
   are behind `#[cfg(debug_assertions)]`. `cargo build --release` produces a binary in
   which invoking either name returns Tauri's "command not found", proven by
   `strings`/`nm` absence check or an integration assert.
10. The diagnostic honours `config.auth_method`: `oauth2` goes through `AUTHENTICATE
    XOAUTH2` like the correct branch at `:962`, so an access token is **never** sent as a
    `LOGIN` password.
11. The `log::info!` transcript dump at `:1101` becomes `log::debug!` **and** the `LOGIN`/
    `AUTHENTICATE` request line is redacted before it reaches the log buffer.
    `grep -c "RAW IMAP DIAGNOSTIC" <release log>` = 0 after a diagnostic attempt.
12. `"devtools"` is removed from the `tauri` feature list in `Cargo.toml`. Tauri enables
    DevTools automatically in debug builds; the feature flag exists only to force them
    *on in release*, which is exactly what we do not want on a window that renders
    untrusted email HTML. `open_devtools` and its registration get `#[cfg(debug_assertions)]`;
    the Settings button is gated on `import.meta.env.DEV`.

**P4 — Literal allocation**

13. `extract_literal_size` returns `Result<Option<usize>, String>` and errors above
    `MAX_LITERAL_BYTES = 64 * 1024 * 1024` **before** any `vec![0u8; n]`. Both allocation
    sites (`:1259` discard path, `:1278` body path) propagate it.
14. Test: a FETCH line ending `{99999999999}` returns `Err`, allocates nothing, and does
    not abort the process. Test: `{67108865}` (64 MiB + 1) errors; `{1024}` succeeds.

**EX-002 + housekeeping**

15. The three pre-existing lints are **fixed, not silenced** — re-confirmed by a clean
    clippy run today, all three in `src-tauri/src/imap/client.rs`:
    - `:1578` `too_many_arguments` — `parse_message` takes 9. Bundle the per-message
      metadata (`uid`, `folder`, `raw_size`, `is_read`, `is_starred`, `is_draft`,
      `internal_date`) into one struct; the existing `RawFetchedMessage` is nearly it.
    - `:1704` `unnecessary_map_or`
    - `:1815` `question_mark` — `match … { None => return None, Some(a) => a }` → `addr?`
16. `.github/workflows/ci.yml` drops `-A clippy::too_many_arguments -A clippy::question_mark
    -A clippy::unnecessary_map_or`. CI is red if any of them returns. **EX-002 closes on merge.**
17. ~~`serde_json = "1.0"` is removed from `src-tauri/Cargo.toml`.~~ **Not done — the audit
    is wrong.** `serde_json` has zero references in `src-tauri/src/`, but
    `tauri::generate_context!()` expands to code that names `::serde_json` in the calling
    crate, so removing it fails the build with `E0433: cannot find serde_json in the crate
    root`. Verified by removing it and rebuilding. It stays, now with a comment saying why.
    Audit §4's "unused dependency" line should be treated as retracted.
18. Rust test count goes from **6** (all in `smtp/`) to a suite that covers `imap/wire.rs`
    and `oauth.rs` — today both have **zero** tests.
19. `npx tsc --noEmit` and the full `vitest` suite (1,562 tests, both TZ legs) stay green.
    No frontend behaviour changes except the DevTools button visibility.

---

## Constraints & context

- **Decisions already made** (`docs/decisions/LOG.md`, not to be relitigated): all 20 audit
  items accepted as written; batch order D0 → **A** → B → C → G → E → E2 → F → H; agents
  never merge; CI is the only source of test status.
- **ADR-000 "Standard → this stack":** every `#[tauri::command]` argument is a trust
  boundary and validates itself. Tauri capabilities are the middleware, not the check —
  the same rule as "authz lives in the request handler, never middleware-only". All 23
  commands currently have **zero** argument validation; Batch A fixes the ones on the
  wire path and leaves the rest for their own batches.
- **The webview is semi-trusted, not trusted.** It renders untrusted email. P1 is not
  hypothetical hardening: folder names arrive from the *server* via `LIST`, flow into the
  frontend, and come back as `folder` arguments.
- **No dependency may be added without asking.** See *Not doing*.
- **`main` is protected; agents never merge.** Work lands on `feat/batch-a-rust-security`,
  CI gates it, Jim merges.

---

## Threat (Tier 2)

Per changed surface.

**Surface 1 — IMAP command construction (`imap/client.rs`, `commands.rs`)**

- *Spoofing:* an attacker who controls a mailbox the user syncs controls folder names
  returned by `LIST`. Those names round-trip through the UI back into `folder` arguments.
  Post-fix they are quoted or rejected before reaching the wire.
- *Tampering (the actual bug):* a `\r\n` in `folder`, `flags`, `since_date`, or `uid_range`
  splits one IMAP command into two. The injected command runs **with the user's
  authenticated session**, so it can `DELETE` a mailbox, `STORE \Deleted`, `EXPUNGE`, or
  `APPEND` forged mail. Trust boundary = the `#[tauri::command]` argument list; validation
  now sits there and at the wire helper (defence in depth, both cheap).
- *Repudiation:* out of scope — Velo has no app audit log (`05-security.md` §7 is unmet
  repo-wide; that is a known gap, not one Batch A introduces or closes).
- *Disclosure:* the raw `LOGIN` path interpolates the password; an unescaped `"` in a
  password currently corrupts the command and can push credential bytes into an
  unpredictable server-side parse. Quoting fixes it.
- *DoS:* an injected `SEARCH` on a large mailbox, or repeated `EXPUNGE`. Bounded by the
  existing 60 s command timeouts.
- *Elevation:* no authz decision exists in this path — the IMAP session *is* the authority.
  That is precisely why argument validation cannot be skipped: there is no second gate.

**Surface 2 — OAuth loopback server (`oauth.rs`)**

- *Spoofing:* any local process can connect to `127.0.0.1:17248` during the 300 s accept
  window and present a fake redirect. The `state` comparison at `:58` is the defence and it
  is correct — but today it is unreachable when the malformed input panics first at `:132`.
  Fixing the panic makes the CSRF check actually run. **This is the sharpest edge in P2:**
  the security control exists and is being bypassed by a crash.
- *Tampering:* the redirect query string is attacker-shaped input parsed by a hand-written
  decoder. Post-fix it cannot panic and cannot produce invalid UTF-8.
- *Disclosure:* the authorization code is single-use and PKCE-bound; a stolen code without
  the verifier is not redeemable. Unchanged by this work.
- *DoS:* one stalled connection currently hangs `start_oauth_server` for the process
  lifetime — the accept timeout does not cover the read. The 30 s read timeout closes it.
  Note the server still handles exactly one connection, so a local attacker who connects
  first still denies the sign-in; that is inherent to the loopback pattern and is bounded
  by the user retrying. Not fixed here, called out deliberately.
- *Elevation:* the webview choosing the listening port is a capability it should not have.
  Removed.

**Surface 3 — Diagnostic command and DevTools (`client.rs`, `lib.rs`, `Cargo.toml`)**

- *Disclosure (the actual bug):* for an OAuth account, `config.password` **is the access
  token**, and `:1066` sends it as a plaintext `LOGIN` password regardless of
  `auth_method`. A malicious or merely chatty server can echo it into a `BAD` response,
  which `:1101` then writes to the persistent log at `info` in **release** builds. Two
  independent fixes (route through XOAUTH2; make the whole command debug-only) so either
  alone would have been sufficient.
- *Elevation:* `open_devtools` gives an end user — or anything that reaches the IPC bridge
  from a page rendering untrusted email — a debugger on the window holding session state.
  Compile it out of release.

**Surface 4 — IMAP literal parsing (`client.rs`)**

- *DoS:* `{4294967295}` from a hostile or broken server → `vec![0u8; 4 GiB]`. Rust's
  allocation-failure path **aborts the process**; it is not a catchable error. Reachable
  from `imap_fetch_messages` via the `ASYNC_IMAP_EMPTY` fallback, i.e. on exactly the
  non-standard servers this code path exists to serve. Capped at 64 MiB, which is above
  any realistic message and below anything that hurts.
- *Tampering:* the literal size governs how many bytes are consumed as body rather than
  parsed as protocol. A bounded, validated size also keeps the framing honest.

---

## Rollback

- **`git revert` of the Batch A merge commit, and nothing else.** No database migration, no
  schema change, no settings key, no on-disk format change, no persisted-state change, and
  no change to any stored credential. Reverting restores the previous binary behaviour exactly.
- **Deviation from the planned commit split.** The brief called for six commits so a
  partial revert would be meaningful. In practice P1, P3, P4 and the clippy fixes all
  edit interleaved regions of the same function bodies in `src-tauri/src/imap/client.rs`,
  so a clean per-item split was not achievable without rewriting hunks by hand — which
  would have produced commits that never individually compiled, making the "revert one"
  property fictional rather than real. Landed as two commits instead (Rust + frontend
  changes; then CI and paperwork). **Revert granularity is therefore the whole batch.**
  Flagged rather than papered over.
- **Rehearsal:** `main` @ `b751b94` is the revert target and its CI is already green
  (run 33478845306), so the way back is a state that has been built and tested, not a
  hypothesis. Nothing in this batch writes to disk, so no state has to be unwound to
  return to it.
- **Known-bad signal to watch after merge:** if any user reports IMAP folders that no longer
  open, the suspect is `quote_string` rejecting a legitimate folder name (a non-ASCII or
  modified-UTF-7 mailbox). Mitigation: `quote_string` rejects only `\r`, `\n`, and NUL —
  never non-ASCII — and there is a test asserting a UTF-8 folder name passes through. If it
  happens anyway, revert commit 1 alone.
- **Blast radius if it goes wrong and is not caught:** an over-strict validator makes a
  mailbox unreadable. It cannot corrupt or delete mail — every change in this batch either
  rejects input or narrows what is sent. There is no write path that becomes *more*
  permissive.

---

## Observations found while verifying (not in the audit, not being fixed here)

Recorded so they are not lost. Each needs its own brief.

1. **`async-imap` 0.10.4 does not validate `uid_store`, `uid_search`, or `append`'s
   mailbox/flags** (verified in the vendored source: `client.rs:808-828`, `:1219-1221`,
   `:1119-1136`). The audit listed six raw-`format!` sites; these three library calls are a
   **seventh, eighth, and ninth injection sink** and are folded into P1's scope above —
   this is the one place Batch A is *wider* than the audit text, and deliberately so.
2. **The OAuth 17249–17251 fallback is dead code.** `redirectUri` is hard-coded to
   `:17248` in both `oauthFlow.ts:71` and `auth.ts:88`, so if the server binds a fallback
   port the provider still redirects to 17248 and the sign-in times out. Binding the
   fallback makes failure *slower*, not likelier to succeed.
3. **`oauthFlow.ts:71` builds `http://localhost:17248` while the server binds `127.0.0.1`**
   (upstream commit `ec47a7a` deliberately switched the bind). On a host where `localhost`
   resolves to `::1` first, that redirect goes nowhere. `gmail/auth.ts:88` already uses
   `127.0.0.1`. Likely a live bug for non-Gmail OAuth providers.
4. **`fetch_new_uids` / `delta_check_folders` compute `last_uid + 1` on a `u32`** with no
   overflow guard (`client.rs:380`, `:718`). Unreachable in practice (UIDs near `u32::MAX`),
   panics in debug if ever reached.
5. **The `state` comparison at `oauth.rs:58` is a plain `!=`**, not constant-time. Low value
   to fix — `state` is a one-shot CSRF nonce, not a stored secret — but noted.

---

## Approval

- Plan approved by: **Jim — pre-approved 2026-09-01** ("I preapprove Batch A"), on the
  understanding that the plan is reviewed alongside the PR rather than before it. This
  deviates from `02-work-loop.md`'s "Tier 2: plan approved *before code*" — the deviation
  is Jim's own instruction (precedence rule 1) and is recorded here rather than left implicit.
- Reviewed by: __________ date: ______
