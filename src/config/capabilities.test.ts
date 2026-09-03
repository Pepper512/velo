import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";

/**
 * The Tauri capability grant, as committed (SPEC-P11, SPEC-280).
 *
 * Two files: `main.json` for the main window — today's full list, pinned
 * literally so the split cannot narrow it by accident — and `content.json`
 * for the windows that render untrusted email (`thread-*`, `compose-*`),
 * which hold only what they demonstrably call, scoped to the paths they use,
 * and are pinned literally too so nothing can be added without a test going
 * red. The splash page runs no script and is in no file.
 *
 * What these tests reach is the JSON and the source. What they cannot reach is
 * the runtime: whether a narrowed window still works, and whether a removed
 * permission is actually denied. That is Jim's five-step manual QA in the spec.
 */
const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, "src-tauri/capabilities");

type ScopeEntry = { url?: string; path?: string };
type Permission = string | { identifier: string; allow?: ScopeEntry[] };

interface Capability {
  identifier: string;
  windows: string[];
  permissions: Permission[];
}

function load(name: string): Capability {
  return JSON.parse(readFileSync(resolve(DIR, name), "utf-8")) as Capability;
}

const idOf = (p: Permission): string => (typeof p === "string" ? p : p.identifier);
const scopeOf = (p: Permission): string[] =>
  typeof p === "string" ? [] : (p.allow ?? []).map((a) => a.path ?? a.url ?? "");

const HTTP_SCOPE = [
  { url: "http://*" },
  { url: "http://*/*" },
  { url: "http://127.0.0.1:*" },
  { url: "http://127.0.0.1:*/*" },
  { url: "http://localhost:*" },
  { url: "http://localhost:*/*" },
  { url: "https://*" },
  { url: "https://*/*" },
];

/** `main`'s grant, exactly as it was before the split (the old `default.json`). */
const MAIN_PERMISSIONS: Permission[] = [
  "core:default",
  "core:window:default",
  "core:webview:allow-create-webview-window",
  "sql:default",
  "sql:allow-load",
  "sql:allow-execute",
  "sql:allow-select",
  "sql:allow-close",
  "notification:default",
  "notification:allow-is-permission-granted",
  "notification:allow-request-permission",
  "notification:allow-notify",
  "notification:allow-register-action-types",
  "core:event:default",
  "core:event:allow-listen",
  "core:event:allow-emit",
  "opener:default",
  "opener:allow-open-url",
  "dialog:default",
  "dialog:allow-save",
  "fs:default",
  "fs:allow-appdata-read-recursive",
  "fs:allow-appdata-write-recursive",
  "fs:allow-read-file",
  "fs:allow-write-file",
  "fs:allow-exists",
  "fs:allow-mkdir",
  "fs:allow-remove",
  {
    identifier: "fs:scope",
    allow: [{ path: "$APPDATA" }, { path: "$APPDATA/**" }],
  },
  "core:window:allow-minimize",
  "core:window:allow-toggle-maximize",
  "core:window:allow-close",
  "core:window:allow-is-maximized",
  "core:window:allow-start-dragging",
  "core:window:allow-show",
  "core:window:allow-set-focus",
  "autostart:default",
  "autostart:allow-enable",
  "autostart:allow-disable",
  "autostart:allow-is-enabled",
  "global-shortcut:default",
  "global-shortcut:allow-register",
  "global-shortcut:allow-unregister",
  "global-shortcut:allow-unregister-all",
  "global-shortcut:allow-is-registered",
  "deep-link:default",
  "core:window:allow-set-badge-count",
  { identifier: "http:default", allow: HTTP_SCOPE },
  "updater:default",
  "process:allow-restart",
  "os:default",
];

/**
 * The content grant, literally (Gemini 3.8 M5, Grok M5 on #75). The caller
 * that needs each entry is beside it; widening this list is a Tier-2 change
 * with a reason.
 */
