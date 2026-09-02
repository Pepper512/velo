## Verdict
**CHANGES REQUESTED**

---

## Numbered Findings

### 1. HIGH — Privacy: Sanitizer bypass via non-`src` image triggers under `img-src https:`
- **File & Function:** `src/renderer/EmailRenderer.tsx` (`stripRemoteImages`), `src/utils/sanitize.ts` (DOMPurify configuration)
- **Concern:** The architectural shift delegates all privacy gating to `stripRemoteImages`. If the sanitizer only rewrites `img[src]` to `data-blocked-src`, alternative HTML/CSS image triggers will bypass the block and load over HTTPS.
- **Exact Scenario:** An incoming email contains:
  1. `<img srcset="https://tracker.example.com/pixel.png 1x">` or `<picture><source srcset="https://tracker.example.com/pixel.png"><img src="..."></picture>`
  2. Inline styles or `<style>` blocks: `<div style="background-image: url('https://tracker.example.com/bg.png')">` (governed by `img-src` because `style-src 'unsafe-inline'` is enabled)
  3. SVG images: `<svg><image href="https://tracker.example.com/img.png" /></svg>` or `<svg><image xlink:href="..." /></svg>`
  4. `<video poster="https://tracker.example.com/poster.jpg">` or `<input type="image" src="https://tracker.example.com/btn.png">`
  5. `<body background="https://tracker.example.com/bg.png">` or `<table background="...">`
  
  When "Block Remote Images" is **ON**, `stripRemoteImages` leaves these attributes intact. With `img-src` previously restricted to Gravatar/Google, the webview blocked them. With `img-src https:`, the webview executes the network requests immediately upon opening the email.
- **Consequence:** Remote tracking pixels and images load automatically even when "Block Remote Images" is enabled, leaking the user's IP address, open timestamp, and email read status.
- **Fix:** Ensure `stripRemoteImages` and the DOMPurify hook strip/rewrite all image triggers (`srcset`, `<source>`, `style` with `url()`, SVG `<image href/xlink:href>`, `poster`, `input[type=image]`, and `background` attributes) before widening `img-src` to `https:`.

---

### 2. MEDIUM — Test: `Object.fromEntries` masks duplicate CSP directives
- **File & Function:** `src/config/tauriConfig.test.ts` (top-level `csp` parser)
- **Concern:** `Object.fromEntries` overwrites duplicate keys with the last occurrence.
- **Exact Scenario:** If `tauri.conf.json` contains duplicate directives (e.g., `default-src 'self'; img-src https://evil.com; img-src 'self' data: https:`), browsers ignore the second directive (CSP Level 3 § 5.1). However, `Object.fromEntries` discards the first directive and retains the second, causing the test to report a false pass.
- **Consequence:** A malformed or accidentally duplicated CSP directive in `tauri.conf.json` can pass CI while behaving insecurely or brokenly in the webview.
- **Fix:** Parse the directive list as an array of pairs and assert that no directive name is duplicated before converting to a map:
  ```ts
  const rawDirectives = (config.app.security.csp as string)
    .split(";")
    .map((d: string) => d.trim())
    .filter(Boolean)
    .map((d: string) => {
      const [name, ...sources] = d.split(/\s+/);
      return [name, sources] as const;
    });

  const names = rawDirectives.map(([name]) => name);
  expect(names).toEqual([...new Set(names)]);
  ```

---

### 3. LOW — Security: Inline CSS with `url()` is enabled by `style-src 'unsafe-inline'` + `img-src https:`
- **File & Function:** `src-tauri/tauri.conf.json` (`security.csp`)
- **Concern:** Combination of `'unsafe-inline'` in `style-src` and `https:` in `img-src` permits CSS-based network exfiltration.
- **Exact Scenario:** If email styling allows unchecked CSS properties (or CSS `@import` / `url()`), CSS rules can reference remote HTTPS endpoints on element interaction or state changes.
- **Consequence:** Attackers can exfiltrate UI state or trigger delayed tracking without using `<img>` tags.
- **Fix:** Verify that DOMPurify forbids or strips CSS `url()` expressions when remote images are blocked, and strictly sanitizes `<style>` tags.

---

### 4. NIT — Test: Top-level file execution in test suite
- **File & Function:** `src/config/tauriConfig.test.ts`
- **Concern:** JSON parsing and CSP transformation run during module load rather than inside a `beforeAll` or test assertion block.
- **Exact Scenario:** If `tauri.conf.json` is missing or `config.app.security.csp` is undefined, the test file crashes during suite collection rather than producing a clean test failure.
- **Consequence:** Obscures failure reporting in test runners.
- **Fix:** Move the extraction and parsing inside `beforeAll()` or within the individual `it()` blocks.

---

## Questions for Author

1. Does `stripRemoteImages` currently handle `srcset`, `<picture><source>`, inline `style="background: url(...)"`, SVG `<image>`, `<input type=image>`, and `<video poster>`? If not, are those handled in a separate sanitizer hook?
2. Has `blob:` been intentionally omitted from `img-src`? (Confirming: keeping `blob:` out is correct to prevent untrusted blob URL injection unless client-side generated object URLs are needed).

---

## What Is Good

- **Correct Transport Restriction:** REQ-1.2 and REQ-1.3 explicitly forbid `http:`, preventing cleartext network leaks and MITM interception.
- **Strict Sandbox & Boundary Isolation:** The iframe preserves `sandbox="allow-same-origin"` without `allow-scripts`, and `script-src 'self'` / `connect-src` remain tightly pinned.
- **Pinning Unchanged Directives:** `tauriConfig.test.ts` comprehensively asserts all other CSP directives (`default-src`, `script-src`, `style-src`, `font-src`, `frame-src`, `connect-src`), preventing accidental scope creep.
