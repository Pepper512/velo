/**
 * xAI (Grok) provider, and the shared OpenAI-compatible body it uses
 * (audit P16(3) + the accepted Grok feature).
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

import { createXaiProvider, clearXaiProvider } from "./xaiProvider";

describe("xaiProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConfig.length = 0;
    clearXaiProvider();
  });

  it("points at the xAI OpenAI-compatible endpoint", () => {
    createXaiProvider("xai-key", "grok-4.6");
    expect(capturedConfig[0]).toMatchObject({
      apiKey: "xai-key",
      baseURL: "https://api.x.ai/v1",
    });
  });

  it("sends the system and user content as chat messages", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "hi" } }] });
    const provider = createXaiProvider("xai-key", "grok-4.6");

    const out = await provider.complete({
      systemPrompt: "You are terse.",
      userContent: "Summarise this.",
    });

    expect(out).toBe("hi");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "grok-4.6",
        messages: [
          { role: "system", content: "You are terse." },
          { role: "user", content: "Summarise this." },
        ],
      }),
    );
  });

  it("returns an empty string rather than undefined when the model returns nothing", async () => {
    // The AI boundary treats model output as untrusted (P10); callers expect a
    // string, so an empty response must not become `undefined`.
    mockCreate.mockResolvedValue({ choices: [] });
    const provider = createXaiProvider("k", "grok-4.6");
    await expect(provider.complete({ systemPrompt: "s", userContent: "u" })).resolves.toBe("");
  });

  it("reports a failed connection as false rather than throwing", async () => {
    mockCreate.mockRejectedValue(new Error("401 Unauthorized"));
    const provider = createXaiProvider("bad-key", "grok-4.6");
    await expect(provider.testConnection()).resolves.toBe(false);
  });

  it("reports a working connection as true", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "hi" } }] });
    const provider = createXaiProvider("good-key", "grok-4.6");
    await expect(provider.testConnection()).resolves.toBe(true);
  });

  it("reuses the client for the same key and rebuilds after a clear", () => {
    createXaiProvider("k1", "grok-4.6");
    createXaiProvider("k1", "grok-4.6");
    expect(capturedConfig).toHaveLength(1);

    clearXaiProvider();
    createXaiProvider("k1", "grok-4.6");
    expect(capturedConfig).toHaveLength(2);
  });
});
