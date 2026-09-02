# SPEC-280 — Local AI on a non-default port is blocked by the http scope, and the test hides why

- **Task:** Let the Tauri http plugin reach `http://127.0.0.1:<port>` and `http://localhost:<port>`
  (Ollama 11434, LM Studio 1234, any local port) without opening plain http to every host on
  every port; and make the AI "Test Connection" button report *why* it failed instead of a bare
  "Connection failed".
- **Tier:** **2** — `src-tauri/capabilities/*` is a named Tier-2 file in `CLAUDE.md`; the scope
  is a security boundary. Plan in the PR before code; threat pass and rollback below; both
  cross-vendor legs (ADR-004).
- **Base:** `main` @ `11a034b` (code pin `b95468e`). Every citation below was grepped at that pin.
- **Status:** building — branch `f280-http-scope`; Jim's instruction 2026-09-02 (*"add
  http://127.0.0.1:* and http://localhost:* (not *:*) and stop swallowing the testConnection
  error"*). The build seat owns the PR and the merge.
- **Source:** upstream avihaymenahem/velo#280 (macOS, Ollama 0.32 on 127.0.0.1:11434 — every
  endpoint answers 200 with curl, Velo shows "Connection failed" before any request); the fork's
  2026-09-01 triage ranked it **P1** and verified the URLPattern port semantics in Node. Bug-fix
  queue item 2.
- **Effort:** S · half a day.

## Outcome

Pointing Velo's Local AI at `http://127.0.0.1:11434` (or any local port) connects. When a
connection test fails, the settings page shows the reason the client saw — a scope refusal, a
refused TCP connection, a 401 — so the user can act on it.

## The defect, verified in the fork

1. **The Ollama client goes through the http plugin.** `providers/ollamaProvider.ts:2` imports
   `fetch` from `@tauri-apps/plugin-http` and hands it to the OpenAI SDK (`:15`), so every
   request is checked against the plugin's scope, not the webview's CSP. (The CSP already lists
   the local ports — `tauri.conf.json:42` `connect-src … http://localhost:11434 http://localhost:1234
   http://127.0.0.1:11434 http://127.0.0.1:1234` — which is why it looked allowed.)
2. **The scope is `http://*` and `http://*/*`** (`capabilities/default.json:68-69`). The plugin
   matches with the `urlpattern` crate (`tauri-plugin-http-2.6.0/src/scope.rs:9-33`), i.e. the
   WHATWG URLPattern algorithm, where a pattern with no port matches **only the default port**.
   Verified with Node 26's URLPattern (same algorithm):

   | pattern | `127.0.0.1:11434/v1/models` | `localhost:11434/api/tags` | `localhost:1234/v1/models` | `example.com/x` | `evil.example:8080/x` |
   |---|---|---|---|---|---|
   | `http://*` | ✗ | ✗ | ✗ | ✓ | ✗ |
   | `http://*/*` | ✗ | ✗ | ✗ | ✓ | ✗ |
   | `http://127.0.0.1:*` | ✓ | ✗ | ✗ | ✗ | ✗ |
   | `http://127.0.0.1:*/*` | ✓ | ✗ | ✗ | ✗ | ✗ |
   | `http://localhost:*/*` | ✗ | ✓ | ✓ | ✗ | ✗ |

   So a local server on any non-80 port is refused by the plugin before a socket is opened — the
   reporter's "fails before sending HTTP request".
3. **The reason never reaches the user.** `openAiCompatible.ts:48-58` (`testConnection`) catches
   everything and returns `false`; `claudeProvider.ts:25-35` and `geminiProvider.ts:125-137` do
   the same; `aiService.ts:246-253` catches again and returns `false`; `SettingsPage.tsx:1129-1147`
   (Ollama) and `:1264-1287` (the second AI card) render the boolean as "Connection failed". Four
   layers, no message.

## Requirements

- **REQ-1** As a user with a local model server I want Velo to reach it on its port.
  - REQ-1.1 THE SYSTEM SHALL allow http requests to `127.0.0.1` and `localhost` on **any** port
    (`http://127.0.0.1:*`, `http://127.0.0.1:*/*`, `http://localhost:*`, `http://localhost:*/*`).
  - REQ-1.2 THE SYSTEM SHALL NOT widen plain-http access to other hosts: `http://*` stays as it
    is (default port only) and no `http://*:*` entry is added — a remote host on an odd port over
    plain http is still refused.
  - REQ-1.3 A test SHALL pin REQ-1.1 and REQ-1.2 against the committed capability file using the
    same URLPattern semantics the plugin uses, so a future edit cannot silently reopen or
    re-close either.
