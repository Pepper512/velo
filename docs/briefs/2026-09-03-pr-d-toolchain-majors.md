# SPEC-PR-D — Build-toolchain majors: TypeScript 5.9 → 6.0 → 7.0, then Vite 8

- **Task:** Move the frontend toolchain across two TypeScript majors and one Vite major, in
  four commits landed by rebase merge so the legal revert sets below are real: the `baseUrl`
  config fix on today's compiler; TypeScript 6.0.3; TypeScript 7.0.2 (the native compiler);
  Vite 8.2.2 with `@vitejs/plugin-react` 6.1.1 and the browser floor pinned.
- **Tier:** **2** — dependency changes (`CLAUDE.md`: any dependency change is Tier 2; the
  house rule is *ask before adding any dependency*). **This document is the plan only.** No
  package.json, lockfile or config line changes until Jim approves it.
- **Base:** `main` @ `a27398f` (code pin `e05f6cd`, #75). Every version and measurement below
  was taken on 2026-09-03 against this tree.
- **Status:** **approved by Jim, 2026-09-03 (see §Approval); being built on branch
  `pr-d-toolchain-majors`, four commits, rebase merge.** Amended
  after both review legs on PR #77 (Gemini 3.8 Flash High, Grok 4.6; dispositions in LOG.md)
  and a throwaway build of the whole stack (§5).
- **Source:** the vault's `2026-09-01_Velo_Dependency-Audit.md` (PR D, the TypeScript and Vite
  rows, "What not to upgrade yet"); `docs/audits/2026-09-01-optimize-audit.md` P18 and the
  Batch G row (each bump its own dependency block, Jim approves); ROADMAP §3.
- **Effort:** S–M · 1 day of agent work once approved; four gated commits plus a production
  bundle smoke.

## Outcome

`tsc --noEmit`, the test suite and `vite build` run on TypeScript 7 and Vite 8 with the same
results as today, and the packaged app's production bundle is exercised before merge. The
browser floor the bundle is built for stays Vite 7's unless Jim lifts it. Each commit can be
reverted within the sets named under *Rollback*. (The native type check is also about three
times faster on this tree — an observation for the PR body, not a success criterion.)

## What exists, verified at `a27398f`