const CONTENT_PERMISSIONS: Permission[] = [
  "core:path:default", // join() in the attachment cache
  "core:event:allow-listen", // the IMAP session manager's invalidation listener …
  "core:event:allow-unlisten", // … and its cleanup. No emit: main acts on events.
  "sql:allow-load", // getDb()
  "sql:allow-select",
  "sql:allow-execute", // draft auto-save, the sent copy; migrations on mount (idempotent)
  "opener:allow-open-url", // links in email (openLink) …
  "opener:allow-default-urls", // … with the default URL set (http, https, mailto, tel)
  "dialog:allow-save", // saving an attachment or an .eml
  "fs:deny-default", // the platform's sensitive paths stay denied
  {
    identifier: "fs:allow-exists", // crypto.ts: is velo.key there; cacheManager
    allow: [
      { path: "$APPDATA/velo.key" },
      { path: "$APPDATA/attachment_cache" },
      { path: "$APPDATA/attachment_cache/**" },
    ],
  },
  {
    identifier: "fs:allow-read-text-file", // crypto.ts reads velo.key to decrypt credentials
    allow: [{ path: "$APPDATA/velo.key" }],
  },
  {
    identifier: "fs:allow-read-file", // loadCachedAttachment
    allow: [{ path: "$APPDATA/attachment_cache/**" }],
  },
  {
    identifier: "fs:allow-mkdir", // cacheAttachment creates the cache dir
    allow: [{ path: "$APPDATA/attachment_cache" }],
  },
  {
    identifier: "fs:allow-write-file", // cacheAttachment; a dialog-picked save path comes from the runtime scope
    allow: [{ path: "$APPDATA/attachment_cache/**" }],
  },
  "fs:allow-write-text-file", // .eml export to a dialog-picked path (runtime scope only)
  { identifier: "http:default", allow: HTTP_SCOPE }, // unsubscribe POST, Ollama — residual
];

/**
 * What a window that renders email must never hold (SPEC-P11 REQ-1.2). Each
 * one was shown main-only by import, or is a write onto the credential store.
 */
const FORBIDDEN_IN_CONTENT = [
  "core:default", // carries emit, menu, tray, webview and window sets
  "core:event:default",
  "core:event:allow-emit", // main listens for single-instance-args (opens a composer)
  "core:event:allow-emit-to",
  "core:webview:allow-create-webview-window", // the pop-out buttons are hidden inside a pop-out
  "fs:default", // carries recursive read of the app directories
  "fs:scope", // no blanket scope: every fs permission names its paths
  "fs:allow-appdata-read-recursive", // velo.key and the database file
  "fs:allow-appdata-write-recursive",
  "fs:allow-read-dir",
  "fs:allow-remove", // cacheManager's evict/clear are Settings-only
  "sql:default", // carries allow-close
  "sql:allow-close",
  "dialog:default", // carries open and message
  "dialog:allow-open",
  "dialog:allow-message",
  "opener:default", // carries reveal-item-in-dir
  "opener:allow-reveal-item-in-dir",
  "core:window:default",
  "core:window:allow-set-badge-count", // badgeManager is App-only
  "core:window:allow-minimize", // TitleBar is main-only; lib.rs strips decorations from main only
  "core:window:allow-toggle-maximize",
  "core:window:allow-close",
  "core:window:allow-is-maximized",
  "core:window:allow-start-dragging",
  "core:window:allow-show",
  "core:window:allow-set-focus", // only the pop-out creators focus another window
];

/** Whole plugins that nothing in a pop-out calls. */
const FORBIDDEN_PLUGINS_IN_CONTENT = [
  "notification:",
  "autostart:",
  "global-shortcut:",
  "deep-link:",
  "updater:",
  "process:",
  "os:",
  "core:menu:",
  "core:tray:",
];

/** Paths a content window may write. Everything it writes must sit under one of these. */
const CONTENT_WRITE_ROOTS = ["$APPDATA/attachment_cache"];

/**
 * What the sets main holds whole expand to, so content may name a member of
 * one. Copied from the generated ACL manifest
 * (`src-tauri/gen/schemas/acl-manifests.json`, gitignored); the test below
 * checks this table against the manifest whenever a local build has produced
 * it, so an upstream change to a set cannot leave the table stale unnoticed
 * (delta review F3 on #75).
 */
