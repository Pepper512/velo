The prompt was truncated, so I’ll load the offloaded full request first and review from that material only.The offloaded prompt continues past the first chunk; I’ll read the rest of the plan and the full diff before writing the review.**APPROVE**

## Findings

- **L1.** `src-tauri/src/imap/wire_bytes.rs` — `session.list(Some(""), Some("*"))` / asserted `"A0006 LIST \"\" *"`. REQ-2.3 and §7 asked for LIST bytes on the same mailbox shapes as SELECT/COPY/MOVE/CREATE, and §7 claimed 0.11 would send `LIST "" "*"` (quoted pattern). The scripted server is faithful (greeting, tagged OK only; it never invents client lines), so the bare `*` is the library, not an artefact, and it does not touch `wire.rs` (raw SELECT / `validate_mailbox` only). It also means 0.11’s new LIST-pattern quoting is unpinned for any pattern that actually needs quotes. Add `list(Some(""), Some("Sent Mail"))` and `list(Some(""), Some("a\"b\\c"))` and assert one layer of quoting.

- **L2.** Plan §5 / REQ-0.1 still say ISO-8859-1 and Windows-1252 *are* the `full_encoding` guard; the fixture is the correction and the brief was not amended (the PR brief hunk only fills Approval):

```
+        // The real full_encoding guard: mail-parser's single-byte tables are
+        // built in (the two cases above pass without the feature — the plan's
+        // premise was wrong there, a REQ-3 correction)
```

Patch §5 and REQ-0.1 to name Shift_JIS (multi-byte) as the fail-closed proof.

## Requirements

- **REQ-0.1** met, with the named dispositions. Every §9 field has a fixture. `List-Unsubscribe` is pinned `None` (hardening) because both versions parse it as an address list. Obsolete-zone `Date` moved to hardening (0.11 parses EST). Shift_JIS added as the real `full_encoding` guard. Invariant values that look like product quirks are 0.9 behaviour, correctly locked, not regressions: synthesised HTML (`<html><body>…<br/>…`), multipart bodies stripped of the CRLF before the boundary, snippet internal runs not squeezed (`"Hello Bob,    this is the body."`), HTML-only `body_text`/`snippet` = `Some("")`.
- **REQ-0.2** met. The five named shapes are present. Final assertions that moved (obsolete zone → `SEPT_1_1045_UTC`; stray QP → `"a=b 100=% done"`) match 0.11. Received whitespace-fold still degrades on 0.11.8 the same way as 0.9.4 (panic fix ≠ parse fix); truncated base64 size 6, unterminated part size 14, corrupted rfc822 size 25 are consistent with decoded prefix / raw leftover.
- **REQ-0.3** met (stated: 0.9.4 green first; invariants unchanged). Per-commit fixture diff not in this material.
- **REQ-1.1** met, with the named HeaderName deviation. `u32 → usize` cannot fail on 32- or 64-bit (`usize::try_from(u32)` is infallible there; only a 16-bit pointer width fails). `.ok()?` in the attachment `filter_map` is the plan’s skip; walk cannot `?` off `()`, so `if let Ok` is the same unreachable skip, not a worse production failure mode.
- **REQ-1.2** met.
- **REQ-1.3** met (measurement: `socket2` once).
- **REQ-1.4** met (`native-tls-no-alpn` + `json` + `form`; `.use_native_tls()` on the shared AI client and on both token paths via `native_client()`). Per-request OAuth clients match pre-existing `Client::new()`, not a new defect. `.use_native_tls()` with both backends compiled selects native-tls; measurement: `native-tls-no-alpn` from `velo`, `__native-tls-alpn` absent. `without_url()` on `build()` is correct redaction (and a no-op for a URL-less build error).
- **REQ-1.5** met (`hashify` 0.2.9 only new direct transitive; `windows-registry` / extra `getrandom` drops are the reqwest 0.13 graph).
- **REQ-1.6** not verifiable here (landing method).
- **REQ-2.1** met for commits 1–3; not verifiable for 4–5 (CI in progress). MSRV 1.89: mail-parser/async-imap commits are in the green set; reqwest/socket2 declare ≤ 1.85.
- **REQ-2.2** met. Mock capture is robust for this request (loop until header + `Content-Length`; ASCII so lossy-string index = byte index). Asserted body is WHATWG form-urlencoded (`+` for space, `%26`/`%3D`/`%3A`/`%2F`), which is what RFC 6749 token endpoints take. Listener does not leak: one `accept`, task ends, `JoinHandle` drop aborts `accept` if the client fails first. Hang risk only if the client never connects and the test runtime has no timeout — unused on the passing path.
- **REQ-2.3** met for LOGIN/SELECT/UID COPY/UID MOVE/CREATE quoting (space, `"\` , `[Gmail]/…`, `&AOQ-`, LOGIN credentials quoted once). LIST only pins `LIST "" *` (L1). CR/LF case proves what it claims for CREATE: `BufReader::lines()` would have split an injected `A9999 DELETE` into a second recorded line; `seen.len()==2` and no `DELETE` means the library refused before write. It does not separately probe UID COPY.
- **REQ-2.4** not verifiable (PR body not in this material; lockfile summary here matches the required record).
- **REQ-2.5** met as approved: Docker down, stated. Live test itself is correct: APPEND to INBOX, max UID, SELECT INBOX, then `uid_copy(uid.to_string(), &folder)` into `PR E Space {pid}` (space in the name); marker checked on the copy. `to_string()` is the IMAP sequence-set.
- **REQ-3** met in Cargo comments and fixtures; plan §5 still carries the old `full_encoding` premise (L2).

Revert sets: commit 2 carries the HeaderName switch and the moved hardening asserts with the crate bump, so `git revert` of that commit restores 0.9.4 lookups and 0.9.4 hardening together. Commits 3–5 are crate+tests / manifest-only / reqwest+builders. Commit 1 stays useful after any single crate revert.

## Threat pass

Honoured in the diff: address/section fixtures; no `rkyv`/`serde`; `.use_native_tls()` + `native-tls-no-alpn`; `without_url()` on the new OAuth builder; hardening expects no panic. `hashify` is the approved pre-1.0 compile-time add. Not evidenced here (PR body): lockfile checksum, `syn`/`quote`/`indexmap` versions, one-pass read of the proc-macro entry point. Residual already named: live harness not run, so Velo-session ∘ 0.11 `UID COPY` quoting is unconfirmed on Dovecot.
