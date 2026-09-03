Independent review of SPEC-PR-E (plan only). Evidence in the document is treated as the author’s measurements; the findings below are about reasoning, completeness, and claims that fail if the source was misread.

---

HIGH — §2 / Design Commit 4 / REQ-2.2
Claim: “The graph already holds `reqwest` 0.13.4 and `socket2` 0.6.5” and after the bump “the TLS backend does not move”; REQ-2.2: “`cargo tree -i rustls` SHALL show no path from `velo`’s own `reqwest` (native TLS held).”
Why: Today Velo’s `reqwest` 0.12 and the updater’s `reqwest` 0.13 are **different crate versions**, so their features do not unify. Commit 4 puts Velo on the **same** 0.13.4 as `tauri-plugin-updater`. Cargo then builds **one** `reqwest` 0.13 with the **union** of features. Velo’s `default-features = false` does **not** turn off defaults another crate enabled. If the updater enables 0.13 defaults (rustls + aws-lc) or `http2` / compression / cookies, those features compile into Velo’s client too. The plan also says Velo “calls none of” the explicit TLS builder methods, so the backend is chosen by features — the exact thing unification breaks. `cargo tree -i rustls` is the wrong proof: rustls will still appear via the updater, and it cannot tell you which backend `Client::builder()` uses.
Fix: Before approval, record `cargo tree -p reqwest --edges features` for **both** 0.12 and 0.13 **and** the updater’s `reqwest` dependency line (features + whether defaults are on). State the unified feature set after Commit 4. If unification would enable rustls/http2/gzip, either (a) keep Velo on 0.12 until that is a separate brief, or (b) call an explicit native-tls builder method on every `Client` and add a test that fails if the selected connector is rustls. Replace REQ-2.2 with a command that inspects **Velo’s** `reqwest` feature set and connector, not a global `-i rustls`.

HIGH — §8 / Failure modes / REQ-2.4 / Done when
Claim: “ALPN is the one wire-visible change (verify against Google and Microsoft token endpoints in the smoke run)”; “the smoke run is Jim’s”; Done when allows live/smoke “recorded as not run.”
Why: Moving OAuth token refresh onto a different TLS handshake is a behaviour change on the credential path. The plan names `native-tls-no-alpn` as the opt-out that would preserve today’s handshake, then does not take it, and makes the only check a manual smoke that is allowed to remain open through merge. That is not a gate for Tier-2 OAuth.
Fix: Make the ALPN choice explicit in REQ-1.3: either `native-tls-no-alpn` (preserve today’s handshake) or `native-tls` (accept ALPN) with a **blocking** recorded handshake against the actual Google and Microsoft token URLs before merge — not an open Jim smoke. If Docker/endpoints are unavailable, the reqwest commit does not land.

HIGH — REQ-0.1 / REQ-0.2 / §6
Claim: The suite “SHALL be green on 0.9.4 first”; it SHALL assert that truncated base64, a missing closing boundary, and quoted-printable with a stray `=` “**do not panic**”; and 0.11.3/0.11.5 “fix panics on corrupted attachments and nested messages.”
Why: Those cannot all be true. If 0.9.4 panics on the cases 0.11 was shipped to fix, Commit 1 cannot be green under REQ-0.1. If 0.9.4 already does not panic on those three, they are not the security net the bump is sold as, and the panics cited in §6 (nested messages, Received, fabricated addresses) are untested. “Byte for byte” on Commit 2 then forbids the output change the security fixes exist to produce.
Fix: Split the corpus into (1) **freeze** fixtures: well-formed trees, section numbers, charsets, header extraction — identical on 0.9.4 and 0.11; (2) **disposition** fixtures: the actual 0.11 panic/corruption cases, including 0.11.6 Received and fabricated-address. On 0.9.4 record the real behaviour (`catch_unwind` / partial parse). On 0.11 allow panic→partial and forbid silent part-tree rewrites on freeze fixtures. Do not require identity on the security cases.

