/**
 * Custom OpenAI-compatible provider (SPEC-209): configuration plus a client
 * whose transport is the Rust `ai_fetch` command.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const capturedConfig: Record<string, unknown>[] = [];

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
    constructor(config: Record<string, unknown>) {
      capturedConfig.push(config);
    }
  },
}));

const mockRustFetch = vi.fn();
vi.mock("../rustFetch", () => ({
  rustFetch: (...args: unknown[]) => mockRustFetch(...args),
}));

import { createCustomProvider, clearCustomProvider, normaliseBaseUrl, PLACEHOLDER_API_KEY } from "./customProvider";

describe("customProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConfig.length = 0;
    clearCustomProvider();
  });

  it("points the SDK at the user's base URL and at the Rust transport (REQ-1.1)", () => {
    createCustomProvider("https://openrouter.ai/api/v1/", "or-key", "openai/gpt-4o-mini");

    expect(capturedConfig[0]).toMatchObject({
      apiKey: "or-key",
      baseURL: "https://openrouter.ai/api/v1",
      dangerouslyAllowBrowser: true,
    });
    // The transport is the wrapper over `ai_fetch`, never the webview's fetch.
    const fetchArg = capturedConfig[0]!["fetch"] as (...a: unknown[]) => unknown;
    fetchArg("https://x/", {});
    expect(mockRustFetch).toHaveBeenCalledWith("https://x/", {});
  });

  it("sends a placeholder when the key is blank — a LAN gateway may not want one", () => {
    createCustomProvider("http://localhost:1234/v1", "   ", "local-model");

    expect(capturedConfig[0]).toMatchObject({ apiKey: PLACEHOLDER_API_KEY });
  });

  it("normalises the base URL: trims and drops trailing slashes", () => {
    expect(normaliseBaseUrl("  https://api.deepseek.com/v1///  ")).toBe("https://api.deepseek.com/v1");
    expect(normaliseBaseUrl("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com/v1");
  });

  it("reuses one client per base URL and key, and rebuilds when either changes", () => {
    createCustomProvider("https://a.example/v1", "k1", "m");
    createCustomProvider("https://a.example/v1", "k1", "m2"); // model is per request, not per client
    expect(capturedConfig).toHaveLength(1);

    createCustomProvider("https://a.example/v1", "k2", "m");
    expect(capturedConfig).toHaveLength(2);

    createCustomProvider("https://b.example/v1", "k2", "m");
    expect(capturedConfig).toHaveLength(3);

    clearCustomProvider();
    createCustomProvider("https://b.example/v1", "k2", "m");
    expect(capturedConfig).toHaveLength(4);
  });

  it("sends the system and user content as chat messages with the chosen model", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "hi" } }] });
    const provider = createCustomProvider("https://api.deepseek.com/v1", "k", "deepseek-chat");

    const out = await provider.complete({ systemPrompt: "You are terse.", userContent: "Summarise this." });

    expect(out).toBe("hi");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are terse." },
          { role: "user", content: "Summarise this." },
        ],
      }),
    );
  });

  it("reports a failed connection with its reason, credentials redacted (SPEC-280 REQ-2.1)", async () => {
    mockCreate.mockRejectedValue(new Error("401 Unauthorized: Bearer sk-abcdefghijklmnop rejected"));
    const provider = createCustomProvider("https://api.deepseek.com/v1", "k", "deepseek-chat");

    const result = await provider.testConnection();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("401");
      expect(result.error).not.toContain("sk-abcdefghijklmnop");
    }
  });
});
