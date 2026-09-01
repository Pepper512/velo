/**
 * Gemini provider — plain `fetch` against the `generateContent` REST endpoint.
 *
 * Dependency-audit PR C. The SDK Velo shipped (`@google/generative-ai`) reached
 * end of life per Google's announcement, and its successor (`@google/genai`)
 * would bring `google-auth-library`, `protobufjs`, `ws` and `p-retry` into a
 * renderer that holds mail credentials — for a provider that makes exactly one
 * POST. So this is the request the SDK would have made, written by hand. The
 * wire format below was read from the SDK's own source, not from docs. Fetch is
 * already house style for talking to Google here (`gmail/client.ts`).
 *
 * The response is untrusted input at the boundary (CLAUDE.md): its shape is
 * validated before any field is read, and a reply with no text part is a typed
 * error rather than an `undefined` flowing into the compose path.
 */
import type { AiProviderClient, AiCompletionRequest } from "../types";
import { AiError } from "../errors";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Tokens requested when only a liveness check is needed. */
const CONNECTION_TEST_MAX_TOKENS = 10;

/** Default completion budget when the caller does not specify one. */
const DEFAULT_MAX_TOKENS = 1024;

interface TextPart {
  text: string;
}

interface GenerateContentBody {
  contents: Array<{ role: "user"; parts: TextPart[] }>;
  systemInstruction?: { parts: TextPart[] };
  generationConfig: { maxOutputTokens: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Pull the answer out of a `generateContent` response body.
 *
 * Mirrors the SDK's `.text` accessor: the first candidate's text parts
 * concatenated, thinking parts skipped. Returns `null` — not `""` — when the
 * body carries no text part at all (a safety block, an empty candidate list, a
 * body that is not the documented shape) so the caller can refuse it. An
 * answer that is present but empty is `""`, like the sibling providers.
 */
function extractText(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.candidates)) return null;
  const first: unknown = body.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) {
    return null;
  }

  let text: string | null = null;
  for (const part of first.content.parts as unknown[]) {
    if (!isRecord(part) || typeof part.text !== "string" || part.thought === true) continue;
    text = (text ?? "") + part.text;
  }
  return text;
}

/** Never echo the response body: on a 4xx it can quote the API key back. */
function errorForStatus(status: number): AiError {
  if (status === 401 || status === 403) return new AiError("AUTH_ERROR", "Invalid API key");
  if (status === 429) return new AiError("RATE_LIMITED", "Rate limited — please try again shortly");
  return new AiError("NETWORK_ERROR", `Gemini request failed with HTTP ${status}`);
}

async function generateContent(
  apiKey: string,
  modelId: string,
  body: GenerateContentBody,
): Promise<string> {
  // The SDK accepts both `gemini-…` and `models/gemini-…`; so do we.
  const model = modelId.startsWith("models/") ? modelId : `models/${modelId}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AiError("NETWORK_ERROR", err instanceof Error ? err.message : String(err));
  }
  if (!response.ok) throw errorForStatus(response.status);

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new AiError("NETWORK_ERROR", "Gemini returned a non-JSON response");
  }

  const text = extractText(parsed);
  if (text === null) throw new AiError("NETWORK_ERROR", "Gemini returned no text");
  return text;
}

export function createGeminiProvider(apiKey: string, modelId: string): AiProviderClient {
  return {
    complete(req: AiCompletionRequest): Promise<string> {
      return generateContent(apiKey, modelId, {
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: req.userContent }] }],
        generationConfig: { maxOutputTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS },
      });
    },

    async testConnection(): Promise<boolean> {
      try {
        await generateContent(apiKey, modelId, {
          contents: [{ role: "user", parts: [{ text: "Say hi" }] }],
          generationConfig: { maxOutputTokens: CONNECTION_TEST_MAX_TOKENS },
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
