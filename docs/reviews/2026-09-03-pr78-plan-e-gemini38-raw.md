# Independent Cross-Vendor Review: SPEC-PR-E (Rust Parser Majors)

**Review Target:** `SPEC-PR-E — Rust parser majors: mail-parser 0.11, async-imap 0.11, reqwest 0.13, socket2 0.6`  
**Reviewer:** Independent Cross-Vendor Reviewer (Tier-2 Plan Review)  
**Base:** `main` @ `a27398f`  

---

## Findings

### Finding 1: HIGH
- **Section:** §2, §8, REQ-2.2, Threat Pass
- **Exact Sentence / Claim:**  
  > "The graph already holds `reqwest` 0.13.4 ... `tauri-plugin-updater` 2.11.0 pulls reqwest 0.13.4"  
  > "0.13 defaults to rustls with aws-lc — Velo sets `default-features = false` and names `native-tls` ... so the TLS backend does not move"  
  > "After commit 4: ... `cargo tree -i rustls` SHALL show no path from `velo`'s own `reqwest` (native TLS held)."
- **Why it is wrong or insufficient:**  
  Cargo unifies crate features across the entire dependency graph for a single package version. If `tauri-plugin-updater` 2.11.0 pulls `reqwest 0.13.4` with its default features (which the plan explicitly notes defaults to `rustls` with `aws-lc`), then moving Velo’s own `reqwest` dependency to `0.13.4` will collapse them into a **single** unified `reqwest 0.13.4` crate in `Cargo.lock` that compiles with **both** `native-tls` and `rustls`.  
  This triggers two severe issues:
  1. **REQ-2.2 is mathematically guaranteed to fail:** Because `velo` directly depends on `reqwest 0.13.4`, and `reqwest 0.13.4` will depend on `rustls` due to feature unification from `tauri-plugin-updater`, `cargo tree -i rustls` will inevitably report a path: `rustls <- reqwest v0.13.4 <- velo`.
  2. **Silent runtime TLS engine switch:** In `reqwest`, when multiple TLS backends are compiled in simultaneously, `Client::builder()` defaults to the default TLS backend (`rustls`), unless `.use_native_tls()` is explicitly called on `ClientBuilder`. The plan specifies "no source change" in `oauth.rs` and `ai_fetch.rs` (REQ-1.3). Consequently, Velo’s OAuth exchange and AI endpoints will silently switch to Rustls / aws-lc at runtime, bypassing the OS certificate keychain without any gate detecting it.
- **Concrete Fix to the Plan:**  
  1. Inspect `tauri-plugin-updater`'s exact feature activation on `reqwest` in `Cargo.lock`. If `rustls` is pulled, update `oauth.rs` and `ai_fetch.rs` to explicitly invoke `.use_native_tls()` on `ClientBuilder` to guarantee Native TLS at runtime.  
  2. Rewrite the REQ-2.2 verification gate: do not use a naive `cargo tree -i rustls` check that fails under normal Cargo feature unification. Instead, verify that `reqwest` runtime client instances explicitly select `native-tls`.

---

### Finding 2: HIGH
- **Section:** Rollback
- **Exact Sentence / Claim:**  
  > "`git revert` of any one commit or the squash; `Cargo.lock` reverts with it and `cargo build --locked` is the proof. No state, no schema."
- **Why it is wrong or insufficient:**  
  The claim "No state, no schema" treats Velo as a stateless network proxy rather than a **local-first desktop email client**. Velo persists parsed message structures, attachment mappings (`build_imap_section_map`), and extracted envelope headers into a local SQLite database (`sqlx`).  
  If `mail-parser` 0.11 or `async-imap` 0.11 runs in production and persists parsed MIME structures, section IDs, or normalized addresses into SQLite, rolling back the binary via `git revert` leaves 0.11-generated data in the local database. When the downgraded 0.9.4 engine subsequently reads those records or issues on-demand attachment fetches (e.g. `FETCH <uid> BODY.PEEK[<section>]`), any subtle divergence in section numbering or part indexing between 0.11 and 0.9.4 will cause silent data corruption or failed attachment downloads.
- **Concrete Fix to the Plan:**  
  Audit and document exactly which outputs of `mail-parser` and `async-imap` are stored in SQLite. If section maps or parsed structures are cached, the rollback plan must specify how stored 0.11 records are invalidated or re-synced upon rollback (e.g. clearing cached MIME envelopes or bumping a client-side cache epoch).