1. **Versions today** (`package.json`, all caret ranges, lockfile pins): `typescript ^5.9.3`
   (installed 5.9.3), `vite ^7.3.6`, `@vitejs/plugin-react ^5.1.3`, `vitest ^4.1.11`,
   `@tailwindcss/vite ^4.3.3`, `jsdom ^30.0.1`, `@testing-library/react ^16.3.3`; `engines.node
   >=24`; CI runs Node 24 on `ubuntu-latest` (`ci.yml:24,37,51,56,127`). No `@types/node`, no
   `.npmrc`. The `build` script is `tsc && vite build`; `test` is `vitest run`.
   **`tsconfig.json` sets `"noEmit": true`** (line 12) and no `outDir`, `incremental`,
   `composite`, `plugins` or `tsBuildInfoFile` — so `tsc` in the `build` script type-checks
   and emits nothing, on every compiler version in this plan. **CI's frontend job runs
   `npm ci`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`** in that order
   (`ci.yml:40-47`), so every gate below except the packaged-app smoke is CI-backed. Nothing
   under `scripts/` or `src/` imports `typescript` as a library (`graph:check` and
   `docs:check` are plain Node scripts), and there is no ESLint.
2. **What the registry offers** (`npm view`, 2026-09-03): `typescript` latest **7.0.2**
   (dist-tag `latest`), **6.0.3** the last 6.x (the `beta` dist-tag still points at
   `6.0.0-beta`, so `6.0.3` must be named explicitly); `vite` **8.2.2**; `@vitejs/plugin-react`
   **6.1.1** (peer `vite ^8.0.0` only); `vitest` 4.1.11 is current and its peer is `vite ^6 ||
   ^7 || ^8`; `@tailwindcss/vite` 4.3.3's peer is `vite ^5.2 || ^6 || ^7 || ^8`. Vite 8 and the
   plugin require Node `^20.19 || >=22.12` — satisfied.
3. **TypeScript 7.0.2 is the native (Go) compiler in the `typescript` package.** It installs
   `tsc`; its manifest lists 20 per-platform binary packages
   (`@typescript/typescript-<os>-<arch>`) under **both** `dependencies` and
   `optionalDependencies` — npm's documented rule is that an `optionalDependencies` entry
   overrides the same name in `dependencies`, so `npm ci` installs the host's binary and
   skips the rest. **This repository already relies on that mechanism:** today's lockfile
   carries 51 `@esbuild/*` and `@rollup/rollup-*` platform packages the same way, and CI's
   Linux `npm ci` has been green on a lockfile generated on macOS since PR A. The published
   targets cover the fork's: darwin arm64/x64, linux x64/arm64 (glibc), win32 x64/arm64;
   musl is not published and is not a target. `@typescript/typescript6` (6.0.2 on the
   registry) is the JavaScript fallback that provides `tsc6`. TypeScript 6.0 is explicitly
   the bridge release: what 6.0 deprecates, 7.0 removes.
4. **Measured on today's tsconfig with the compilers fetched into the npx cache only:**
   - **6.0.3: one error** — `TS5101: Option 'baseUrl' is deprecated and will stop functioning
     in TypeScript 7.0` (`tsconfig.json:19`).
   - **7.0.2: two errors** — `TS5102: Option 'baseUrl' has been removed` and `TS5090:
     Non-relative paths are not allowed` (`tsconfig.json:21`, the `"@/*": ["src/*"]` mapping).
   - **With `baseUrl` removed and `"@/*": ["./src/*"]`, in a throwaway copy of the config:
     5.9.3, 6.0.3 and 7.0.2 all exit 0.** That is the only `tsconfig.json` item on this tree
     (the 233 files importing through `@/` need no change; the alias also lives in
     `vite.config.ts` and `vitest.config.ts` as `resolve.alias`, unaffected).
   - **`tsc --showConfig` on 5.9.3 versus 6.0.3:** the only differences are the strict-family
     flags 5.9 lists because `strict: true` expands them and 6.0 no longer lists because they
     are its defaults; no option flips value. `allowSyntheticDefaultImports` is already `true`
     under `moduleResolution: bundler`; `esModuleInterop` affects emit only and this config
     never emits — so 6.0's forced-`true` on both changes no checking result here (and the
     dry run's exit 0 is the corroboration, not the argument). `types` now defaults to `[]`:
     `src/vite-env.d.ts` references `vite/client` explicitly and the three `@types/*` packages
     (react, react-dom, react-transition-group) are reached by import. `noUncheckedSideEffectImports`
     now `true`: the one side-effect import in `src/`, `./styles/globals.css`, resolves through
     `vite/client`'s `*.css` declaration. `lib` `DOM.Iterable` merged into `DOM`: accepted.
     `target` is explicit (`ES2021`), so the new `es2025` default does not apply.
5. **Measured in a throwaway copy of the project** (rsync of the tree without `node_modules`,
   `dist`, `.git`, `src-tauri/target`, `src-tauri/gen`; `typescript ^7.0.2`, `vite ^8.2.2`,
   `@vitejs/plugin-react ^6.1.1` set, the `baseUrl` fix applied, `build.rollupOptions` renamed
   to `build.rolldownOptions`; `npm install` **in the copy only**):
   - **`tsc --noEmit` on 7.0.2 against Vite 8's `vite/client` types: exit 0.**
   - **`vite build`: exit 0** in 0.45 s. `dist/index.html` carries exactly one
     `<script type="module" crossorigin src="/assets/main-<hash>.js">` and one hashed
     stylesheet; `dist/splashscreen.html` is emitted (the `rolldownOptions.input` rename took
     effect) and carries no script or stylesheet because the page has none; **0 inline
     `<script>` tags** across `dist/*.html`; 49 files under `dist/assets`, 2.3 MB. Two warning
     classes, both pre-existing patterns: seven `INEFFECTIVE_DYNAMIC_IMPORT` notes (modules
     both statically and dynamically imported — Rolldown says so where Rollup was silent) and
     one chunk over 500 kB.
   - **`vitest run` under Vite 8 + plugin-react 6: 173 files, 2,298 passed, 1 skipped** — the
     skip is `capabilities.test.ts`'s manifest-guard test, which `skipIf`s when
     `src-tauri/gen/` is absent, as it is in the copy. Every hook-using component test
     (Sidebar, the F-3 renderer and banner tests) passed, which is the check that the plugin's
     dropped `resolve.dedupe` changes nothing here; `npm ls react` shows one copy, every
     occurrence deduped.
   - **Lockfile: 355 → 316 packages.** Babel leaves with plugin-react 5 (3 `@babel/*` packages
     remain, pulled by something else). **Native or platform packages: 76 → 72** —
     `@esbuild/*` (25) and `@rollup/rollup-*` (20) leave; `rolldown` with 16 `@rolldown/*`
     packages (the platform bindings and `pluginutils`), `@oxc-project/types` (types only —
     Oxc's native code ships inside the Rolldown bindings) and `@typescript/typescript-*`
     (20) arrive; `lightningcss-*` and `@tailwindcss/oxide-*` were already there through
     Tailwind v4 (Vite 8 adds a second `lightningcss` version beside Tailwind's). **`@types/node`
     is not added.** **Packages with install scripts: `better-sqlite3` and `fsevents` — both
     present today; nothing new runs a postinstall.** `npm audit signatures`: 118 packages
     with verified attestations, no invalid signature; `npm audit`: 0.
6. **Vite 8 is Rolldown + Oxc instead of Rollup + esbuild** (`vite.dev/guide/migration`):
   `build.rollupOptions` → `build.rolldownOptions`; the `esbuild` option → `oxc`; JS minifier
   Oxc, CSS minifier Lightning CSS; CJS default-import interop made consistent between dev and
   build (`legacy.inconsistentCjsInterop` restores the old behaviour); **default browser
   targets move from Vite 7's Baseline floor (Chrome 107, Edge 107, Firefox 104, Safari 16.0)
   to the current one (Chrome 111, Safari 16.4)**; `optimizeDeps.esbuildOptions` deprecated.
   `vite.config.ts` uses one affected option, `build.rollupOptions.input` for the two pages;
   no `esbuild`, `optimizeDeps`, `manualChunks`, `watch.chokidar` or `build.target`. **Bundler
   plugins in the tree:** `@vitejs/plugin-react` and `@tailwindcss/vite` — both exercised by
   the throwaway build. **Bundler-owned source patterns:** none — `src/` has no
   `import.meta.glob`, `new URL(…, import.meta.url)`, `?raw`/`?url`/`?worker` imports, workers
   or WASM (the `new URL(...)` hits are runtime URL parsing in `phishingDetector.ts` and
   `openLink.ts`); `import.meta.env` is used in two files and typed by `vite/client`.
7. **`@vitejs/plugin-react` 6 drops Babel for Oxc**, removes the `babel`, `jsxRuntime`,
   `fastRefresh` and `jsxPure` options, changes the default `exclude` (from the regex
   `/node_modules/` to the array `[/\/node_modules\//]` — the same set, now a list), and **no
   longer adds `react`/`react-dom` to `resolve.dedupe`**. Velo calls `react()` with no options
   in both `vite.config.ts` and `vitest.config.ts`; §5's test run is the measurement.
8. **Provenance, from the registry:** `vite@8.2.2`, `@vitejs/plugin-react@6.1.1`, `rolldown`
   and every `@rolldown/binding-*` publish SLSA v1 provenance; **`typescript@6.0.3`,
   `typescript@7.0.2` and the `@typescript/typescript-*` binaries publish none** (registry
   signature only — Microsoft's practice); `lightningcss` and its platform packages publish
   none either, and they are already in today's tree through Tailwind v4. `npm audit signatures` verifies what
   is attested and **says nothing about unattested packages** — it is a check on the attested
   set, not a clean bill for the rest.
9. **Out of the blast radius:** the Rust side (untouched); the `landing/` package (its own
   `package.json` on Vite 7 / TypeScript 5.9 / plugin-react 5, not an npm workspace, out of
   ADR-000's scope); Tauri (`@tauri-apps/cli` only runs `npm run dev`/`build`); the CSP
   (`tauri.conf.json` untouched).

## Requirements

- **REQ-1** As the maintainer I want each step as its own commit, landed so it stays one.
  - REQ-1.1 Commit 1 SHALL, on today's `typescript` 5.9.3, remove `baseUrl` and make `paths`
    relative (`"@/*": ["./src/*"]`) — a config-only commit that proves the alias still works
    before any compiler moves. `ignoreDeprecations` SHALL NOT be used.
  - REQ-1.2 Commit 2 SHALL bump `typescript` to **6.0.3** and nothing else.
  - REQ-1.3 Commit 3 SHALL bump `typescript` to **7.0.2** and nothing else.
  - REQ-1.4 Commit 4 SHALL bump `vite` to **8.2.2** and `@vitejs/plugin-react` to **6.1.1**,
    rename `build.rollupOptions` to `build.rolldownOptions` in `vite.config.ts`, **pin the
    browser floor to Vite 7's** (`build.target` and `build.cssTarget` set to `["chrome107",
    "edge107", "firefox104", "safari16"]`, so the emitted syntax and CSS do not change with
    the bundler), and change nothing else. `vitest`, `@tailwindcss/vite`, `jsdom` SHALL stay at
    their current versions. **Lifting the floor to Vite 8's default is a separate decision
    for Jim** (it needs the minimum webview named per platform: WKWebView on the oldest
    supported macOS, WebView2 on Windows, WebKitGTK on the Flatpak runtime and the Linux
    packages).
  - REQ-1.5 No other dependency SHALL be added or removed, **except** what the four bumps
    bring transitively as measured in §5 (the `@typescript/typescript-*`,
    `@rolldown/binding-*` and `@oxc-project/*` platform packages, and Babel leaving). In
    particular `esbuild`, `@typescript/typescript6` and `@types/node` SHALL NOT be added; the
    lockfile diff of each commit SHALL be checked against that list.
  - REQ-1.6 The PR SHALL be landed by **rebase merge, not squash**, so the four commits
    survive on `main` (the repository allows all three merge methods; linear history is
    kept). `npm update` is out of bounds on these four packages until the majors are boring.
- **REQ-2** As the maintainer I want proof, not a claim, at every step.
  - REQ-2.1 After each commit: `./node_modules/.bin/tsc --noEmit` exit 0; `npx vitest run`
    with the same file and test counts as before the commit (173 / 2,299 at the base); `npm
    run build`; `npm run graph:check` and `npm run docs:check` green; `npm audit --omit=dev
    --audit-level=high` and `npm audit --audit-level=high` both 0; `npm audit signatures`
    with no invalid signature; the lockfile diff matching REQ-1.5; **CI green on the exact
    commit** (its frontend job on `ubuntu-latest` runs `tsc`, `vitest` and the build — the
    second platform for the lockfile and the native binaries).
  - REQ-2.2 After commit 4, **an automated check in the build** (a small Node script run
    after `npm run build`, part of that commit): `dist/index.html` and `dist/splashscreen.html`
    exist; every `<script>` in either has a `src` (the CSP is `script-src 'self'`);
    `index.html` references at least one hashed `/assets/*.js` and one hashed `/assets/*.css`.
    The `dist/` file count and size are recorded beside Vite 7's for the PR body.
  - REQ-2.3 After commit 4, **the production bundle runs in the app before merge:** `npm run
    tauri build -- --debug` (the debug profile, because the release profile does not build on
    this machine — `HANDOFF.md`), and the packaged app opens a thread, a pop-out and the
    composer from that bundle. The agent builds; Jim runs it if the agent cannot drive the
    GUI. **Commit 4 does not merge on a green dev-server smoke alone** — `npm run tauri dev`
    serves unbundled modules and never exercises Rolldown, Oxc or Lightning CSS output.
  - REQ-2.4 Commit 1 SHALL also add an `npm audit signatures` step to `ci.yml`'s frontend
    job (one line, Tier 1 CI wiring, approved as part of this plan): from then on the
    attested set is verified on every run, not by hand.
  - REQ-2.5 The PR body SHALL record `tsc --noEmit` wall time before and after (an
    observation), the transitive counts per commit (§5 gives the expected end state), and
    the list of native packages present after commit 4.
- **REQ-3** As Jim I want the escape hatches named, not used.
  - REQ-3.1 `@typescript/typescript6` (`tsc6`) is the fallback if the native binary misbehaves
    on a platform; it is **not** added by this PR.
  - REQ-3.2 `build.minify: 'esbuild'`, `build.cssMinify: 'esbuild'` and
    `legacy.inconsistentCjsInterop` are the Vite 8 escape hatches; the first two need `esbuild`
    as a devDependency (a dependency add — Jim's call), the third hides a real interop
    difference and would be a recorded deviation, not a silent flag. The throwaway run (§5)
    gave no reason to reach for any of them.

## Not doing

- **Not bumping `vitest`, `jsdom`, `@testing-library/*`, `@tailwindcss/vite`** — current and
  compatible; each is its own line in the audit if ever needed.
- **Not touching `landing/`** — separate package, out of scope (ADR-000).
- **Not adding `@types/node`** — Vite 8 lists it as an optional peer; nothing in `src/`
  needs Node types, `vite.config.ts` is outside `tsconfig.json`'s `include`, and §5 shows
  npm does not pull it.
- **Not lifting the browser floor** — REQ-1.4 pins Vite 7's; lifting it is Jim's decision
  with the webview minimums named.
- **Not pinning exact versions in `package.json`** — the house style is caret ranges with the
  lockfile as the pin and `npm ci` as the gate; REQ-1.6 freezes these four by instruction.
- **Not enabling the React Compiler** (`compiler: true` / `babel-plugin-react-compiler`) — a
  behaviour change with its own brief.
- **Not changing the CSP, `tauri.conf.json`, or any Rust.**

## Design

- **Commit 1 — the config fix, on 5.9.3.** `tsconfig.json`: delete `"baseUrl": "."`, set
  `"paths": { "@/*": ["./src/*"] }`. `ci.yml`: the `npm audit signatures` step (REQ-2.4).
  Measured: 5.9.3 exits 0 on this config.
- **Commit 2 — TypeScript 6.0.3.** `package.json`: `"typescript": "^6.0.3"`. Nothing else:
  §4 shows every other 6.0 default is already met or explicitly set.
- **Commit 3 — TypeScript 7.0.2.** `package.json`: `"typescript": "^7.0.2"`. The lockfile
  gains the 20 platform packages (optional; the host's is installed). `tsc` is now the native
  binary; the `build` script is unchanged and still emits nothing.
- **Commit 4 — Vite 8.2.2 + plugin-react 6.1.1 + the floor pin.** `package.json`: `"vite":
  "^8.2.2"`, `"@vitejs/plugin-react": "^6.1.1"`. `vite.config.ts`: `build.rollupOptions` →
  `build.rolldownOptions` (same `input` map); `build.target` and `build.cssTarget` as in
  REQ-1.4. `vitest.config.ts`: unchanged (it imports the same plugin and `vitest/config`). The
  `scripts/check-dist.mjs` assertion (REQ-2.2) and its `package.json` script line. Expect the
  JS/CSS output to differ byte-wise (different minifiers); REQ-2.2 is the CSP-relevant check
  and REQ-2.3 the behavioural one.
- **Legal revert sets** (`git revert`, rebase-merged history): commit 4 alone; commit 3 alone
  (back to 6.0.3, which accepts the relative `paths`); commits 3 and 2 together (back to
  5.9.3 on the fixed config); commit 1 only after 3 and 2 are gone (7.0.2 refuses `baseUrl`,
  6.0.3 warns on it); all four. **Not** commit 1 or 2 alone while 3 is on the tree.
- **Decision & alternatives** — (a) four rebase-merged commits in one PR (chosen; the vault's
  PR D shape with the config fix split out so the compiler bumps are pure). (b) TypeScript 7
  directly from 5.9: the vault's "what not to upgrade yet" — 7.0 hard-errors on what 6.0
  deprecates; the measurement confirms the same one-line fix serves both, so the bridge costs
  one extra commit and buys a clean bisect. (c) Vite 8 first: pointless coupling — the
  TypeScript commits do not touch Vite. (d) One squash: loses every revert set above.
- **Data / schema** — none.
- **Failure modes** — a type error only the native checker reports (its type ordering is
  deterministic and cannot be switched off): none on this tree today (§5); fix the type, not
  the config, if one appears later. A Vite 8 build difference that changes runtime behaviour
  (CJS interop, minifier): not seen by the test suite (jsdom does not run the production
  bundle), which is why REQ-2.3 exists; the escape hatches are named above. A platform
  without a native TypeScript binary: `@typescript/typescript6` — not this fork's targets.
  Stale caches after a bump or a revert (`node_modules/.vite`, `node_modules/.vitest`): both
  key on the lockfile and config hash, and the rollback clears them anyway.

## Tasks (risk-first, after approval)
- [ ] 1. Commit 1 (config fix on 5.9.3 + the CI `npm audit signatures` step), REQ-2.1 gate.
- [ ] 2. Commit 2 (TypeScript 6.0.3), REQ-2.1 gate.
- [ ] 3. Commit 3 (TypeScript 7.0.2), REQ-2.1 gate, the wall-time and native-package records.
- [ ] 4. Commit 4 (Vite 8.2.2 + plugin-react 6.1.1, `rolldownOptions`, the floor pin,
  `check-dist`), REQ-2.1 and REQ-2.2 gates, the `dist/` record; **REQ-2.3 — the debug
  bundle built and the app run on it** (Jim drives the GUI if the agent cannot).
- [ ] 5. Two review legs on the PR (Gemini 3.8 Flash High via `agy`, Grok 4.6 via the `grok`
  CLI), dispositions on the PR and in LOG.md; rebase merge on green under the standing rule.
- [ ] 6. LOG.md; the vault audit's landing log; `CLAUDE.md` if it names the toolchain
  versions; HANDOFF pin after merge.

## Done when
Every REQ-2 check green on each of the four commits and on `main` after the rebase merge;
the `check-dist` assertion green; `npm audit` full and prod 0; `npm audit signatures` clean in
CI; file and test counts unchanged; the browser floor pinned; **the packaged debug bundle
opened a thread, a pop-out and the composer** (REQ-2.3) — that is the check that closes the
PR, not the dev server.

## Rollback
`git revert` within the legal sets above, then `rm -rf node_modules/.vite node_modules/.vitest
dist && npm ci` — the two caches are state that survives a revert and are cleared rather than
trusted. No schema, nothing persisted by the app. Reverting commit 4 restores `rollupOptions`
and the unpinned floor with it.

## Threat pass (Tier 2 — supply chain)
- **Assets:** the developer machine and CI runner at build time (a build tool runs arbitrary
  code there); the built bundle (what ships to the webview); the lockfile as the record of
  what was built.
- **What is new, and its trust:** **prebuilt native executables on every build machine** —
  20 `@typescript/typescript-*` (Microsoft, **no provenance attestation**) and the
  `@rolldown/binding-*` family (VoidZero, **SLSA v1 provenance on every package**, verified
  by `npm audit signatures`). Today's toolchain already runs prebuilt native code
  (`@esbuild/*`, `@rollup/rollup-*`, `lightningcss-*`, `@tailwindcss/oxide-*` — 76 such
  packages), so the *class* is not new; the *publishers* of both new families are. **This is
  a new trust decision for Jim, stated plainly:** approving this plan accepts unattested
  native compiler binaries from Microsoft, and attested native bundler binaries from
  VoidZero, on the dev machine and CI. None of them declares an install script (§5); they
  are loaded when `tsc` or `vite` runs.
- **Blast radius:** a compromised toolchain package is **build-time code execution on the
  dev machine and CI, and the ability to alter the shipped JS and CSS** — which `script-src
  'self'` will load, because it is the app's own bundle. The inline-script check (REQ-2.2) is
  a CSP-integrity check only; it does not defend against a compromised bundler, and the plan
  does not claim it does. The runtime surface (`src/`, Rust, CSP, capabilities) is untouched.
- **Provenance and the attested set:** `vite` and `@vitejs/plugin-react` carry SLSA v1
  provenance (the house standard names SLSA v1.2; v1 is the residual, not a block).
  `npm audit signatures` (REQ-2.4, in CI from commit 1) verifies registry signatures and
  the attestations that exist; it is silent on unattested packages, which is why the
  inventory above is written down rather than delegated to it. It also talks to the registry
  and the Sigstore transparency log on every run, so a registry outage or rate limit fails
  the step for a reason unrelated to a bad signature — a known transient failure mode; re-run
  the job rather than remove the step. It runs after `npm ci`, so it does not prevent an
  install script from executing; the two packages with install scripts (`better-sqlite3`,
  `fsevents`) are pre-existing and listed in §5.
- **Lockfile:** `npm ci` in CI is the frozen-lockfile gate; every new package enters
  `package-lock.json` in the commit that needs it, and REQ-1.5's list is what a reviewer
  diffs against. No `.npmrc` omits optional dependencies.
- **Transitive cost:** measured (§5): 355 → 316 lockfile packages; native packages 76 → 72;
  Babel gone; `@types/node` not pulled.
- **Removal path:** each commit reverts within the sets above; the JavaScript compiler
  (`@typescript/typescript6`) and Rollup-era Vite 7 remain on the registry.
- **Residual:** the unattested Microsoft binaries (accepted above) and the already-present
  unattested Lightning CSS binaries; SLSA v1 rather than v1.2; the production bundle is
  exercised by a person, not a test (REQ-2.3).

## Review
Two legs on this plan — Gemini 3.8 Flash High via `agy` and Grok 4.6 via the `grok` CLI,
both done, dispositions on PR #77 and in LOG.md — then two legs on the code PR. Diffs from
committed SHAs. Findings verified against source before adoption.

## Approval
- Plan approved by: **Jim** date: **2026-09-03** (decision 2 of the 2026-09-03 next-session
  prompt: "APPROVED, including every decision its Approval section names (native-binary trust,
  Vite 7 browser floor, npm audit signatures step, rebase merge)") — **required before any
  package.json, lockfile or config change.** Approving it also decides: the native-binary trust in §Threat pass; the
  browser floor stays Vite 7's (REQ-1.4); the `npm audit signatures` CI step (REQ-2.4); the
  rebase merge (REQ-1.6).
