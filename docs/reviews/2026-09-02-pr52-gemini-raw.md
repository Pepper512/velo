## Verdict
**APPROVE WITH NITS**

---

## Findings

### 1. `Resent-Bcc` header is not stripped (RFC 5322 §3.6.3)
- **Severity:** LOW
- **File and Function:** `src-tauri/src/smtp/client.rs` — `is_bcc_field`
- **Concern:** RFC 5322 §3.6.3 explicitly mandates that when an email is transmitted over the network, all `Bcc:` and `Resent-Bcc:` fields must be removed. `is_bcc_field` only checks for field name `bcc`.
- **Exact Input:**
  ```text
  From: alice@example.com\r\nTo: bob@example.com\r\nResent-From: alice@example.com\r\nResent-To: charlie@example.com\r\nResent-Bcc: secret@example.com\r\n\r\nBody
  ```
- **Consequence:** If a re-sent message carrying a `Resent-Bcc` header is processed, the `Resent-Bcc` header remains in the wire payload and discloses blind recipients.
- **Fix:** Update `is_bcc_field` to match both `bcc` and `resent-bcc`:
  ```rust
  name.eq_ignore_ascii_case(b"bcc") || name.eq_ignore_ascii_case(b"resent-bcc")
  ```

---

### 2. Mixed line ending `\n\r\n` boundary causes whole message to be treated as headers
- **Severity:** NIT
- **File and Function:** `src-tauri/src/smtp/client.rs` — `header_block_end`
- **Concern:** If an incoming message uses LF for headers but a CRLF blank line separator (`\n\r\n`), `header_block_end` misses the boundary because it only checks for `\r\n\r\n` and `\n\n`.
- **Exact Input:**
  ```text
  From: alice@example.com\nTo: bob@example.com\n\r\nBody line 1\nBcc: not-a-header@example.com\n
  ```
- **Consequence:** `header_block_end` returns `raw.len()`, causing `strip_bcc_header` to scan the body as headers and strip any body line starting with `Bcc:`.
- **Fix:** Add a check for `rest.starts_with(b"\n\r\n")` in `header_block_end` returning `i + 1`.

---

### 3. Malformed top-level header with leading whitespace escapes header check
- **Severity:** NIT
- **File and Function:** `src-tauri/src/smtp/client.rs` — `strip_bcc_header`
- **Concern:** If a malformed message begins with leading whitespace on the first line (e.g. ` Bcc:`), `continuation` evaluates to `true`. Since `skipping` starts as `false`, the line is not checked by `is_bcc_field` and is preserved.
- **Exact Input:**
  ```text
  \x20Bcc: secret@example.com\r\nTo: bob@example.com\r\n\r\nBody
  ```
- **Consequence:** The scanner does not strip the line. If `mail_parser` parses it as `bcc`, `refuse_if_bcc` catches it and blocks transmission (fail closed). If `mail_parser` ignores it while a remote MTA parses it, the header leaks.
- **Fix:** Ensure top-level malformed whitespace on line 0 cannot be treated as a continuation of a non-existent previous header.

---

### 4. Test coverage gaps for trailing folded Bcc, sole Bcc, and multiple non-contiguous Bcc
- **Severity:** NIT
- **File and Function:** `src-tauri/src/smtp/client.rs` — `mod tests`
- **Concern:** Several boundary cases in `header_block_end` and `strip_bcc_header` lack explicit unit tests.
- **Exact Inputs to Add:**
  1. **Folded Bcc as the final header immediately preceding `\r\n\r\n`:**
     ```text
     From: a@x.org\r\nTo: b@x.org\r\nBcc: s1@x.org,\r\n s2@x.org\r\n\r\nBody
     ```
  2. **Bcc as the only header in the message:**
     ```text
     Bcc: secret@x.org\r\n\r\nBody
     ```
  3. **Multiple non-contiguous Bcc fields with folding:**
     ```text
     Bcc: s1@x.org\r\nTo: b@x.org\r\nBcc: s2@x.org,\r\n\ts3@x.org\r\nSubject: Hi\r\n\r\nBody
     ```
- **Consequence:** Future refactoring of `header_block_end` or `lines_inclusive` could regress boundary slicing without failing tests.
- **Fix:** Add tests covering these 3 inputs in `client.rs::tests`.

---

## Questions
1. Does the upstream `emailBuilder.ts` ever construct `Resent-*` headers for redirect/bounce operations, or is that strictly out of scope for Velo?
2. If `refuse_if_bcc` rejects a send in production, does the UI surface the returned error message cleanly to the user so they know sending failed without losing draft contents?

---

## What is Good
- **Fail-closed defense in depth:** Re-parsing the stripped bytes with `mail_parser` via `refuse_if_bcc` guarantees that scanner oversights result in an error rather than a silent privacy leak.
- **Envelope preservation:** `prepare_for_wire` correctly extracts the envelope containing blind recipients before stripping the header for the wire payload.
- **Clean zero-copy slicing:** `lines_inclusive` and `header_block_end` operate on byte slices without intermediate String conversions or heap allocations until building `out`.
- **End-to-end alignment:** Preserving `Bcc` on the TypeScript side for IMAP Sent/Drafts folders while stripping only on the Rust SMTP transport layer matches RFC 5322 §3.6.3 and user expectations.
