### Verdict

**APPROVE WITH NITS**

The implementation faithfully delivers SPEC-209 and Jim's Decision 2. The core security controls—Rust-side URL validation, complete refusal of redirects without disclosing `Location`, strict header allow-lists in both directions, chunk-level response body capping, error sanitisation with `without_url()`, and zod validation across the IPC boundary—are sound. No dependencies were added, and the static CSP and Tauri capability files remain untouched.

---

### Numbered Findings

#### 1. [MEDIUM] `src/services/ai/rustFetch.ts` (`rustFetch`) — In-flight `AbortSignal` ignored after invocation starts
* **Concern**: `rustFetch` checks `init?.signal?.aborted` before invoking the Tauri command, but does not attach an abort listener while `await invoke("ai_fetch")` is pending.
* **Exact scenario**: The OpenAI SDK triggers a timeout or the user cancels an ongoing request (e.g., navigating away or cancelling an AI draft). `init.signal` fires `abort` while `ai_fetch` is in flight.
* **Consequence**: The frontend promise fails to reject promptly, and the UI hangs until the 120-second backend timeout or remote server response completes.
* **Fix**: Listen to `init.signal` during the `invoke` call:
  ```ts
  if (init?.signal) {
    if (init.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    raw = await new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      init.signal!.addEventListener("abort", onAbort, { once: true });
      invoke("ai_fetch", { request }).then(resolve, reject).finally(() => {
        init.signal!.removeEventListener("abort", onAbort);
      });
    });
  } else {
    raw = await invoke("ai_fetch", { request });
  }
  ```

#### 2. [LOW] `src-tauri/src/ai_fetch.rs` (`tests`) — Body cap test only exercises the `Content-Length` header check
* **Concern**: The test `a_body_over_the_cap_is_refused` sends `Content-Length: 2048`, hitting `response.content_length() > max_body`. It does not test chunk-by-chunk stream truncation when `Content-Length` is omitted.
* **Exact scenario**: A hostile or misconfigured endpoint sends `Transfer-Encoding: chunked` without a `Content-Length` header and streams endless data.
* **Consequence**: If a future refactor breaks the `while let Some(chunk) = response.chunk().await` limit check, the test suite would remain green.
* **Fix**: Add a socket test that sends chunked transfer encoding (or raw bytes with `Connection: close` and no `Content-Length`) exceeding the cap and verifies that the chunk accumulator terminates with `larger than {max_body} bytes`.

#### 3. [LOW] `src-tauri/src/ai_fetch.rs` (`fetch_with_limits`) — Unbounded `retry-after` header passed to the SDK
* **Concern**: `retry-after` is forwarded verbatim to the webview.
* **Exact scenario**: A hostile or misconfigured custom endpoint answers `429 Too Many Requests` or `503 Service Unavailable` with `retry-after: 31536000` (1 year).
* **Consequence**: The OpenAI SDK inspects `retry-after` when scheduling retries. Depending on SDK retry backoff logic, background AI tasks (e.g. summarisation, categorisation) could stall.
* **Fix**: In `ai_fetch.rs`, validate or clamp `retry-after` (e.g., if numeric, cap to a reasonable value such as 60 seconds before returning it in the headers list).

#### 4. [LOW] `src-tauri/src/ai_fetch.rs` & `src/services/ai/rustFetch.ts` (`tests`) — Missing negative test coverage for `0.0.0.0` and `[::]`
* **Concern**: Neither table test includes `0.0.0.0` or `[::]`.
* **Exact scenario**: On macOS/Linux, connecting to `0.0.0.0` routes to `127.0.0.1`. While `IpAddr::is_loopback()` in Rust correctly returns `false` for `0.0.0.0` and `[::]`, there is no regression test pinning this refusal.
* **Consequence**: A regression in URL parsing or a relaxed IP check could inadvertently admit `0.0.0.0` as loopback.
* **Fix**: Add `"http://0.0.0.0:8080"` and `"http://[::]:8080"` to both the Rust and TypeScript refusal test tables.

#### 5. [NIT] `src-tauri/src/ai_fetch.rs` (`fetch_with_limits`) — Client constructed per request without connection pooling
* **Concern**: `reqwest::Client::builder().build()` is called inside `fetch_with_limits` on every single invocation.
* **Exact scenario**: Multiple sequential completions (e.g., auto-categorizing threads).
* **Consequence**: Connection pooling and TLS session resumption are bypassed, adding an extra TCP/TLS handshake roundtrip per request (~50–150ms).
* **Fix**: Cache or reuse a static/lazy `reqwest::Client` configured with `redirect(Policy::none())`.

#### 6. [NIT] `src/components/settings/SettingsPage.tsx` — Test Connection tests saved database settings, not field state
* **Concern**: Clicking "Test Connection" reads `custom_base_url` from the database. If the user edits the URL or key and clicks "Test Connection" without first clicking "Save", it tests the old values or fails with `NOT_CONFIGURED`.
* **Exact scenario**: User pastes a new URL and key, and immediately clicks "Test Connection".
* **Consequence**: Confusing test failure, though mitigated by the helper text `"Test Connection uses the saved values — save first."`
* **Fix**: Either pass the current input state into a targeted test function, or disable "Test Connection" when the input fields are dirty relative to the saved settings.

---

### Detailed Review by Checklist Area

