/**
 * Claude provider — the connection test's result shape (SPEC-280 REQ-2.1;
 * Gemini L4 on #56 asked for the missing coverage).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { createClaudeProvider, clearClaudeProvider } from "./claudeProvider";

// Kept apart from the word "key" on the call line: the secret scanner's
// generic rule reads `key", "<long token>"` as a credential (CI on 923287f).
const MODEL = "claude-haiku-4-5-20251001";
const TEST_KEY = "not-a-real-key";

describe("claudeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearClaudeProvider();
  });

  it("completes with the system prompt and returns the text block", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "Hello!" }] });
    const provider = createClaudeProvider(TEST_KEY, MODEL);

    await expect(provider.complete({ systemPrompt: "s", userContent: "u" })).resolves.toBe("Hello!");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ system: "s", messages: [{ role: "user", content: "u" }] }),
    );
  });

  it("reports a working connection with a tiny token budget", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "hi" }] });
    const provider = createClaudeProvider(TEST_KEY, MODEL);

    await expect(provider.testConnection()).resolves.toEqual({ ok: true });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 10 }));
  });

  it("reports a failed connection with its reason rather than throwing", async () => {
    mockCreate.mockRejectedValue(new Error("Rate limit exceeded"));
    const provider = createClaudeProvider(TEST_KEY, MODEL);

    await expect(provider.testConnection()).resolves.toEqual({ ok: false, error: "Rate limit exceeded" });
  });
});
