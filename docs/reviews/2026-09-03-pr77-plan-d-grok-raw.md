SPEC-PR-D review (plan only; author's measurements taken as stated; attacking reasoning, completeness, and claims that collapse if the source was misread)

1. HIGH — Outcome; Rollback; REQ-1
Claim: “Either commit can be reverted alone if it misbehaves.” / “git revert of any one of the three commits, or the squash.”
Why: Commit 1 is the `baseUrl`/`paths` fix. Commit 2 is TypeScript 7, which hard-errors on `baseUrl` (author’s own TS5102). Reverting commit 1 after commit 2 is on the tree restores `baseUrl` under 7.0.2 and the typecheck goes red. The three commits are not independently revertible; 1 and 2 are a stack. “Or the squash” then destroys even the remaining bisect story: after a squash there is no commit 3 to revert alone, and `vite.config.ts` does not “return to `rollupOptions` with it.”
Fix: State the legal revert sets: (commit 3 alone), (commit 2 alone, leaving 6.0.3 + the paths fix), (commits 2+1 together), (all three). Forbid squash (merge commit or rebase-keep-commits). Drop “either commit can be reverted alone.”

2. HIGH — What exists §4–5; Design (Commit 2); REQ-2.1
Claim: Measurements are `npx … tsc --noEmit`; “rootDir (irrelevant under `noEmit`)”; build script is `tsc && vite build`; commit 2 “with no other change.”
Why: Every compiler data point is `--noEmit`. The build path is bare `tsc`. `noEmit: true` is inferred, never quoted. If tsconfig does not set `noEmit` (or sets `outDir`/`incremental`/`emitDeclarationOnly`), commit 2 puts the native emitter on `npm run build` with zero measurement of emit, file placement, or clash with `dist/`. That is the misread that falsifies “the only migration item is `baseUrl`” and “the build script is unchanged.”
Fix: Quote `noEmit`, `outDir`, `incremental`, `composite`, `plugins` from tsconfig. If `noEmit` is not true, either measure native emit or make `tsc --noEmit` in the `build` script an explicit, approved extra change in commit 1 or 2. Gates must invoke `./node_modules/.bin/tsc`, not `npx tsc` (npx can miss the lockfile binary).

3. HIGH — What exists §6–7; Design (Commit 3)
Claim: Vite 8 breakage is bounded by “`vite.config.ts` uses one affected option: `build.rollupOptions.input`” and “No `esbuild`, `optimizeDeps`, `manualChunks`, `watch.chokidar` or plugin-API use anywhere.”
Why: That is a config-key grep, not a what-breaks analysis. Vite majors break on source patterns the bundler owns: `import.meta.glob`, `new URL(..., import.meta.url)`, `?raw`/`?url`/`?worker`, workers/WASM, CJS default imports, `import.meta.env` typing, CSS modules, and third-party plugins that speak Rollup (`@tailwindcss/vite` is in the tree). None of those were inventoried. Unlike TypeScript, there is no throwaway `vite build` on this tree; Rolldown+Oxc+Lightning+plugin-react 6 is documentation. Blind rename of `rollupOptions` → `rolldownOptions` is also unverified: Vite’s MPA HTML `input` is a Vite convention; raw Rolldown `input` is JS entries. If the rename is ignored, `splashscreen.html` can still appear in `dist/` as an unprocessed copy and REQ-2.1 still passes.
Fix: In a throwaway copy (same method as tsconfig): install Vite 8.2.2 + plugin-react 6.1.1, apply the rename, run `vite build`, and paste the result (exit, both HTML hashes/script tags, whether splash was transformed). Grep `src/` for glob/URL/worker/WASM/query-imports/CJS default imports and list hits or “none.” Name `@tailwindcss/vite` as an in-tree plugin that uses the bundler plugin API, not “no plugin-API use.”

4. HIGH — Outcome; Vite §6; Not doing; Scope
Claim: “nothing user-visible changes”; commit 3 “change nothing else”; default targets “move to Baseline (Chrome 111, Safari 16.4)” listed as a fact, not a decision.
Why: Raising `build.target` is a behaviour change: less JS/CSS transpile, Lightning CSS prefixes/colours to that floor (Tailwind 4 `oklch` is in scope). Velo is a Tauri webview app. Linux webkit2gtk and older WKWebView are often below Safari 16.4. That can be a runtime syntax/CSS break, not a cosmetic minify delta. Leaving the new default in place is a second decision smuggled into the Vite bump. Tests in jsdom will not see it.
Fix: Either pin `build.target` (and CSS target) to the Vite 7 effective value and record that pin in commit 3, or get an explicit accept of Baseline-with-webview-floor (name macOS min, Windows WebView2, Linux webkit2gtk). Do not call it user-invisible.

5. HIGH — Tasks §5; Failure modes; REQ-2.1/2.2
Claim: Vite 8 runtime/minifier/CJS issues are “caught by the test suite or the smoke run”; smoke is `npm run tauri dev` (open a thread, a pop-out, the composer).
Why: `tauri dev` is the dev server, not Rolldown+Oxc minify+Lightning CSS. Vitest 4 can be peer-compatible with Vite 8 and still transform tests on a different pipeline than the production bundle. 2,299 tests at stable counts will not catch a minifier-broken production parse, a splash-page split-chunk miss, or CSS the webview will not paint. REQ-2.2 only requires two HTML files, no inline `<script>`, and a size table.
Fix: After commit 3, a production smoke is mandatory: `npm run tauri build` (or `vite preview` against the production `dist/`) loading both `index.html` and `splashscreen.html`, plus the composer/thread/pop-out on that bundle. Tighten REQ-2.2: each HTML must reference bundled, hashed JS/CSS (not existence alone). Record `npm ls react react-dom` after plugin-react 6 drops `resolve.dedupe`.

6. HIGH — Threat pass (Provenance, Blast radius)
Claim: TypeScript 7 unattested binaries are “the same trust the fork already extends to `typescript@5.9.3`”; Rolldown/Oxc “count and publishers go in the PR body”; “the one way the bundler could weaken it (an inline script against `script-src 'self'`).”
Why: 5.9.3 is JavaScript. 7.0.2 is ~20 prebuilt executables on every developer machine and CI. That is not the same trust; it is a new class. Deferring the Rolldown/Oxc publisher list until after approval means Jim is asked to accept unnamed native code. `npm audit signatures` only checks packages that published attestations; it is silent on typescript’s platform packages and on any unattested `@rolldown/*`/`@oxc-*`. A compromised toolchain injects into the JS/CSS that `script-src 'self'` will load; the inline-script check does not cover that path.
Fix: Before approval: throwaway install, list every new native package and publisher (TS platform pkgs + Rolldown/Oxc bindings), state tarball-vs-postinstall for each, and get an explicit accept of unattested native compilers. Describe blast radius as “build-time RCE + ability to alter shipped JS/CSS,” with inline-script as a CSP check only. Do not treat `npm audit signatures` as covering typescript 7.

7. HIGH — What exists §4; Design (commits 1–3)
Claim: 7.0.2 with the throwaway paths fix “exits 0”; commit 3 is the Vite bump on top of that.
Why: TS 7 was measured against Vite 7’s `vite/client` and today’s `@types/*`. Vite 8 ships different client types (`ImportMeta`, glob, CSS modules). Combined TS 7 + Vite 8 + plugin-react 6 types were never run. Commit 3 is the first time that set exists; the “only migration item is `baseUrl`” claim does not extend to it.
Fix: In the same throwaway tree as the Vite 8 build, run TypeScript 7.0.2 `--noEmit` and record errors. If `vite-env.d.ts` / `import.meta` types break, that fix belongs in commit 3 and must be named in REQ-1.3 (it is no longer “change nothing else”).

8. MEDIUM — What exists §5
Claim: “`esModuleInterop` and `allowSyntheticDefaultImports` are not set, so their new forced-`true` is the status quo.”
Why: Unset is not “already true.” On TypeScript 5.9 with `module: ESNext`, `esModuleInterop` defaults false. Forced true is a checker change (usually more permissive default imports). It will not show up as a new error; it can hide errors. The dry run exiting 0 does not prove status quo.
Fix: Paste `tsc --showConfig` for 5.9.3 vs 6.0.3 for `esModuleInterop`, `allowSyntheticDefaultImports`, `isolatedModules`, `moduleResolution`, `types`, and `target`. Anything that actually flips is a named behaviour change, not “already met.”

9. MEDIUM — REQ-2.1; What exists §1; Tasks
Claim: “CI green on the exact commit (its frontend job already runs `npm ci && npm run build`)”; vitest 173 / 2,299 after each commit.
Why: The parenthetical implies CI typechecks+builds and may not run vitest (or lint). Then the 2,299-test gate is operator-local and is not the merge bit. `graph:check` / `docs:check` are the right place to catch “something imports the `typescript` compiler API,” but the plan never says whether they (or eslint/typedoc/ts-morph) do. Native `typescript@7` has a history of breaking API consumers even when `tsc --noEmit` is green. `plugin-react` 6’s new default `exclude` is named and then ignored because `react()` is called with no options — that is exactly when the new default applies; the delta vs plugin-react 5 is unstated.
Fix: State which CI jobs run vitest, lint, graph:check, docs:check. If tests are not in CI, adding that job is a separate CI decision — do not pretend REQ-2.1 is CI-backed. Quote whether any script depends on `typescript` as a library and the `typescript-eslint` (or equivalent) peer. Spell the old vs new `exclude` and grep the repo for the delta.

10. MEDIUM — Rollback; Threat pass (Lockfile)
Claim: “No state, no schema, nothing persisted.” / `npm ci` restores the lockfile.
Why: `node_modules/.vite`, `node_modules/.vitest`, `*.tsbuildinfo`, and CI `actions/cache` / npm caches are state. Stale optimizeDeps and TS 7 incremental info are a known false-pass/false-fail class after bump or revert. Optional native installs also fail closed if `.npmrc` omits optional deps, or on musl/Alpine and Linux arm64, which are not in the published-target list.
Fix: Rollback includes deleting Vite/Vitest caches and `*.tsbuildinfo`. Confirm optional deps are not omitted. Name supported OS/arch (include or explicitly exclude linux-arm64 and musl). Require CI green on the OS that is not the author’s (Linux vs macOS) before merge of commit 2.

11. MEDIUM — REQ-1.4; Not doing (`@types/node`); Threat pass (Transitive cost)
Claim: “No other dependency SHALL be added or removed”; “Not adding `@types/node`”; transitive cost “to be measured in the build.”
Why: Commit 2 adds ~20 optional platform packages; commit 3 adds Rolldown/Oxc bindings and removes Babel. REQ-1.4 as written is already false. Vite 8’s optional peer `@types/node` can be auto-installed by npm into the lockfile, which is an undeclared dependency add. Transitive cost and publisher list after approval is not a Tier-2 threat pass; it is a diary entry.
Fix: Carve out the platform packages and the Vite-native bindings in REQ-1.4. After the throwaway install, assert the lockfile does not gain `@types/node` (or accept it as its own line). Put `npm ls --all` counts and the new-package list in the plan now, not in the PR body later.

12. MEDIUM — Failure modes; REQ-3.2
Claim: CJS interop / minifier differences caught by tests; escape hatches named not used.
Why: No inventory of default imports from CJS packages (common in mail/MIME/sanitizer stacks). Vitest will not see production Oxc minify. `legacy.inconsistentCjsInterop` is named; the condition that would fire it is not.
Fix: List CJS default-import sites or “none in `src/`.” If any exist, add a production-bundle execution check for those modules, not only unit tests.

13. LOW — Outcome; REQ-2.3
Claim: “the type check is measurably faster (native compiler)” as an outcome; REQ-2.3 only records wall time.
Why: 0.9 s vs 3.3 s is a local npx-cache run on one machine, not a gate. Cold CI (download 20 binaries) can be slower. Outcome oversells a nicety as success.
Fix: Move speed to an observation in the PR body. Success is exit 0 and unchanged test/build/CSP checks.

14. LOW — REQ-1.4 vs Design (Commit 2)
Claim vs fact: “No other dependency SHALL be added or removed” vs “the lockfile gains the 20 platform packages.”
Fix: Reword REQ-1.4 to allow those optional packages and the Vite 8 native transitives, and to forbid anything else (including `esbuild` and `@typescript/typescript6`).

15. NIT — Effort; caret ranges; SLSA
“½ day” is tight if production smoke, lockfile optional-deps, and a real Vite 8 dry run are added — not a defect. Caret `^7.0.2` on a native-compiler major is house style (already called out); worth restating that `npm update` is out of bounds until 7.x is boring. House SLSA v1.2 vs Vite’s v1 is residual, not blocking. `landing/` drift is correctly out of scope only if the PR checklist says so.

Verdict: CHANGES REQUESTED
