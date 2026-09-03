The full brief was offloaded. I’ll read that file first so the review uses the complete plan and diffs, then I’ll write the verdict from that material only.**APPROVE**

## Findings

- **L1.** `scripts/check-dist.mjs`, hashed-asset guards. Empty `index.html` is not “missing” (`existsSync` succeeds) but `readFileSync` returns `""`, which is falsy, so both hashed-asset tests are skipped and a script-less empty page yields exit 0. Quote:
  ```
  return readFileSync(p, "utf8");
  …
  if (index && !/\/assets\/[^"']+-[A-Za-z0-9_-]{6,}\.js\b/.test(index)) {
  if (index && !/\/assets\/[^"']+-[A-Za-z0-9_-]{6,}\.css\b/.test(index)) {
  ```
  `vite build &&` will not emit this today; the bypass is the checker, not current output. Treat missing and empty the same: `if (index == null || index === "" || !regex)` (or return `null` from `page()` on missing and always run the hashed tests when the file exists).

- **N1.** `scripts/check-dist.mjs`, script loop. Only the opening tag is inspected:
  ```
  const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
  for (const tag of scripts) {
    if (!/\bsrc\s*=/.test(tag)) failures.push(`${name}: inline <script> found: ${tag}`);
  }
  ```
  `<script src="/assets/main-XXXX.js">alert(1)</script>` passes. HTML ignores that body when `src` is set, so `script-src 'self'` is not actually bypassed; the comment’s “inline `<script>`” claim is broader than the check. `type="module"` is not asserted (REQ-2.2 does not require it). Tighten only if you want the body empty when `src` is present.

- **N2.** `.github/workflows/ci.yml`, after `npm ci`:
  ```
  - name: Registry signatures and attestations
    run: npm audit signatures
  ```
  Placement is right (needs `node_modules`). Unattested packages do not fail it (plan §8; 242 signatures / 118 attestations). Uninstalled optional platform packages do not fail it (commit 3 CI green on Ubuntu with 20 `@typescript/typescript-*` in the lockfile). A registry or attestation-log outage/rate-limit still fails the job for a reason other than a bad signature. That is the approved REQ-2.4 gate running fail-closed; do not `continue-on-error`.

No High or Medium on the diff. `__dirname` in `vite.config.ts` left unchanged is what REQ-1.4 requires; the Vite 8 notice is a follow-up, not a miss.

## Requirements

- **REQ-1.1** met. `baseUrl` gone; `"@/*": ["./src/*"]`; no `ignoreDeprecations`. Same resolution as `baseUrl: "."` + `"src/*"` (both relative to the tsconfig directory). Vite/vitest `resolve.alias` untouched; `include`/`exclude` untouched. `tsc --noEmit` 0 on 5.9.3 confirms the 233 `@/` imports. Brief status + `ci.yml` in this commit are specified by the header / REQ-2.4 / Design, not extra deps.
- **REQ-1.2** met (lockfile: only the `typescript` entry).
- **REQ-1.3** met (lockfile: 20 `@typescript/typescript-<os>-<arch>` only).
- **REQ-1.4** met. `vite ^8.2.2`, `@vitejs/plugin-react ^6.1.1`; `rollupOptions` → `rolldownOptions` with the same `input` map (splashscreen.html emitted, so the key and shape are right); `target` / `cssTarget` exactly `["chrome107", "edge107", "firefox104", "safari16"]` (Vite 7 Baseline: Chrome 107, Edge 107, Firefox 104, Safari 16.0; `safari16` is 16.0 in that grammar). `vitest` / `@tailwindcss/vite` / `jsdom` unchanged. `check-dist` + the `build` script line are REQ-2.2/Design for this same commit, not an extra bump.
- **REQ-1.5** met. Transitive set matches the measured commit-4 delta; `esbuild`, `@typescript/typescript6`, `@types/node` absent; end count 316 as in §5 (start 375 vs §5’s 355 is the current tree, not extra adds).
- **REQ-1.6** not verifiable (landing method). Revert sets in the plan remain valid: 4 alone; 3 alone; 3+2; 1 only after 3 and 2 are gone.
- **REQ-2.1** met locally on every commit (`tsc` 0, vitest 174 / 2,341 unchanged, `build`, graph/docs, `npm audit` prod+full 0, signatures clean). CI green on commits 1–3. Commit 4 CI not verifiable (in progress). Plan parenthetical 173 / 2,299 is the throwaway/base snapshot; this tree is 174 / 2,341 and stable across the four commits.
- **REQ-2.2** met. Script wired as `tsc && vite build && node scripts/check-dist.mjs`; measurements green (51 files / 2.19 MB vs Vite 7 26 / 2.21 MB; one `<script>` with `src` in index.html, none in splashscreen.html). Windows: filesystem via `node:path`; URL checks look at `/assets/` in HTML, not OS separators. Residual: L1/N1 above.
- **REQ-2.3** not verifiable (debug bundle “recorded separately”). This is the only check that exercises Rolldown/Oxc/Lightning CSS output and the CJS-interop default; do not merge on the dev-server smoke.
- **REQ-2.4** met (frontend job, after `npm ci`, before `tsc`).
- **REQ-2.5** not verifiable (PR body not in this material).
- **REQ-3.1** met (`@typescript/typescript6` not present).
- **REQ-3.2** met (no `build.minify`/`cssMinify: 'esbuild'`, no `legacy.inconsistentCjsInterop`; `esbuild` not re-added).

## Threat pass

Honoured. Native Microsoft binaries (unattested) and VoidZero Rolldown bindings (SLSA v1) match the inventory Jim approved; signatures step is in CI from commit 1; lockfile is still the frozen-`npm ci` record; no `.npmrc`; no new install scripts; CSP / `tauri.conf.json` / `src/` / Rust untouched; REQ-2.2 is the inline-script shape check only and is not claimed as a compromised-bundler defense. Second `lightningcss` under `vite/node_modules` is the §5 residual already named.
