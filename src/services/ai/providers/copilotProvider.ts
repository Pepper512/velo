import OpenAI from "openai";
import type { AiProviderClient } from "../types";
import { createOpenAICompatibleProvider } from "./openAiCompatible";
import { createProviderFactory } from "../providerFactory";

const factory = createProviderFactory(
  (apiKey) =>
    new OpenAI({
      apiKey,
      baseURL: "https://models.github.ai/inference",
      defaultHeaders: { "X-GitHub-Api-Version": "2022-11-28" },
      dangerouslyAllowBrowser: true,
    }),
);

export function createCopilotProvider(apiKey: string, model: string): AiProviderClient {
  const client = factory.getClient(apiKey);

  return createOpenAICompatibleProvider(client, model);
}

export function clearCopilotProvider(): void {
  factory.clear();
}
