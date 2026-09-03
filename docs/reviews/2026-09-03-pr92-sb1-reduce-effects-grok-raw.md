The full request was truncated, so I’ll load the offloaded prompt first and then review only the inline brief and diff.1. Verdict: **CHANGES REQUESTED**

2. Findings:

**[H] F1** — `src/services/effects/reduceEffects.ts` — `readPlatform` never awaits `platform()`, so a Promise return is treated as a non-Linux OS and REQ-1.3’s Linux default never applies. Evidence from the diff: `const p = (await load()).platform(); return p === "linux" || p === "macos" || p === "windows" ? p : "unknown";` with `type OsPlugin = { platform: () => string }`. The tests only inject a **sync** stub (`platform: () => "linux"`), plus a throw — they would stay green if the real plugin returned `Promise<"linux">`. I did **not** see `@tauri-apps/plugin-os`’s types or the Developer-tab call site (both outside the diff). Tauri v2’s published usage is `await platform()`; if that is this repo’s API, every first-run Linux session is classified `"unknown"`, `resolveReduceEffects` yields `{ value: false, persisted: false }`, and App never calls `restoreReduceMotion`. If `platform()` is actually sync and returns `"linux"`, this finding drops to a typing/test gap. Fix that works either way: `const p = await Promise.resolve((await load()).platform())`, and add an async stub test.

**[M] F2** — `src/components/settings/SettingsPage.tsx` — REQ-1.1 SHALLs the description `"Flat panels, no blur or animation — quieter on the CPU (recommended on Linux)"`. The diff sets `description="Flat panels, no blur or animation — quieter on the CPU (on by default on Linux; also fixes flickering on some GPUs)"`. Label `"Reduce effects"` is correct; the quoted description is not. The GPU clause is leftover from the old copy; “on by default” also overstates REQ-1.3 (default only when nothing is stored).

**[M] F3** — `src/styles/globals.css` — REQ-1.2 names the `backdropIn` keyframes; the brief’s SB-1 design applies `backdrop-filter: none` (and `-webkit-`) to `.backdrop-animate` as well as the glass classes. The new rule is only:

```css
.reduce-motion .backdrop-animate {
  animation: none;
  background-color: rgba(0, 0, 0, 0.2);
}
```

That gives the final tint and cancels the animation; it does **not** kill a static `backdrop-filter` on that element. Neutralization then depends on the overlay also matching `.glass-backdrop` or `[class*="backdrop-blur"]`. Those class lists are outside the diff (`Composer.tsx:514`, `@keyframes backdropIn`). Cheap and matches the design: set `backdrop-filter: none; -webkit-backdrop-filter: none` on this rule too.

**[M] F4** — `src/App.tsx` / tests — REQ-1.3’s persist invariant is “session default is not stored; first toggle touch is.” The store test checks `restoreReduceMotion` does not call `setSetting`; nothing checks that **boot** calls `restoreReduceMotion` rather than `setReduceMotion` (the previous body, which persists). The new null path also `await readPlatform()` after `getSetting`, then `if (reduce.value) ui.restoreReduceMotion(true)` with no “user already toggled” guard. A stale `null` read plus a later restore can clobber a toggle that already wrote `"false"`. Narrow window, but it is new: the old null path did not write the store at all. `reduce.persisted` is unused.

**[L] F5** — `src/constants/helpContent.ts` vs `src/styles/globals.css` — Same commit disagrees about where the control lives. Help: `"Reduce effects (Settings > General)…"`. CSS comment: `"Reduce effects" (Settings → Appearance; …)`. REQ-1.1 / *What exists* place the `ToggleRow` in Appearance. `relatedSettingsTab: "general"` is pre-existing (outside the diff); if that tab is actually labeled General in the UI, say so and align the CSS comment — one of the two strings is wrong.

**[L] F6** — `src/styles/globals.css` — REQ-1.2: “Layout SHALL not change (same paddings, borders, **shadows stay**).” The new `.reduce-motion .hover-lift:hover:not(:active) { transform: none; box-shadow: none; }` follows the design but will override a resting `box-shadow` on the same node (higher specificity than `.glass-panel`). Brief puts `hover-lift` on `ThreadCard` and glass on panels/modals/toasts — likely different elements (outside the diff). If any node is both, hover strips the panel shadow. Prefer killing only the lift transform/transition, or `revert` in a way that keeps the glass shadow.

**[L] F7** — `src/App.tsx` vs `src/services/effects/reduceEffects.test.ts` — Resolver test: `stored: "maybe", platform: "linux"` → `{ value: true, persisted: false }` (“unrecognised stored value as absent”). App only calls `readPlatform()` when `savedReduceMotion === null`, otherwise passes `"unknown"`. A non-null non-boolean value therefore never gets a Linux default, contrary to that test. REQ-1.3 is “no value stored” (`null`); App matches the spec, the test does not match App. Dead if `getSetting` only returns `"true"` / `"false"` / `null` (return type is outside the diff: `string | null`).

**[L] F8** — `src/App.tsx` — Linux default is applied only after `await getSetting` and possibly `await readPlatform()` (dynamic import). Store default remains `false` until then; `.reduce-motion` on `<html>` is mirrored from the store (outside the diff). First paint on a fresh Linux install still has blobs/blurs — the #232 cost — then flips on. Spec-compliant (REQ-1.3 does not require before first paint); at odds with the outcome line “Velo starts with flat panels.” No first-touch/persist bug in the happy path: `ToggleRow` still uses `setReduceMotion`.

**[N] F9** — `src/styles/globals.css` — `.reduce-motion [class*="backdrop-blur"] { backdrop-filter: none; -webkit-backdrop-filter: none; }` is 0,2,0 and should beat a single utility if `globals.css` is unlayered. Tailwind v4 still sets `backdrop-filter` via `--tw-backdrop-*` (stated context). If this file is `@layer base` and utilities win the cascade, the five `backdrop-blur-*` sites named in REQ-1.2 keep filtering. I cannot see the import/`@layer` setup (outside the diff). Residual: also zero `--tw-backdrop-blur` / `--tw-backdrop-filter`, or put the override in `@layer utilities`.

3. What you verified and found correct

- REQ-1.1 label is `"Reduce effects"`; stored key remains `reduce_motion` (no `settingsKeys` change; `setReduceMotion` still writes `"reduce_motion"`).
- Stored `"true"` / `"false"` win on every platform; a user who already turned it on stays on; Linux `"false"` stays off (`resolveReduceEffects` + tests).
- Session Linux default does not persist: `restoreReduceMotion` is `set({ reduceMotion })` only; `setReduceMotion` is unchanged and is still the toggle path (“first touch persists”).
- Pop-out safety in the function itself: dynamic `import("@tauri-apps/plugin-os")` is inside try/catch; failure → `"unknown"` → default off. App also skips `readPlatform()` when a value is stored, so that path never loads the plugin.
- `.reduce-motion .glass-panel/.glass-modal/.glass-backdrop` set both `backdrop-filter` and `-webkit-backdrop-filter` to `none` (0,2,0 vs 0,1,0, so they still win if the glass rules appear later in this file). Blobs still `display: none`. `.stagger-in { animation: none }`, `.hover-lift { transition: none }`, `.press-scale:active { transform: none }`. Overlay tint `rgba(0, 0, 0, 0.2)` without animating. Paddings/borders of glass rules are not edited.
- `readPlatform` maps only `linux|macos|windows`, else `"unknown"`; injected load that throws returns `"unknown"`.
- Store API matches existing `restoreSidebarNavConfig` (restore ≠ persist). No extra dependency, no Rust/CSP/capability change. SB-2/SB-3 are out of this commit.
