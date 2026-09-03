### Findings

#### 1. Runtime Breakage: Dialog-picked save paths are not added to `fs` scope; `.eml` export and attachment saving will fail
- **Severity**: HIGH
- **File**: `src-tauri/capabilities/content.json`
- **Exact Code**:
  ```json
      {
        "identifier": "fs:allow-write-file",
        "allow": [
          { "path": "$APPDATA/attachment_cache/**" }
        ]
      },
      "fs:allow-write-text-file",
  ```
- **Why it is wrong**:
  The description in `content.json` states:
  > *"the picked path is added to the fs scope by the dialog plugin at runtime, which is why write-file and write-text-file need no static path for it."*
  
  This premise is incorrect for Tauri v2. `tauri-plugin-dialog` and `tauri-plugin-fs` are independent crates and plugins. `dialog.save()` merely invokes the native OS save dialog and returns the selected string path to the frontend; it **does not** (and cannot) mutate `tauri-plugin-fs`'s runtime scope.
  
  Because of this:
  1. `"fs:allow-write-text-file"` is defined in `tauri-plugin-fs` with no pre-configured path scope (`commands.allow = ["write_text_file"]`). When `writeTextFile(pickedPath, eml)` is called during an `.eml` export to a user-selected path (e.g. `~/Downloads/thread.eml`), `tauri-plugin-fs` checks whether `pickedPath` is in the allowed scope. Because the static scope is empty and no runtime scope was injected, it fails with `path not allowed on the configured scope`.
  2. Saving attachments from a pop-out calls `writeFile(pickedPath, bytes)`. `fs:allow-write-file` in `content.json` is statically scoped **only** to `$APPDATA/attachment_cache/**`. When a user chooses a save destination outside the attachment cache (e.g. `~/Downloads`), `writeFile` is rejected by the scope check.
  
  Both `.eml` export and attachment download to user directories are broken at runtime in pop-out windows.
- **Concrete Fix**:
  Do not expose raw filesystem write permissions to windows that render untrusted HTML. Instead, implement dedicated Tauri application commands in Rust (e.g., `export_eml(path, content)` and `save_attachment(path, data)`). Tauri application commands are not subject to plugin scope restrictions and can write to user-selected paths safely. Remove `"fs:allow-write-text-file"` from `content.json`, keeping pop-out file writes strictly confined to `$APPDATA/attachment_cache/**`.

---

#### 2. Unguarded Webview Creation Site in Shared UI Component
- **Severity**: HIGH
- **File**: `src/components/ui/ContextMenuPortal.tsx`
- **Exact Code** (referenced in `src/config/capabilities.test.ts`):
  ```typescript
    it("creates webview windows from exactly the three known sites", () => {
      expect(contains("new WebviewWindow(")).toEqual([
        "src/components/composer/Composer.tsx",
        "src/components/email/ThreadView.tsx",
        "src/components/ui/ContextMenuPortal.tsx",
      ]);
    });
  ```
- **Why it is wrong**:
  `capabilities.test.ts` confirms three sites instantiate `new WebviewWindow`: `Composer.tsx`, `ThreadView.tsx`, and `ContextMenuPortal.tsx`. The PR added `isPopoutWindow()` guards to `Composer.tsx` and `ThreadView.tsx`, but left `ContextMenuPortal.tsx` untouched based on the assumption recorded in the test:
  > *"gates both pop-out-reachable creators"*
  
  `ContextMenuPortal` is a shared UI component. Right-clicking within email messages, selected text, links, or attachments in `ThreadView` or `Composer` triggers context menus. If `ContextMenuPortal` attempts to instantiate a `new WebviewWindow` inside a pop-out window, Tauri will reject the IPC call with an unauthorized error because `content.json` excludes `core:webview:allow-create-webview-window`. This will throw unhandled rejections and break context menus inside pop-outs.
- **Concrete Fix**:
  Update `src/components/ui/ContextMenuPortal.tsx` to check `isPopoutWindow()`. When inside a pop-out window, fall back to an in-window portal (rendering directly into the local document DOM) instead of attempting to spawn a separate `WebviewWindow`. Update `capabilities.test.ts` to assert that all three sites guard against unauthorized execution in pop-out windows.

