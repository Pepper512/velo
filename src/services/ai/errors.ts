export type AiErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "NETWORK_ERROR";

export class AiError extends Error {
  code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

/**
 * One line of display text for whatever a provider or the http plugin threw
 * (SPEC-280 REQ-2.1). `Error.message` when there is one, else the value as
 * text — the plugin rejects a scope refusal with a plain string.
 */
export function describeError(err: unknown): string {
  return redactSecrets(rawDescription(err));
}

function rawDescription(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  // Plain-object rejections (an IPC bridge, a fetch wrapper) carry the text
  // under `message` or `error`; `String(err)` would show "[object Object]"
  // (Gemini M1 on #56).
  if (typeof err === "object" && err !== null) {
    const o = err as { message?: unknown; error?: unknown };
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.error === "string" && o.error) return o.error;
  }
  return String(err);
}

/**
 * SDK and plugin messages can echo the credential that failed ("Incorrect
 * API key provided: sk-…", a refused URL carrying `?key=…`). The reason is
 * shown on screen, so those are cut before display (Grok L3 on #56). The
 * patterns are the key shapes Velo's providers use plus bearer tokens and
 * key-bearing query parameters.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g, // OpenAI, Anthropic (sk-ant-…), xAI-compatible
  /\bghp_[A-Za-z0-9]{8,}/g, // GitHub (Copilot)
  /\bxai-[A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{8,}/g, // Google
  /\bBearer\s+[^\s"']+/gi,
  /([?&](?:key|api_key|apikey|access_token|token)=)[^&\s"']+/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix: string | undefined) =>
      typeof prefix === "string" && match.startsWith(prefix) ? `${prefix}[redacted]` : "[redacted]",
    );
  }
  return out;
}