---

### Finding 3: HIGH
- **Section:** Tasks (Tasks 5 & 6), REQ-2.4, §9, Failure Modes
- **Exact Sentence / Claim:**  
  > "5. Two review legs on the PR ... merge on green under the standing rule."  
  > "6. LOG.md; ... Manual, Jim: the live harness run if Docker is up; npm run tauri dev smoke on an IMAP account (fetch a thread with attachments, a non-UTF-8 message, sign in with OAuth) — recorded as open until done."
- **Why it is wrong or insufficient:**  
  The author explicitly notes in §9 and Decision & Alternatives (d) that the Dovecot harness is "not runnable on this machine today" and that live tests are `#[ignore]`. In REQ-2.4, live checks are "Recorded as not run if Docker is down, never claimed."  
  Unit tests mock or test command rendering only (`client.rs` has 0 MIME tests, 11 total tests). As planned, the PR will be merged in Task 5 with **zero live verification** of IMAP network exchanges, zero verification of the unsolicited response channel, and zero verification of the OAuth token exchange over ALPN. Punting the only live verification to Jim as a post-merge manual smoke test ("recorded as open until done") violates the fundamental risk controls for a Tier-2 change touching authenticated IMAP sessions and OAuth credentials.
- **Concrete Fix to the Plan:**  
  Reorder Tasks 5 and 6: Live harness execution (via CI with Docker service containers enabled) and manual smoke testing of IMAP + OAuth MUST be a mandatory pre-merge gate. The PR must not be merged until live verification is green.

---

### Finding 4: MEDIUM
- **Section:** REQ-1.1 vs Design (Commit 2)
- **Exact Sentence / Claim:**  
  > REQ-1.1: "...and fix the three `u32` sites by converting at the boundary (`usize::try_from` / `as usize` where the value is an index the parser produced), with no other source change."  
  > vs.  
  > Design (Commit 2): "`client.rs`: the section map keyed by `u32` (the parser's own index type) — `build_imap_section_map` returns `HashMap<u32, String>`..."
- **Why it is wrong or insufficient:**  
  This is a direct internal contradiction in the plan. REQ-1.1 states that `build_imap_section_map` and the surrounding code will retain their existing types with three local boundary conversions (`as usize`), claiming "no other source change." The Design section, however, changes the return type and internal signature of `build_imap_section_map` from `HashMap<usize, String>` to `HashMap<u32, String>`. If the signature is changed to `u32`, all call sites, test assertions, and consumers of `build_imap_section_map` are impacted.
- **Concrete Fix to the Plan:**  
  Align REQ-1.1 and Design: Decide definitively whether `build_imap_section_map` returns `HashMap<usize, String>` (retaining the boundary conversion at `parts.get`) or `HashMap<u32, String>`. If changing the signature to `u32`, enumerate all affected call sites across `client.rs` and update the scope description in REQ-1.1.

---

### Finding 5: MEDIUM
- **Section:** REQ-0.1, §6, Failure Modes
- **Exact Sentence / Claim:**  
  > "REQ-0.1 A fixture suite in `src-tauri/src/imap/` ... SHALL assert, on hand-written RFC 5322 messages: a single-part text body → section `"1"`; `multipart/mixed` ... sections `"1.1"`, `"1.2"`, `"2"`; a nested `message/rfc822`; an ISO-8859-1 and a Windows-1252 body ... `Authentication-Results` and `List-Unsubscribe`/`List-Unsubscribe-Post` extraction; and that a truncated base64 attachment, a missing closing boundary and quoted-printable with a stray `=` do not panic..."
- **Why it is wrong or insufficient:**  
  The plan notes in §6 that `mail-parser` 0.11.6 introduced "fabricated-address fixes" and notes in Failure Modes that "header normalisation or address parsing" is the most likely area to change output. Despite this, REQ-0.1 contains **zero** fixtures covering:
  1. **Address parsing:** `From`, `To`, `Cc`, `Bcc`, `Reply-To` (including RFC 2047 encoded display names `=?UTF-8?B?...?=`, unquoted names, angle-addr formatting, and group syntax like `undisclosed-recipients:;`).
  2. **Threading headers:** `Message-ID`, `In-Reply-To`, and `References` (which Velo uses to build conversation trees).
  3. **Date parsing:** RFC 5322 date/time parsing into timestamps.
  4. **Content-ID (CID):** `Content-ID` extraction for inline attachments in HTML emails.  
  If `mail-parser` 0.11 alters how addresses, message-IDs, or CIDs are parsed or stripped of delimiters, email threading and inline image rendering in Velo will silently regress without triggering any test in the REQ-0.1 suite.
