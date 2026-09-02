## Verdict
**APPROVE WITH NITS**

The implementation is well-architected, secure, and adheres strictly to the recorded decision. The security boundary in Rust (`ai_fetch`) is tight: it restricts schemes and hosts, enforces `Policy::none()`, refuses 3xx without disclosing `Location`, strips URL queries from error text and logs, bounds response memory and execution time, and strictly allow-lists headers in both directions. The webview CSP and Tauri capability scopes remain untouched.

---

## Numbered Findings

### 1. [LOW] `src-tauri/src/ai_fetch.rs` — `tests::a_body_over_the_cap_is_refused`
- **Concern:** Body cap test exercises the `Content-Length` header check, not the streaming chunk accumulation check.
- **Exact Scenario:** `framed()` generates a `content-length: 2048` header. `fetch_with_limits` hits `if len > max_body as u64` and returns early before entering `while let Some(chunk) = response.chunk().await`.
- **Consequence:** The chunk streaming cap logic (`buf.len() + chunk.len() > max_body`) is not exercised by tests. A regression in the chunk loop would pass CI.
- **Fix:** Add a socket test that sends a response with `Transfer-Encoding: chunked` (or no `Content-Length` header) and a payload exceeding the cap.

### 2. [LOW] `src-tauri/src/ai_fetch.rs` — `fetch_with_limits`
- **Concern:** Rebuilding `reqwest::Client` on every request prevents HTTP keep-alive, connection pooling, and TLS session reuse.
- **Exact Scenario:** Back-to-back LLM calls (e.g., auto-categorization, thread summary, smart reply) each perform a full client initialization, TCP handshake, and TLS negotiation.
- **Consequence:** Unnecessary latency and socket churn for consecutive completions against remote endpoints.
- **Fix:** Maintain a reusable client instance (e.g., via `tokio::sync::OnceCell` or a client struct in Tauri state) and configure timeouts per-request via `builder.timeout(timeout)` instead of rebuilding the client.

### 3. [NIT] `src/services/ai/providerManager.ts` — `getActiveProvider`
- **Concern:** Nullish coalescing operator does not coalesce empty strings.
- **Exact Scenario:** If `custom_model` is saved as an empty string `""` in the database, `(await getSetting("custom_model")) ?? DEFAULT_MODELS.custom` evaluates to `""` instead of falling back to `"gpt-4o-mini"`.
- **Consequence:** An empty model name string could be passed to `createCustomProvider`.
- **Fix:** Use logical OR: `(await getSetting("custom_model")) || DEFAULT_MODELS.custom`.

### 4. [NIT] `src/services/ai/rustFetch.ts` — `rustFetch`
- **Concern:** `AbortSignal` is only evaluated before invoking the Tauri command.
- **Exact Scenario:** If the caller aborts the `AbortSignal` while `ai_fetch` is in flight over the wire, `rustFetch` does not reject until `invoke` completes or times out.
- **Consequence:** The calling UI / SDK remains in a pending state until Rust finishes the request.
- **Fix:** Race `invoke` against an `abort` event listener on `init.signal` that rejects immediately with a `DOMException("The operation was aborted.", "AbortError")`.

### 5. [NIT] `src-tauri/src/ai_fetch.rs` — `tests`
- **Concern:** Table tests omit non-standard IPv4 notations, `0.0.0.0`, `[::ffff:...]`, and trailing dot hosts.
- **Exact Scenario:** Refactoring of `validate_ai_url` or `is_loopback_host` could alter handling of `0177.0.0.1`, `2130706433`, `127.1`, `0.0.0.0`, `[::ffff:127.0.0.1]`, or `localhost.`.
- **Consequence:** Potential unnoticed regression in URL parsing behavior.
- **Fix:** Add explicit test cases for `http://0177.0.0.1`, `http://2130706433`, `http://127.1` (accepted), and `http://0.0.0.0`, `http://[::ffff:127.0.0.1]`, `http://localhost.` (refused).

---

## Detailed Review Points

