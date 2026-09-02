# SPEC-209 — Custom OpenAI-compatible endpoint through a validated Rust fetch (#209, #265)

- **Task:** Add a "Custom (OpenAI-compatible)" AI provider whose base URL the user types,
  reached through a Rust `ai_fetch` command that allows `https:` to any host or `http:` to
  loopback only, follows no redirect, forwards an allow-listed header set, and caps the
  response — so the CSP `connect-src` and the http-plugin scope stay exactly as they are.
- **Tier:** **2** — a new `#[tauri::command]` taking a user-controlled URL (`CLAUDE.md`:
  "every `#[tauri::command]` argument" is a boundary that validates its own input), the
  `services/ai/*` output boundary, and credentials in flight. Plan, threat pass and rollback
  in the PR before code; both cross-vendor legs (ADR-004).
- **Base:** `main` @ `fe67514` (code pin `7e767e5`). Every citation below was grepped at that pin.
- **Status:** building — branch `f209-custom-llm-url`.
- **Source:** upstream avihaymenahem/velo#209 ("Support custom LLM url" — DeepSeek, GLM and
  other OpenAI-compatible endpoints) and #265 ("Provider - Openrouter"; the second comment is
  spam). Upstream PR #242 (`wynn5a`, `custom-provider`, open) implements the UI and provider
  through the http plugin's `fetch`. The fork's 2026-09-01 triage: P2, M, Tier 2 — *"CSP
  connect-src + http scope are allowlists — user-supplied URL is a Tier-2 boundary; validate
  host, https-only except loopback"*; #265 *"falls out of #209"*. Jim's decision 2 of
  2026-09-02: **validated Rust fetch command (https/loopback only, no off-host redirects); CSP
  stays tight.** Bug-fix queue item 9.