const DEFAULT_SET_MEMBERS: Record<string, string[]> = {
  "core:default": [
    "core:path:default",
    "core:event:default",
    "core:window:default",
    "core:webview:default",
    "core:app:default",
    "core:image:default",
    "core:resources:default",
    "core:menu:default",
    "core:tray:default",
  ],
  "core:event:default": [
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "core:event:allow-emit",
    "core:event:allow-emit-to",
  ],
  "sql:default": ["sql:allow-close", "sql:allow-load", "sql:allow-select"],
  "dialog:default": ["dialog:allow-message", "dialog:allow-save", "dialog:allow-open"],
  "opener:default": [
    "opener:allow-open-url",
    "opener:allow-reveal-item-in-dir",
    "opener:allow-default-urls",
  ],
  "fs:default": [
    "fs:create-app-specific-dirs",
    "fs:read-app-specific-dirs-recursive",
    "fs:deny-default",
  ],
  "fs:read-app-specific-dirs-recursive": [
    "fs:allow-read-dir",
    "fs:allow-read-file",
    "fs:allow-read-text-file",
    "fs:allow-read-text-file-lines",
    "fs:allow-read-text-file-lines-next",
    "fs:allow-exists",
    "fs:scope-app-recursive",
  ],
  "fs:create-app-specific-dirs": ["fs:allow-mkdir", "fs:scope-app-index"],
  "fs:allow-appdata-read-recursive": ["fs:read-all", "fs:scope-appdata-recursive"],
  "fs:allow-appdata-write-recursive": ["fs:write-all", "fs:scope-appdata-recursive"],
};

/**
 * `read-all` and `write-all` are command lists, not sets of permissions; a
 * command `x_y` is reached through the permission `allow-x-y`.
 */
const COMMAND_LIST_MEMBERS: Record<string, string[]> = {
  "fs:read-all": [
    "read_dir",
    "read_file",
    "read",
    "open",
    "read_text_file",
    "read_text_file_lines",
    "read_text_file_lines_next",
    "seek",
    "stat",
    "lstat",
    "fstat",
    "exists",
    "watch",
    "unwatch",
  ].map((c) => `fs:allow-${c.replaceAll("_", "-")}`),
  "fs:write-all": [
    "mkdir",
    "create",
    "copy_file",
    "remove",
    "rename",
    "truncate",
    "ftruncate",
    "write",
    "write_file",
    "write_text_file",
  ].map((c) => `fs:allow-${c.replaceAll("_", "-")}`),
};

/** Every permission id main reaches, through its sets, transitively. */
function expand(ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const m of DEFAULT_SET_MEMBERS[id] ?? []) queue.push(m);
    for (const m of COMMAND_LIST_MEMBERS[id] ?? []) queue.push(m);
  }
  return out;
}

/** `$APPDATA/attachment_cache/**` is under `$APPDATA/**`; `$APPDATA/velo.key` too. */
function pathSubsumed(entry: string, roots: string[]): boolean {
  return roots.some((root) => {
    if (root === entry) return true;
    const base = root.endsWith("/**") ? root.slice(0, -3) : root;
    return entry === base || entry.startsWith(`${base}/`);
  });
}

