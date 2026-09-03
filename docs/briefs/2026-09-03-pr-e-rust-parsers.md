# SPEC-PR-E — Rust parser majors: `mail-parser` 0.11, `async-imap` 0.11, `socket2` 0.6, `reqwest` 0.13

- **Task:** Move the four Rust crates that touch hostile bytes, the authenticated IMAP
  session, the keepalive socket and the OAuth token exchange to their current majors, in
  five commits that each stand alone, with the MIME-parsing regression net written first
  because none exists today.
- **Tier:** **2** — dependency changes on the Rust IMAP/SMTP/OAuth path (`CLAUDE.md`: Rust
  IMAP/SMTP/OAuth and any dependency change are Tier 2). **This document is the plan only.**
  No `Cargo.toml`, `Cargo.lock` or source change until Jim approves it.
- **Base:** `main` @ `a27398f` (code pin `e05f6cd`, #75). Every version and measurement below
  was taken on 2026-09-03 against this tree.
- **Status:** **approved by Jim, 2026-09-03 (see §Approval); built on branch
  `pr-e-rust-parsers`, five commits, rebase merge — PR #84.** Amended
  after both review legs on PR #78 (Gemini 3.8 Flash High, Grok 4.6; dispositions in LOG.md).
- **Source:** the vault's `2026-09-01_Velo_Dependency-Audit.md` (PR E, the Cargo table, "What
  not to upgrade yet"); `docs/audits/2026-09-01-optimize-audit.md` P18 and the Batch G row;
  ROADMAP §3. The vault sequenced this after E2 (`imap/client.rs` was being rewritten); E2
  parts 1–3 have landed (#37, #39, #73), so the rebase hazard is gone.
- **Effort:** M · 1 day of agent work once approved (half of it the fixture suite).

## Outcome

Velo parses mail with a `mail-parser` that no longer panics on corrupted attachments, nested
messages or bad quoted-printable; talks IMAP through `async-imap` 0.11; carries one `socket2`
instead of two; and exchanges OAuth tokens and reaches custom AI endpoints through `reqwest`
0.13 on the same native TLS **and the same handshake** as today, selected explicitly. A MIME
fixture suite now stands between the parser and the next regression. **What a user may
notice, by design:** a message that crashed the fetch on 0.9 now renders; a destination folder
with a space or a quote now works on servers without MOVE (§7); an address or `Received`
header 0.9 mis-parsed may display differently — each such case is a dispositioned fixture.
**One transitive crate is new: `hashify` 0.2.9, a pre-1.0 build-time proc-macro** (§4) — named
here because the house rule scrutinises pre-1.0 dependencies; its blast radius is compile time
only, and approving this plan approves it.

## What exists, verified at `a27398f`

1. **Versions today** (`src-tauri/Cargo.toml` / `Cargo.lock`): `mail-parser = "0.9"` (0.9.4,
   default features — which in 0.9 include `full_encoding`); `async-imap = "0.10"` (0.10.4,
   `default-features = false`, `runtime-tokio`); `reqwest = "0.12"` (0.12.28,
   `default-features = false`, `native-tls`, `json`); `socket2 = "0.5"` (0.5.10);
   `base64 = "0.22"`; `rust-version = "1.89"` (CI-checked). Latest on crates.io: `mail-parser`
   **0.11.8** (updated 2026-08-22), `async-imap` **0.11.3** (2026-07-17), `reqwest` **0.13.4**
   (`rust-version` 1.85), `socket2` **0.6.5** (`rust-version` 1.70). `mail-parser` and
   `async-imap` **declare no MSRV** — absence is not a floor; CI's `rust MSRV` job on 1.89 is
   the only check, and a 1.89 failure on their commits stops the bump. **The exact versions
   named here are the ones measured, and the plan pins them with `=`** (§Design) so the
   lockfile cannot float to an unmeasured patch during the PR.
2. **The graph already holds `reqwest` 0.13.4 and `socket2` 0.6.5** — `tauri-plugin-updater`
   2.11.0 pulls reqwest 0.13.4 with `default-features = false, features = ["json", "stream"]`
   plus its own default `rustls-tls` feature, which turns on reqwest's `rustls-no-provider`;
   `hyper-util` pulls socket2 0.6.5; Velo's own `reqwest` 0.12.28 is shared with
   `tauri-plugin-http` 2.6.0 (the latest), which pins 0.12. So after this PR **reqwest stays
   duplicated** (plugin-http on 0.12 until it moves); **socket2 does dedupe**. The vault's
   "aligning removes the duplicate reqwest" is corrected here.
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
     `quote`, `syn`; 2.27 M downloads; **pre-1.0, build time only**). `rkyv` stays **optional
     and off** in `mail-parser` 0.11 (its default feature set is empty), so EX-006 is
     unaffected; `rkyv 0.7.46` remains lockfile-only through `sqlx`, exactly as today.
   - **`cargo audit` on the scratch lockfile:** 0 vulnerabilities with the same three ignores
     as CI (EX-003, EX-006), the same 20 allowed warnings (the gtk-rs stack under Tauri's
     Linux target, plus `atty` — all pre-existing).
   - **What the scratch check was, and was not:** one `cargo check` of the library target on
     macOS with all four bumps applied at once. It was not `--all-targets`, not `cargo test`,
     not per commit, not Linux or Windows. The build (REQ-2.1) does each commit with
     `--all-targets` and `cargo test` on this host and lets CI's Linux job be the second
     platform; `socket2` 0.6's Windows keepalive path is unmeasured until CI's release matrix
     builds it, which the fork cannot run (EX-007) — recorded.
   - **Feature unification, `reqwest` 0.13.4 in the scratch graph** (`cargo tree -e
     features`): one crate carrying **both** `__native-tls` (from Velo's `native-tls`) and
     `__rustls` (from the updater plugin's `rustls-no-provider`). That is what Cargo does with
     two dependents of one version, and it is why the TLS choice below is made explicit.
5. **`mail-parser`'s breaking changes, checked against Velo's use:** `HeaderName` became
   `#[non_exhaustive]` in 0.10 — Velo never matches on it (it constructs `HeaderName::Other`
   and `HeaderName::ListUnsubscribe` to call `header()`); `serde_support` → `serde` (Velo uses
   neither); `usize → u32` (the three sites); **the default feature set is now empty** —
   quoted from 0.11.8's manifest as `cargo info` prints it: `default = []`, `encoding_rs`,
   `full_encoding = [encoding_rs]`, `rkyv = [dep:rkyv]`, `serde = [dep:serde]`. 0.9's default
   was `full_encoding`, so **`full_encoding` must be explicit or the multi-byte charsets
   (Shift_JIS, GBK, Big5, EUC-KR, … bodies) silently degrade** — *corrected in the build
   (Grok L2 on #84): the single-byte tables (ISO-8859-1, Windows-1252) are built in and
   decode without the feature; the feature gates `decoders/charsets/multi_byte.rs` only, so
   the fail-closed proof is a Shift_JIS fixture.* That is the one behaviour change a
   bare bump would introduce, and there is no test today that would catch it; the plan writes
   the dependency **fail-closed** (`default-features = false` as well as the explicit feature)
   so a future default cannot re-enable `rkyv` or `serde` unnoticed, and proves the guard by
   running the charset fixtures once with the feature omitted (they must fail). Nested-message
   depth is capped by the parser (`MAX_NESTED_ENCODED = 3`, `parsers/message.rs:17`) in both
   versions; **input size is not capped by the parser** — a fetched body is bounded only by
   what the server declares and Velo's fetch timeout — a pre-existing residual, unchanged.
6. **Why `mail-parser` first (security value):** 0.11.2 stops corrupted nested messages from
   producing invalid MIME parts; 0.11.3 and 0.11.5 fix panics on corrupted attachments and
   nested messages; 0.11.5 leniently decodes quoted-printable with invalid `=` escapes; the
   vault records 0.11.6's `Received`-header panic and fabricated-address fixes. Velo runs the
   parser inside a pooled IMAP command on bytes a sender chose: a panic there evicts the
   session (E2 finding 5) and fails the fetch — a hostile message is a per-thread denial of
   service today.
7. **`async-imap` 0.10.4 → 0.11.3, checked against Velo's 17 session methods and the crate
   source diff** (`diff -ru` of the two registry copies: **8 files, +498 −243** —
   `client.rs`, `imap_stream.rs`, `parse.rs`, `types/fetch.rs`, `mock_stream.rs` and the
   `id`/`idle`/`quota` extensions; the changelog's four bullets understate it): 0.11.0 changed
   `read_response()` to `Result<Option<_>>` — Velo does not call it; 0.11.0 added
   `Session::get_ref/get_mut` — Velo's `ImapStream` has its own `get_mut` through `Pin`
   (`client.rs:116-149`), a different type, no clash. **LOGIN changed shape:** 0.11 sends
   the same `LOGIN {u} {p}` bytes (both versions quote through the same macro) but runs it
   through `run_command` and parses a `CAPABILITY` response code off the tagged OK to
   feed `login_with_capabilities()`; the plain `login()` Velo calls keeps its signature, and
   the duplex-stream test (REQ-2.3) captures the LOGIN line too, so the credential bytes on
   the wire are asserted, not assumed. `uid_fetch`/`fetch` parsing (`types/fetch.rs`,
   `parse.rs`) changed internally — the fixture suite does not reach that (it parses
   bodies, not FETCH responses); the existing `client.rs` FETCH-line tests and the live
   harness do. **Mailbox-name rendering:** both versions render `SELECT`, `EXAMINE`, `CREATE`, `DELETE`, `MOVE`, `UID
   MOVE`, `STATUS` and `APPEND` through the same quote-and-validate function (`validate_str`
   → the `quote!` macro: wraps in `"…"`, escapes `\` and `"`, refuses CR/LF — 0.10.4
   `client.rs:1476`, 0.11.3 `:1510`); **0.11 extends it to `COPY`/`UID COPY`, `LIST`'s
   pattern, `RENAME`, `SUBSCRIBE` and quota commands, which 0.10.4 rendered raw**. For Velo
   that changes bytes on the wire in exactly two places: the `UID COPY` destination in the
   move fallback for servers without MOVE (`uid_copy`), which today goes out unquoted (a
   destination with a space or a quote is broken on such servers), and `LIST "" "*"`, whose
   pattern becomes a quoted-string (RFC 3501's own example form). **No double quoting:** Velo
   never pre-quotes a name for the session API — `wire::quote_string` is used only by the
   raw-TCP fallback that builds its own `SELECT` (`client.rs:1229,1341`), and
   `wire::validate_mailbox` (`:769`) only refuses quotes and backslashes before `append`. The
   vault's "0.11.2 adds quoting for COPY-style commands" is confirmed; its implication that
   this "overlaps the fork's own P1 quoting" is not — P1 validates, it does not quote.
   0.11.2 cut the IDLE timeout to 29 minutes — Velo does not use IDLE; 0.11.3's
   `login_with_capabilities()` is optional and not adopted; `imap-proto` stays on the 0.16
   line (0.16.7 today, `^0.16.4` required); the unsolicited-response channel that F-5's
   `COPYUID` drain reads (`copyuid.rs`, `client.rs:634,657`) is unchanged.
8. **`reqwest` 0.12.28 → 0.13.4, checked against Velo's use** (`ai_fetch.rs`, `oauth.rs`)
   **and reqwest's source:** 0.13 defaults to rustls with aws-lc — Velo sets
   `default-features = false` and names `native-tls`. **In 0.13 `native-tls` now includes
   ALPN** (`native-tls = [__native-tls, __native-tls-alpn]`); in 0.12 Velo's `native-tls` did
   not (ALPN was the separate `native-tls-alpn` feature, never enabled), so today's OAuth
   handshake carries no ALPN extension. **The plan takes `native-tls-no-alpn`** (`=
   [__native-tls]`), which is byte-identical to today's handshake — the OAuth token exchange
   is a credential path and gets no behaviour change it does not need; HTTP/2 is off anyway,
   so ALPN would buy nothing. That removes the "verify the handshake against Google and
   Microsoft" item from the smoke run: there is nothing new to verify. **With both backends compiled (§4), reqwest's
   default is still native-tls:** `TlsBackend::default()` picks rustls only when `__rustls`
   is on *and* `__native-tls` is off, or with `http3` (`reqwest-0.13.4/src/tls.rs:621-635`).
   Rather than lean on that rule, the plan **calls `.use_native_tls()` explicitly** on the
   three builders (`ai_fetch.rs:125`; `oauth.rs:350,395`, which today use `Client::new()`), so
   a future feature drift from a plugin cannot move the OAuth exchange onto a different
   certificate store silently. **`form` became an opt-in feature and `oauth.rs:353,398` call
   `.form(&params)`** — it must be added or the token exchange stops compiling (the dry run
   included it); `json` unchanged; `redirect::Policy::none()`, `Client::builder()`, per-request
   `.timeout()` unchanged; the renamed TLS methods are soft-deprecated and Velo calls none of
   them; `http2` stays off as today. aws-lc is already compiled into the app today through
   the updater plugin, so no new native code enters the build.
9. **What the parser's output feeds, and what is persisted.** `parse_message` fills
   `ImapMessage` (`types.rs:48-70`: `message_id`, `in_reply_to`, `references`, the five
   address fields and `from_name`, `subject`, `date`, `body_html`/`body_text`, `snippet`,
   `list_unsubscribe`/`_post`) and `ImapAttachment` (`:76-82`: `part_id`, `filename`,
   `mime_type`, `size`, `content_id`, `is_inline`). All of it lands in SQLite through
   `imapSync.ts`, and **`part_id` is reused** as the IMAP section for on-demand attachment
   fetches (`imapSync.ts:207`). Section numbers are the message's MIME structure numbered the
   way IMAP `BODY[…]` numbers it — a property of the message, not of the parser version — so
   the invariant fixtures (REQ-0) are what make a revert safe for stored data.
10. **The regression net does not exist.** `src/imap/client.rs` has 11 tests, none of which
    parses a MIME message; no fixture directory; no test mentions a charset. `wire.rs` (19),
    `copyuid.rs` (17, one live), `oauth.rs` (10), `ai_fetch.rs` (16), `net.rs` (2) cover their
    own seams. Batch A's wire tests protect command rendering, not parsing.

## Requirements

- **REQ-0** Before any bump, the parser's behaviour today is pinned, in two kinds of fixture.
  - REQ-0.1 **Invariant fixtures** — RFC-compliant, hand-written messages whose output must
    be byte-identical on 0.9.4 and 0.11.8: a single-part text body → section `"1"`;
    `multipart/mixed` with a nested `multipart/alternative` and a file attachment → sections
    `"1.1"`, `"1.2"`, `"2"` and one attachment with its `filename`, `mime_type`, `size`;
    a nested `message/rfc822`; an inline image with `Content-ID` → `content_id` and
    `is_inline`; an ISO-8859-1 and a Windows-1252 body decoded to the right characters, and
    a Shift_JIS body (**the `full_encoding` guard** — the single-byte tables are built in,
    the multi-byte decoders are what the feature adds; corrected in the build); addresses —
    plain, RFC 2047 encoded display name
    (`=?UTF-8?B?…?=`), a comma inside a quoted display name, a group
    (`undisclosed-recipients:;`), several recipients — into `from_address`/`from_name`/
    `to_addresses`/`cc_addresses`/`reply_to`; `Message-ID`, `In-Reply-To` and `References`
    with angle brackets handled as today; `Date` in the RFC 5322 forms Velo sees (with and
    without a zone name) → the same `i64`; `Authentication-Results`, `List-Unsubscribe` and
    `List-Unsubscribe-Post` extraction. Every persisted field in §9 has at least one fixture.
  - REQ-0.2 **Hardening fixtures** — malformed inputs where 0.9.4's behaviour is asserted as
    it is (a panic, through `catch_unwind`, or a degraded output) and 0.11.8's is expected to
    differ: a truncated base64 attachment, a missing closing boundary, quoted-printable with
    a stray `=`, a corrupted nested `message/rfc822`, a `Received` header of the shape 0.11.6
    fixed. In commit 2 these assertions change, and each change is a line in the PR body.
  - REQ-0.3 The suite SHALL be green on 0.9.4 first (commit 1), so commit 2's diff shows
    exactly what the parser changed — and REQ-0.1's fixtures SHALL NOT change between the two.
- **REQ-1** As the maintainer I want each crate to land as its own revertible commit.
  - REQ-1.1 Commit 2 SHALL bump `mail-parser` to **`=0.11.8`** with `default-features =
    false, features = ["full_encoding"]` (fail-closed: no `rkyv`, no `serde`, and no future
    default can add them), and fix the three
    `u32` sites **by converting at the boundary**: the section map stays `HashMap<usize,
    String>`, `walk` keeps its `usize` parameter, and the three call sites convert the
    parser's `u32` with `usize::try_from(…).ok()?` (an index the parser produced can always
    be widened). No other source change.
  - REQ-1.2 Commit 3 SHALL bump `async-imap` to **`=0.11.3`** with `default-features =
    false, features = ["runtime-tokio"]` as today; its only source change is the tests it adds
    (REQ-2.3, REQ-2.5).
  - REQ-1.3 Commit 4 SHALL bump `socket2` to **`=0.6.5`**, and no source change.
  - REQ-1.4 Commit 5 SHALL bump `reqwest` to **`=0.13.4`** with `default-features = false,
    features = ["native-tls-no-alpn", "json", "form"]` and make **one source change:
    `.use_native_tls()` on the three client builders** (`oauth.rs:350,395` become
    `Client::builder().use_native_tls().build()`; `ai_fetch.rs:125` adds the call), plus the
    tests in REQ-2.2.
  - REQ-1.5 No other crate SHALL be added, removed or bumped, **except the one transitive
    addition the `mail-parser` bump brings, `hashify` 0.2.9, which Jim's approval of this plan
    approves explicitly** (pre-1.0, proc-macro, build time; §4 and §Threat pass). `base64`
    stays at 0.22 (§3). `windows` 0.62 stays out (needs a Windows box).
    `login_with_capabilities` is not adopted.
  - REQ-1.6 The code PR SHALL be landed by **rebase merge, not squash**, so each crate's
    commit survives on `main` and can be reverted alone (the repository allows all three
    merge methods; the standing squash habit is the one thing this requirement changes, and
    linear history is kept).
- **REQ-2** As the maintainer I want proof at every step.
  - REQ-2.1 After each commit, on this host: `cargo test --locked --all-targets`, `cargo
    clippy --all-targets --locked -- -D warnings`, `cargo build --locked`, `cargo check
    --release --locked`, `cargo audit` with CI's ignores, the CI `sqlx` single-copy check; and
    CI green on the exact commit (its Linux job is the second platform); the frontend gates
    unchanged (they do not touch this).
  - REQ-2.2 After commit 4: `cargo tree --locked -e normal -d` SHALL show `socket2` once.
    After commit 5: `cargo tree --locked -e features -i reqwest@0.13.4` SHALL show
    `native-tls-no-alpn` reached from `velo` and no `__native-tls-alpn`; the three
    `.use_native_tls()` builders SHALL be covered by a unit test that builds each client (a
    builder asked for a backend that is not compiled errors at `build()`); and **the OAuth
    token request SHALL have a mock-server test asserting the exact `Content-Type`
    (`application/x-www-form-urlencoded`) and body encoding** (`+` versus `%20`, the
    characters an identity provider is strict about), so the `form` feature's serializer is
    pinned, not assumed. The naive `cargo tree -i rustls` check is **not** the gate: rustls is
    in the graph through the updater plugin today and stays there.
  - REQ-2.3 Commit 3 SHALL add a unit test that drives `async-imap` over an in-memory duplex
    stream with a scripted server and asserts the exact bytes of `LOGIN`, `SELECT`, `UID
    COPY`, `UID MOVE`, `CREATE` and `LIST` for a name with a space, a name with a `"` and a
    `\`, a `[Gmail]/Sent Mail`-shaped name and a modified-UTF-7 name (`&AOQ-`): quoted once,
    escaped once, never twice — the wire truth for §7, runnable without Docker, **and it runs
    in CI** (it is not an ignored test).
  - REQ-2.4 The PR body SHALL record the transitive delta (`cargo tree --prefix none` before
    and after) and the `cargo audit` summary at each commit.
  - REQ-2.5 Live, against the Dovecot harness: the existing ignored `live_dovecot` tests
    (COPYUID on the unsolicited channel; the E2 part 3 pair) and one new ignored test that
    creates, selects and copies into a folder with a space in its name through the pooled
    path. **The agent SHALL attempt the harness before merge** (start Docker if it can) and
    state the result in the PR body; **whether a harness that cannot be started holds the
    merge is Jim's decision on this plan** — the standing instruction records manual checks
    as open, and this PR's reviewer asked for the opposite.
- **REQ-3** As Jim I want the corrections to the vault named, not buried: the reqwest
  duplicate stays (§2); `base64` is not collapsible (§3); `full_encoding` is a behaviour cliff
  (§5); COPY quoting is what 0.11.2 added, not an overlap with P1 (§7); `native-tls` in 0.13
  is not today's handshake — `native-tls-no-alpn` is (§8).

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
- **Not invalidating stored data on revert** — §9 and REQ-0.1 are why none is needed; if a
  hardening fixture shows 0.11 numbering a corrupted message's parts differently, that
  message's stored `part_id`s were already wrong on 0.9 (it could not fetch them either), and
  the disposition line in the PR body says so.

## Design

- **Commit 1 — the fixture suite on 0.9.4** (REQ-0). Pure Rust tests calling
  `parse_message`/`build_imap_section_map` and the header helpers on literal messages; no
  network, no fixture files (inline `&str` messages keep the corpus greppable). Two modules
  or two `mod`s in one file: `invariant` and `hardening`.
- **Commit 2 — `mail-parser` 0.11.** `Cargo.toml`: `mail-parser = { version = "=0.11.8",
  default-features = false, features = ["full_encoding"] }`. `client.rs`: three boundary
  conversions, signatures unchanged (REQ-1.1). The invariant suite must stay green byte for
  byte; every hardening assertion that changes is a dispositioned line; the Shift_JIS fixture
  is run once with `full_encoding` removed and must fail (the fail-closed proof — measured:
  it alone fails, the single-byte fixtures pass without the feature), then it is restored.
- **Commit 3 — `async-imap` 0.11.** `Cargo.toml` (`=0.11.3`), plus the duplex-stream wire
  test (REQ-2.3, in CI) and the folder-with-a-space live test (ignored).
- **Commit 4 — `socket2` 0.6.** `Cargo.toml` only (`=0.6.5`).
- **Commit 5 — `reqwest` 0.13.** `Cargo.toml` (`=0.13.4`, `native-tls-no-alpn`, `json`,
  `form` — the last is the line that makes `oauth.rs` compile), the three `.use_native_tls()`
  calls with their unit test, and the form-body mock-server test (REQ-2.2).
- **Landing:** rebase merge (REQ-1.6). Pins are `=` exact, as `sqlx = "=0.8.6"` already is in
  this manifest; loosening them later is a one-line decision per crate.
- **Decision & alternatives** — (a) five commits in one PR, parser first (chosen; the
  vault's order, security value first, each crate revertible alone — `reqwest` and `socket2`
  are different failure domains and get different commits). (b) One commit: loses the bisect
  and the per-crate revert for no gain. (c) Skip `socket2`: leaves a dedupe that costs one
  line. (d) Skip the fixture suite and rely on the live harness: the harness is not runnable
  on this machine today and proves the protocol, not the parser — the suite is the only
  thing that would catch a charset or address regression. (e) Rely on reqwest's backend
  default instead of `.use_native_tls()`: correct today (§8) and one plugin feature away
  from wrong; three explicit calls are cheaper than that bet.
- **Data / schema** — none; §9 for why stored `part_id`s survive a revert.
- **Failure modes** — an invariant fixture that changes output under 0.11 (most likely:
  address or `Message-ID` normalisation): stop, record, disposition — that is the suite doing
  its job, and it is also the case in which stored addresses would differ between versions,
  which Jim then weighs; a hardening fixture that changes: expected, one line each; a
  live-harness difference in `UID COPY` quoting: the duplex test predicts it and the harness
  confirms it; a TLS difference: none by construction (`native-tls-no-alpn` is today's
  handshake; `.use_native_tls()` pins the backend) — the smoke run covers the product, not a
  handshake; an MSRV surprise: CI's `rust MSRV` job on 1.89 is the check (`reqwest` and
  `socket2` declare ≤ 1.85; `mail-parser` and `async-imap` declare nothing).

## Tasks (risk-first, after approval)
- [ ] 1. Commit 1: the invariant and hardening suites, green on 0.9.4 (REQ-0).
- [ ] 2. Commit 2: `mail-parser` 0.11 + the three boundary conversions; invariant suite
  unchanged and green; hardening changes dispositioned; REQ-2.1 gates and the
  transitive/audit record.
- [ ] 3. Commit 3: `async-imap` 0.11; the duplex wire test (REQ-2.3); the folder-with-a-space
  live test (ignored); gates.
- [ ] 4. Commit 4: `socket2` 0.6; REQ-2.1 and the single-copy check.
- [ ] 5. Commit 5: `reqwest` 0.13 + `.use_native_tls()` ×3 with their test; REQ-2.1 and the
  feature-tree check.
- [ ] 6. The live harness attempt (REQ-2.5), result stated in the PR body.
- [ ] 7. Two review legs on the PR (Gemini 3.8 Flash High via `agy`, Grok 4.6 via the `grok`
  CLI); merge on green under the standing rule, subject to Jim's REQ-2.5 decision.
- [ ] 8. LOG.md; the vault audit's landing log with the four corrections (REQ-3);
  `CLAUDE.md` if it names crate versions; HANDOFF pin after merge. **Manual, Jim:** `npm run
  tauri dev` smoke on an IMAP account (fetch a thread with attachments, a non-UTF-8 message,
  sign in with OAuth) — recorded as open until done.

## Done when
Every REQ-2 gate green on each commit and on the merge commit in CI; the invariant suite
green on both parser versions with no fixture edited between them and every hardening change
dispositioned; `socket2` single in the tree; `native-tls` on the feature tree and explicit
in the three builders; the transitive delta and audit summary in the PR body; the live
harness attempted and its result stated. Closed, rather than merely done, when Jim's smoke
is signed.

## Rollback
`git revert` of any one crate's commit (they survive on `main` by REQ-1.6); `Cargo.lock`
reverts with it and `cargo build --locked` is the proof. No schema change. **Stored data:** the parser's outputs in SQLite
(§9) are stable across the two versions by REQ-0.1's invariant fixtures, and `part_id` is the
message's own IMAP section numbering; a revert re-derives the same values, so no
invalidation step is needed. The fixture suite (commit 1) stays useful on either version and
need not be reverted.

## Threat pass (Tier 2 — supply chain and the parsing boundary)

**STRIDE, per surface this PR touches:**
- **Spoofing** — display names and addresses come out of `mail-parser`; a change in how it
  splits `"Name" <addr>` or decodes RFC 2047 would change what the UI shows as the sender.
  REQ-0.1's address fixtures pin that; the phishing detector (F-3) reads the same fields.
- **Tampering** — attachment bytes and MIME boundaries are the parser's input; a corrupted
  boundary today can produce invalid parts (0.11.2 fixes that). Section numbers feed
  `BODY[…]` fetches; REQ-0.1 pins the numbering.
- **Repudiation** — none new; parse failures are logged at `warn` without message content
  today (`client.rs:1967`), unchanged.
- **Information disclosure** — `reqwest::Error` text embeds the URL; `ai_fetch::describe`
  strips it (`ai_fetch.rs:111-118`) and that test stays; the OAuth exchange logs no token
  (unchanged). The TLS certificate store stays the OS keychain (`.use_native_tls()`), so
  corporate/MITM trust decisions the user made in the OS keep applying.
- **Denial of service** — the parser runs on sender-chosen bytes in-process; nesting is
  capped at 3 in both versions (§5); 0.11's panic fixes (§6) *reduce* the surface; the
  hardening fixtures assert no panic on the shapes it fixed.
- **Elevation of privilege** — the only new code that runs with the developer's privileges
  is `hashify`, a proc-macro at compile time (§4) — the same class as every derive macro
  already in the graph; no new runtime capability.

**Supply chain:**
- **Assets:** the process that parses hostile mail; the authenticated IMAP session and the
  credential that opened it (`async-imap` sends LOGIN); the OAuth refresh/exchange and the
  custom AI endpoint (`reqwest`, TLS); the developer machine and CI at build time.
- **Provenance:** crates.io carries no build attestations; the checks are publisher identity
  and maintenance: `mail-parser` and `hashify` — `mdecimus` (Stalwart Labs; the mail server
  vendor), updated 2026-08-22 and 2026-04-01; `async-imap` — the `async-email` organisation
  (Delta Chat), 2026-07-17; `reqwest` — `seanmonstar` (hyper's author), `rust-version` 1.85;
  `socket2` — the `rust-lang` organisation. `hashify` is the one addition: **the same
  publisher as `mail-parser` is correlated trust, not a control** — one compromised
  maintainer reaches both — so the build records its lockfile checksum, license
  (Apache-2.0 OR MIT), the `syn`/`quote`/`indexmap` versions it resolves to, and a one-pass
  read of its proc-macro entry point in the PR body; the pre-1.0 deviation is named there
  (rule, reason, risk, mitigation, owner) per the house exception format.
- **Lockfile:** `cargo build --locked` in CI is the frozen gate; the lockfile moves only in
  the commit that bumps a crate, and REQ-2.4 records what moved.
- **Transitive cost:** +1 crate (`hashify`), −0; crate count 374 → 374 (measured).
  `encoding_rs` stays (it is what `full_encoding` is). No `rkyv`, no new native code
  (aws-lc is already compiled in through the updater plugin), no `async-compression`.
- **Blast radius, per crate:** `mail-parser` — parses untrusted input; the upgrade *reduces*
  the panic surface and the fixture suite holds the output stable; a regression here is
  wrong attachment sections or wrong addresses, not disclosure. `async-imap` — carries the
  credential on LOGIN and the session after; the 0.10.4 → 0.11.3 diff is small (§7) and
  Velo's wire validation (`imap::wire`, audit P1) stays ahead of it; the COPY quoting is the
  one thing that alters bytes on the wire, predicted by the duplex test. `reqwest` — the
  token exchange and `ai_fetch`; the TLS backend is pinned by feature *and* by call, and the
  handshake is today's (`native-tls-no-alpn`); the form body is pinned by test. `socket2` —
  keepalive options only.
- **Removal path:** each crate has a revert; `mail-parser` has no drop-in replacement (the
  fixture suite is what would make one possible); `async-imap` likewise; `reqwest` could
  give way to the plugin's client; `socket2` to raw `libc` calls.
- **Residual:** the `reqwest` duplicate until `tauri-plugin-http` moves to 0.13; `base64`
  ×4; `utf7-imap` unmaintained since 2022 (HOLD in the vault, no advisory); the live harness
  not runnable here at writing.

## Review
Two legs on this plan — Gemini 3.8 Flash High via `agy` and Grok 4.6 via the `grok` CLI,
both done, dispositions on PR #78 and in LOG.md — then two legs on the code PR. Diffs from
committed SHAs. Findings verified against source before adoption.

## Approval
- Plan approved by: **Jim** date: **2026-09-03** (decision 3 of the 2026-09-03 next-session
  prompt: "APPROVED, including hashify 0.2.9 as the one pre-1.0 transitive crate (build-time
  proc-macro) and the REQ-2.5 live-harness decision") — **required before any `Cargo.toml`,
  `Cargo.lock` or source change.** Approving this plan also approves the one transitive addition it
  brings, **`hashify` 0.2.9 (pre-1.0, build-time proc-macro, Stalwart Labs)**, and the
  REQ-2.5 decision on the live harness.
