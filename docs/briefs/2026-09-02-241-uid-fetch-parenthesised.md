# SPEC-241 — Multi-item `UID FETCH` attribute lists must be parenthesised

- **Task:** Send `UID FETCH <set> (UID FLAGS INTERNALDATE BODY.PEEK[])` — the RFC 3501 form —
  instead of the unparenthesised list Velo sends today at three sites, so strict servers
  (Stalwart) return the body instead of nothing.
- **Tier:** **2** — Rust IMAP client (`CLAUDE.md`: *Rust IMAP/SMTP/OAuth* is Tier 2). Plan in the
  PR before code; threat pass and rollback below; both cross-vendor legs (ADR-004).
- **Base:** `main` @ `11a034b` (code pin `b95468e`). Every citation below was grepped at that pin.
- **Status:** building — branch `f241-uid-fetch`; Jim's instruction 2026-09-02. The build seat
  owns the PR and the merge.
- **Source:** upstream avihaymenahem/velo#241 (Stalwart with shared folders, Windows, 0.4.21:
  every fetched message logs `UID n has no body`; Thunderbird/Betterbird work against the same
  server); the fork's 2026-09-01 triage ranked it **P1** and located the sites. Bug-fix queue
  item 3.
- **Effort:** S · half a day (the change is three string literals; the value is the guard).

## Outcome

Velo syncs message bodies from Stalwart — and any other server that parses `FETCH` strictly —
exactly as it does from Dovecot and Gmail's IMAP. No behaviour change on servers that already
tolerated the loose form.

## The defect, verified in the fork

1. **The grammar.** RFC 3501 §6.4.5 / §9:
   `fetch = "FETCH" SP sequence-set SP ("ALL" / "FULL" / "FAST" / fetch-att / "(" fetch-att *(SP fetch-att) ")")`.
   One attribute may stand alone; **two or more must be parenthesised.** Dovecot and Gmail accept
   the bare list as an extension of the grammar; Stalwart parses to the grammar, reads the first
   attribute, and answers with a FETCH response that carries no `BODY[]` — which Velo logs as
   `has no body` (`client.rs` warn, visible in the issue's log).
2. **Three sites send a bare multi-item list** (`src-tauri/src/imap/client.rs`):
   `:274` `"UID FLAGS INTERNALDATE BODY.PEEK[]"` (initial-sync batch fetch), `:367`
   `"UID FLAGS BODY.PEEK[]"` (single-message fetch), `:1101` `"UID FLAGS INTERNALDATE BODY.PEEK[]"`
   (delta-sync chunk fetch). `async-imap`'s `uid_fetch(set, query)` sends `UID FETCH {set} {query}`
   verbatim — it does not add parentheses.
3. **Two sites send one attribute** (`:809`, `:880` `"BODY.PEEK[]"`) — valid as is.
4. **The raw diagnostic already does it right:** `imap_raw_fetch_diagnostic` builds
   `"a3 UID FETCH {} (UID FLAGS INTERNALDATE BODY.PEEK[])"` (`:1246`). The fix makes the three
   production sites match it.

## Requirements

- **REQ-1** As an IMAP user on a strict server I want bodies to arrive.
  - REQ-1.1 THE SYSTEM SHALL send every multi-attribute `FETCH`/`UID FETCH` attribute list
    enclosed in parentheses.
  - REQ-1.2 THE SYSTEM SHALL keep sending exactly the same attributes at each site (no attribute
    added or dropped), so parsing of the responses is unchanged.
  - REQ-1.3 A test SHALL fail if any `uid_fetch` call site in the client ever again passes a
    space-separated attribute list without parentheses — the guard, not the fix, is what keeps
    this from regressing when the next fetch site is written.

## Not doing

- Shared-folder discovery/namespace handling (the issue's title). The log shows the folders
  are listed and selected; only the bodies are missing. Anything else Stalwart-specific is a
  new brief after this lands and the reporter re-tests.
- Changing the attribute set (e.g. adding `RFC822.SIZE`) — separate concern.

## Design

- Three literals gain parentheses. To make the intent legible and the guard cheap, the two
  attribute lists become named constants at the top of `client.rs`
  (`FETCH_FULL = "(UID FLAGS INTERNALDATE BODY.PEEK[])"`, `FETCH_UID_FLAGS_BODY =
  "(UID FLAGS BODY.PEEK[])"`) and the sites use them; the diagnostic's format string uses the
  same constant.
- **Guard test** (REQ-1.3): a unit test in the client's test module reads the client source with
  `include_str!`, finds every `.uid_fetch(` call, extracts the quoted attribute argument (or the
  constant it names), and asserts each is either a single attribute or parenthesised; it also
  asserts it found at least the five sites, so the scan can never pass by finding nothing.
- **Decision & alternatives.** (a) Literal edits only — fixes today, regresses silently
  tomorrow. (b) Constants + source-scanning guard — recommended; no new abstraction, the guard
  is thirty lines of test. (c) A typed `FetchAttrs` builder — more code than the problem.
- **Failure modes** — none new: the parenthesised form is the RFC form and every server the
  fork has run against (Dovecot in the harness, Gmail, Outlook, iCloud in the auto-discovery
  list) accepts it; the diagnostic path has used it since it was written.

## Tasks (risk-first)
- [x] 1. The guard test, red against the current tree (three sites fail). — REQ-1.3. After
  review it lives in `imap/fetch_guard.rs` as a bracket-aware scanner with nine fixtures;
  exact counts: 5 method sites, 2 raw commands.
- [x] 2. Constants (`FETCH_UID_FLAGS_INTERNALDATE_BODY`, `FETCH_UID_FLAGS_BODY`, `FETCH_BODY`) and
  the three sites; the diagnostic uses the constant. — REQ-1.1, 1.2
- [ ] 3. Live Dovecot check (optional, harness): the F-5 ignored live test already drives
  `move_messages`; a fetch through `fetch_messages` on the harness after this change confirms
  Dovecot still returns bodies with the parenthesised form. Recorded if run.
- [ ] 4. LOG.md; vault row; `CLAUDE.md` gotcha; HANDOFF pin after merge.

## Done when
`cargo test --locked` green including the guard; clippy clean; CI green on the merge commit.
Reporter-side: re-test on Stalwart (the fork cannot run one); recorded as open until then.

## Rollback
`git revert` of the squash commit. No data or schema.

## Threat pass (Tier 2)
- **Asset:** the IMAP command stream.
- **Entry points:** none new — the attribute list is a compile-time constant; the UID set is
  validated by `wire::validate_uid_set` as before.
- **What an attacker gains:** nothing; no user-controlled bytes are involved.
- **Mitigations in this change:** constants instead of scattered literals; the guard.
- **Residual:** none identified.

## Review
Both cross-vendor legs on the PR (Gemini 3.7 via `agy`, Grok 4.6 via `grok` CLI), diffs from
committed SHAs. Dispositions on the PR and in LOG.md.

## Approval
Jim, 2026-09-02, by instruction; the plan is this file, committed before the code on the same
branch.
