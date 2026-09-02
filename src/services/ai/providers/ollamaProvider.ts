import OpenAI from "openai";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AiProviderClient } from "../types";
import { createOpenAICompatibleProvider } from "./openAiCompatible";

let instance: OpenAI | null = null;
let cachedKey: string | null = null;

/**
 * The plugin checks its scope on the URL it is given, not on redirects. A
 * local model server never needs to redirect elsewhere, so redirects are
 * refused outright rather than followed off loopback (SPEC-280 threat pass;
 * Grok Q3 on #56).
 */
export const localFetch: typeof tauriFetch = (input, init) =>
  tauriFetch(input, { ...init, maxRedirections: 0 });

function getClient(serverUrl: string, model: string): OpenAI {
  const cacheKey = `${serverUrl}|${model}`;
  if (!instance || cachedKey !== cacheKey) {
    instance = new OpenAI({
      baseURL: `${serverUrl.replace(/\/+$/, "")}/v1`,
      apiKey: "ollama",
      dangerouslyAllowBrowser: true,
      fetch: localFetch,
    });
    cachedKey = cacheKey;
  }
  return instance;
}

export function createOllamaProvider(serverUrl: string, model: string): AiProviderClient {
  const client = getClient(serverUrl, model);

  return createOpenAICompatibleProvider(client, model);
}

export function clearOllamaProvider(): void {
  instance = null;
  cachedKey = null;
}
