### Findings

---

#### 1. [HIGH] State divergence between `main.tsx` routing and `isPopoutWindow()` breaks the "One Rule" invariant (SPEC-P11 REQ-2.3)

- **File**: `src/utils/windowKind.ts` (affecting `src/main.tsx`)
- **Exact Code**:
  ```ts
  /** True inside a thread or compose pop-out window — by label when Tauri says, else by URL. */
  export function isPopoutWindow(): boolean {
    const label = currentWindowLabel();
    if (label !== null) return windowKindFromLabel(label) !== "main";
    return windowKindFromSearch(window.location.search) !== "main";
  }
  ```
- **Why it is wrong**:
  The core architecture invariant documented in SPEC-P11 REQ-2.3 is: *"one rule for 'which window am I', shared by `main.tsx`'s root picker and the pop-out gates."*

  This commit updated `isPopoutWindow()` to prioritize `currentWindowLabel()` over `window.location.search`, but left `main.tsx` routing exclusively via the URL rule (`windowKindFromSearch(window.location.search)`). This creates a direct contradiction inside Tauri:

  1. **Stripped Query String failure mode**: The test specifically cites: *"A pop-out whose query string was stripped is still a pop-out: the grant is keyed by the label, so the gate must be too."* However, if a pop-out window's query parameters are stripped (e.g. via `history.replaceState`, internal redirection, or clean reloads), `isPopoutWindow()` returns `true`, but `main.tsx` invokes `windowKindFromSearch("")` which evaluates to `"main"`. `main.tsx` will then attempt to render the full main window root inside a window governed by `content.json`. As soon as the main window mounts, its calls to main-only capabilities (window state controls, notifications, badge count, updater, deep links, `fs:remove`) will fail immediately with Tauri ACL violations.
  2. **URL Parameter Collision**: If the main window (`label === "main"`) is navigated to or opened with `/?thread=t1&account=a1`, `main.tsx` renders `ThreadView` at the root, but inside `ThreadView`, `isPopoutWindow()` reads `label === "main"` and returns `false`. `ThreadView` will then display the "Pop out" button inside the main window, and `handlePopOut` will attempt to spawn duplicate webviews.

  `windowKind.ts` must expose a single unified `currentWindowKind()` resolution function that `main.tsx` also imports and uses.

- **Concrete Fix**:
  In `src/utils/windowKind.ts`, export a unified window kind resolver:
  ```ts
  export function currentWindowKind(): WindowKind {
    const label = currentWindowLabel();
    if (label !== null) return windowKindFromLabel(label);
    return windowKindFromSearch(window.location.search);
  }

  export function isPopoutWindow(): boolean {
    return currentWindowKind() !== "main";
  }
  ```
  In `src/main.tsx`, update the root component selector to use `currentWindowKind()` instead of calling `windowKindFromSearch(window.location.search)` directly.

---

#### 2. [MEDIUM] Direct inspection of private `__TAURI_INTERNALS__` and semantic mismatch between Webview and Window labels

- **File**: `src/utils/windowKind.ts`
- **Exact Code**:
  ```ts
  function currentWindowLabel(): string | null {
    try {
      const internals = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      if (!internals) return null;
      const label = (
        internals as { metadata?: { currentWebview?: { label?: unknown } } }
      ).metadata?.currentWebview?.label;
      return typeof label === "string" ? label : null;
    } catch {
      return null;
    }
  }
  ```