- **Effort:** M · 2 days (#265 included).

## Outcome

In Settings › AI the provider list gains "Custom (OpenAI-compatible)". The user enters a base
URL such as `https://openrouter.ai/api/v1` or `https://api.deepseek.com/v1`, an API key
(optional — a LAN gateway may not need one) and a model name; Test Connection and every AI
feature then work against that endpoint. OpenRouter (#265) is this with its URL. A URL that
is not `https:` or loopback is refused in the settings page before it is saved and, if it
ever reaches Rust, refused there too.

## What exists, verified in the fork

1. **Every cloud provider goes through the webview's `fetch`.** `xaiProvider.ts:22-29` builds
   `new OpenAI({ baseURL: XAI_BASE_URL, dangerouslyAllowBrowser: true })` with no `fetch`
   override, so the request is gated by the static CSP `connect-src`
   (`tauri.conf.json:42`: googleapis, anthropic, openai, generativelanguage, gravatar,
   microsoft, yahoo, four loopback origins, models.github.ai, api.x.ai). A user-typed host
   cannot be added to a CSP at runtime — the reason upstream PR #242 reached for the http
   plugin instead.
2. **Ollama alone uses the http plugin** (`ollamaProvider.ts:2,25`, `localFetch` with
   `maxRedirections: 0` from SPEC-280). The plugin's scope (`capabilities/default.json:68-75`)
   is `http://*`, `https://*` and the loopback entries — broad, and checked on the given URL
   only. Routing an arbitrary user URL through it would be "allowed" by that scope but would
   not enforce the https/loopback rule anywhere.
3. **The shared request body** is `createOpenAICompatibleProvider(client, model)`
   (`openAiCompatible.ts:32-63`); a provider is configuration plus a client. Errors reach the
   settings page through `describeError` (`errors.ts:22-24`), which redacts key shapes,
   bearer tokens and key-bearing query strings (`:47-54`).
4. **Provider names are enumerated in three files** — `types.ts:2` (`AiProvider`),
   `providerManager.ts:13-36` (`API_KEY_SETTINGS`, `getActiveProviderName`),
   `SettingsPage.tsx:116,182,1068-1082` (state, load, dropdown) — plus the model maps
   `DEFAULT_MODELS`/`PROVIDER_MODELS`/`MODEL_SETTINGS` in `types.ts`. Ollama is the existing
   "no key, free-text model, own card" shape (`SettingsPage.tsx:1095-1168`).
5. **Rust already has an HTTP client:** `reqwest 0.12` (`Cargo.toml:66`, native-tls + json),
   used by `oauth.rs:350,395` with `reqwest::Client::new()`. `serde`, `serde_json`, `tokio`
   (`rt`, `macros`, `net`, `time`) are direct dependencies. `reqwest::Url` re-exports the `url`
   crate. **No new dependency on either side**; `zod` is installed and already guards model
   output (`modelOutput.ts:20`).
6. **Commands are registered in two `generate_handler!` lists** (`lib.rs:93-126`, debug and
   release) and need no capability entry — `db_tx_*` (#240) and every `imap_*` command are
   reachable with `core:default` alone (`capabilities/default.json:11`).
7. **The LLM output boundary is unchanged** — the custom provider's `complete()` returns
   through the same `createOpenAICompatibleProvider` path every provider uses, and callers
   parse it through `modelOutput.ts`.

## Review of upstream PR #242 (adopted in shape, replaced at the seam)

| # | Upstream | Disposition |
|---|---|---|
| 1 | New `custom` provider name; settings `custom_base_url`, `custom_model`, secure `custom_api_key`; a card with Base URL / API key / Model / Save / Test; option label "Custom (OpenAI Compatible)" | **Adopt** the names and the card shape (they mirror the Ollama card). |
| 2 | Fetch through `@tauri-apps/plugin-http` `fetch` with redirects followed | **Replace** with the Rust `ai_fetch` command (decision 2): scheme/host rule enforced in Rust, redirects refused, headers allow-listed, body capped. |
| 3 | Default base URL `http://localhost:11434/v1` when unset | **Reject**: an unset URL means not configured (`NOT_CONFIGURED`), never a silent local default that duplicates the Ollama provider. |
| 4 | API key required | **Relax**: optional (a LAN gateway); the SDK needs a non-empty string, so a placeholder is sent when blank. |
| 5 | Adds `baseUrl` to the `AiProviderClient`/`testConnection` signatures across every provider (+6/−5 in five files) | **Reject**: the base URL is the custom provider's configuration, not part of the interface; nothing else changes. |
| 6 | No URL validation, no tests | **Add** both (below). |

## Requirements

- **REQ-1** As a user with an OpenAI-compatible endpoint I want to use it.
  - REQ-1.1 WHEN `ai_provider` is `custom` and `custom_base_url` is set THE SYSTEM SHALL
    send chat-completion requests to `<base_url>/chat/completions` through `ai_fetch`.
  - REQ-1.2 WHEN `custom_base_url` is unset THE SYSTEM SHALL raise `NOT_CONFIGURED` and
    `isAiAvailable()` SHALL be false.
  - REQ-1.3 The custom card SHALL offer Base URL, API key (optional), Model (free text), Save
    and Test Connection; Test SHALL show the reason on failure exactly as the other cards do.
  - REQ-1.4 The help text SHALL name OpenRouter (`https://openrouter.ai/api/v1`) and DeepSeek
    (`https://api.deepseek.com/v1`) as examples (#265).
- **REQ-2** As the owner of this machine I want the endpoint rule enforced where it cannot be
  bypassed.
  - REQ-2.1 `ai_fetch` SHALL accept a URL only if its scheme is `https`, or its scheme is
    `http` and its host is loopback (`localhost`, any `127.0.0.0/8` address, `::1`); it SHALL
    refuse every other scheme, any URL with user-info, and any URL without a host.
  - REQ-2.2 `ai_fetch` SHALL NOT follow redirects; a 3xx response SHALL be returned to the
    caller as an error naming only the status (never the `Location` value).
  - REQ-2.3 `ai_fetch` SHALL forward only these request headers: `authorization`,
    `content-type`, `accept`, `user-agent`; SHALL accept only `GET` and `POST`; and SHALL
    return only `content-type`, `retry-after` and `x-request-id` response headers.
  - REQ-2.4 `ai_fetch` SHALL refuse a response body larger than 8 MiB and SHALL time out
    after 120 s.
  - REQ-2.5 The same scheme/host rule SHALL be checked in TypeScript before saving the URL
    (an inline message); the Rust check is the one that counts.
  - REQ-2.6 The CSP, the http-plugin scope and the capability file SHALL be byte-identical
    to `fe67514` (the existing tests pin them).
- **REQ-3** Credentials and output.
  - REQ-3.1 The API key SHALL travel only in the `authorization` header to the validated
    host; it SHALL never appear in a log line, an error string (`describeError` redacts) or the
    URL.
  - REQ-3.2 `ai_fetch`'s result SHALL be validated in TypeScript (`zod`: status integer,
    header pairs, body string) before a `Response` is built from it.
  - REQ-3.3 Model output SHALL take the existing path through `createOpenAICompatibleProvider`
    and the callers' `modelOutput` guards — unchanged.

## Not doing

- Streaming responses (no caller streams; `ai_fetch` is request/response).
- Routing the existing providers through `ai_fetch` (each has a CSP entry; unchanged).
- Presets/dropdown of known endpoints — the help text names two; a preset list is a
  follow-up if asked.
- Allowing `http:` to private LAN addresses — decision 2 says https or loopback.
- Custom request headers (e.g. OpenRouter's optional `HTTP-Referer`/`X-Title`) — not needed
  for the API to work. Azure OpenAI's `api-key` header is likewise not forwarded (the card
  says so; review, Grok 10).
- Cancelling an in-flight Rust request when the SDK aborts — the wrapper rejects at once,
  the request runs to its own timeout (review, Gemini N4 / Gemini 3.1 Pro N2).
- Widening `connect-src` or the http scope for any host.

## Design

- **Rust — `src-tauri/src/ai_fetch.rs`** (new module, registered in both handler lists).
  - `pub fn validate_ai_url(raw: &str) -> Result<reqwest::Url, String>` — REQ-2.1, pure, unit-tested.
  - `pub struct AiFetchRequest { url, method, headers: Vec<(String, String)>, body: Option<String> }`,
    `pub struct AiFetchResponse { status: u16, headers: Vec<(String, String)>, body: String }` (serde).
  - `#[tauri::command] pub async fn ai_fetch(request: AiFetchRequest) -> Result<AiFetchResponse, String>`
    → `fetch_with_limits(request, MAX_BODY_BYTES, TIMEOUT)`: validate URL and method; filter
    headers by the allow-list (case-insensitive); `reqwest::Client::builder()
    .redirect(Policy::none()).timeout(120 s)`; send; 3xx → `Err("endpoint answered <status>;
    redirects are not followed")`; read the body in chunks and stop at the cap; return the
    filtered response headers. Errors never include the URL's query or headers. `log::info!`
    records host and status only.
- **TypeScript**
  - `src/services/ai/rustFetch.ts`: `rustFetch: typeof fetch` — accepts a URL string or
    `Request`, a string body (anything else throws: the SDK sends JSON strings), collects the
    SDK's headers, invokes `ai_fetch`, validates the result with a zod schema (REQ-3.2), and
    returns `new Response(body, { status, headers })`. `isAllowedAiUrl(url): boolean` mirrors
    REQ-2.1 for the settings page (REQ-2.5).
  - `src/services/ai/providers/customProvider.ts`: `createCustomProvider(baseUrl, apiKey, model)`
    → `new OpenAI({ baseURL: normalised, apiKey: apiKey || "no-key", dangerouslyAllowBrowser:
    true, fetch: rustFetch })` cached on `baseUrl|apiKey|model`; `clearCustomProvider()`.
  - `types.ts`: `AiProvider` += `"custom"`; `DEFAULT_MODELS.custom = "gpt-4o-mini"`;
    `MODEL_SETTINGS.custom = "custom_model"`; `PROVIDER_MODELS` excludes `custom` like `ollama`.
  - `settingsKeys.ts`: `custom_base_url`, `custom_model`; secure `custom_api_key`.
  - `providerManager.ts`: a `custom` branch beside the Ollama one (REQ-1.1/1.2);
    `isAiAvailable` true when the base URL is set; `clearProviderClients` clears it.
  - `SettingsPage.tsx`: the option and the card (REQ-1.3/1.4), inline URL message (REQ-2.5).
  - `helpContent.ts`: the AI-provider card mentions custom endpoints and OpenRouter.
  - `CLAUDE.md`: command list and AI-provider gotcha.
- **Decision & alternatives** — (a) Rust command with the rule in Rust (decision 2). (b) The
  http plugin as upstream did — the rule would live only in TypeScript, the plugin follows
  redirects by default and its scope already admits every https host, so nothing enforces
  "loopback only for http". (c) Add the host to the CSP — impossible at runtime. (a).
- **Data / schema** — none; three settings keys. No migration.
- **Failure modes** — a validator bug that is too strict blocks a legitimate endpoint (the
  inline message says why; the table test pins the accepted forms); one that is too loose
  admits `http:` off-loopback (the same table pins the refusals). A Rust error surfaces as
  the Test Connection reason through `describeError`. A response over the cap or after the
  timeout fails that one request; the SDK's own retries (default 2) re-invoke `ai_fetch`.

## Tasks (risk-first)
- [ ] 1. Rust: `validate_ai_url` table test red (accepts `https://api.deepseek.com/v1`,
  `http://localhost:1234/v1`, `http://127.0.0.1:8080`, `http://127.9.9.9`, `http://[::1]:11434`,
  `HTTPS://Host`; refuses `http://api.example.com`, `http://10.0.0.5`, `http://192.168.1.2`,
  `ftp://x`, `javascript:alert(1)`, `https://user:pw@host`, `https://`, `not a url`), then the
  function. — REQ-2.1
- [ ] 2. Rust: `fetch_with_limits` against a `std::net::TcpListener` on 127.0.0.1 — a 302 is
  refused without its `Location`; a 200 echo shows only allow-listed headers reached the
  server and only allow-listed ones came back; a body over a 1 KiB test cap is refused;
  `PUT` is refused before any connection. — REQ-2.2/2.3/2.4
- [ ] 3. TS: `rustFetch.test.ts` (invoke mocked) — request shape, `Response` reconstruction,
  malformed result refused, a non-string body refused; `isAllowedAiUrl` mirrors task 1. — REQ-3.2, 2.5
- [ ] 4. TS: `customProvider.test.ts` (OpenAI mocked) — base URL normalised, `fetch` is
  `rustFetch`, placeholder key when blank, cache keyed on all three. — REQ-1.1
- [ ] 5. TS: `providerManager.test.ts` — `custom` resolved, `NOT_CONFIGURED` without a URL,
  `isAiAvailable`, cache, clear. — REQ-1.1/1.2
- [ ] 6. Settings card, help text, `CLAUDE.md`; the CSP/capability tests stay green
  untouched. — REQ-1.3/1.4, 2.6
- [ ] 7. LOG.md; vault rows 9 and #265; HANDOFF pin after merge.

## Done when
`cargo test --locked` and `cargo clippy --all-targets --locked -- -D warnings` green with
the new module; `npm run test`, `tsc`, `graph:check`, `docs:check` green; CI green on the
merge commit; `git diff fe67514 -- src-tauri/tauri.conf.json src-tauri/capabilities` empty.
Manual, optional (needs the running app): set a custom URL to an OpenRouter key — Test
Connection reports "Connected!"; set `http://example.com/v1` — the inline message refuses it.

## Rollback
`git revert` of the squash commit. A user who selected `custom` keeps `ai_provider = custom`
in settings; the reverted `getActiveProviderName` treats an unknown value as Claude (its
existing fallback), so nothing breaks — the custom card just disappears until re-landed.

## Threat pass (Tier 2)
- **Assets:** the API key for the custom endpoint; the contents of the user's mail sent as
  prompts; the machine's network position (loopback and LAN services); the webview.
- **Entry points:** the settings page (user-typed URL, key, model); the `ai_fetch` IPC
  command (callable by the app's own JavaScript only — `script-src 'self'`, and email HTML
  renders in a sandboxed iframe without scripts); the endpoint's responses (attacker-
  controlled if the user chose a hostile URL or the host is compromised).
- **What an attacker gains and what stops it:**
  - *SSRF from the webview to internal services* — the scheme/host rule (https anywhere,
    http loopback only) is checked in Rust on every call; redirects are never followed, so a
    friendly https host cannot bounce the request to `http://169.254.169.254/` or a loopback
    admin port; only `GET`/`POST` with four request headers, so no `Host`/cookie smuggling.
    Reach is not wider than the http plugin's existing scope (`https://*`, loopback http).
  - *Credential leakage* — the key goes in `authorization` only, to the validated host, over
    TLS except on loopback; Rust logs host and status; TypeScript shows errors through
    `describeError`'s redaction; the key is stored via `setSecureSetting` (AES-GCM) like the
    other keys.
  - *Hostile model output / prompt injection* — unchanged boundary: responses are parsed by
    the same `modelOutput` guards; the result's transport shape is zod-validated first.
  - *Resource exhaustion* — 8 MiB body cap, 120 s timeout, no streaming.
- **Residual, accepted:** the user may choose any https host, including a malicious one, and
  their mail content goes there — inherent in "bring your own endpoint" and no different
  from choosing any provider; https to private LAN addresses is allowed by decision 2; DNS
  rebinding cannot reach a loopback https service because the certificate must match the
  typed host name.

## Review
Three legs on the PR, diffs from committed SHAs: Gemini 3.7 Flash (APPROVE WITH NITS), Grok
4.6 (CHANGES REQUESTED — twelve minutes; on Jim's rule of 2026-09-02 a second Gemini model
replaced it as the standing second leg) and Gemini 3.1 Pro (APPROVE WITH NITS). Every finding
verified before adoption; dispositions on the PR and in LOG.md. Added by review: the
parser-differential URL tables on both sides, 304 passed through, request body and header
caps, redaction in the cards' `catch`, the empty-user-info form, `Request`-input bodies, a
shared client, the abort race.

## Approval
Jim, 2026-09-02 (decision 2: *"validated Rust fetch command, https/loopback only, no
off-host redirects, CSP stays tight"*) and the 2026-09-03 instruction (*"#209/#265 … Tier 2
… plan in the PR before code"*). The plan is this file, committed before the code.