---

#### 3. Full `sql:allow-execute` Permission Granted to Untrusted HTML Renderers
- **Severity**: HIGH
- **File**: `src-tauri/capabilities/content.json`
- **Exact Code**:
  ```json
      "sql:allow-load",
      "sql:allow-select",
      "sql:allow-execute",
  ```
- **Why it is wrong**:
  The core objective of P11 is blast-radius reduction in windows displaying untrusted email HTML. However, `content.json` grants `"sql:allow-execute"`, which allows arbitrary SQL execution via `plugin:sql|execute` (including `DROP TABLE`, `DELETE FROM`, `UPDATE accounts`, etc.).
  
  The justification in `content.json` states that migrations run on mount and draft auto-save writes data. However:
  1. `ThreadView` is a read-only viewer; it does not need DDL execution or write access, yet it receives `sql:allow-execute`.
  2. Running database migrations on mount in every pop-out window is poor architecture that forces `sql:allow-execute` onto all content windows.
  
  An attacker achieving a sanitizer bypass (XSS) in a thread pop-out can execute arbitrary SQL to corrupt the local database, wipe mailboxes, or alter account configuration.
- **Concrete Fix**:
  1. Restrict migration execution (`runMigrations`) to `main.tsx` (`if (!isPopoutWindow()) await runMigrations();`).
  2. Replace raw client-side SQL execution in pop-out windows with specific Tauri Rust commands (e.g. `save_draft`, `record_sent_copy`).
  3. Drop `sql:allow-execute` from `content.json`.

---