- **Why it is wrong**:
  1. **Coupling to Unstable Internals**: `window.__TAURI_INTERNALS__` is an undocumented, private runtime detail of Tauri v2. Properties under `__TAURI_INTERNALS__` are not covered by semver and are subject to change between minor or patch releases of `@tauri-apps/api`.
  2. **Webview vs. Window Label**: In Tauri v2, `Webview` and `Window` are distinct entities. Capabilities in `content.json` match against window labels via `"windows": ["thread-*", "compose-*"]`. The code reads `metadata.currentWebview.label`, not the window label. While `new WebviewWindow` creates a 1:1 window and webview sharing the same label, any multi-webview composition or distinct webview configuration will cause `currentWebview.label` to differ from the window's label, checking the wrong identifier against the glob.
  3. **Official API handling in jsdom**: The standard `@tauri-apps/api/webviewWindow` function `getCurrentWebviewWindow()` is synchronous. In jsdom or standard browsers without Tauri, calling `getCurrentWebviewWindow()` throws a `TypeError`. Wrapping `getCurrentWebviewWindow().label` in a `try/catch` block cleanly handles the absence of the runtime in test and dev environments without bypassing the public SDK.

- **Concrete Fix**:
  Use the official `@tauri-apps/api/webviewWindow` API inside the `try/catch` block, or defensively check `currentWindow.label` before falling back to `currentWebview.label`:
  ```ts
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

  function currentWindowLabel(): string | null {
    try {
      return getCurrentWebviewWindow().label;
    } catch {
      return null;
    }
  }
  ```
  If static import of `@tauri-apps/api` must be avoided to prevent module-level side effects in non-Tauri environments, inspect both window and webview metadata safely:
  ```ts
  function currentWindowLabel(): string | null {
    try {
      const internals = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: unknown }; currentWebview?: { label?: unknown } } } }).__TAURI_INTERNALS__;
      const label = internals?.metadata?.currentWindow?.label ?? internals?.metadata?.currentWebview?.label;
      return typeof label === "string" ? label : null;
    } catch {
      return null;
    }
  }
  ```

---

#### 3. [MEDIUM] Capability subset test weakens verification by ignoring permission scopes and using a flawed array length assertion

- **File**: `src/config/capabilities.test.ts`
- **Exact Code**:
  ```ts
  const DEFAULT_SET_MEMBERS: Record<string, string[]> = {
    "opener:default": [
      "opener:allow-open-url",
      "opener:allow-reveal-item-in-dir",
      "opener:allow-default-urls",
    ],
  };
  ...
  it("gives content windows a strict subset of main's grant", () => {
    const mainIds = new Set(main.permissions.map(idOf));
    for (const [set, members] of Object.entries(DEFAULT_SET_MEMBERS)) {
      if (mainIds.has(set)) for (const m of members) mainIds.add(m);
    }
    for (const p of content.permissions) {
      expect(mainIds.has(idOf(p)), `${idOf(p)} is in content but not in main`).toBe(true);
    }
    expect(content.permissions.length).toBeLessThan(main.permissions.length);
  });
  ```
- **Why it is wrong**:
  1. **Manual Mock Table as Source of Truth**: `DEFAULT_SET_MEMBERS` is a hardcoded object in the test file rather than being generated from the ACL manifest schema. If `@tauri-apps/plugin-opener` modifies `opener:default` in an upstream update, this test will continue to test against an obsolete, fictional expansion.
  2. **Scope Bypass via `idOf`**: `idOf(p)` reduces permissions down to string identifiers (e.g. `"http:default"`, `"fs:scope"`). Because only the string identifier is placed into `mainIds`, the test does not verify that permission *scopes* (`allow` / `deny` rules) in `content.json` are a subset of `main.json`. `content.json` could grant broader network or filesystem access, and the test would still pass.
  3. **Invalid Length Assertion**: `expect(content.permissions.length).toBeLessThan(main.permissions.length)` is a flawed test of subset cardinality. When composite permissions (such as `:default`) are narrowed into individual fine-grained permissions, the count of permission entries increases. Replacing 1 composite permission with 3 granular permissions adds entries. Relying on `.length` is fragile and logically incorrect when permissions are decomposed.

