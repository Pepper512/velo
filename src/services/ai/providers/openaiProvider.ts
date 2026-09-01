import OpenAI from "openai";
import type { AiProviderClient } from "../types";
import { createOpenAICompatibleProvider } from "./openAiCompatible";
import { createProviderFactory } from "../providerFactory";

const factory = createProviderFactory(
  (apiKey) => new OpenAI({ apiKey, dangerouslyAllowBrowser: true }),
);

export function createOpenAIProvider(apiKey: string, model: string): AiProviderClient {
  const client = factory.getClient(apiKey);

  return createOpenAICompatibleProvider(client, model);
}

export function clearOpenAIProvider(): void {
  factory.clear();
}