- **Concrete Fix to the Plan:**  
  Expand REQ-0.1 to require explicit test assertions for:
  - Header address parsing across edge cases (encoded words, commas in display names, groups).
  - Threading headers (`Message-ID`, `In-Reply-To`, `References` extraction and angle-bracket stripping).
  - `Content-ID` preservation for inline attachments.
  - `Date` parsing stability.

---

### Finding 6: MEDIUM
- **Section:** REQ-0.2, Design (Commit 2), Done When, Failure Modes
- **Exact Sentence / Claim:**  
  > Done When: "...the fixture suite green on both parser versions with no fixture edited between them..."  
  > vs.  
  > Failure Modes: "...a fixture that changes output under 0.11 (most likely: header normalisation or address parsing): stop, record, disposition — that is the suite doing its job..."
- **Why it is wrong or insufficient:**  
  The plan creates an impossible condition. If `mail-parser` 0.11 fixes parser bugs (e.g. lenient quoted-printable decoding with stray `=` escapes, corrupted nested message boundaries, or address normalization), the parsed output under 0.11 *should* diverge from 0.9.4 on malformed inputs.  
  If the completion criteria strictly mandate that the suite must remain green "with no fixture edited between them," then:
  - Either the suite only tests vanilla inputs where 0.9 and 0.11 happen to match (failing to test the bug fixes), or
  - Any legitimate bug fix in 0.11 will fail the gate because updating the expected fixture output is disallowed.
- **Concrete Fix to the Plan:**  
  Differentiate between **invariant fixtures** (RFC-compliant messages that must yield identical AST/output byte-for-byte on both 0.9 and 0.11) and **bug-fix/hardening fixtures** (malformed inputs where 0.9 panics or fails, and 0.11 produces recovered output). In Commit 1, assert the known 0.9 behavior (using `catch_unwind` or asserting the degraded output). In Commit 2, allow updating the assertions for the bug-fix fixtures with documented dispositions in the PR body.

---

### Finding 7: MEDIUM
- **Section:** §7, REQ-2.4
- **Exact Sentence / Claim:**  
  > "...0.11.2 quotes mailbox names with whitespace — Velo passes folder names to select unquoted at 14 sites ... and quotes only in its raw-TCP fallback ... so there is no double quoting, and a folder such as Sent Messages may start working where it did not — a live check on the harness is in the tests..."
- **Why it is wrong or insufficient:**  
  This claim makes unverified assumptions about IMAP wire behavior:
  1. If a folder name returned from IMAP `LIST` is already quoted (e.g. `"Sent Messages"`), and Velo passes it to `select()`, checking for whitespace will cause `async-imap` 0.11.2 to quote it again, producing `"\"Sent Messages\""`, which causes protocol errors.
  2. What happens if folder names contain special characters *other* than whitespace (e.g. `[`, `]`, `(`, `)`, quotes, backslashes, or modified UTF-7 like `&AOQ-`)?
  3. Stating that `Sent Messages` "may start working where it did not" is an admission that folder selection on spaced folders was never properly verified in Velo. Relying on an ignored test that won't run locally provides zero assurance against wire regressions.
- **Concrete Fix to the Plan:**  
  Add automated unit tests in `src/imap/wire.rs` or `client.rs` verifying string escaping and mailbox name handling across:
  - Folders with spaces.
  - Already-quoted folders.
  - Folders with backslashes and double quotes.
  - Modified UTF-7 encoded folders.  
  Ensure `async-imap` does not double-quote pre-sanitized folder names.

---

### Finding 8: LOW
- **Section:** Task, REQ-1.3, Tasks (Task 4)
- **Exact Sentence / Claim:**  
  > Task: "...in three commits that each stand alone..."  
  > REQ-1.3: "Commit 4 SHALL bump `reqwest` to 0.13 ... and `socket2` to 0.6, and no source change."