#### 4. Naive String Prefix Subsumption Allows Path Traversal Bypass in Tests
- **Severity**: MEDIUM
- **File**: `src/config/capabilities.test.ts`
- **Exact Code**:
  ```typescript
  /** `$APPDATA/attachment_cache/**` is under `$APPDATA/**`; `$APPDATA/velo.key` too. */
  function pathSubsumed(entry: string, roots: string[]): boolean {
    return roots.some((root) => {
      if (root === entry) return true;
      const base = root.endsWith("/**") ? root.slice(0, -3) : root;
      return entry === base || entry.startsWith(`${base}/`);
    });
  }
  ```
- **Why it is wrong**:
  `pathSubsumed` tests whether `entry` starts with `${base}/` using string matching without path normalization. If an entry containing directory traversal characters is introduced (e.g. `"$APPDATA/attachment_cache/../velo.key"`), `entry.startsWith("$APPDATA/attachment_cache/")` evaluates to `true`. The test suite would falsely report that the path is subsumed within `$APPDATA/attachment_cache` and pass.
- **Concrete Fix**:
  Normalize paths using `path.relative` or `path.normalize` before checking containment:
  ```typescript
  function pathSubsumed(entry: string, roots: string[]): boolean {
    const cleanEntry = entry.replace(/\/\*\*$/, "");
    return roots.some((root) => {
      const cleanRoot = root.replace(/\/\*\*$/, "");
      const rel = relative(cleanRoot, cleanEntry);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
  }
  ```

---

#### 5. Write-Root Test Skips String Permissions, Leaving `fs:allow-write-text-file` Unchecked
- **Severity**: MEDIUM
- **File**: `src/config/capabilities.test.ts`
- **Exact Code**:
  ```typescript
    it("lets a content window write only under the attachment cache (Grok H1 on #75)", () => {
      for (const p of content.permissions) {
        if (typeof p === "string") continue;
        const writes = /^fs:allow-(write|mkdir|create|copy|rename|remove|truncate)/.test(p.identifier);
        if (!writes) continue;
        for (const entry of scopeOf(p)) {
          expect(pathSubsumed(entry, CONTENT_WRITE_ROOTS), `${p.identifier} ${entry}`).toBe(true);
        }
      }
  ```
- **Why it is wrong**:
  The check explicitly skips string permissions via `if (typeof p === "string") continue;`.
  Because `"fs:allow-write-text-file"` is declared in `content.json` as a bare string, this test ignores it entirely. The test claims to assert that content windows can write only under `attachment_cache`, but an unscoped string write permission was present in `content.json` and completely bypassed verification. Any write permission added as a string identifier in the future would likewise escape this test.
- **Concrete Fix**:
  Ensure that write permissions cannot exist as un-scoped strings in `content.json`:
  ```typescript
      for (const p of content.permissions) {
        const id = idOf(p);
        const isWrite = /^fs:allow-(write|mkdir|create|copy|rename|remove|truncate)/.test(id);
        if (!isWrite) continue;
        if (typeof p === "string") {
          throw new Error(`Write permission ${id} must not be declared as an unscoped string`);
        }
        for (const entry of scopeOf(p)) {
          expect(pathSubsumed(entry, CONTENT_WRITE_ROOTS), `${id} ${entry}`).toBe(true);
        }
      }
  ```

---

#### 6. Missing Manifest Check Causes Silent Test Skipping in CI
- **Severity**: LOW
- **File**: `src/config/capabilities.test.ts`
- **Exact Code**:
  ```typescript
    const manifest = resolve(ROOT, "src-tauri/gen/schemas/acl-manifests.json");
    it.skipIf(!existsSync(manifest))(
      "keeps the expansion table equal to the generated ACL manifest (delta F3 on #75)",
      () => {
  ```
- **Why it is wrong**:
  `src-tauri/gen/schemas/acl-manifests.json` is gitignored and only created during `cargo check` / `cargo build`. If `vitest` runs in CI before or without running `cargo check`, this test is silently skipped. Drift between `DEFAULT_SET_MEMBERS` / `COMMAND_LIST_MEMBERS` and the actual Tauri plugin manifests will not fail the build.
- **Concrete Fix**:
  Fail explicitly in CI if the manifest is missing:
  ```typescript
    it("keeps the expansion table equal to the generated ACL manifest (delta F3 on #75)", () => {
      if (!existsSync(manifest)) {
        if (process.env.CI) {
          throw new Error("ACL manifest missing; cargo check must run before vitest in CI");
        }
        return;
      }
      // ...
    });
  ```

---

#### 7. Unknown Window Labels Default to `"main"`
- **Severity**: LOW
- **File**: `src/utils/windowKind.ts`
- **Exact Code**:
  ```typescript
  export function windowKindFromLabel(label: string): WindowKind {
    if (label.startsWith("thread-")) return "thread";
    if (label.startsWith("compose-")) return "compose";
    return "main";
  }
  ```
- **Why it is wrong**:
  Any future window (e.g. `settings`, `about`, `contacts`) will match neither `thread-` nor `compose-` and will evaluate to `"main"`. Consequently, `isPopoutWindow()` will return `false`, and `main.tsx` will mount `<RouterProvider router={router} />` assuming it is the main window, despite holding no permissions from `main.json`.
- **Concrete Fix**:
  Differentiate `"main"` from unknown labels:
  ```typescript
  export type WindowKind = "main" | "thread" | "compose" | "unknown";

  export function windowKindFromLabel(label: string): WindowKind {
    if (label === "main") return "main";
    if (label.startsWith("thread-")) return "thread";
    if (label.startsWith("compose-")) return "compose";
    return "unknown";
  }
  ```
  Adjust `isPopoutWindow` or routing logic accordingly so non-main auxiliary windows do not masquerade as `main`.

---

#### 8. Event Snooping via `core:event:allow-listen`
- **Severity**: NIT
- **File**: `src-tauri/capabilities/content.json`
- **Exact Code**:
  ```json
      "core:event:allow-listen",
      "core:event:allow-unlisten",
  ```
- **Why it is wrong**:
  While `allow-emit` and `allow-emit-to` were correctly stripped to prevent content windows from triggering actions in `main`, `allow-listen` allows a compromised pop-out window to listen to all events emitted across the app. If `main` emits event payloads containing sensitive user data or tokens (e.g., in `single-instance-args` or background sync notifications), a compromised thread pop-out can inspect them.
- **Concrete Fix**:
  Audit all global event emissions in `main` to ensure sensitive parameters (tokens, credentials) are never passed in event payloads.

---

### Verdict
**CHANGES REQUESTED**
