### Review of SPEC-PR-D: Build-toolchain majors (TypeScript 5.9 → 6.0 → 7.0, Vite 8)

---

### Findings

#### 1. HIGH — The tests that prove it / Tasks
- **Section:** Tasks §5 & Done when / REQ-2.1
- **Exact sentence/claim:** `"Manual, Jim: npm run tauri dev smoke (open a thread, a pop-out, the composer) — recorded as open until done."`
- **Why it is wrong or insufficient:** `npm run tauri dev` boots the Vite development server (unbundled, esbuild/Oxc dev transforms, dynamic module resolution). It does **not** execute or validate the Rolldown production bundle or the Oxc/Lightning CSS minified output in `dist/`. Furthermore, `vitest run` executes tests against source files in JSDOM, and `npm run build` only asserts that the compiler exits zero and emits two HTML files. There is **zero automated or manual test anywhere in this plan that executes the Vite 8 production build inside a Tauri webview**. If Rolldown asset loading, chunking, CJS interop, or minification breaks the production desktop app, every gate in REQ-2.1 and the manual smoke test will pass cleanly while shipping a completely broken binary.
- **Concrete fix:** Add a mandatory gate before merge: run `npm run tauri build` (or build a release binary) and execute the packaged desktop app to smoke-test thread rendering, pop-out windows, and the composer against the actual `dist/` production bundle.

---

#### 2. HIGH — Supply-chain threat pass / What exists
- **Section:** §3 What exists & Threat pass (Lockfile / Transitive cost)
- **Exact sentence/claim:** `"its dependencies are 20 per-platform binary packages (@typescript/typescript-<os>-<arch> — also listed under optionalDependencies, so npm ci installs the host's one)."`
- **Why it is wrong or insufficient:** Packages cannot be simultaneously listed in `dependencies` and `optionalDependencies` to achieve platform filtering. In npm, any package listed under `dependencies` is required; npm will attempt to install all 20 platform binaries, failing on non-matching platforms with `EBADPLATFORM`. Furthermore, if the author generates and updates `package-lock.json` on a local macOS arm64 host, `npm ci` on Linux x64 CI (`ubuntu-latest` as defined in `ci.yml:37,56,127`) will fail with `EINTEGRITY` or `ENOENT` unless the lockfile captures the resolved metadata and integrity hashes for all target platform variants. The author only verified `npx -p` locally on macOS and never validated cross-platform lockfile generation or `npm ci` execution on Linux.
- **Concrete fix:** Correct the manifest description to confirm native binaries reside strictly in `optionalDependencies`. Add an explicit verification step in Task 2 to test `npm ci` in a Linux container or on a CI branch to guarantee that the multi-platform optional dependencies in `package-lock.json` resolve without error on `ubuntu-latest`.

---

#### 3. HIGH — Rollback
- **Section:** Rollback
- **Exact sentence/claim:** `"No state, no schema, nothing persisted."`
- **Why it is wrong or insufficient:** This claim is false. Vite and Vitest maintain persistent on-disk compilation and pre-bundling caches in `node_modules/.vite` and `node_modules/.vitest`. If Commit 3 is reverted from Vite 8 (Rolldown / Oxc / Lightning CSS) back to Vite 7 (Rollup / esbuild), Vite 7 will read the cache artifacts left behind by Vite 8, leading to cryptic transform errors or silent bundling corruptions in local development and persistent CI cache runners.
- **Concrete fix:** Update the Rollback section to require explicitly clearing build and dependency caches upon revert: `git revert ... && rm -rf node_modules/.vite node_modules/.vitest dist && npm ci`.

---

#### 4. HIGH — Supply-chain threat pass / CI Gates
- **Section:** Threat pass (Residual) & REQ-2.1
- **Exact sentence/claim:** `"the fork's CI has no npm audit signatures step — running it by hand is this PR's gate, and adding it to ci.yml is a one-line follow-up Jim can approve separately."`
- **Why it is wrong or insufficient:** Under Jim's Official Development Rules (CI/CD security gates: *"`npm audit signatures` on every build (Shai-Hulud class)"*), running signature checks locally "by hand" and punting CI enforcement to an unapproved future follow-up directly violates the standard. This PR introduces native binaries across two major ecosystems (`@typescript/*`, `@rolldown/*`, `@oxc-*`). Relying on local developer attestations without a blocking CI gate undermines the security model.
- **Concrete fix:** Either make adding the `npm audit signatures` step to `.github/workflows/ci.yml` an approved explicit prerequisite commit within this PR, or include it in Commit 1 so all toolchain updates are verified by the automated CI gate on every run.

---

#### 5. MEDIUM — What breaks / Design (Commit 3)
- **Section:** §7 What exists & Design (Commit 3)
- **Exact sentence/claim:** `"npm ls react react-dom shows a single copy today (every occurrence deduped), so the dropped dedupe changes nothing here."`
- **Why it is wrong or insufficient:** The author conflates physical on-disk package deduplication in `node_modules` with bundler runtime instance deduplication. `@vitejs/plugin-react` previously injected `resolve.dedupe: ['react', 'react-dom']` specifically so that in SSR and Vitest test environments (where `@testing-library/react` and application code interact across CJS/ESM boundaries), Vite resolves React to a single instance. Dropping this deduplication frequently causes the React runtime to throw `"Invalid hook call: Hooks can only be called inside the body of a function component"` in test suites even when `npm ls` shows only one copy on disk. The author never ran Vitest under plugin-react 6 to measure this.
- **Concrete fix:** Explicitly evaluate whether `resolve.dedupe: ['react', 'react-dom']` must be added to `vite.config.ts` and `vitest.config.ts`. Run `vitest run` against tests exercising React hooks to prove that instance duplication does not occur under plugin-react 6.

