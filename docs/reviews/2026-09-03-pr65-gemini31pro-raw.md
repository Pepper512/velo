APPROVE WITH NITS

### Findings

**1. Missing Normalization and Edge Cases in Tests (NIT)**
*   **File:** `src-tauri/src/ai_fetch.rs` & `src/services/ai/rustFetch.test.ts`
*   **Function:** `tests` module
*   **Concern:** The test tables do not cover critical URL parsing edge cases.
*   **Scenario:** If an implementation mistakenly rejected valid loopback normalizations (like decimal IPs) or accepted invalid IPs (like `0.0.0.0`), the tests would still pass.
*   **Consequence:** A future refactor could break the SSRF protections or normalization rules without failing the test suite.
*   **Fix:** Add `http://0.0.0.0`, `http://localhost.`, and `http://[::ffff:127.0.0.1]` to the refusal tests on both sides. Add decimal (`http://2130706433`), octal (`http://0177.0.0.1`), and short form (`http://127.1`) to the acceptance tests on both sides to pin the WHATWG URL normalization behavior.

**2. Incomplete Abort Handling (NIT)**
*   **File:** `src/services/ai/rustFetch.ts`
*   **Function:** `rustFetch`
*   **Concern:** The `AbortController` signal is only checked before the Tauri command is invoked, not during the fetch.
*   **Scenario:** A user cancels an ongoing AI generation via the UI.
*   **Consequence:** The frontend abandons the promise, but the Rust backend continues the HTTP request until it finishes or hits the 120s timeout, holding a background task open.
*   **Fix:** Acceptable for now given desktop limits. For a complete fix, pass a unique request ID to Rust and implement a separate `abort_ai_fetch` command that triggers a cancellation token in Rust.

### Assessment against Criteria

1.  **SSRF and the URL rule:** 
    *   No input can reach a non-loopback `http:` host.
    *   **Normalization:** Both Rust's `url` crate and the browser's `URL` object implement the WHATWG URL specification. This means decimal (`2130706433`), octal (`0177.0.0.1`), and short forms (`127.1`) are canonicalized to `127.0.0.1` by both parsers before validation. Both environments safely accept them. `0.0.0.0` is unspecified and rejected by both. `localhost.` and IPv4-mapped IPv6 (`[::ffff:127.0.0.1]`) are rejected by both (stricter, but safe). `@` in the path is safely treated as part of the path; credentials in the URL authority are explicitly rejected.
    *   **Private `https:`:** Allowed by the rule and explicitly accepted by the threat model.
2.  **Redirects and the response:** 
    *   `Policy::none()` guarantees `reqwest` does not follow redirects.
    *   The `Location` header is dropped entirely on a 3xx error; it is not logged and does not reach TS.
    *   Header injection is prevented because `reqwest` guarantees valid header characters and drops CRLF. 
    *   An attacker returning a huge JSON payload is safely bounded by the 8 MiB chunked-read cap.
    *   `String::from_utf8_lossy` turns non-UTF-8 bytes into ``; this is memory-safe and simply causes the OpenAI SDK to throw a benign JSON parse error.
3.  **Credentials:**
    *   `reqwest::Error::without_url()` successfully strips the URL, preventing query-string leakage into logs or the UI.
    *   Logs strictly record method, host, and status.
    *   `invoke` failures yield generic strings. The API key only travels in the `Authorization` header and is safe from UI leaks.
4.  **Header allow-lists:**
    *   Standard `Authorization`, `Content-Type`, `Accept`, and `User-Agent` are sufficient. OpenRouter's `HTTP-Referer` and `X-Title` are optional and their omission does not break the API. No sensitive internal headers are forwarded.
5.  **The Rust command's exposure:**
    *   Email HTML runs in a sandboxed iframe (`script-src 'self'`) and cannot call `invoke`. 
    *   A compromised renderer could call `ai_fetch`, but its reach (`https://*` and loopback `http`) is strictly *narrower* than the already-enabled `http` plugin (which allows redirects and arbitrary headers). It adds no new attack surface.
6.  **The tests:**
    *   The test tables are solid but could pass with a wrong rule regarding the edge cases mentioned in Finding #1.

### Questions

*   Does the 8 MiB cap accommodate extremely large context windows returning massive JSON payloads for local endpoints (e.g., summarizing an entire book)? 8 MiB is typically enough for text, but worth considering for extreme local use cases.

### What is good

*   Using the `url` crate for validation guarantees WHATWG compliance, neutralizing parser differential attacks between TS and Rust.
*   Explicitly catching and black-holing 3xx responses entirely eliminates the risk of DNS rebinding or redirect-based SSRF.
*   The header allow-list is bidirectional and extremely tight, effectively sanitizing any weirdness a malicious endpoint could inject into the TS `Response` object.
