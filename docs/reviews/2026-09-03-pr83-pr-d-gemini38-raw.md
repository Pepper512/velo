CHANGES REQUESTED

### Findings

* **H1**: Process gate / unverified requirements — REQ-2.1 and REQ-2.3 incomplete before merge.
  * **File and hunk**: Section "Gates observed locally on every commit" and Task 4 / "Done when".
  * **Lines**:
    > "CI (Ubuntu, Node 24) is green on commits 1–3 at the time of writing; commit 4's run is in progress. The packaged debug bundle (REQ-2.3) is being built; its result is recorded separately."
  * **What is wrong**: Commit 4 CI is still running, and the packaged debug bundle smoke test has not been executed or recorded.
  * **Why**: The plan's "Done when" and REQ-2.3 explicitly mandate: *"Commit 4 does not merge on a green dev-server smoke alone"* and requires CI green on the exact commit on Ubuntu. Merging before these gates pass violates the Tier 2 process.
  * **Concrete change**: Block merge until commit 4 CI finishes green and the packaged debug bundle is verified opening a thread, a pop-out, and the composer.

* **M1**: `scripts/check-dist.mjs` — `<script>` tag regex has false negatives (`data-src`), misses inline script body content, and false positives on HTML comments.
  * **File and hunk**: `scripts/check-dist.mjs:26-31`
  * **Lines**:
    ```javascript
    for (const [name, html] of [["index.html", index], ["splashscreen.html", splash]]) {
      const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
      for (const tag of scripts) {
        if (!/\bsrc\s*=/.test(tag)) failures.push(`${name}: inline <script> found: ${tag}`);
      }
    }
    ```
  * **What is wrong**:
    1. `/\bsrc\s*=/` matches `data-src=` because `-` is a non-word character `\W`, creating a word boundary `\b` before `s`. A tag like `<script data-src="foo">alert(1)</script>` erroneously passes.
    2. Only the opening `<script ...>` tag is evaluated. A tag with a valid `src` that also contains inline code (`<script src="/assets/main.js">maliciousCode()</script>`) is not detected.
    3. An empty attribute `<script src="">alert(1)</script>` matches `src=` and passes.
    4. Commented-out scripts (`<!-- <script>alert(1)</script> -->`) are matched by `/<script\b[^>]*>/gi` and cause false positive failures.
  * **Why**: REQ-2.2 exists to protect CSP integrity (`script-src 'self'`). The current check allows inline executable code through if paired with `data-src` or an inner text block.
  * **Concrete change**: Replace the tag loop with a check matching full `<script>` blocks, asserting valid `src` attributes (`(?:\s|^)src\s*=\s*['"][^'"]+['"]`) and empty tag bodies:
    ```javascript
    const scriptBlocks = html.match(/<script\b[\s\S]*?<\/script>/gi) ?? [];
    for (const block of scriptBlocks) {
      const openTag = block.match(/<script\b[^>]*>/i)?.[0] ?? "";
      const content = block.replace(/<script\b[^>]*>/i, "").replace(/<\/script>/i, "").trim();
      const hasValidSrc = /\s+src\s*=\s*["'][^"']+["']/i.test(openTag);
      if (!hasValidSrc || content.length > 0) {
        failures.push(`${name}: invalid or inline <script> found: ${block}`);
      }
    }
    ```

* **M2**: `vite.config.ts` — `build.target` and `build.cssTarget` do not match Vite 7's documented default.
  * **File and hunk**: `vite.config.ts:18-20`
  * **Lines**:
    ```typescript
    target: ["chrome107", "edge107", "firefox104", "safari16"],
    cssTarget: ["chrome107", "edge107", "firefox104", "safari16"],
    ```
  * **What is wrong**: The comment and REQ-1.4 claim this pins the browser floor to "Vite 7's". Vite 7's documented default for `build.target` is `'modules'` (`['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']`). Setting Baseline 2022 (`chrome107`, `safari16`) lifts the browser floor by ~2 years over Vite 7's default. Additionally, `cssTarget` defaults to `build.target` in Vite, making `cssTarget: [...]` redundant.
  * **Why**: The unconfigured base tree targeted Chrome 87 / Safari 14. Raising the floor to Chrome 107 / Safari 16 permits Rolldown/Oxc/LightningCSS to emit syntax and CSS that will fail on older webviews supported under Vite 7, contradicting the stated plan rationale: *"so the emitted syntax and CSS do not change with the bundler"*.
  * **Concrete change**: Either pin explicitly to Vite 7's `'modules'` default:
    ```typescript
    target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"],
    ```
    and remove `cssTarget`, or update the brief and ADR to acknowledge that Jim approved lifting the browser floor to Baseline 2022.

