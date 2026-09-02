## Verdict
**APPROVE WITH NITS**

The changes correctly implement RFC 3501 §6.4.5 multi-attribute parenthesisation across all production and diagnostic call sites. Response parsing is completely unaffected for compliant servers while fixing the missing body defect on strict parsers like Stalwart. The guard test is a great regression defense, with minor edge-case limitations in its string-scanning parser noted below.

---

## Findings

### 1. Guard test line scanner skips multi-line call sites and passes vacuously for additions
- **Severity:** MEDIUM
- **File & Function:** [`src-tauri/src/imap/client.rs`](file:///src-tauri/src/imap/client.rs#L2135-L2155): `fetch_attribute_arguments`
- **Concern:** The AST-less scanner iterates line-by-line (`source.lines()`) and assumes `.uid_fetch(arg1, arg2)` is on a single line.
- **Exact Scenario:** A developer or `rustfmt` wraps a new (6th) `.uid_fetch` call across lines:
  ```rust
  let stream = session
      .uid_fetch(
          &uid_set,
          "UID FLAGS BODY.PEEK[]",
      )
      .await;
  ```
  `args.find(',')` on the `.uid_fetch(` line evaluates to `None`, triggering `continue`. 
- **Consequence:** The new unparenthesised site is skipped entirely. Because `assert!(sites.len() >= 5)` is already satisfied by the original 5 single-line sites, CI stays green and the regression slips into production.
- **Fix:** Either scan across newlines using a regex (or `syn`), or count total occurrences of `.uid_fetch(` in `source` and assert that `parsed_sites.len() == total_uid_fetch_occurrences`.

---

### 2. Guard test scanner breaks if `.uid_fetch(...)` has trailing semicolons or chained calls on the same line
- **Severity:** LOW
- **File & Function:** [`src-tauri/src/imap/client.rs`](file:///src-tauri/src/imap/client.rs#L2141-L2152): `fetch_attribute_arguments`
- **Concern:** `let second = args[comma + 1..].trim().trim_end_matches(')').trim();` only strips a trailing `)` if it is the very last character of the line.
- **Exact Scenario:** A future call site is written without line-breaks before `.await` (e.g. `.uid_fetch(set, FETCH_FULL).await;`) or in a sync context ending in `;` (`.uid_fetch(set, FETCH_FULL);`).
- **Consequence:** `trim_end_matches(')')` fails to strip `)` because the line ends with `;` or `.await;`. `second` becomes `"FETCH_FULL).await;"` and triggers the `panic!("line {}: unknown fetch attribute argument...")` branch during `cargo test`.
- **Fix:** Extract the argument substring strictly up to the closing `)` matching the invocation or use a regex like `r#"\.uid_fetch\s*\([^,]+,\s*([^)]+)\)"#`.

---

### 3. Guard test does not scan `raw_fetch_messages` or potential sequence-number `fetch` calls
- **Severity:** LOW
- **File & Function:** [`src-tauri/src/imap/client.rs`](file:///src-tauri/src/imap/client.rs#L2157-L2170): `every_multi_attribute_fetch_list_is_parenthesised`
- **Concern:** `fetch_attribute_arguments` explicitly looks for `.uid_fetch(`. `raw_fetch_messages` constructs raw IMAP command strings directly (`format!("a3 UID FETCH ...")`), and future code might use `session.fetch(...)`.
- **Exact Scenario:** A regression occurs in `raw_fetch_messages` reverting `{FETCH_FULL}` to an inline unparenthesised string, or a new non-UID `session.fetch()` call is introduced.
- **Consequence:** The guard test does not cover these paths and passes without verifying them.
- **Fix:** Add a test checking that raw fetch format strings contain parentheses or assert that raw templates reference `FETCH_FULL`.

---

### 4. Space-detection heuristic flags valid single parameterized attributes
- **Severity:** NIT
- **File & Function:** [`src-tauri/src/imap/client.rs`](file:///src-tauri/src/imap/client.rs#L2162): `every_multi_attribute_fetch_list_is_parenthesised`
- **Concern:** `let multi = attrs.trim_matches(|c| c == '(' || c == ')').contains(' ');` assumes any space denotes multiple attributes.
- **Exact Scenario:** A call site passes a single compound attribute containing spaces, such as `BODY.PEEK[HEADER.FIELDS (Subject From)]`.
- **Consequence:** `multi` evaluates to `true`. Unless outer parentheses are added (`(BODY.PEEK[HEADER.FIELDS (Subject From)])`), the test fails even though RFC 3501 permits a single bare `fetch-att`.
- **Fix:** Noted as acceptable since enclosing single compound attributes in `(...)` is valid RFC 3501 syntax anyway, but documenting this behavior prevents confusion if specialized header fetches are added.

---

## Questions
1. Is there any plan to introduce non-UID `fetch()` calls in Velo (e.g. for message sequence numbers during search/sort)? If so, should the guard test scan `.fetch(` as well?
2. Has `raw_fetch_messages` been tested against Stalwart to confirm that `{FETCH_FULL}` interpolates cleanly without double parentheses or missing spaces?

---

## What is Good
1. **RFC 3501 Compliance:** Strictly adheres to RFC 3501 §6.4.5 (`UID FETCH <set> (<att1> <att2> ...)`).
2. **Zero Response Parser Regressions:** Keeping the exact attribute sets (`FETCH_FULL`, `FETCH_UID_FLAGS_BODY`, `FETCH_BODY`) ensures no response parser or data extraction regressions on existing servers (Dovecot, Gmail, Outlook, iCloud).
3. **Constant Centralization:** Eliminates hardcoded magic strings and unifies the raw diagnostic command with production client calls.
4. **Active Defense:** Adding an `include_str!` guard test is an excellent, low-overhead way to prevent silent syntax regressions without adding heavy runtime abstractions.
