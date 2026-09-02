import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("tauri.conf.json", () => {
  const configPath = resolve(__dirname, "../../src-tauri/tauri.conf.json");
  const config = JSON.parse(readFileSync(configPath, "utf-8"));

  /**
   * SPEC-197: the CSP as a map of directive → sources. Remote images are
   * gated by the sanitizer (the "Block Remote Images" setting and the
   * per-sender allowlist); the CSP must let an allowed HTTPS image load and
   * must not move anything else.
   */
  const csp: Record<string, string[]> = Object.fromEntries(
    (config.app.security.csp as string)
      .split(";")
      .map((d: string) => d.trim())
      .filter(Boolean)
      .map((d: string) => {
        const [name, ...sources] = d.split(/\s+/);
        return [name, sources];
      }),
  );

  it("lets an allowed remote image load over https, and nothing else (SPEC-197 REQ-1.1–1.3)", () => {
    expect(csp["img-src"]).toEqual(["'self'", "data:", "https:"]);
    expect(csp["img-src"]).not.toContain("http:");
    expect(csp["img-src"]).not.toContain("*");
  });

  it("leaves the other directives exactly as they are (SPEC-197 REQ-1.3)", () => {
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp["font-src"]).toEqual(["'self'", "data:"]);
    expect(csp["frame-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual([
      "https://www.googleapis.com",
      "https://oauth2.googleapis.com",
      "https://api.anthropic.com",
      "https://api.openai.com",
      "https://generativelanguage.googleapis.com",
      "https://www.gravatar.com",
      "https://login.microsoftonline.com",
      "https://graph.microsoft.com",
      "https://api.login.yahoo.com",
      "http://localhost:11434",
      "http://localhost:1234",
      "http://127.0.0.1:11434",
      "http://127.0.0.1:1234",
      "https://models.github.ai",
      "https://api.x.ai",
    ]);
    expect(Object.keys(csp).sort()).toEqual(
      ["connect-src", "default-src", "font-src", "frame-src", "img-src", "script-src", "style-src"],
    );
  });

  it("should disable native drag-drop on the main window so HTML5 events reach the webview", () => {
    const mainWindow = config.app.windows.find(
      (w: { label: string }) => w.label === "main",
    );
    expect(mainWindow).toBeDefined();
    expect(mainWindow.dragDropEnabled).toBe(false);
  });
});