HIGH — §7 / REQ-1.2 / REQ-2.4 / Design Commit 3
Claim: “0.11.2 quotes mailbox names with whitespace … there is no double quoting, and a folder such as `Sent Messages` may start working”; proof is “one new ignored test”; REQ-1.2 “no source change.”
Why: This is a protocol behaviour change on `select` at 14 sites, i.e. bytes on the authenticated session. The plan refuses `login_with_capabilities` as “a protocol behaviour change with its own brief” and then takes this quoting change as a free side effect. An ignored live test that “is recorded as not run if Docker is down” will not catch it in CI. Whitespace is not the IMAP astring set: `"`, `\`, `{`, `%`, `*`, `[Gmail]/Sent Mail`, UTF-8/modified UTF-7. The plan never checks whether 0.11.2 wraps in quotes without escaping, which is command injection on a folder name containing `"`. “Velo passes unquoted” is only safe if LIST-derived names are stored decoded; that storage convention is not stated.
Fix: Treat quoting as an explicit behaviour decision in this brief (or split it). Add a **CI** unit test on a mock stream that `select("Sent Messages")`, `select("Foo\"Bar")`, and `select("[Gmail]/Sent Mail")` emit one correctly escaped IMAP astring and never double-quote. Review the 0.11.2 quote function in the crate diff, not the changelog. Do not merge Commit 3 with that test ignored-only.

HIGH — REQ-1.4 / Transitive delta / Threat pass
Claim: “No other crate SHALL be added, removed or bumped”; “the one new crate (`hashify` 0.2.9 … a proc-macro)”; “Nothing here is new to the graph except `hashify`, whose owner already ships `mail-parser`.”
Why: REQ-1.4 is already false on the lockfile this plan intends to write. `hashify` 0.2.9 is a **new** compile-time code-execution dependency (proc-macro), pre-1.0, generic name, no attestations. Same publisher as `mail-parser` is correlated trust: one compromised maintainer fires both. Download count is not provenance. Standing rule is ask-before-any-dependency and no pre-1.0 on critical paths; a proc-macro in the crate that parses hostile mail is on the critical path. That deviation is not named.
Fix: Amend REQ-1.4 to an explicit exception: add `hashify` 0.2.9 (build/proc-macro) as a new transitive, with Jim’s approval of that addition. Record crate URL, license, lockfile checksum, `syn`/`quote`/`indexmap` versions, and a one-pass read of the proc-macro entry points. Name the pre-1.0 exception in the PR note (rule, reason, risk, mitigation, owner). If that approval is not wanted, do not bump `mail-parser` past the last 0.9/0.10 that does not pull it.

HIGH — REQ-1.1 / Design Commit 2
Claim: “`mail-parser = { version = "0.11", features = ["full_encoding"] }`” and “`default-features` left at the new default (no `rkyv`, no `serde`)”; “the default feature set is now empty.”
Why: The whole brief hangs on defaults having become empty. That reading is not quoted from `mail-parser`’s `[features]`. If it is wrong, this Cargo.toml line **keeps defaults and adds** `full_encoding`, which can enable `rkyv` (EX-006 / a second `rkyv` line) or other features. The author already called empty defaults “the one behaviour change a bare bump would introduce” and then does not fail closed.
Fix: Write `mail-parser = { version = "=0.11.8", default-features = false, features = ["full_encoding"] }` (pin the measured version). Quote `default = []` from 0.11.8’s Cargo.toml in the plan. Re-run the charset fixtures with the feature omitted once, to prove they fail closed.

---

MEDIUM — §4 (measured scratch)
Claim: “exactly three compile errors”, “compiles unchanged” for the other three crates, crate count 374, audit clean.
Why: One combined scratch `cargo check` (not `--all-targets`, not per-commit, existing cache, almost certainly one OS) is not four revertible commits. Test/bin/example code using part indices can fail at `cargo test` even if lib `check` saw three errors. Windows `socket2` 0.6 keepalive (`with_retries` is Unix-only) is unmeasured if the scratch box is macOS. Combined audit/tree hides a Commit-2-only `hashify` delta and a Commit-4-only feature-unification delta. “Crate list stays at 374” can be true while **features** on existing crates change.
Fix: Require a scratch check **per commit** with `cargo check --locked --all-targets` and `cargo test --locked --all-targets` on the host, plus CI’s Windows/Linux jobs as the first merge bar. Publish per-commit `cargo tree --prefix none` and `cargo audit`, not one combined blob.

MEDIUM — §1 / Failure modes
Claim: “`mail-parser` and `async-imap` declare no MSRV”; “an MSRV surprise: CI’s `rust MSRV` job on 1.89 is the check (all declared MSRVs are ≤ 1.85).”
Why: Absence of MSRV is not MSRV ≤ 1.85. Those two crates can use a newer rustc than they admit. CI on 1.89 is a useful backstop, not evidence they declared 1.85.
Fix: Drop “all declared MSRVs are ≤ 1.85” for those two. Say: no declared MSRV; 1.89 CI is the only floor; a 1.89 failure on Commit 2 or 3 stops the bump.

MEDIUM — Design Commit 2 / REQ-1.1
Claim: “One boundary conversion fixes all three”; “no other source change”; then “`build_imap_section_map` returns `HashMap<u32, String>`, `walk` takes `u32`.”
Why: Changing the map’s public(crate) key type is an API change, not a local `try_from` at three call sites. Any other reader of that map (IPC, cache, tests added in Commit 1) is in the diff. Commit 1 written against `usize` keys will have to be typed in a way that still compiles on 0.9.4 **and** 0.11, or Commit 1 is not standalone.
Fix: Specify the Commit 1 map type so both parser versions compile (e.g. keep `HashMap<usize, String>` and convert only at the parser boundary with `usize::try_from` / `u32::try_from`). Do not retarget the map to `u32` unless Commit 1 already uses an index newtype. List every caller of `build_imap_section_map` / `walk`.

MEDIUM — Rollback / Data / schema
Claim: “No state, no schema.” “Nothing user-visible changes.”
Why: Velo is a local-first mail client. If parsed sections, decoded bodies, or header fields are stored in SQLite (or any on-disk cache), a 0.11 parse then a revert leaves mixed cache; that is state. Folder-with-space “may start working” is user-visible. 0.11.2 nested-MIME and 0.11.6 address fixes are user-visible by design. The rollback section treats all of that as none.
Fix: State whether parse output is persisted. If yes, rollback includes cache invalidation (version stamp or drop parsed rows) and is not `git revert` alone. Strike “nothing user-visible.” List the intended visible deltas: space-named folders, previously panicking messages now shown, From/address display if 0.11.6 fires.

MEDIUM — REQ-1 / REQ-1.2 / REQ-1.3
Claim: “each crate to land as its own revertible commit”; Commit 4 bumps `reqwest` **and** `socket2`; Commit 3 “Cargo.toml only” but also adds the live test.
Why: Two crates in one commit means a `socket2` problem reverts OAuth. The live test is a source change. Squash merge, allowed in Rollback, destroys per-commit revert anyway.
Fix: Split `socket2` into its own commit (or drop it; it is a one-line dedupe). Put the live/unit quoting test in Commit 3 and strike “no source change.” Require merge-commit or rebase-merge, not squash, if per-crate revert is a REQ.

MEDIUM — Threat pass, blast radius (`mail-parser`)
Claim: “a regression here is wrong attachment sections or wrong charsets, not disclosure.”
Why: Velo extracts `Authentication-Results` and `List-Unsubscribe` / `List-Unsubscribe-Post`, and 0.11.6 is explicitly an address-fabrication fix. Wrong From/unsubscribe/auth results are spoofing and URL-target bugs, not “not disclosure.” Panics becoming unbounded CPU/RAM on the same hostile bytes is also unaddressed.
Fix: Add address-display and unsubscribe-header fixtures (encoded-words, group syntax, fabricated `From`). Treat those mismatches as security findings. Note parse runs on attacker-controlled size with no cap; require a timeout/size bound or explicitly residual it.

MEDIUM — REQ-0.1 vs §6
Claim: Fixtures cover one nested `message/rfc822`, two charsets, three corruption shapes; §6 cites 0.11.2 invalid nested parts, 0.11.6 `Received` panic and fabricated addresses.
Why: The suite as specified cannot catch the bugs used to justify the bump. Charset guard is only ISO-8859-1 and Windows-1252; `full_encoding` covers more. No CID/inline, no RFC 2047 Subject/From, no calendar part.
Fix: Add the cited 0.11.2/0.11.6 cases as disposition fixtures. Keep the two charsets as the `full_encoding` tripwire; say other charsets are residual.

MEDIUM — REQ-2 / `oauth.rs` / Batch A
Claim: Existing `oauth.rs` (10) and `ai_fetch.rs` (16) tests plus compile-unchanged are the reqwest net; Batch A wire tests “protect command rendering, not parsing.”
Why: Batch A does not protect **pooled** `select` rendering through `async-imap`. Compile-with-`form` does not pin `application/x-www-form-urlencoded` bytes (`+` vs `%20` is enough to break an IdP). Those tests are not described as capturing bodies.
Fix: Add one oauth test that asserts the exact form body and `Content-Type` of the token request (mock server). Add the SELECT wire test above. Do not call existing counts a net they do not cover.

MEDIUM — REQ-1.1–1.3 / Design (version path)
Claim: Bump to **0.11** / **0.11** / **0.13** / **0.6**; measurements are 0.11.8 / 0.11.3 / 0.13.4 / 0.6.5.
Why: Caret `0.11` on a floating lockfile during the PR can pick 0.11.9, which was not what was `cargo check`’d. The exact version path this process asks for is the measured versions.
Fix: Pin `=0.11.8`, `=0.11.3`, `=0.13.4`, `=0.6.5` in `Cargo.toml` (or equivalent `<=` that cannot float past the measured crate). Lockfile remains the CI pin.

MEDIUM — §7
Claim: “the 0.10.4 → 0.11.3 diff is four small entries.”
Why: That is a changelog count, not a crate diff. LOGIN, FETCH, unsolicited handling, and error types can change without a bullet. “Compiles unchanged” does not mean LOGIN still sends the same bytes.
Fix: Attach the `async-imap` 0.10.4…0.11.3 diffstat (or `cargo tree -i async-imap` + reviewed source diff) to the plan. Explicitly tick Velo’s 17 session methods against that diff, including LOGIN/AUTHENTICATE and FETCH, not only `read_response` / IDLE / `get_mut`.

---

LOW — Outcome
Claim: “Nothing user-visible changes.”
Contradicted by space-named folders, panic→render, possible address/section changes, possible OAuth TLS failure. Strike it.

LOW — Task / opening line
Claim: “in three commits that each stand alone” vs four commits (suite + three bumps) vs four crates.
Fix: Say four commits; four crates; `socket2` rides with `reqwest` only if that combo is re-approved.

LOW — REQ-2.4 / §7
Claim: the ignored COPYUID live test “is the proof” the unsolicited channel is unchanged.
An ignored test is not proof. Residual: channel unchanged as far as compile + code inspection; live remains optional.

LOW — Threat pass provenance
Download counts and “same owner” are not controls. Fine as colour; do not use them as the hashify accept criterion.

LOW — §4 `cargo audit` on the combined scratch lockfile
Re-audit each commit; gtk-rs Linux warnings may not appear on a macOS scratch check.

NIT — Opening vs Design: “three commits” / REQ-1 numbered from 2.
NIT — `hashify` “2.27 M downloads” as a trust input.
NIT — Task 5 (reviewer legs) is process, not this dependency decision; leave it out of the REQ set.

---

Verdict: CHANGES REQUESTED

Do not approve until the plan (1) treats reqwest 0.13 feature unification with the updater as the actual TLS risk and replaces REQ-2.2, (2) fail-closes `mail-parser` features and pins 0.11.8, (3) splits freeze vs security fixtures so Commit 1 can exist, (4) puts IMAP quoting under a CI wire test or its own brief, (5) names `hashify` 0.2.9 as a new pre-1.0 proc-macro and asks for it, and (6) does not allow the OAuth/ALPN path to merge on an unrun smoke.