#### 1. SSRF and the URL Rule
* **Non-loopback `http:` prevention**: `validate_ai_url` requires `scheme == "https"` or `scheme == "http" && is_loopback_host(host)`.
* **IPv6-mapped IPv4**: In Rust, `Ipv6Addr::is_loopback()` checks for `::1` only; `[::ffff:127.0.0.1]` has segment 5 set to `0xffff`, so `is_loopback()` is `false`. Both `http://[::ffff:127.0.0.1]` and `http://[::ffff:10.0.0.1]` are refused. In TS, the regex fails on `::ffff:`.
* **Alternative IPv4 forms**: In WHATWG URL parsing (both Rust `url` crate and browser `URL`), octal (`0177.0.0.1`), integer (`2130706433`), and short (`127.1`) forms are canonicalized to dotted-quad `127.0.0.1` before `is_loopback_host` runs. Both implementations accept them as loopback.
* **`0.0.0.0` and `[::]`**: `0.0.0.0.is_loopback()` is `false` (only `127.0.0.0/8` is loopback in Rust std). Refused.
* **Trailing dot (`localhost.`)**: `host.eq_ignore_ascii_case("localhost")` fails for `"localhost."`. Refused by both.
* **IDN/Punycode**: Punycode hosts start with `xn--`, never matching ASCII `"localhost"`. Refused for `http:`.
* **`@` in path/query vs userinfo**: `url.username()` and `url.password()` correctly detect userinfo before `@host`. An `@` inside the path or query is preserved and allowed.
* **Whitespace/newlines**: `raw.trim()` removes outer whitespace; inner tabs/newlines are stripped per WHATWG URL rules, and whitespace inside hostnames causes parse errors.
* **TS vs Rust alignment**: The TS regex `/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/` checks `v4[1] === "127"`. The TS pre-check is never more permissive than Rust.
* **`https` to private IP addresses**: Explicitly permitted by Jim's Decision 2 and documented in the threat pass. Reqwest enforces TLS certificate validation, preventing non-TLS intranet SSRF.

#### 2. Redirects and the Response
* **`Policy::none()`**: Reqwest does not follow any 3xx redirect under `Policy::none()`. Reqwest does not redirect on 2xx responses regardless of `Location` headers.
* **Status check**: `ai_fetch.rs` explicitly checks `status.is_redirection()` (300–399) and returns `the endpoint answered {status} — redirects are not followed`, completely redacting the `Location` target header.
* **Response headers**: Strict allow-list (`content-type`, `retry-after`, `x-request-id`). No possibility of response header injection into the reconstructed `Response`.
* **Body capping**: Checked twice—via `content_length()` before allocation and inside the streaming `while let Some(chunk) = response.chunk().await` loop. Memory is bounded at 8 MiB.
* **Non-UTF-8 bytes**: Handled via `String::from_utf8_lossy`. Malformed JSON will fail safely during `JSON.parse` in the OpenAI SDK and surface cleanly via `describeError`.

#### 3. Credentials
* **Transport**: The API key travels solely in the `Authorization` request header over TLS (or unencrypted loopback).
* **Logs & Errors**: `ai_fetch.rs` logs only `method`, `host`, and `status`. Reqwest errors pass through `err.without_url()`, removing query strings and credentials.
* **UI**: `describeError` in TypeScript redacts bearer tokens and API keys from error messages displayed in settings.
* **Storage**: Keys are encrypted at rest using `setSecureSetting` (AES-GCM).

#### 4. Header Allow-lists
* **Forwarded request headers**: `["authorization", "content-type", "accept", "user-agent"]`. Sensitive headers (`Cookie`, `Origin`, `Host`, custom auth headers) are dropped.
* **OpenAI-compatible needs**:
  * `OpenAI-Organization` / `OpenAI-Project`: Not forwarded. If a proxy strictly requires them, it will fail, but standard custom providers (DeepSeek, OpenRouter, self-hosted vLLM/Ollama) do not require them.
  * `HTTP-Referer` / `X-Title` (OpenRouter): Optional metadata headers. OpenRouter functions correctly without them. Documented as an intentional omission.
  * `x-api-key`: Not forwarded. Endpoints requiring `x-api-key` instead of standard Bearer authorization are not supported by the OpenAI JS client by default anyway.

#### 5. Rust Command Exposure
* **Webview isolation**: Email HTML renders in a sandboxed iframe without script execution privileges.
* **Compromised renderer impact**: If an XSS occurs in the main React application, an attacker could invoke `ai_fetch` to send GET/POST requests to arbitrary HTTPS origins or loopback HTTP. However, this reach is strictly narrower than the pre-existing `@tauri-apps/plugin-http` scope (which allowed arbitrary HTTP methods, followed redirects, and permitted unconstrained response headers).

#### 6. Tests
* **Coverage**: Table tests for URL parsing on both sides, socket tests verifying 302 refusal, request/response header allow-lists, 401 relay, and `without_url` error sanitisation.
* **Gaps**: Missing chunked stream body-cap test (Finding 2), missing negative assertions for `0.0.0.0` / `[::]` (Finding 4), and missing in-flight abort test for `rustFetch` (Finding 1).

---

### Questions

1. **Self-signed certificates on LAN HTTPS endpoints**: `reqwest::Client` validates TLS certificates against the system trust store. If a user points to a local gateway like `https://192.168.1.50:8443` using a self-signed certificate without adding it to the OS trust store, the connection will fail with a TLS validation error. Is this the intended behaviour, or should a future update support custom CA certs?

---

### What is Good

* **Zero-dependency footprint**: Leverages pre-existing `reqwest 0.12`, `url`, `tokio`, and `zod` packages without adding new crate or npm dependencies.
* **Tight security boundaries**: Preserves the static CSP `connect-src` and untouched capability files.
* **Defense in depth on errors**: `err.without_url()` combined with `describeError` ensures keys in URLs or query strings are never reflected to logs or the UI.
* **Clean error framing**: Refuses 3xx redirects without echoing the `Location` header, preventing redirection-based information disclosure.
* **Strict response validation**: Validates Rust IPC output with Zod before constructing `Response`.