---

#### 6. MEDIUM — Version path / Scope discipline
- **Section:** Requirements (REQ-1.1) & Design (Commit 1)
- **Exact sentence/claim:** `"Commit 1 SHALL bump typescript to 6.0.3 and, in the same commit, remove baseUrl and make paths relative (@/*: [./src/*])."`
- **Why it is wrong or insufficient:** Conflating the `baseUrl` configuration refactor with the major TypeScript 6.0 compiler upgrade impairs bisectability. Relative paths in `paths` (`"@/*": ["./src/*"]`) have been fully supported since TypeScript 5.0. If path resolution breaks an external tool (such as `graph:check` or path aliases in Vite/Vitest), a maintainer bisecting Commit 1 cannot tell whether the failure was caused by the TS 6.0 compiler or the config rewrite.
- **Concrete fix:** Split Commit 1 into two steps:
  1. Commit 1a: Remove `baseUrl` and convert `paths` to relative on the currently installed `typescript@5.9.3`, proving all tests and check scripts pass.
  2. Commit 1b: Upgrade `typescript` to `6.0.3` (pure compiler bump).

---

#### 7. MEDIUM — What breaks / Verification
- **Section:** §6 What exists & Not doing
- **Exact sentence/claim:** `"vite.config.ts is outside tsconfig.json's include."`
- **Why it is wrong or insufficient:** Because `vite.config.ts` (and `vitest.config.ts`) are excluded from `tsconfig.json`, `npx tsc --noEmit` does not type-check either configuration file. In Commit 3, renaming `build.rollupOptions` to `build.rolldownOptions` and modifying config options is completely unchecked by the compiler. Any misspelled option or invalid Rolldown configuration will escape `tsc --noEmit` without error.
- **Concrete fix:** Add a verification check for the config files (e.g., via `tsc --noEmit -p tsconfig.node.json` or a dedicated type-check/lint script that includes `vite.config.ts` and `vitest.config.ts`) to ensure Rolldown configuration options are strictly type-validated.

---

#### 8. MEDIUM — What breaks / Platform compatibility
- **Section:** §6 What exists
- **Exact sentence/claim:** `"default browser targets move to Baseline (Chrome 111, Safari 16.4)"`
- **Why it is wrong or insufficient:** Velo is a desktop Tauri v2 application targeting macOS, Linux, and Windows. On Linux, Tauri relies on WebKitGTK, which on older or LTS enterprise distributions may not support all features assumed by Baseline (Safari 16.4). If `vite.config.ts` leaves `build.target` unset, Rolldown may emit modern ECMAScript/CSS syntax that fails to parse or execute in the system WebKitGTK webview.
- **Concrete fix:** In Commit 3, verify whether `vite.config.ts` requires an explicit, platform-appropriate `build.target` setting compatible with Tauri v2's minimum supported webviews (e.g., targeting Safari 15/WebKitGTK parity for Linux and Chrome 105 for Windows).

---

#### 9. LOW — The tests that prove it
- **Section:** Requirements (REQ-2.2)
- **Exact sentence/claim:** `"After commit 3: the built dist/index.html and dist/splashscreen.html SHALL contain no inline <script> (the CSP is script-src 'self'), and the dist/ size and file list SHALL be recorded beside the Vite 7 build's for the PR body."`
- **Why it is wrong or insufficient:** REQ-2.2 is stated as a requirement, but it has no automated gate. Relying on manual inspection in the PR body means that if Vite 8 / Rolldown introduces an inline preload shim, runtime polyfill, or inline script tag, CI will not catch it.
- **Concrete fix:** Add a simple automated test or script assertion to REQ-2.1: `! grep -q '<script' dist/*.html || grep -q 'src=' dist/*.html` (or an equivalent HTML check) to fail the build automatically if inline script tags are emitted.

---

#### 10. LOW — What breaks
- **Section:** §4 What exists
- **Exact sentence/claim:** `"So the only migration item on this tree is the baseUrl line..."`
- **Why it is wrong or insufficient:** The author bases this conclusion solely on running `tsc --noEmit` from the npx cache. `tsc --noEmit` tests only TypeScript type syntax and declarations; it does not exercise bundling, transform plugins, minification, CSS processing, or test execution. Concluding that `baseUrl` is "the only migration item on this tree" ignores the vast majority of Vite 8 and Rolldown breaking changes.
- **Concrete fix:** Rephrase the claim to clarify that `baseUrl` was the only syntax/config error identified *specifically within `tsconfig.json` during compiler dry runs*, and acknowledge the bundling and runtime migration surfaces evaluated in subsequent sections.

---

#### 11. NIT — Scope discipline / Process
- **Section:** Done when
- **Exact sentence/claim:** `"Done when: ... Manual smoke open for Jim."`
- **Why it is wrong or insufficient:** A task cannot be "Done" while a required verification step remains "open." Leaving the manual smoke open allows the task to be marked complete prior to verification.
- **Concrete fix:** Change to: `"Done when: Every REQ-2 check green in CI, and manual smoke test of the production build confirmed and signed off by Jim."`

---

### Verdict

**CHANGES REQUESTED**

*Summary for author:* The plan demonstrates solid initial research into TypeScript 6/7 and Vite 8 breaking changes, but suffers from three critical defects: (1) it provides no test or gate that ever executes the Vite 8 production bundle in a Tauri webview, relying instead on `tauri dev` which only tests the dev server; (2) it relies on a flawed understanding of npm multi-platform native package resolution and leaves Linux CI lockfile compatibility untested; and (3) it falsely claims the rollback is completely stateless, ignoring Vite and Vitest build caches. Address the high-severity items and split the `baseUrl` change into a pre-bump commit before resubmitting for Jim's approval.