- **Concrete Fix**:
  1. Load or assert `DEFAULT_SET_MEMBERS` against the actual generated plugin manifest schemas in `src-tauri/gen/schemas/`.
  2. For scoped permissions (`typeof p === "object"`), assert that each rule in `content`'s `allow` list is matched or subsumed by a corresponding rule in `main`.
  3. Remove the `.length` assertion and rely on set containment:
  ```ts
  it("gives content windows a strict subset of main's grant", () => {
    const expandedMainIds = new Set(main.permissions.map(idOf));
    for (const [set, members] of Object.entries(DEFAULT_SET_MEMBERS)) {
      if (expandedMainIds.has(set)) {
        for (const m of members) expandedMainIds.add(m);
      }
    }
    for (const p of content.permissions) {
      expect(expandedMainIds.has(idOf(p)), `${idOf(p)} is in content but not in main`).toBe(true);
    }
    // Verify strict subset: main must have at least one permission or member not present in content
    const contentIds = new Set(content.permissions.map(idOf));
    const hasStrictDifference = Array.from(expandedMainIds).some((id) => !contentIds.has(id));
    expect(hasStrictDifference).toBe(true);
  });
  ```

---

#### 4. [LOW] Potential unhandled rejection on attachment "Reveal in folder" actions in thread popouts

- **File**: `src-tauri/capabilities/content.json`
- **Exact Code**:
  ```json
  -    "opener:default",
  +    "opener:allow-open-url",
  +    "opener:allow-default-urls",
  ```
- **Why it is wrong**:
  Narrowing `opener:default` to `opener:allow-open-url` + `opener:allow-default-urls` correctly supports `openLink.ts` and `unsubscribeManager` because `allow-default-urls` permits `http`, `https`, `mailto`, and `tel`.

  However, `content.json` retains `dialog:default` and `fs:allow-appdata-write-recursive` specifically for attachment downloading and saving. If the thread view UI includes a "Show in folder" or "Reveal in Finder" action upon saving an attachment (which invokes `@tauri-apps/plugin-opener`'s `revealItemInDir`), this call will now fail with a Tauri ACL denial. Unlike `handlePopOut`, which is explicitly guarded by `if (isPopoutWindow()) return;`, attachment components are not guarded against calling `revealItemInDir`.

- **Concrete Fix**:
  Audit attachment components in `ThreadView` to confirm whether `revealItemInDir` (or `revealItem`) is invoked. If an attachment UI exposes a "Show in folder" button:
  1. Guard the handler and conditionally hide the button using `isPopoutWindow()`, or
  2. If the product requirement dictates that pop-outs must allow revealing saved attachments in the file manager, `opener:allow-reveal-item-in-dir` must be added back to `content.json` with an explicit justification.

---

#### 5. [NIT] Incomplete test coverage for inside-Tauri main window and malformed metadata

- **File**: `src/utils/windowKind.test.ts`
- **Exact Code**:
  ```ts
  it("is false in the main window", () => {
    expect(isPopoutWindow()).toBe(false);
  });
  ```
- **Why it is wrong**:
  Because `afterEach` resets `setTauriLabel(null)`, the test `"is false in the main window"` executes with `label === null` and URL `"/"`. It tests the non-Tauri fallback path, not the behavior inside Tauri. There is no test verifying that `isPopoutWindow()` returns `false` when running inside Tauri (`setTauriLabel("main")`) under the default route (`"/"`).
  Additionally, there are no tests verifying behavior when `window.__TAURI_INTERNALS__` exists but `metadata` is missing, empty, or contains non-string labels.

- **Concrete Fix**:
  Add explicit unit tests covering the inside-Tauri main window and malformed metadata fallbacks:
  ```ts
  it("is false in the main window inside Tauri", () => {
    setTauriLabel("main");
    expect(isPopoutWindow()).toBe(false);
  });

  it("safely falls back to URL rule when Tauri metadata is malformed", () => {
    const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
    w.__TAURI_INTERNALS__ = { metadata: {} };
    window.history.replaceState({}, "", "/?thread=t1&account=a1");
    expect(isPopoutWindow()).toBe(true);
  });
  ```

---

### Verdict

**CHANGES REQUESTED**
