# SPEC-PR-E — Rust parser majors: `mail-parser` 0.11, `async-imap` 0.11, `reqwest` 0.13, `socket2` 0.6

- **Task:** Move the four Rust crates that touch hostile bytes, the authenticated IMAP
  session, the OAuth token exchange and the keepalive socket to their current majors, in
  three commits that each stand alone, with the MIME-parsing regression net written first
  because none exists today.
- **Tier:** **2** — dependency changes on the Rust IMAP/SMTP/OAuth path (`CLAUDE.md`: Rust
  IMAP/SMTP/OAuth and any dependency change are Tier 2). **This document is the plan only.**
  No `Cargo.toml`, `Cargo.lock` or source change until Jim approves it.
- **Base:** `main` @ `a27398f` (code pin `e05f6cd`, #75). Every version and measurement below
  was taken on 2026-09-03 against this tree.
- **Status:** **draft — awaiting Jim's approval. No code, no dependency change.**
- **Source:** the vault's `2026-09-01_Velo_Dependency-Audit.md` (PR E, the Cargo table, "What
  not to upgrade yet"); `docs/audits/2026-09-01-optimize-audit.md` P18 and the Batch G row;
  ROADMAP §3. The vault sequenced this after E2 (`imap/client.rs` was being rewritten); E2
  parts 1–3 have landed (#37, #39, #73), so the rebase hazard is gone.
- **Effort:** M · 1 day of agent work once approved (half of it the fixture suite).

## Outcome

Velo parses mail with a `mail-parser` that no longer panics on corrupted attachments, nested
messages or bad quoted-printable; talks IMAP through `async-imap` 0.11; exchanges OAuth tokens
and reaches custom AI endpoints through `reqwest` 0.13 on the same native TLS as today; and
carries one `socket2` instead of two. Nothing user-visible changes, and a MIME fixture suite
now stands between the parser and the next regression.

## What exists, verified at `a27398f`

1. **Versions today** (`src-tauri/Cargo.toml` / `Cargo.lock`): `mail-parser = "0.9"` (0.9.4,
   default features — which in 0.9 include `full_encoding`); `async-imap = "0.10"` (0.10.4,
   `default-features = false`, `runtime-tokio`); `reqwest = "0.12"` (0.12.28,
   `default-features = false`, `native-tls`, `json`); `socket2 = "0.5"` (0.5.10);
   `base64 = "0.22"`; `rust-version = "1.89"` (CI-checked). Latest on crates.io: `mail-parser`
   **0.11.8** (updated 2026-08-22), `async-imap` **0.11.3** (2026-07-17), `reqwest` **0.13.4**
   (`rust-version` 1.85), `socket2` **0.6.5** (`rust-version` 1.70). `mail-parser` and
   `async-imap` declare no MSRV.
2. **The graph already holds `reqwest` 0.13.4 and `socket2` 0.6.5** — `tauri-plugin-updater`
   2.11.0 pulls reqwest 0.13.4; `hyper-util` pulls socket2 0.6.5; Velo's own `reqwest` 0.12.28
   is shared with `tauri-plugin-http` 2.6.0 (the latest), which pins 0.12. So after this PR
   **reqwest stays duplicated** (plugin-http on 0.12 until it moves); **socket2 does dedupe**.
   The vault's "aligning removes the duplicate reqwest" is corrected here.
3. **`base64` cannot be collapsed by Velo alone** — four versions, each pinned by someone
   else: 0.13.1 by `utf7-imap` 0.3.2 (unmaintained since 2022-09, its latest), 0.21.7 by
   `swift-rs` under `tauri-utils` (build time), 0.22.1 by Velo, `async-imap` 0.11.3 and
   `reqwest`, 0.23.1 by `lettre`'s `email-encoding`. Bumping Velo to 0.23 (the vault's
   suggestion) would leave it sharing with `lettre` and splitting from `async-imap`/`reqwest`:
   still four versions. **Left alone, with this evidence.**
4. **Measured in a throwaway copy of `src-tauri`** (scratch directory, the four bumps applied,
   `cargo check` against the existing build cache; the repo untouched):
   - **`mail-parser` 0.11.8: exactly three compile errors**, all its `usize → u32` change, all
     in `src/imap/client.rs`: `:1964` (`message.parts.get(part_idx)` — attachment indices are
     now `u32`), `:1965` (`section_map.get(&part_idx)` — the map is keyed by `usize`),
     `:2051` (`walk(parts, child_idx, …)` — `Multipart` children are `u32`). One boundary
     conversion fixes all three.
   - **`async-imap` 0.11.3: compiles unchanged.** **`reqwest` 0.13.4 with `native-tls`,
     `json`, `form`: compiles unchanged.** **`socket2` 0.6: compiles unchanged**
     (`SockRef::from`, `TcpKeepalive::new` in `imap/net.rs:84-85`).
   - **Transitive delta:** the crate list stays at **374**; removed `async-imap 0.10.4`,
     `mail-parser 0.9.4`, `socket2 0.5.10`; added `async-imap 0.11.3`, `mail-parser 0.11.8`,
     **`hashify 0.2.9`** — the one new crate (perfect hashing for header names; Stalwart Labs,
     the same owner as `mail-parser`; a proc-macro depending on `indexmap`, `proc-macro2`,
     `quote`, `syn`; 2.27 M downloads). `rkyv` stays **optional and off** in `mail-parser`
     0.11 (its default feature set is empty), so EX-006 is unaffected; `rkyv 0.7.46` remains
     lockfile-only through `sqlx`, exactly as today.
   - **`cargo audit` on the scratch lockfile:** 0 vulnerabilities with the same three ignores
     as CI (EX-003, EX-006), the same 20 allowed warnings (the gtk-rs stack under Tauri's
     Linux target, plus `atty` — all pre-existing).
5. **`mail-parser`'s breaking changes, checked against Velo's use:** `HeaderName` became
   `#[non_exhaustive]` in 0.10 — Velo never matches on it (it constructs `HeaderName::Other`
   and `HeaderName::ListUnsubscribe` to call `header()`); `serde_support` → `serde` (Velo uses
   neither); `usize → u32` (the three sites); **the default feature set is now empty** — 0.9's
   default was `full_encoding`, so **`features = ["full_encoding"]` must be explicit or
   non-UTF-8 charsets (ISO-8859-1, Windows-1252 bodies) silently degrade**. That is the one
   behaviour change a bare bump would introduce, and there is no test today that would catch
   it.
6. **Why `mail-parser` first (security value):** 0.11.2 stops corrupted nested messages from
   producing invalid MIME parts; 0.11.3 and 0.11.5 fix panics on corrupted attachments and
   nested messages; 0.11.5 leniently decodes quoted-printable with invalid `=` escapes; the
   vault records 0.11.6's `Received`-header panic and fabricated-address fixes. Velo runs the
   parser inside a pooled IMAP command on bytes a sender chose: a panic there evicts the
   session (E2 finding 5) and fails the fetch — a hostile message is a per-thread denial of
   service today.
7. **`async-imap` 0.10.4 → 0.11.3, checked against Velo's 17 session methods:** 0.11.0
   changed `read_response()` to `Result<Option<_>>` — Velo does not call it; 0.11.0 added
   `Session::get_ref/get_mut` — Velo's `ImapStream` has its own `get_mut` through `Pin`
   (`client.rs:116-149`), a different type, no clash; **0.11.2 quotes mailbox names with
   whitespace** — Velo passes folder names to `select` **unquoted** at 14 sites
   (`client.rs:267 … 1064`) and quotes only in its raw-TCP fallback (`wire::quote_string`,
   `client.rs:1229,1341`), so there is no double quoting, and a folder such as `Sent Messages`
   may start working where it did not — a live check on the harness is in the tests; 0.11.2
   cut the IDLE timeout to 29 minutes — Velo does not use IDLE; 0.11.3's
   `login_with_capabilities()` is optional and not adopted; `imap-proto` stays on the 0.16 line
   (0.16.7 today, `^0.16.4` required); the unsolicited-response channel that F-5's `COPYUID`
   drain reads (`copyuid.rs`, `client.rs:634,657`) is unchanged, and its ignored live test is
   the proof.
8. **`reqwest` 0.12.28 → 0.13.4, checked against Velo's use** (`ai_fetch.rs`, `oauth.rs`):
   0.13 defaults to rustls with aws-lc — **Velo sets `default-features = false` and names
   `native-tls`, which still exists (now with ALPN; `native-tls-no-alpn` is the opt-out)**, so
   the TLS backend does not move; **`form` became an opt-in feature and `oauth.rs:353,398` call
   `.form(&params)`** — it must be added or the token exchange stops compiling (the dry run
   included it); `json` unchanged; `redirect::Policy::none()`, `Client::builder()`,
   per-request `.timeout()` unchanged; the renamed TLS methods are soft-deprecated and Velo
   calls none of them; `http2` stays off as today (Velo never enabled reqwest's defaults).
9. **The regression net does not exist.** `src/imap/client.rs` has 11 tests, none of which
   parses a MIME message; no fixture directory; no test mentions a charset. `wire.rs` (19),
   `copyuid.rs` (17, one live), `oauth.rs` (10), `ai_fetch.rs` (16), `net.rs` (2) cover their
   own seams. Batch A's wire tests protect command rendering, not parsing.

## Requirements

- **REQ-0** Before any bump, the parser's behaviour today is pinned.
  - REQ-0.1 A fixture suite in `src-tauri/src/imap/` (a `parse_tests` module beside
    `parse_message`) SHALL assert, on hand-written RFC 5322 messages: a single-part text body
    → section `"1"`; `multipart/mixed` with a nested `multipart/alternative` and a file
    attachment → sections `"1.1"`, `"1.2"`, `"2"` and one attachment; a nested
    `message/rfc822`; an ISO-8859-1 and a Windows-1252 body decoded to the right characters
    (**this is the `full_encoding` guard**); `Authentication-Results` and
    `List-Unsubscribe`/`List-Unsubscribe-Post` extraction; and that a truncated base64
    attachment, a missing closing boundary and quoted-printable with a stray `=` **do not
    panic** and yield the parts they can.
  - REQ-0.2 The suite SHALL be green on 0.9.4 first (one commit), so the bump commit's diff
    shows exactly what the parser changed.
- **REQ-1** As the maintainer I want each crate to land as its own revertible commit.
  - REQ-1.1 Commit 2 SHALL bump `mail-parser` to **0.11** with `features = ["full_encoding"]`
    and `default-features` left at the new default (no `rkyv`, no `serde`), and fix the three
    `u32` sites by converting at the boundary (`usize::try_from` / `as usize` where the value
    is an index the parser produced), with no other source change.
  - REQ-1.2 Commit 3 SHALL bump `async-imap` to **0.11** with `default-features = false,
    features = ["runtime-tokio"]` as today, and no source change.
  - REQ-1.3 Commit 4 SHALL bump `reqwest` to **0.13** with `default-features = false,
    features = ["native-tls", "json", "form"]` and `socket2` to **0.6**, and no source change.
  - REQ-1.4 No other crate SHALL be added, removed or bumped. `base64` stays at 0.22 (§3).
    `windows` 0.62 stays out (needs a Windows box). `login_with_capabilities` is not adopted.
- **REQ-2** As the maintainer I want proof at every step.
  - REQ-2.1 After each commit: `cargo test --locked`, `cargo clippy --all-targets --locked --
    -D warnings`, `cargo build --locked`, `cargo check --release --locked`, `cargo audit` with
    CI's ignores, the CI `sqlx` single-copy check, and CI green on the exact commit; the
    frontend gates unchanged (they do not touch this).
  - REQ-2.2 After commit 4: `cargo tree --locked -e normal -d` SHALL show `socket2` once, and
    `cargo tree -i rustls` SHALL show no path from `velo`'s own `reqwest` (native TLS held).
  - REQ-2.3 The PR body SHALL record the transitive delta (`cargo tree --prefix none` before
    and after) and the `cargo audit` summary at each commit.
  - REQ-2.4 Live, against the Dovecot harness: the existing ignored `live_dovecot` tests
    (COPYUID on the unsolicited channel; the E2 part 3 pair) and one new ignored test that
    creates and selects a folder with a space in its name through the pooled path. **Recorded
    as not run if Docker is down**, never claimed.
- **REQ-3** As Jim I want the corrections to the vault named, not buried: the reqwest
  duplicate stays (§2); `base64` is not collapsible (§3); `full_encoding` is a behaviour cliff
  (§5).

## Not doing

- **Not moving Ollama to `ai_fetch` or unsubscribe to Rust** (P11's follow-up) — unrelated
  to these crates.
- **Not bumping `lettre`, `native-tls`, `tokio`, `tauri*`** — current.
- **Not enabling `rkyv` or `serde` on `mail-parser`**, not enabling `http2`, `rustls` or
  `system-proxy` on `reqwest`, not enabling `compress` on `async-imap`.
- **Not adopting `login_with_capabilities`** — a protocol behaviour change with its own brief
  if ever wanted.
- **Not touching `utf7-imap`** — its `base64` 0.13 pin is the cost of a tiny, stable crate;
  replacing it is a separate decision.

## Design

- **Commit 1 — the fixture suite on 0.9.4** (REQ-0). Pure Rust tests calling
  `parse_message`/`build_imap_section_map` and the header helpers on literal messages; no
  network, no fixture files (inline `&str` messages keep the corpus greppable).
- **Commit 2 — `mail-parser` 0.11.** `Cargo.toml`: `mail-parser = { version = "0.11",
  features = ["full_encoding"] }`. `client.rs`: the section map keyed by `u32` (the parser's
  own index type) — `build_imap_section_map` returns `HashMap<u32, String>`, `walk` takes
  `u32` and indexes with `usize::from`-style conversion at the `parts.get(...)` calls; the
  attachment loop uses the same. Three sites, one shape. The suite from commit 1 must stay
  green byte for byte; a fixture that changes output is a finding to disposition, not a test
  to edit.
- **Commit 3 — `async-imap` 0.11.** `Cargo.toml` only. The live folder-with-a-space test is
  added here (ignored).
- **Commit 4 — `reqwest` 0.13 + `socket2` 0.6.** `Cargo.toml` only; the `form` feature is the
  line that makes `oauth.rs` compile.
- **Decision & alternatives** — (a) four commits in one PR, parser first (chosen; the vault's
  order, security value first, each revertible). (b) One commit: loses the bisect and the
  per-crate revert for no gain. (c) Skip `socket2`: leaves a dedupe that costs one line.
  (d) Skip the fixture suite and rely on the live harness: the harness is not runnable on
  this machine today and proves the protocol, not the parser — the suite is the only thing
  that would catch a charset regression.
- **Data / schema** — none.
- **Failure modes** — a fixture that changes output under 0.11 (most likely: header
  normalisation or address parsing): stop, record, disposition — that is the suite doing its
  job; a live-harness difference in `select` quoting (0.11.2): the Dovecot check; a TLS
  handshake difference from ALPN with native-tls (0.13): `ai_fetch`'s and `oauth`'s tests
  run against real endpoints only manually — the smoke run is Jim's; an MSRV surprise: CI's
  `rust MSRV` job on 1.89 is the check (all declared MSRVs are ≤ 1.85).

## Tasks (risk-first, after approval)
- [ ] 1. Commit 1: the fixture suite, green on 0.9.4 (REQ-0).
- [ ] 2. Commit 2: `mail-parser` 0.11 + the three-site fix; suite unchanged and green;
  REQ-2.1 gates and the transitive/audit record.
- [ ] 3. Commit 3: `async-imap` 0.11; the folder-with-a-space live test (ignored); gates.
- [ ] 4. Commit 4: `reqwest` 0.13 + `socket2` 0.6; REQ-2.1 and REQ-2.2 gates.
- [ ] 5. Two review legs on the PR (Gemini 3.8 Flash High via `agy`, Grok 4.6 via the `grok`
  CLI); merge on green under the standing rule.
- [ ] 6. LOG.md; the vault audit's landing log with the three corrections (REQ-3);
  `CLAUDE.md` if it names crate versions; HANDOFF pin after merge. **Manual, Jim:** the live
  harness run if Docker is up; `npm run tauri dev` smoke on an IMAP account (fetch a thread
  with attachments, a non-UTF-8 message, sign in with OAuth) — recorded as open until done.

## Done when
Every REQ-2 gate green on each commit and on the merge commit in CI; the fixture suite green
on both parser versions with no fixture edited between them; `socket2` single in the tree;
native TLS held; the transitive delta and audit summary in the PR body; the live tests run or
recorded as not run. Manual smoke open for Jim.

## Rollback
`git revert` of any one commit or the squash; `Cargo.lock` reverts with it and `cargo build
--locked` is the proof. No state, no schema. The fixture suite (commit 1) stays useful on
either version and need not be reverted.

## Threat pass (Tier 2 — supply chain and the parsing boundary)
- **Assets:** the process that parses hostile mail (`mail-parser` runs on sender-chosen bytes
  inside the app); the authenticated IMAP session and the credential that opened it
  (`async-imap` sends LOGIN); the OAuth refresh/exchange and the custom AI endpoint
  (`reqwest`, TLS); the developer machine and CI at build time (a proc-macro runs there).
- **Provenance:** crates.io carries no build attestations; the checks are publisher identity
  and maintenance: `mail-parser` and `hashify` — `mdecimus` (Stalwart Labs; the mail server
  vendor), updated 2026-08-22 and 2026-04-01; `async-imap` — the `async-email` organisation
  (Delta Chat), 2026-07-17; `reqwest` — `seanmonstar` (hyper's author), `rust-version` 1.85;
  `socket2` — the `rust-lang` organisation. Nothing here is new to the graph except
  `hashify`, whose owner already ships `mail-parser` to Velo.
- **Lockfile:** `cargo build --locked` in CI is the frozen gate; the lockfile moves only in
  the commit that bumps a crate, and REQ-2.3 records what moved.
- **Transitive cost:** +1 crate (`hashify`, build-time proc-macro on `syn`/`quote`, the same
  class as every derive macro already compiled), −0; crate count 374 → 374 (measured).
  `encoding_rs` stays (it is what `full_encoding` is). No `rkyv`, no rustls/aws-lc for Velo's
  client, no `async-compression`.
- **Blast radius, per crate:** `mail-parser` — parses untrusted input; the upgrade *reduces*
  the panic surface (§6) and the fixture suite holds the output stable; a regression here is
  wrong attachment sections or wrong charsets, not disclosure. `async-imap` — carries the
  credential on LOGIN and the session after; the 0.10.4 → 0.11.3 diff is four small entries
  (§7) and Velo's wire validation (`imap::wire`, audit P1) stays ahead of it; the 0.11.2
  quoting change is the one thing that alters bytes on the wire, and only for names with
  whitespace. `reqwest` — the token exchange and `ai_fetch`; the TLS backend is pinned to
  native-tls by feature, ALPN is the one wire-visible change (verify against Google and
  Microsoft token endpoints in the smoke run). `socket2` — keepalive options only.
- **Removal path:** each crate has a revert; `mail-parser` has no drop-in replacement (the
  fixture suite is what would make one possible); `async-imap` likewise; `reqwest` could give
  way to the plugin's client; `socket2` to raw `libc` calls.
- **Residual:** the `reqwest` duplicate until `tauri-plugin-http` moves to 0.13; `base64` ×4;
  `utf7-imap` unmaintained since 2022 (HOLD in the vault, no advisory); the live harness not
  runnable here.

## Review
Two legs on this plan, then two legs on the code PR: Gemini 3.8 Flash High via `agy`; Grok
4.6 via the `grok` CLI. Diffs from committed SHAs. Findings verified against source before
adoption; dispositions on the PR and in LOG.md.

## Approval
- Plan approved by: __________ date: ______ — **required before any `Cargo.toml`, `Cargo.lock`
  or source change.**
