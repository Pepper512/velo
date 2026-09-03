# SPEC-PR-D — Build-toolchain majors: TypeScript 5.9 → 6.0 → 7.0, then Vite 8

- **Task:** Move the frontend toolchain across two TypeScript majors and one Vite major, in
  three commits that each stand alone: TypeScript 6.0.3 with the `baseUrl` fix; TypeScript
  7.0.2 (the native compiler); Vite 8.2.2 with `@vitejs/plugin-react` 6.1.1.
- **Tier:** **2** — dependency changes (`CLAUDE.md`: any dependency change is Tier 2; the
  house rule is *ask before adding any dependency*). **This document is the plan only.** No
  package.json, lockfile or config line changes until Jim approves it.
- **Base:** `main` @ `a27398f` (code pin `e05f6cd`, #75). Every version and measurement below
  was taken on 2026-09-03 against this tree.
- **Status:** **draft — awaiting Jim's approval. No code, no dependency change.**
- **Source:** the vault's `2026-09-01_Velo_Dependency-Audit.md` (PR D, the TypeScript and Vite
  rows, "What not to upgrade yet"); `docs/audits/2026-09-01-optimize-audit.md` P18 and the
  Batch G row (each bump its own dependency block, Jim approves); ROADMAP §3.
- **Effort:** S · ½ day of agent work once approved; three gated commits.

## Outcome

`tsc --noEmit`, the test suite and `vite build` run on TypeScript 7 and Vite 8 with the same
results as today; the type check is measurably faster (native compiler); nothing user-visible
changes. Either commit can be reverted alone if it misbehaves.

## What exists, verified at `a27398f`

1. **Versions today** (`package.json`, all caret ranges, lockfile pins): `typescript ^5.9.3`
   (installed 5.9.3), `vite ^7.3.6`, `@vitejs/plugin-react ^5.1.3`, `vitest ^4.1.11`,
   `@tailwindcss/vite ^4.3.3`, `jsdom ^30.0.1`, `@testing-library/react ^16.3.3`; `engines.node
   >=24`; CI runs Node 24 (`ci.yml:37,56,127`). No `@types/node`. The `build` script is
   `tsc && vite build`; `test` is `vitest run`.
2. **What the registry offers** (`npm view`, 2026-09-03): `typescript` latest **7.0.2**
   (dist-tag `latest`), **6.0.3** the last 6.x (the `beta` dist-tag still points at
   `6.0.0-beta`, so `6.0.3` must be named explicitly); `vite` **8.2.2**; `@vitejs/plugin-react`
   **6.1.1** (peer `vite ^8.0.0` only); `vitest` 4.1.11 is current and its peer is `vite ^6 ||
   ^7 || ^8`; `@tailwindcss/vite` 4.3.3's peer is `vite ^5.2 || ^6 || ^7 || ^8`. Vite 8 and the
   plugin require Node `^20.19 || >=22.12` — satisfied.