### 1. SSRF and the URL Rule
- **Schemes & Host Parsing:** `validate_ai_url` strictly enforces `https:` to any host and `http:` to loopback only. Other schemes (`file:`, `ftp:`, `javascript:`, `data:`) are rejected.
- **IP / Host Normalization:** 
  - WHATWG URL standard parser (via `Url::parse`) canonicalizes octal (`0177.0.0.1`), decimal (`2130706433`), and short (`127.1`) forms to `127.0.0.1`, correctly recognized by `IpAddr::is_loopback()`.
  - `0.0.0.0` is parsed as `0.0.0.0` (`is_loopback()` is `false`), so `http://0.0.0.0` is safely refused.
  - `[::ffff:127.0.0.1]` is parsed as IPv6 where `Ipv6Addr::is_loopback()` only matches `::1`, so it is safely refused.
  - `localhost.` has host `"localhost."`, which fails `eq_ignore_ascii_case("localhost")` and fails IP parsing, so it is safely refused.
  - URLs with user-info (`https://user:pass@host`) are explicitly rejected by checking `url.username()` and `url.password()`. An `@` in the path or query string does not set username/password and is correctly accepted.
  - `https://` to private addresses (e.g. `https://10.0.0.5`) is permitted by recorded design (decision 2) for local TLS gateways.

### 2. Redirects and Response Handling
- `reqwest::redirect::Policy::none()` is set on the client.
- Statuses in `300..=399` (`response.status().is_redirection()`) are rejected without reading or returning the `Location` header.
- The 8 MiB response body cap is enforced before and during chunk streaming.
- `String::from_utf8_lossy` avoids Rust UTF-8 decoding panics while producing clean strings.
- In TypeScript, `NULL_BODY_STATUSES` (`204`, `205`, `304`) pass `null` body to `new Response()`, preventing standard Fetch API `TypeError` exceptions.

### 3. Credentials & Redaction
- `custom_api_key` is registered in `SECURE_SETTING_KEYS` (AES-GCM encrypted in SQLite).
- `Authorization` is forwarded only to the validated endpoint over TLS (or loopback HTTP).
- `ai_fetch` logs only method, host, and status.
- `reqwest::Error::without_url()` prevents query parameters or endpoint paths from leaking into error messages or UI.
- Failed connections in the UI route through `describeError` which scrubs Bearer tokens and API key patterns.

### 4. Header Allow-Lists
- **Request:** `["authorization", "content-type", "accept", "user-agent"]`. Strips all browser headers, cookies, origins, and non-essential metadata.
- **Response:** `["content-type", "retry-after", "x-request-id"]`. Strips `Set-Cookie` and server internal headers while preserving headers needed by OpenAI SDK for JSON parsing and rate-limit backoff.

### 5. Rust Command Exposure
- Exposed via `core:default` IPC.
- Email HTML is rendered in a sandboxed, scriptless iframe.
- Even in the event of a compromised webview context, `ai_fetch`'s blast radius is strictly smaller than the existing `@tauri-apps/plugin-http` scope (`https://*`, loopback http) because it blocks off-host redirects, restricts HTTP methods to `GET`/`POST`, and restricts request headers to 4 entries.

### 6. Test Suite Completeness
- Rust socket tests verify redirect blocking, header allow-listing in both directions, body limits, status code relaying, and query string error redaction.
- TypeScript tests verify `isAllowedAiUrl` parity, `rustFetch` response reconstruction, Zod boundary validation, provider caching, `NOT_CONFIGURED` behavior, and credential scrubbing.

---

## Questions
1. Is there any plan to support streaming responses (`text/event-stream`) for custom endpoints in the future? (The spec notes request/response only for now, which fits the current callers).
2. For private LAN endpoints using self-signed TLS certificates, does `reqwest` rely on the OS trust store via `native-tls`? (If a user configures `https://192.168.1.50` with an untrusted certificate, `reqwest` will reject the connection unless the CA is in the system keychain).

---

## What is Good
- **Strict Boundary Control:** Excellent decision to enforce the URL rules, method allow-list, header filter, and redirect refusal in Rust rather than trusting the TypeScript layer.
- **Zod Schema at the IPC Seam:** Validating the return value of `invoke("ai_fetch")` with Zod treats the IPC boundary as untrusted.
- **Error Redaction:** Consistent use of `err.without_url()` in Rust and `describeError` in TypeScript ensures API keys in URLs or bearer tokens do not reach logs or UI alerts.
- **Null-Body Status Handling:** Proper handling of `204`, `205`, and `304` responses avoids Fetch standard `TypeError` bugs when reconstructing `Response` objects.
- **Clean Fallback & Zero New Dependencies:** Leverages existing `reqwest 0.12`, `serde`, `tokio`, and `zod` dependencies with no new additions or capability modifications.