* **L1**: `scripts/check-dist.mjs` — Asset regexes assume leading absolute path `/assets/`.
  * **File and hunk**: `scripts/check-dist.mjs:33-38`
  * **Lines**:
    ```javascript
    if (index && !/\/assets\/[^"']+-[A-Za-z0-9_-]{6,}\.js\b/.test(index)) {
      failures.push("index.html references no hashed /assets/*.js");
    }
    if (index && !/\/assets\/[^"']+-[A-Za-z0-9_-]{6,}\.css\b/.test(index)) {
      failures.push("index.html references no hashed /assets/*.css");
    }
    ```
  * **What is wrong**: The regex strictly requires a leading `/assets/`.
  * **Why**: If Vite's `base` is configured relatively (`./` or `""`), or if bundler output references relative assets (`assets/...` or `./assets/...`), the check emits a false failure.
  * **Concrete change**: Allow optional relative prefixes:
    ```javascript
    if (index && !/(?:\/|\.\/)?assets\/[^"']+-[A-Za-z0-9_-]{6,}\.js\b/.test(index)) {
    ```

* **L2**: `.github/workflows/ci.yml` — Step placement and network failure mode of `npm audit signatures`.
  * **File and hunk**: `.github/workflows/ci.yml:43-45`
  * **Lines**:
    ```yaml
    - name: Registry signatures and attestations
      run: npm audit signatures
    ```
  * **What is wrong**: `npm audit signatures` queries external registry and Sigstore transparency endpoints. Any npm registry 5xx, rate limit, or network timeout fails CI for reasons unrelated to bad signatures. Furthermore, placed after `npm ci`, any malicious postinstall lifecycle scripts (e.g. `better-sqlite3`) have already executed before the signatures are audited.
  * **Why**: While conforming to REQ-2.4, it introduces external availability coupling in CI and cannot prevent install-time execution without `npm ci --ignore-scripts`.
  * **Concrete change**: Document registry availability as a known transient CI failure mode, or run `npm audit signatures` before running dependencies with scripts.

* **N1**: `vite.config.ts` — `__dirname` deprecation warning under Vite 8.
  * **File and hunk**: `vite.config.ts:22-23`
  * **Lines**:
    ```typescript
    main: path.resolve(__dirname, "index.html"),
    splashscreen: path.resolve(__dirname, "splashscreen.html"),
    ```
  * **What is wrong**: Emits deprecation notice under Vite 8 (`__dirname in vite.config.ts is unsupported by the future configLoader: 'native'`).
  * **Why**: While noted in the measurement as a follow-up, `vite.config.ts` is already being edited in commit 4. Node 24 supports `import.meta.dirname`.
  * **Concrete change**: Replace `path.resolve(__dirname, ...)` with `path.resolve(import.meta.dirname, ...)`.

---

### Plan Requirements Assessment

* **REQ-1.1**: **Met**. `baseUrl` removed, `"@/*": ["./src/*"]` made relative, no `ignoreDeprecations`. (Also added `ci.yml` step and brief update per REQ-2.4).
* **REQ-1.2**: **Met**. Bumps `typescript` to `^6.0.3` and lockfile touched only `typescript`.
* **REQ-1.3**: **Met**. Bumps `typescript` to `^7.0.2` and lockfile added only the 20 native platform packages.
* **REQ-1.4**: **Met**. Bumps `vite` to `^8.2.2`, `@vitejs/plugin-react` to `^6.1.1`, renames `rolldownOptions`, sets target/cssTarget, leaves vitest/tailwind/jsdom untouched.
* **REQ-1.5**: **Met**. No extra dependencies added (grepped clean for `esbuild`, `@typescript/typescript6`, and `@types/node`). Lockfile reduced from 375 to 316 packages.
* **REQ-1.6**: **Met**. Structured as four distinct commits for rebase merge.
* **REQ-2.1**: **Not verifiable from this material**. Commits 1–3 local and CI gates green, but commit 4 CI run on Ubuntu Node 24 is still in progress.
* **REQ-2.2**: **Met**. `scripts/check-dist.mjs` implemented and wired to `npm run build`, verified locally (51 files / 2.19 MB).
* **REQ-2.3**: **Not verifiable from this material**. Packaged debug bundle build and manual runtime smoke (thread, pop-out, composer) is in progress / recorded separately.
* **REQ-2.4**: **Met**. `npm audit signatures` added to `ci.yml` in commit 1.
* **REQ-2.5**: **Met**. Wall clock times (3.19 s → 0.40 s), package counts, and native platform lists recorded.
* **REQ-3.1**: **Met**. `@typescript/typescript6` not added.
* **REQ-3.2**: **Met**. No escape hatches (`build.minify: 'esbuild'`, `legacy.inconsistentCjsInterop`) introduced.

---

### Threat Pass Adherence

* **Honoured**:
  * Unattested native Microsoft binaries and attested VoidZero binaries match the inventory accepted by Jim in the plan.
  * `npm audit signatures` verifies registry signatures and Sigstore attestations from commit 1 onwards.
  * No new dependencies with postinstall scripts were introduced.
* **Dishonoured / Incomplete**:
  * **Timing of CSP gate (REQ-2.2 / Blast radius)**: The threat model states that REQ-2.2 serves as the CSP-integrity check on generated HTML. Because `scripts/check-dist.mjs` fails to detect inline code inside `<script src="...">...</script>` or scripts with `data-src=`, it does not fully honour the CSP verification guarantee promised in the Threat pass.
