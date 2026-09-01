/**
 * The shared body of every OpenAI-compatible AI provider (audit P16(3)).
 *
 * `openaiProvider`, `copilotProvider` and `ollamaProvider` each carried their own
 * copy of the same `complete` / `testConnection` pair — 27 identical lines three
 * times over, differing only in how the client was constructed.
 *
 * The audit sequenced this extraction *before* adding xAI Grok deliberately:
 * with it, a new OpenAI-compatible endpoint is a few lines of configuration
 * rather than a fourth copy of the same request-shaping logic. Without it, every
 * fix to prompt handling would need applying in four places, and the copies had
 * already begun to drift (`ollamaProvider` cached its client differently and
 * bypassed `createProviderFactory` entirely).
 */
import OpenAI from "openai";
import type { AiProviderClient, AiCompletionRequest } from "../types";

/** Tokens requested when only a liveness check is needed. */
const CONNECTION_TEST_MAX_TOKENS = 10;

/** Default completion budget when the caller does not specify one. */
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Wrap an OpenAI-compatible client as an `AiProviderClient`.
 *
 * `client` is taken already-constructed so each provider keeps control of its
 * own base URL, headers, auth and caching — the parts that genuinely differ.
 */
export function createOpenAICompatibleProvider(
  client: OpenAI,
  model: string,
): AiProviderClient {
  return {
    async complete(req: AiCompletionRequest): Promise<string> {
      const response = await client.chat.completions.create({
        model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userContent },
        ],
      });

      return response.choices[0]?.message?.content ?? "";
    },

    async testConnection(): Promise<boolean> {
      try {
        await client.chat.completions.create({
          model,
          max_tokens: CONNECTION_TEST_MAX_TOKENS,
          messages: [{ role: "user", content: "Say hi" }],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
