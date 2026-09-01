/**
 * xAI (Grok) provider.
 *
 * xAI exposes an OpenAI-compatible chat-completions API, so this is
 * configuration plus a client — the request shaping lives in
 * `createOpenAICompatibleProvider` (audit P16(3)).
 *
 * The audit sequenced that extraction *before* this feature for exactly this
 * reason: added first, Grok would have been a fourth verbatim copy of the same
 * 27 lines.
 *
 * Note the CSP: `tauri.conf.json` must allow `https://api.x.ai` in
 * `connect-src`, or every request fails in the packaged app with an opaque
 * network error while working fine in `tauri dev`.
 */
import OpenAI from "openai";
import type { AiProviderClient } from "../types";
import { createProviderFactory } from "../providerFactory";
import { createOpenAICompatibleProvider } from "./openAiCompatible";

const XAI_BASE_URL = "https://api.x.ai/v1";

const factory = createProviderFactory(
  (apiKey) =>
    new OpenAI({
      apiKey,
      baseURL: XAI_BASE_URL,
      dangerouslyAllowBrowser: true,
    }),
);

export function createXaiProvider(apiKey: string, model: string): AiProviderClient {
  return createOpenAICompatibleProvider(factory.getClient(apiKey), model);
}

export function clearXaiProvider(): void {
  factory.clear();
}
