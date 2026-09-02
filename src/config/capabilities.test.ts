import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * SPEC-280: the http plugin's scope. The plugin matches with the `urlpattern`
 * crate — the WHATWG URLPattern algorithm — where a pattern with no port
 * matches only the scheme's default port. Node's `URLPattern` is the same
 * algorithm, so the committed capability file can be checked here against the
 * URLs that matter, positive and negative.
 */
describe("capabilities/default.json — http scope", () => {
  const path = resolve(__dirname, "../../src-tauri/capabilities/default.json");
  const capability = JSON.parse(readFileSync(path, "utf-8")) as {
    permissions: (string | { identifier: string; allow?: { url: string }[] })[];
  };
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
