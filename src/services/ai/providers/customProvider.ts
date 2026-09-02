/**
 * Custom OpenAI-compatible provider (SPEC-209, upstream #209/#265).
 *
 * Configuration plus a client, like xAI — except that the base URL is the
 * user's, so the request cannot go through the webview's `fetch` (the static
 * CSP would refuse it) and goes through `rustFetch` instead: the `ai_fetch`
 * command in Rust enforces https-or-loopback, follows no redirect and forwards
 * an allow-listed header set. OpenRouter, DeepSeek and any LAN gateway that
 * speaks the chat-completions API are this provider with their URL.
 */
import OpenAI from "openai";
import type { AiProviderClient } from "../types";
import { createOpenAICompatibleProvider } from "./openAiCompatible";
import { rustFetch } from "../rustFetch";

/**
 * The SDK refuses an empty key; a LAN gateway may not want one at all. What is
 * sent then is this placeholder, never the empty string.
 */
export const PLACEHOLDER_API_KEY = "no-key";

let instance: OpenAI | null = null;
let cachedKey: string | null = null;

/** Trim and drop trailing slashes; the SDK appends `/chat/completions` itself. */
export function normaliseBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function getClient(baseUrl: string, apiKey: string): OpenAI {
  const cacheKey = `${baseUrl}|${apiKey}`;
  if (!instance || cachedKey !== cacheKey) {
    instance = new OpenAI({
      baseURL: baseUrl,
      apiKey: apiKey || PLACEHOLDER_API_KEY,
      dangerouslyAllowBrowser: true,
      fetch: rustFetch,
    });
    cachedKey = cacheKey;
  }
  return instance;
}

export function createCustomProvider(baseUrl: string, apiKey: string, model: string): AiProviderClient {
  return createOpenAICompatibleProvider(getClient(normaliseBaseUrl(baseUrl), apiKey.trim()), model);
}

export function clearCustomProvider(): void {
  instance = null;
  cachedKey = null;
}