describe("capabilities — the split (SPEC-P11)", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
  const main = load("main.json");
  const content = load("content.json");

  it("is exactly two files: main and content — default.json is gone", () => {
    expect(files).toEqual(["content.json", "main.json"]);
  });

  it("partitions the windows: main alone, the two content globs together, splash in neither", () => {
    expect(main.identifier).toBe("main");
    expect(main.windows).toEqual(["main"]);
    expect(content.identifier).toBe("content");
    expect(content.windows).toEqual(["thread-*", "compose-*"]);
    for (const file of files) {
      expect(load(file).windows, `${file} must not grant the splash page anything`).not.toContain(
        "splashscreen",
      );
    }
  });

  it("leaves main's grant exactly as it was", () => {
    expect(main.permissions).toEqual(MAIN_PERMISSIONS);
  });

  it("is exactly the content grant, and nothing more", () => {
    expect(content.permissions).toEqual(CONTENT_PERMISSIONS);
  });

  it("gives content windows a strict subset of main's grant, by id", () => {
    const reachable = expand(main.permissions.map(idOf));
    for (const p of content.permissions) {
      expect(reachable.has(idOf(p)), `${idOf(p)} is in content but main cannot reach it`).toBe(
        true,
      );
    }
    const contentIds = new Set(content.permissions.map(idOf));
    expect([...reachable].some((id) => !contentIds.has(id))).toBe(true);
  });

  it("gives content windows a subset of main's scopes, by path and url", () => {
    const mainFsRoots = main.permissions.flatMap((p) => (idOf(p) === "fs:scope" ? scopeOf(p) : []));
    const mainUrls = main.permissions.flatMap((p) =>
      idOf(p) === "http:default" ? scopeOf(p) : [],
    );
    for (const p of content.permissions) {
      if (typeof p === "string") continue;
      for (const entry of scopeOf(p)) {
        if (p.identifier.startsWith("fs:")) {
          expect(pathSubsumed(entry, mainFsRoots), `${p.identifier} ${entry}`).toBe(true);
        } else if (p.identifier === "http:default") {
          expect(mainUrls, `${p.identifier} ${entry}`).toContain(entry);
        } else {
          throw new Error(`unexpected scoped permission in content: ${p.identifier}`);
        }
      }
    }
  });

  it("lets a content window write only under the attachment cache (Grok H1 on #75)", () => {
    // velo.key and the database file live in $APPDATA; a window that renders
    // email reads the key (credentials decrypt in the page) and never writes
    // beside it. Dialog-picked save paths arrive through the runtime scope.
    for (const p of content.permissions) {
      if (typeof p === "string") continue;
      const writes = /^fs:allow-(write|mkdir|create|copy|rename|remove|truncate)/.test(p.identifier);
      if (!writes) continue;
      for (const entry of scopeOf(p)) {
        expect(pathSubsumed(entry, CONTENT_WRITE_ROOTS), `${p.identifier} ${entry}`).toBe(true);
      }
    }
    const readsKey = content.permissions.filter((p) =>
      scopeOf(p).some((e) => e.endsWith("/velo.key")),
    );
    expect(readsKey.map(idOf).sort()).toEqual(["fs:allow-exists", "fs:allow-read-text-file"]);
  });

  it("withholds from content windows everything shown to be main-only", () => {
    const ids = content.permissions.map(idOf);
    for (const forbidden of FORBIDDEN_IN_CONTENT) {
      expect(ids, `${forbidden} must not reach a window that renders email`).not.toContain(
        forbidden,
      );
    }
    for (const plugin of FORBIDDEN_PLUGINS_IN_CONTENT) {
      const leaked = ids.filter((id) => id.startsWith(plugin));
      expect(leaked, `${plugin}* must not reach a window that renders email`).toEqual([]);
    }
  });

  const manifest = resolve(ROOT, "src-tauri/gen/schemas/acl-manifests.json");
  it.skipIf(!existsSync(manifest))(
    "keeps the expansion table equal to the generated ACL manifest (delta F3 on #75)",
    () => {
      type Manifest = Record<
        string,
        {
          default_permission?: { permissions: string[] };
          permission_sets?: Record<string, { permissions: string[] }>;
          permissions?: Record<string, { commands?: { allow: string[] } }>;
        }
      >;
      const m = JSON.parse(readFileSync(manifest, "utf-8")) as Manifest;
      for (const [set, members] of Object.entries(DEFAULT_SET_MEMBERS)) {
        const [plugin, name] = set.split(/:(?=[^:]+$)/) as [string, string];
        const entry =
          name === "default"
            ? m[plugin]?.default_permission
            : m[plugin]?.permission_sets?.[name] ?? m[plugin]?.permissions?.[name];
        const actual = (entry as { permissions?: string[] } | undefined)?.permissions?.map((p) =>
          p.includes(":") ? p : `${plugin}:${p}`,
        );
        expect(actual, set).toEqual(members);
      }
      for (const [list, members] of Object.entries(COMMAND_LIST_MEMBERS)) {
        const [plugin, name] = list.split(":") as [string, string];
        const commands = m[plugin]?.permissions?.[name]?.commands?.allow ?? [];
        expect(commands.map((c) => `${plugin}:allow-${c.replaceAll("_", "-")}`), list).toEqual(
          members,
        );
      }
    },
  );
});

/**
 * The create path, in the source (Grok M5/L6 on #75): the JSON tests cannot
 * see a runtime denial, but they can pin where a webview is created and that
 * the pop-out roots and gates share one rule.
 */
describe("capabilities — the create path in the source", () => {
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }
  const src = resolve(ROOT, "src");
  const files = sourceFiles(src);
  const contains = (needle: string) =>
    files.filter((f) => readFileSync(f, "utf-8").includes(needle)).map((f) => relative(ROOT, f)).sort();

  it("creates webview windows from exactly the three known sites", () => {
    expect(contains("new WebviewWindow(")).toEqual([
      "src/components/composer/Composer.tsx",
      "src/components/email/ThreadView.tsx",
      "src/components/ui/ContextMenuPortal.tsx",
    ]);
  });

  it("gates both pop-out-reachable creators, and routes the root, by the one rule", () => {
    expect(contains("isPopoutWindow()")).toEqual(
      expect.arrayContaining(["src/components/composer/Composer.tsx", "src/components/email/ThreadView.tsx"]),
    );
    expect(contains("currentWindowKind()")).toContain("src/main.tsx");
    expect(contains("new URLSearchParams(window.location.search)")).not.toContain("src/main.tsx");
  });
});

