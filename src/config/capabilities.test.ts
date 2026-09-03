import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

/**
 * The Tauri capability grant, as committed (SPEC-P11, SPEC-280).
 *
 * Two files: `main.json` for the main window — today's full list, pinned
 * literally so the split cannot narrow it by accident — and `content.json`
 * for the windows that render untrusted email (`thread-*`, `compose-*`),
 * which hold only what they demonstrably call. The splash page runs no
 * script and is in no file.
 *
 * What these tests reach is the JSON. What they cannot reach is the runtime:
 * whether a narrowed window still works, and whether a removed permission is
 * actually denied. That is Jim's five-step manual QA in the spec.
 */
const DIR = resolve(__dirname, "../../src-tauri/capabilities");

type Permission =
  | string
  | { identifier: string; allow?: { url?: string; path?: string }[] };

interface Capability {
  identifier: string;
  windows: string[];
  permissions: Permission[];
}

function load(name: string): Capability {
  return JSON.parse(readFileSync(resolve(DIR, name), "utf-8")) as Capability;
}

const idOf = (p: Permission): string => (typeof p === "string" ? p : p.identifier);

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
  {
    identifier: "http:default",
    allow: [
      { url: "http://*" },
      { url: "http://*/*" },
      { url: "http://127.0.0.1:*" },
      { url: "http://127.0.0.1:*/*" },
      { url: "http://localhost:*" },
      { url: "http://localhost:*/*" },
      { url: "https://*" },
      { url: "https://*/*" },
    ],
  },
  "updater:default",
  "process:allow-restart",
  "os:default",
];

/**
 * What a window that renders email must never hold (SPEC-P11 REQ-1.2). Each
 * one was shown main-only by import; the reason is beside it.
 */
const FORBIDDEN_IN_CONTENT = [
  "core:webview:allow-create-webview-window", // the pop-out buttons are hidden inside a pop-out
  "fs:allow-remove", // cacheManager's evict/clear are Settings-only
  "core:window:allow-set-badge-count", // badgeManager is App-only
  "core:window:allow-minimize", // TitleBar is main-only; pop-outs have native decorations
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
];

/** What a pop-out does call (SPEC-P11 REQ-1.3), with the caller beside it. */
const REQUIRED_IN_CONTENT = [
  "core:default", // events (sessionManager's listener), read-only window queries
  "sql:default", // load + select
  "sql:allow-execute", // runMigrations on mount; draft auto-save every 3 s
  "opener:allow-open-url", // links in email (openLink) …
  "opener:allow-default-urls", // … with the default URL set (http, https, mailto, tel)
  "dialog:default", // attachment save
  "fs:default",
  "fs:allow-appdata-read-recursive", // attachment cache, velo.key
  "fs:allow-appdata-write-recursive",
  "fs:allow-read-file",
  "fs:allow-write-file", // attachment save, velo.key on first run
  "fs:allow-exists",
  "fs:allow-mkdir",
  "fs:scope",
  "http:default", // unsubscribe POST, Ollama
];

/**
 * The content grant, literally (Gemini 3.8 M5 on #75): a permission that is
 * in main and not on the forbidden list could otherwise be added here without
 * a test going red. Widening this list is a Tier-2 change with a reason.
 */
const CONTENT_PERMISSIONS: Permission[] = [
  "core:default",
  "sql:default",
  "sql:allow-execute",
  "opener:allow-open-url",
  "opener:allow-default-urls",
  "dialog:default",
  "fs:default",
  "fs:allow-appdata-read-recursive",
  "fs:allow-appdata-write-recursive",
  "fs:allow-read-file",
  "fs:allow-write-file",
  "fs:allow-exists",
  "fs:allow-mkdir",
  {
    identifier: "fs:scope",
    allow: [{ path: "$APPDATA" }, { path: "$APPDATA/**" }],
  },
  {
    identifier: "http:default",
    allow: [
      { url: "http://*" },
      { url: "http://*/*" },
      { url: "http://127.0.0.1:*" },
      { url: "http://127.0.0.1:*/*" },
      { url: "http://localhost:*" },
      { url: "http://localhost:*/*" },
      { url: "https://*" },
      { url: "https://*/*" },
    ],
  },
];

/**
 * What a `<plugin>:default` set in main expands to, from the generated ACL
 * manifest, so content may name a member of a set main holds whole. Only the
 * sets content actually narrows are listed; anything else must match by id.
 */
const DEFAULT_SET_MEMBERS: Record<string, string[]> = {
  "opener:default": [
    "opener:allow-open-url",
    "opener:allow-reveal-item-in-dir",
    "opener:allow-default-urls",
  ],
};

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

  it("does not let a content window reveal files in the file manager", () => {
    const ids = content.permissions.map(idOf);
    expect(ids).not.toContain("opener:default");
    expect(ids).not.toContain("opener:allow-reveal-item-in-dir");
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

  it("keeps in content windows everything a pop-out calls", () => {
    const ids = content.permissions.map(idOf);
    for (const required of REQUIRED_IN_CONTENT) {
      expect(ids, `${required} is needed by a pop-out`).toContain(required);
    }
  });

  it("scopes fs to $APPDATA in both files, identically", () => {
    const scopeOf = (c: Capability) =>
      c.permissions.find((p) => typeof p === "object" && p.identifier === "fs:scope");
    expect(scopeOf(content)).toEqual(scopeOf(main));
    expect(scopeOf(main)).toEqual({
      identifier: "fs:scope",
      allow: [{ path: "$APPDATA" }, { path: "$APPDATA/**" }],
    });
  });
});

/**
 * SPEC-280: the http plugin's scope. The plugin matches with the `urlpattern`
 * crate — the WHATWG URLPattern algorithm — where a pattern with no port
 * matches only the scheme's default port. Node's `URLPattern` is the same
 * algorithm, so the committed capability files can be checked here against the
 * URLs that matter, positive and negative. Both files carry the scope, and it
 * must be the same scope: a pop-out's unsubscribe and Ollama calls are the
 * same calls main makes.
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
    expect((http?.allow ?? []).map((a) => a.url)).toEqual([
      "http://*",
      "http://*/*",
      "http://127.0.0.1:*",
      "http://127.0.0.1:*/*",
      "http://localhost:*",
      "http://localhost:*/*",
      "https://*",
      "https://*/*",
    ]);
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
