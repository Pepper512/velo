/**
 * Gemini provider — plain `fetch` against the `generateContent` REST endpoint
 * (dependency-audit PR C: the EOL SDK removed, nothing added in its place).
 *
 * The wire format asserted here is the one `@google/genai` itself emits, read
 * from its source rather than from docs: `v1beta`, `models/{model}:generateContent`,
 * the key in an `x-goog-api-key` header, `systemInstruction` in the body, and
 * `candidates[0].content.parts[].text` with `thought` parts skipped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createGeminiProvider } from "./geminiProvider";
import { AiError } from "../errors";

const mockFetch = vi.fn();

const MODEL = "gemini-2.5-flash-preview-05-20";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function reply(...parts: Array<{ text?: string; thought?: boolean }>): Response {
  return jsonResponse(200, { candidates: [{ content: { parts } }] });
}

function lastRequest(): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const call = mockFetch.mock.calls.at(-1) as [string, RequestInit] | undefined;
  if (!call) throw new Error("fetch was not called");
  const [url, init] = call;
  return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

describe("geminiProvider", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the model's generateContent endpoint with the key in a header, never in the URL", async () => {
    mockFetch.mockResolvedValue(reply({ text: "hi" }));

    await createGeminiProvider("g-key", MODEL).complete({ systemPrompt: "s", userContent: "u" });

    const { url, init } = lastRequest();
    expect(url).toBe(ENDPOINT);
    expect(url).not.toContain("g-key");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("g-key");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("sends the system prompt as systemInstruction and the user content as a user turn", async () => {
    mockFetch.mockResolvedValue(reply({ text: "hi" }));

    const out = await createGeminiProvider("k", MODEL).complete({
      systemPrompt: "You are terse.",
      userContent: "Summarise this.",
    });

    expect(out).toBe("hi");
    expect(lastRequest().body).toMatchObject({
      systemInstruction: { parts: [{ text: "You are terse." }] },
      contents: [{ role: "user", parts: [{ text: "Summarise this." }] }],
    });
  });

  it("honours maxTokens and applies the shared default when the caller gives none", async () => {
    // A Response body can be read once, so each call needs a fresh one.
    mockFetch.mockImplementation(() => Promise.resolve(reply({ text: "hi" })));
    const provider = createGeminiProvider("k", MODEL);

    await provider.complete({ systemPrompt: "s", userContent: "u", maxTokens: 77 });
    expect(lastRequest().body).toMatchObject({ generationConfig: { maxOutputTokens: 77 } });

    await provider.complete({ systemPrompt: "s", userContent: "u" });
    expect(lastRequest().body).toMatchObject({ generationConfig: { maxOutputTokens: 1024 } });
  });

  it("concatenates text parts and skips thinking parts", async () => {
    mockFetch.mockResolvedValue(
      reply({ text: "private reasoning", thought: true }, { text: "Hello, " }, { text: "world" }),
    );

    await expect(
      createGeminiProvider("k", MODEL).complete({ systemPrompt: "s", userContent: "u" }),
    ).resolves.toBe("Hello, world");
  });

  it("returns an empty string for a present-but-empty answer, like the sibling providers", async () => {
    mockFetch.mockResolvedValue(reply({ text: "" }));

    await expect(
      createGeminiProvider("k", MODEL).complete({ systemPrompt: "s", userContent: "u" }),
    ).resolves.toBe("");
  });

  it("throws a typed error rather than returning undefined when the reply carries no text part", async () => {
    // The AI boundary treats model output as untrusted (P10). A response with
    // no candidate text — a safety block, a malformed body — must not become
    // `undefined` flowing into the compose path.
    mockFetch.mockResolvedValue(
      jsonResponse(200, { candidates: [], promptFeedback: { blockReason: "SAFETY" } }),
    );

    const attempt = createGeminiProvider("k", MODEL).complete({ systemPrompt: "s", userContent: "u" });
    await expect(attempt).rejects.toBeInstanceOf(AiError);
    await expect(attempt).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("throws a typed error when the only parts are thinking parts", async () => {
    mockFetch.mockResolvedValue(reply({ text: "private reasoning", thought: true }));

    await expect(
      createGeminiProvider("k", MODEL).complete({ systemPrompt: "s", userContent: "u" }),
    ).rejects.toBeInstanceOf(AiError);
  });

  it("throws a typed error when the body is not the documented shape at all", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { candidates: "nope" }));

    await expect(
      createGeminiProvider("k", MODEL).complete({ systemPrompt: "s", userContent: "u" }),
    ).rejects.toBeInstanceOf(AiError);
  });

  it.each([
    [401, "AUTH_ERROR"],
    [403, "AUTH_ERROR"],
    [429, "RATE_LIMITED"],
    [500, "NETWORK_ERROR"],
  ])("maps HTTP %i to AiError %s", async (status, code) => {
    mockFetch.mockResolvedValue(jsonResponse(status, { error: { message: "nope" } }));

    const attempt = createGeminiProvider("k", MODEL).complete({ systemPrompt: "s", userContent: "u" });
    await expect(attempt).rejects.toBeInstanceOf(AiError);
    await expect(attempt).rejects.toMatchObject({ code });
  });

  it("maps a network failure to AiError NETWORK_ERROR", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      createGeminiProvider("k", MODEL).complete({ systemPrompt: "s", userContent: "u" }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("never puts the API key in an error message", async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, { error: { message: "API key not valid: secret-key-123" } }));

    await expect(
      createGeminiProvider("secret-key-123", MODEL).complete({ systemPrompt: "s", userContent: "u" }),
    ).rejects.not.toThrow(/secret-key-123/);
  });

  it("reports a failed connection as false rather than throwing", async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, { error: { message: "bad key" } }));
    await expect(createGeminiProvider("bad-key", MODEL).testConnection()).resolves.toBe(false);

    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(createGeminiProvider("bad-key", MODEL).testConnection()).resolves.toBe(false);
  });

  it("reports a working connection as true using a tiny token budget", async () => {
    mockFetch.mockResolvedValue(reply({ text: "hi" }));

    await expect(createGeminiProvider("good-key", MODEL).testConnection()).resolves.toBe(true);
    expect(lastRequest().body).toMatchObject({ generationConfig: { maxOutputTokens: 10 } });
  });

  it("still reports a working connection when the tiny budget was all spent on thinking", async () => {
    // The default model is a thinking model; on Gemini 2.5 thinking tokens come
    // out of the same maxOutputTokens budget, so a 10-token liveness check can
    // legitimately return a 200 with no text part. That is a working key, not a
    // broken one — strictness about text belongs to complete(), not here.
    mockFetch.mockResolvedValue(reply({ text: "private reasoning", thought: true }));
    await expect(createGeminiProvider("good-key", MODEL).testConnection()).resolves.toBe(true);

    mockFetch.mockResolvedValue(
      jsonResponse(200, { candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] }),
    );
    await expect(createGeminiProvider("good-key", MODEL).testConnection()).resolves.toBe(true);
  });
});