/**
 * SPEC-280: the http plugin's scope. The plugin matches with the `urlpattern`
 * crate — the WHATWG URLPattern algorithm — where a pattern with no port
 * matches only the scheme's default port. Node's `URLPattern` is the same
 * algorithm, so the committed capability files can be checked here against the
 * URLs that matter, positive and negative.
 *
 * Both files carry the scope, and today it is the same scope — **an accepted
 * residual, not a requirement** (SPEC-P11 threat pass; Grok M4 on #75): a
 * pop-out's unsubscribe POST goes to a sender-supplied URL and its Ollama
 * calls to a local port the user chose (#280). When unsubscribe moves behind
 * a Rust command and Ollama behind `ai_fetch`, `content.json` drops `http`
 * and this loop runs over `main.json` alone.
 */
describe.each(["main.json", "content.json"])("%s — http scope", (file) => {
  const capability = load(file);
  const http = capability.permissions.find(
    (p): p is { identifier: string; allow: { url: string }[] } =>
      typeof p === "object" && p.identifier === "http:default",
  );
  const patterns = (http?.allow ?? []).map((a) => new URLPattern(a.url));
  const allowed = (url: string) => patterns.some((p) => p.test(url));

  it("reaches a local model server on its port — Ollama, LM Studio, or any other (REQ-1.1)", () => {
    expect(allowed("http://127.0.0.1:11434/v1/chat/completions")).toBe(true);
    expect(allowed("http://localhost:11434/api/tags")).toBe(true);
    expect(allowed("http://localhost:1234/v1/models")).toBe(true);
    expect(allowed("http://127.0.0.1:8080/")).toBe(true);
    // Origin-only and query-carrying forms (Grok NIT 5 on #56).
    expect(allowed("http://127.0.0.1:11434")).toBe(true);
    expect(allowed("http://127.0.0.1:11434/v1/chat/completions?stream=false")).toBe(true);
  });

  it("is exactly the intended allow list — an extra host or port cannot slip in (Grok L2 on #56)", () => {
    expect((http?.allow ?? []).map((a) => a.url)).toEqual(HTTP_SCOPE.map((a) => a.url));
  });

  it("still reaches plain-http hosts on the default port, as before", () => {
    expect(allowed("http://example.com/x")).toBe(true);
  });

  it("does not widen plain http to other hosts on other ports (REQ-1.2)", () => {
    expect(allowed("http://evil.example:8080/x")).toBe(false);
    expect(allowed("http://10.0.0.5:11434/v1/models")).toBe(false);
    expect(http?.allow.some((a) => a.url.includes("*:*"))).toBe(false);
  });

  it("refuses look-alike hosts, private ranges and the metadata endpoint on odd ports (Gemini L3 on #56)", () => {
    expect(allowed("http://localhost.evil.com:11434/v1/models")).toBe(false);
    expect(allowed("http://127.0.0.1.nip.io:11434/v1/models")).toBe(false);
    expect(allowed("http://192.168.1.1:8080/api")).toBe(false);
    expect(allowed("http://169.254.169.254:8080/latest/meta-data")).toBe(false);
    // The Local AI ports themselves must not be open to other hosts (Grok L2 on #56).
    expect(allowed("http://evil.example:1234/v1/models")).toBe(false);
    expect(allowed("http://example.com:11434/v1/models")).toBe(false);
    expect(allowed("http://0.0.0.0:11434/v1/models")).toBe(false);
    expect(allowed("http://127.0.0.2:11434/")).toBe(false);
    expect(allowed("http://169.254.169.254:11434/")).toBe(false);
    expect(allowed("http://[::ffff:127.0.0.1]:11434/v1/models")).toBe(false);
    // IPv6 loopback by literal is deliberately not in the scope: the only
    // pattern form that parses (`http://\[\:\:1\]:*`) is verified for Node's
    // URLPattern, not for the Rust crate the plugin uses, and a pattern the
    // plugin cannot parse breaks startup. `http://localhost:*` covers a
    // loopback that resolves to ::1, because the scope checks the URL text.
    expect(allowed("http://[::1]:11434/v1/models")).toBe(false);
  });
});