3. **TypeScript 7.0.2 is the native (Go) compiler in the `typescript` package.** It installs
   `tsc`; its `dependencies` are 20 per-platform binary packages
   (`@typescript/typescript-<os>-<arch>` — also listed under `optionalDependencies`, so
   `npm ci` installs the host's one). `@typescript/typescript6` (6.0.2 on the registry) is the
   JavaScript fallback that provides `tsc6`. TypeScript 6.0 is explicitly the bridge release:
   what 6.0 deprecates, 7.0 removes.
4. **Measured on today's tsconfig, nothing installed into the repo** (`npx -p typescript@…
   tsc --noEmit`, both compilers fetched into the npx cache only):
   - **6.0.3: one error** — `TS5101: Option 'baseUrl' is deprecated and will stop functioning
     in TypeScript 7.0` (`tsconfig.json:19`).
   - **7.0.2: two errors** — `TS5102: Option 'baseUrl' has been removed` and `TS5090:
     Non-relative paths are not allowed` (`tsconfig.json:21`, the `"@/*": ["src/*"]` mapping).
   - **With `baseUrl` removed and `"@/*": ["./src/*"]`, in a throwaway copy of the config: 6.0.3
     exits 0 and 7.0.2 exits 0.** Wall time for the full `--noEmit`: 5.9.3 **3.3 s**, 7.0.2
     **0.9 s**.
   So the only migration item on this tree is the `baseUrl` line, and the 233 files that import
   through `@/` need no change (the alias also lives in `vite.config.ts` and `vitest.config.ts`
   as `resolve.alias`, which is unaffected).
5. **TypeScript 6.0's new defaults, checked against today's config:** `strict` (already
   `true`), `module` (already `ESNext`), `target` (explicit `ES2021`, so the new `es2025`
   default does not apply), `types` now `[]` (`src/vite-env.d.ts` references `vite/client`
   explicitly; the three `@types/*` packages — react, react-dom, react-transition-group — are
   reached by import, not auto-inclusion), `noUncheckedSideEffectImports` now `true` (the one
   side-effect import in `src/`, `./styles/globals.css`, resolves through `vite/client`'s
   `*.css` declaration — this is why the dry run passes), `rootDir` (irrelevant under
   `noEmit`), `lib` `DOM.Iterable` merged into `DOM` (still accepted — measured). `esModuleInterop`
   and `allowSyntheticDefaultImports` are not set, so their new forced-`true` is the status quo.
6. **Vite 8 is Rolldown + Oxc instead of Rollup + esbuild** (`vite.dev/guide/migration`):
   `build.rollupOptions` → `build.rolldownOptions`; the `esbuild` option → `oxc`; JS minifier
   Oxc, CSS minifier Lightning CSS; CJS default-import interop made consistent between dev and
   build (`legacy.inconsistentCjsInterop` restores the old behaviour); default browser targets
   move to Baseline (Chrome 111, Safari 16.4); `optimizeDeps.esbuildOptions` deprecated.
   `vite.config.ts` uses **one** affected option: `build.rollupOptions.input` for the two
   pages (`index.html`, `splashscreen.html`). No `esbuild`, `optimizeDeps`, `manualChunks`,
   `watch.chokidar` or plugin-API use anywhere.
7. **`@vitejs/plugin-react` 6 drops Babel for Oxc**, removes the `babel`, `jsxRuntime`,
   `fastRefresh` and `jsxPure` options, changes the default `exclude`, and **no longer adds
   `react`/`react-dom` to `resolve.dedupe`**. Velo calls `react()` with no options in both
   `vite.config.ts` and `vitest.config.ts`; `npm ls react react-dom` shows a single copy today
   (every occurrence `deduped`), so the dropped dedupe changes nothing here.
8. **Provenance today:** `npm audit signatures` verifies 139 packages with attestations and
   reports no invalid signatures; `vite@8.2.2` and `@vitejs/plugin-react@6.1.1` publish SLSA v1
   provenance; **`typescript@6.0.3` and `typescript@7.0.2` publish no provenance attestation**
   (registry signature only — Microsoft's practice, not a defect of this plan). `npm audit`
   full tree and prod: 0 today.
9. **Out of the blast radius:** the Rust side (untouched); the `landing/` package (its own
   `package.json` on Vite 7 / TypeScript 5.9 / plugin-react 5, not an npm workspace, out of
   ADR-000's scope); Tauri (`@tauri-apps/cli` only runs `npm run dev`/`build`); the CSP
   (`tauri.conf.json` untouched — a build output with inline scripts would fail against
   `script-src 'self'`, which is one of the checks below).

## Requirements

- **REQ-1** As the maintainer I want each major to land as its own revertible commit.
  - REQ-1.1 Commit 1 SHALL bump `typescript` to **6.0.3** and, in the same commit, remove
    `baseUrl` and make `paths` relative (`"@/*": ["./src/*"]`). `ignoreDeprecations` SHALL NOT
    be used.
  - REQ-1.2 Commit 2 SHALL bump `typescript` to **7.0.2** with no other change.
  - REQ-1.3 Commit 3 SHALL bump `vite` to **8.2.2** and `@vitejs/plugin-react` to **6.1.1**,
    rename `build.rollupOptions` to `build.rolldownOptions` in `vite.config.ts`, and change
    nothing else. `vitest`, `@tailwindcss/vite`, `jsdom` SHALL stay at their current versions
    (all compatible by peer range).
  - REQ-1.4 No other dependency SHALL be added or removed. In particular, `esbuild` SHALL NOT
    be added to restore the old minifiers; if the Oxc/Lightning output fails a check below, the
    commit stops and Jim decides.
- **REQ-2** As the maintainer I want proof, not a claim, at every step.
  - REQ-2.1 After each commit: `npx tsc --noEmit` exit 0; `npx vitest run` with the same
    file and test counts as before the commit (173 / 2,299 at the base); `npm run build`
    producing `dist/index.html` and `dist/splashscreen.html`; `npm run graph:check` and
    `npm run docs:check` green; `npm audit --omit=dev --audit-level=high` and `npm audit
    --audit-level=high` both 0; `npm audit signatures` with no invalid signature; CI green on
    the exact commit (its frontend job already runs `npm ci && npm run build`).
  - REQ-2.2 After commit 3: the built `dist/index.html` and `dist/splashscreen.html` SHALL
    contain no inline `<script>` (the CSP is `script-src 'self'`), and the `dist/` size and
    file list SHALL be recorded beside the Vite 7 build's for the PR body.
  - REQ-2.3 The PR body SHALL record the measured `tsc --noEmit` wall time before and after.
- **REQ-3** As Jim I want the escape hatches named, not used.
  - REQ-3.1 `@typescript/typescript6` (`tsc6`) is the fallback if the native binary misbehaves
    on a platform; it is **not** added by this PR.
  - REQ-3.2 `build.minify: 'esbuild'`, `build.cssMinify: 'esbuild'` and
    `legacy.inconsistentCjsInterop` are the Vite 8 escape hatches; the first two need `esbuild`
    as a devDependency (a dependency add — Jim's call), the third hides a real interop
    difference and would be a recorded deviation, not a silent flag.

## Not doing

- **Not bumping `vitest`, `jsdom`, `@testing-library/*`, `@tailwindcss/vite`** — current and
  compatible; each is its own line in the audit if ever needed.
- **Not touching `landing/`** — separate package, out of scope (ADR-000).
- **Not adding `@types/node`** — Vite 8 lists it as an optional peer; nothing in `src/`
  needs Node types, and `vite.config.ts` is outside `tsconfig.json`'s `include`.
- **Not pinning exact versions in `package.json`** — the house style is caret ranges with the
  lockfile as the pin and `npm ci` as the gate; changing that style is a separate decision.
- **Not enabling the React Compiler** (`compiler: true` / `babel-plugin-react-compiler`) — a
  behaviour change with its own brief.
- **Not changing the CSP, `tauri.conf.json`, or any Rust.**

## Design

- **Commit 1 — TypeScript 6.0.3 + `baseUrl` fix.** `package.json`: `"typescript": "^6.0.3"`.
  `tsconfig.json`: delete `"baseUrl": "."`, set `"paths": { "@/*": ["./src/*"] }`. Nothing
  else: the measurement shows every other 6.0 default is already met or explicitly set.
- **Commit 2 — TypeScript 7.0.2.** `package.json`: `"typescript": "^7.0.2"`. The lockfile
  gains the 20 platform packages (optional; the host's is installed). `tsc` is now the native
  binary; the `build` script is unchanged.
- **Commit 3 — Vite 8.2.2 + plugin-react 6.1.1.** `package.json`: `"vite": "^8.2.2"`,
  `"@vitejs/plugin-react": "^6.1.1"`. `vite.config.ts`: `build.rollupOptions` →
  `build.rolldownOptions` (same `input` map). `vitest.config.ts`: unchanged (it imports the
  same plugin and `vitest/config`). Expect the JS/CSS output to differ byte-wise (different
  minifiers); REQ-2.2 is the check that matters for security, the size record is for the
  reviewer.
- **Decision & alternatives** — (a) three gated commits in one PR (chosen; the vault's PR D
  shape, each revertible alone). (b) TypeScript 7 directly from 5.9: the vault's "what not to
  upgrade yet" — 7.0 hard-errors on what 6.0 deprecates; the measurement confirms the same
  one-line fix serves both, so the bridge costs one extra commit and buys a clean bisect.
  (c) Vite 8 first: pointless coupling — the TypeScript commits do not touch Vite.
- **Data / schema** — none.
- **Failure modes** — a type error only the native checker reports (its type ordering is
  deterministic and cannot be switched off): fix the type, not the config; a Vite 8 build
  difference that changes runtime behaviour (CJS interop, minifier): caught by the test suite
  or the smoke run, and the escape hatches are named above; a platform without a native
  TypeScript binary: `@typescript/typescript6` — not this fork's targets (macOS arm64/x64,
  Linux x64, Windows x64 are all published).

## Tasks (risk-first, after approval)
- [ ] 1. Commit 1 (TypeScript 6.0.3 + `baseUrl` fix) with the REQ-2.1 gate run and recorded.
- [ ] 2. Commit 2 (TypeScript 7.0.2), REQ-2.1 gate, the wall-time record (REQ-2.3).
- [ ] 3. Commit 3 (Vite 8.2.2 + plugin-react 6.1.1, `rolldownOptions`), REQ-2.1 and REQ-2.2
  gates, the `dist/` size record.
- [ ] 4. Two review legs on the PR (Gemini 3.8 Flash High via `agy`, Grok 4.6 via the `grok`
  CLI), dispositions on the PR and in LOG.md; merge on green under the standing rule.
- [ ] 5. LOG.md; the vault audit's landing log; `CLAUDE.md` if it names the toolchain
  versions; HANDOFF pin after merge. **Manual, Jim:** `npm run tauri dev` smoke (open a
  thread, a pop-out, the composer) — recorded as open until done.

## Done when
Every REQ-2 check green on each of the three commits and on the merge commit in CI; the two
build pages present and free of inline scripts; `npm audit` full and prod 0; `npm audit
signatures` clean; file and test counts unchanged; the wall-time and `dist/` records in the
PR body. Manual smoke open for Jim.

## Rollback
`git revert` of any one of the three commits, or the squash; `npm ci` restores the previous
lockfile. No state, no schema, nothing persisted. If commit 3 is reverted alone, `vite.config.ts`
returns to `rollupOptions` with it.

## Threat pass (Tier 2 — supply chain)
- **Assets:** the developer machine and CI runner at build time (a build tool runs arbitrary
  code there); the built bundle (what ships to the webview); the lockfile as the record of
  what was built.
- **Provenance:** `vite` and `@vitejs/plugin-react` carry SLSA v1 provenance attestations
  (verified by `npm audit signatures`); **`typescript` 6 and 7 carry none** — the registry
  signature is the only cryptographic check, and the 20 platform binaries are prebuilt
  executables from the same publisher. Accepted: Microsoft-published, the most-downloaded
  package on the registry, and the same trust the fork already extends to `typescript@5.9.3`
  (also unattested). Rolldown and Oxc likewise arrive as prebuilt platform binaries under
  `@rolldown/*` and `@oxc-*` — they are new native code in the build; their count and
  publishers go in the PR body (REQ-2.1's transitive record).
- **Lockfile:** `npm ci` in CI is the frozen-lockfile gate; every new package enters
  `package-lock.json` in the commit that needs it and nowhere else.
- **Transitive cost:** to be measured in the build (`npm ls --all | wc -l` before and after
  each commit) and recorded; the expectation from the peer lists is a net *decrease* on the
  Vite commit (Babel and its plugins leave with plugin-react 5) and an increase of 20 optional
  platform packages on the TypeScript 7 commit.
- **Blast radius:** build tooling only. The shipped app contains the bundler's *output*, not
  the bundler; a compromised toolchain package is a build-time compromise of the dev machine
  and CI, which is the class every existing devDependency already belongs to. The runtime
  surface (`src/`, Rust, CSP, capabilities) is untouched, and REQ-2.2 checks the one way the
  bundler could weaken it (an inline script against `script-src 'self'`).
- **Removal path:** each commit reverts alone; the JavaScript compiler (`@typescript/typescript6`)
  and Rollup-era Vite 7 remain on the registry.
- **Residual:** the unattested TypeScript binaries (accepted above); the fork's CI has no
  `npm audit signatures` step — running it by hand is this PR's gate, and adding it to `ci.yml`
  is a one-line follow-up Jim can approve separately.

## Review
Two legs on this plan, then two legs on the code PR: Gemini 3.8 Flash High via `agy`; Grok
4.6 via the `grok` CLI. Diffs from committed SHAs. Findings verified against source before
adoption; dispositions on the PR and in LOG.md.

## Approval
- Plan approved by: __________ date: ______ — **required before any package.json, lockfile or
  config change.**
