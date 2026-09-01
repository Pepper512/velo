import OpenAI from "openai";
import { fetch } from "@tauri-apps/plugin-http";
import type { AiProviderClient } from "../types";
import { createOpenAICompatibleProvider } from "./openAiCompatible";

let instance: OpenAI | null = null;
let cachedKey: string | null = null;

function getClient(serverUrl: string, model: string): OpenAI {
  const cacheKey = `${serverUrl}|${model}`;
  if (!instance || cachedKey !== cacheKey) {
    instance = new OpenAI({
      baseURL: `${serverUrl.replace(/\/+$/, "")}/v1`,
      apiKey: "ollama",
      dangerouslyAllowBrowser: true,
      fetch,
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