- **REQ-2** As a user I want to know why a connection test failed.
  - REQ-2.1 WHEN a provider's connection test fails THE SYSTEM SHALL return the failure reason
    (the error's message) alongside the boolean, through `aiService.testConnection`, to the
    settings page.
  - REQ-2.2 THE SYSTEM SHALL render that reason next to "Connection failed" on both AI cards.
  - REQ-2.3 Callers that only need the boolean (`writingStyleService.isAutoDraftEnabled`) keep
    their behaviour.
  - REQ-2.4 The reason is display text only: never interpolated into a request, a query or a
    shell, and never logged with credentials (the SDK error messages carry none).

## Not doing

- Widening the CSP — it already lists the local ports; anything beyond that is #197/#209
  territory (Jim's decisions 1 and 2 on 2026-09-02).
- Custom OpenAI-compatible base URLs on arbitrary hosts (#209/#265): a separate decision.
- Retries or a cancel button on the connection test (#204's second half, queue item 12).

## Design

- **Scope** — four entries added to `capabilities/default.json` under `http:default`. Nothing
  removed.
- **Result type** — `ConnectionTestResult = { ok: true } | { ok: false; error: string }` in
  `ai/types.ts`; `AiProviderClient.testConnection()` returns it. The three implementations
  (`openAiCompatible` — shared by OpenAI, Ollama, Copilot, xAI — `claudeProvider`,
  `geminiProvider`) turn the caught error into `{ ok: false, error }` with a shared
  `describeError(err)` helper (`Error.message`, else `String(err)`). `aiService.testConnection`
  returns the result and turns its own failure (no provider configured, bad key format) into the
  same shape. `SettingsPage` keeps its `"success" | "fail"` state and adds the reason.
- **Decision & alternatives.** (a) Change the return type everywhere — recommended: one shape,
  honest at every layer, seven test assertions to update. (b) Keep `boolean` and add a side
  channel (`lastError`) — hides state in a module and two callers would disagree. (c) Make
  providers throw and catch only in `aiService` — the provider tests are written against
  "false rather than throwing" and the interface would lie about half its implementations. (a).
- **Failure modes** — a wrong scope entry either keeps blocking (the reporter's state, now with
  a visible reason) or over-allows (caught by REQ-1.3's negative case). A malformed error object
  becomes `String(err)`; the page never throws on it.

## Tasks (risk-first)
- [ ] 1. `src/config/capabilities.test.ts` — reads the committed `default.json`, builds every
  `http:default` allow entry with `URLPattern`, asserts the five URLs from the table above
  (positive: the three local ones; negative: `http://evil.example:8080/x`; and that
  `http://example.com/x` still matches via the untouched `http://*`). Red first. — REQ-1.1–1.3
- [ ] 2. The four scope entries. — REQ-1.1
- [ ] 3. `ConnectionTestResult`; the three providers; `aiService`; `writingStyleService`; tests
  updated to assert the reason (`{ ok: false, error: "401 Unauthorized" }`), red first. — REQ-2
- [ ] 4. `SettingsPage`: reason rendered under "Connection failed" on both cards. — REQ-2.2
- [ ] 5. LOG.md; vault row; HANDOFF pin after merge.

## Done when
`npm run test` green including the new config test; `tsc` clean; CI green on the merge commit.
Manual, optional: point Local AI at a running Ollama on 127.0.0.1:11434 and press Test —
"Connected!"; stop Ollama — "Connection failed: … ECONNREFUSED".

## Rollback
`git revert` of the squash commit. No data or schema. Reverting restores the block and the
bare message; nothing else.

## Threat pass (Tier 2)
- **Asset:** the boundary that keeps webview code from talking plain http to arbitrary hosts.
- **Entry points:** every `@tauri-apps/plugin-http` `fetch` call (today: the Ollama provider);
  the scope is what decides.
- **What an attacker gains:** with `http://*:*` they could have reached any host on any port over
  plain http from injected webview code; **not added**. With the four loopback entries they gain
  loopback on any port — the machine's own services. That is exactly what Local AI needs and is
  the same reach the CSP already grants for two of those ports. REQ-1.3's negative test keeps
  the remote case closed.
- **Mitigations in this change:** loopback-only widening; a committed test on the scope; the
  error reason is rendered as text, never interpreted.
- **Residual:** any local service on any port becomes reachable to webview code over http.
  Recorded as the accepted cost of Local AI. A local service that *redirects* elsewhere is
  not followed: the Ollama client's fetch passes `maxRedirections: 0` to the plugin, because
  the plugin checks its scope on the URL it is given, not on each redirect (Grok Q3 on #56).

## Open for Jim — the test oracle (Grok M1 on #56)

`capabilities.test.ts` builds the allow entries with **Node's** `URLPattern`; the plugin matches
with the **`urlpattern` crate**. Both implement the WHATWG algorithm and CI runs Node 24 (where
`URLPattern` is global), but it is a regression net, not a proof the plugin accepts the request.
The plugin's `scope` module is private, so the only way to test with the plugin's own matcher
is a Rust test with `urlpattern` as a **dev-dependency** (already in the graph through the
plugin, same version) — a dependency addition, which is Jim's call. Until then the reporter's
re-test on a real Ollama is the end-to-end proof.

## Review
Both cross-vendor legs on the PR (Gemini 3.7 via `agy`, Grok 4.6 via `grok` CLI), diffs
generated from committed SHAs. Dispositions on the PR and in LOG.md.

## Approval
Jim, 2026-09-02, by instruction (the scope entries named, `*:*` excluded, the un-swallow asked
for); the plan is this file, committed before the code on the same branch.