- **Why it is wrong or insufficient:**  
  1. **Commit count mismatch:** The Task section claims "three commits", but the plan outlines four commits (Commit 1: fixture suite; Commit 2: `mail-parser`; Commit 3: `async-imap`; Commit 4: `reqwest` + `socket2`).
  2. **Violation of Scope Discipline & REQ-1:** REQ-1 explicitly states: "As the maintainer I want each crate to land as its own revertible commit." Combining `reqwest` 0.13 (OAuth / AI HTTP client) and `socket2` 0.6 (IMAP TCP keepalive) bundles two completely unrelated failure domains into a single commit. If `reqwest` regresses on OAuth or TLS ALPN, reverting Commit 4 also reverts the `socket2` deduplication.
- **Concrete Fix to the Plan:**  
  Split Commit 4 into two distinct commits:
  - Commit 4: Bump `socket2` to 0.6 (deduplication only).
  - Commit 5: Bump `reqwest` to 0.13 with `features = ["native-tls", "json", "form"]`.  
  Update the header and Task section to consistently specify five commits.

---

### Finding 9: LOW
- **Section:** Threat pass
- **Exact Sentence / Claim:**  
  > "## Threat pass (Tier 2 — supply chain and the parsing boundary)"
- **Why it is wrong or insufficient:**  
  The global methodology standard explicitly states: *"The spec must include a STRIDE pass (Spoofing, Tampering, Repudiation, Information disclosure, DoS, Elevation of privilege). No approval → no code."*  
  The plan's "Threat pass" covers assets, provenance, lockfile, transitive cost, blast radius, and removal path, but completely omits the mandatory STRIDE categorization (e.g. Spoofing of email headers/display names, Tampering of attachment bytes, Information Disclosure in OAuth/TLS errors, Denial of Service via parser recursion limits).
- **Concrete Fix to the Plan:**  
  Replace or augment the freeform Threat Pass with a structured STRIDE analysis addressing:
  - **Spoofing:** Sender address and display name extraction changes in `mail-parser`.
  - **Tampering:** Body part boundary and attachment data integrity.
  - **Repudiation:** Audit logging of parser/connection failures.
  - **Information Disclosure:** Redaction of OAuth refresh tokens and IMAP credentials in TLS/connection error messages.
  - **Denial of Service:** Memory allocation limits and recursion depth on deeply nested MIME messages (`message/rfc822`).
  - **Elevation of Privilege:** Blast radius of build-time proc-macros (`hashify`).

---

### Finding 10: NIT
- **Section:** §4, Threat pass
- **Exact Sentence / Claim:**  
  > "...added `hashify 0.2.9` — the one new crate (perfect hashing for header names; Stalwart Labs, the same owner as `mail-parser`; a proc-macro depending on `indexmap`, `proc-macro2`, `quote`, `syn`; 2.27 M downloads)."
- **Why it is wrong or insufficient:**  
  Under the project's development rules, all dependency additions require explicit justification, and pre-1.0 dependencies on critical paths face strict scrutiny. Although `hashify` is a transitive dependency introduced by `mail-parser`, it is a pre-1.0 proc-macro executed at build time. It is mentioned in the body of §4, but is not formally highlighted in the PR approval requirements.
- **Concrete Fix to the Plan:**  
  Add an explicit note in the Approval and Outcome sections calling out `hashify 0.2.9` as a pre-1.0 build-time dependency addition introduced transitively by `mail-parser` 0.11, confirming its blast radius is restricted to compile-time code generation.

---

## Verdict

**CHANGES REQUESTED**

### Summary of Required Changes Before Approval:
1. **Resolve the Cargo feature unification / TLS backend conflict:** Address how `tauri-plugin-updater`'s `reqwest 0.13` features interact with Velo's `native-tls` requirement, and fix the REQ-2.2 gate.
2. **Account for local-first SQLite persistence in Rollback:** Specify how cached MIME envelopes and section mappings in SQLite are safely handled if rolling back to 0.9.4.
3. **Fix the verification sequence:** Live IMAP harness and manual OAuth/TLS smoke tests must pass *before* merging the PR, not after.
4. **Resolve the internal contradiction on `build_imap_section_map`:** Reconcile REQ-1.1 and Design Commit 2.
5. **Expand the REQ-0.1 fixture net:** Add coverage for email addresses, threading headers (`Message-ID`, `References`), and inline attachment CIDs.
6. **Structure the Threat Pass under STRIDE:** Comply with the mandatory engineering standard.
7. **Separate `reqwest` and `socket2`:** Give each crate its own independent, revertible commit.
