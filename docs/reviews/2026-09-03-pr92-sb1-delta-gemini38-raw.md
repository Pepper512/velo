### 1. Verdict
**CHANGES REQUESTED**

---

### 2. Findings

- **[M] M1 — `src/App.tsx`** — In replacing `savedReduceMotion === null ? await readPlatform() : "unknown"` with `platform: await readPlatform()`, the boot path now unconditionally executes and awaits `readPlatform()` on every startup. This creates an unforced sequential async waterfall (`await getSetting("reduce_motion")` followed by `await readPlatform()`), delaying `ui.restoreReduceMotion(reduce.value)`. When `savedReduceMotion` is already a valid boolean string (`"true"` or `"false"`), `resolveReduceEffects` determines `reduce.value` entirely from `stored`, leaving `input.platform` dead and unread. Consequently, all returning users with a saved setting pay the cost of dynamically importing `@tauri-apps/plugin-os` and invoking the plugin on every launch. Furthermore, in secondary or pop-out windows where plugin permissions may be restricted, this forces an unnecessary import attempt and caught exception on every boot even when an explicit setting exists. `readPlatform()` should only be awaited when `savedReduceMotion !== "true" && savedReduceMotion !== "false"`, or parallelized via `Promise.all`.

- **[L] L1 — `src/services/effects/reduceEffects.test.ts`** — The newly added test `expect(await readPlatform(async () => ({ platform: async () => "linux" }))).toBe("linux");` asserts that an asynchronously resolved `platform()` stub works, but there is no companion test for when an async `platform()` rejects. The existing failure test (`const failing = vi.fn(async () => { throw new Error("plugin not allowed"); });`) tests a failure in the `load()` import factory itself, not a rejection inside `(await load()).platform()`. Although `try { const p = await (await load()).platform(); ... } catch { return "unknown"; }` correctly catches promise rejections because the call is awaited inside `try`, adding `expect(await readPlatform(async () => ({ platform: async () => { throw new Error("fault"); } }))).toBe("unknown");` is needed to verify end-to-end negative coverage for the async hardening.

- **[N] N1 — `src/styles/globals.css`** — The addition of `backdrop-filter: none;` and `-webkit-backdrop-filter: none;` to `.reduce-motion .backdrop-animate` is strictly redundant with `animation: none;` based on round 1's premise that blur originates solely from the keyframes. While harmless as defensive hardening against future refactors or static utility additions, disabling the animation already prevents the keyframes from ever applying the blur.

- **[N] N2 — `src/services/effects/reduceEffects.ts` & `src/App.tsx`** — In `resolveReduceEffects`, the return object includes `persisted: boolean` (`return { value: input.platform === "linux", persisted: false };`), but the callsite in `App.tsx` only consumes `reduce.value` (`ui.restoreReduceMotion(reduce.value);`). The `persisted` flag is currently dead code in application runtime boot logic, serving no purpose unless consumed by a persistence-reconciliation hook.

---

### 3. Verified-Correct List

1. **Resting Shadows Preserved (`src/styles/globals.css`)**: Deleting `box-shadow: none;` from `.reduce-motion .hover-lift:hover:not(:active)` completely resolves hole (1). Resting card and panel shadows are no longer zeroed out when hovered under reduced motion. The selector maintains `(0, 4, 0)` specificity to nullify `transform` while respecting REQ-1.2 ("shadows stay").
2. **UI Store State Hydration for False (`src/App.tsx`)**: Changing `if (reduce.value) ui.restoreReduceMotion(true);` to `ui.restoreReduceMotion(reduce.value);` correctly resolves hole (2b). When `reduce.value` evaluates to `false`, the UI store/DOM state is explicitly set to `false` rather than remaining uninitialized or retaining a stale `true`.
3. **Cross-Engine Backdrop Suppression (`src/styles/globals.css`)**: Adding both standard `backdrop-filter: none;` and prefixed `-webkit-backdrop-filter: none;` at `(0, 2, 0)` specificity cleanly covers both WebKit (Tauri macOS) and Chromium/Blink (Tauri Linux/Windows) webviews, ensuring blur removal regardless of engine-specific prefix requirements.
4. **Synchronous & Asynchronous Plugin Compatibility (`src/services/effects/reduceEffects.ts`)**: Widening `OsPlugin` to `{ platform: () => string | Promise<string> }` and implementing `const p = await (await load()).platform();` safely hardens the loader without overhead, seamlessly handling both synchronous strings (current `plugin-os` 2.x) and promises while maintaining `Platform` validation (`"linux" | "macos" | "windows"` vs `"unknown"`).
5. **Pop-out Window Exception Safety (`src/services/effects/reduceEffects.ts`)**: The surrounding `try/catch` in `readPlatform()` safely swallows load rejections and runtime plugin access errors in secondary/pop-out windows where plugin capabilities are disabled, returning `"unknown"` without triggering unhandled promise rejections.

---

### External Context Relied Upon
- **`resolveReduceEffects` contract**: Relied upon lines 1–25 returning `{ value: true, persisted: true }` for `stored === "true"` and `{ value: false, persisted: true }` for `stored === "false"`, evaluating `input.platform === "linux"` exclusively when `stored` is neither `"true"` nor `"false"`.
- **`@tauri-apps/plugin-os` 2.x specifications**: Relied upon the plugin exporting a synchronous `platform(): Platform` function returning OS identifier strings.
- **Tauri Multi-Window Capability Scoping**: Relied upon secondary/pop-out webview windows being subject to Tauri capability configurations where unpermitted plugin access rejects on import or IPC dispatch.
- **CSS Precedence**: Relied upon `.backdrop-animate` and `.hover-lift` baseline rules having lower specificity than compound `.reduce-motion .*` class selectors.
