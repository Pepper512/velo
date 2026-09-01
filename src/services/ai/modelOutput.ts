/**
 * The trust boundary between a language model and the rest of Velo (audit P10).
 *
 * Two directions, both of which were unguarded:
 *
 * **In.** Email bodies are attacker-controlled and were interpolated into the
 * prompt inside an `<email_content>` delimiter *that the body could close*. A
 * message containing `</email_content>` ended the block, and everything after it
 * was read by the model as instructions rather than as quoted mail. That is a
 * prompt-injection primitive reachable by anyone who can send the user an email.
 *
 * **Out.** Model text reached the composer after nothing more than a
 * `replace(/<[^>]*>/g, "")` tag strip, and `generateSmartReplies` fell back to
 * splitting raw model output by newline when JSON parsing failed — so an
 * unparseable response became user-facing reply suggestions in the send path.
 *
 * The global standard states the rule this module implements: *treat all LLM
 * output as untrusted input; prompt injection is assumed.*
 */
import { z } from "zod";

/** The tag used to fence quoted email content in prompts. */
const CONTENT_TAG = "email_content";

/**
 * Longest model response we will parse. Beyond this the response is refused
 * rather than truncated — a truncated JSON document is not a smaller valid one.
 */
export const MAX_MODEL_OUTPUT_CHARS = 100_000;

/** Longest single quoted email body we will place in a prompt. */
export const MAX_QUOTED_BODY_CHARS = 20_000;

/**
 * Make a caller-supplied string safe to place *inside* the content fence.
 *
 * Neutralises any sequence that could open or close the delimiter, in either
 * case and with incidental whitespace, so the model always sees exactly one
 * well-formed block per message. Angle brackets are replaced rather than
 * stripped so the text still reads naturally to the model — dropping them
 * silently would change quoted content in ways a summary might then misreport.
 */
export function fenceContent(value: string): string {
  const clipped =
    value.length > MAX_QUOTED_BODY_CHARS
      ? `${value.slice(0, MAX_QUOTED_BODY_CHARS)}\n[truncated]`
      : value;

  return clipped.replace(
    new RegExp(`<\\s*/?\\s*${CONTENT_TAG}\\s*>`, "gi"),
    `(${CONTENT_TAG})`,
  );
}

/** Wrap `body` in the content fence, neutralising the fence inside it first. */
export function wrapContent(body: string): string {
  return `<${CONTENT_TAG}>${fenceContent(body)}</${CONTENT_TAG}>`;
}

/**
 * Parse model output against a schema, **failing closed**.
 *
 * Returns `null` rather than throwing: every caller's correct response to
 * unusable model output is to fall back to its non-AI behaviour, not to surface
 * an error the user cannot act on. Returning `null` makes that the easy path;
 * the previous code made "use the raw text" the easy path.
 *
 * Tolerates the two things models reliably do — wrapping JSON in prose, and
 * fencing it in markdown — without tolerating anything about its *shape*.
 */
export function parseModelOutput<T>(raw: string, schema: z.ZodType<T>): T | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.length > MAX_MODEL_OUTPUT_CHARS) return null;

  for (const candidate of jsonCandidates(raw)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
  }

  return null;
}

/**
 * Yield the substrings of `raw` that might be the JSON document, most likely
 * first: the whole string, then a ```-fenced block, then the outermost
 * bracketed span.
 */
function* jsonCandidates(raw: string): Generator<string> {
  const trimmed = raw.trim();
  yield trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) yield fenced[1].trim();

  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) yield trimmed.slice(start, end + 1);
  }
}

/**
 * Reply suggestions: a short list of short plain-text strings.
 *
 * Length-capped here rather than at the call site so no caller can forget. HTML
 * is not permitted — these go into the composer, and the old
 * `replace(/<[^>]*>/g, "")` was a tag strip, never a sanitizer.
 */
export const SmartRepliesSchema = z
  .array(z.string().trim().min(1).max(500))
  .min(1)
  .max(5);

/** `{ threadId: category }` pairs, before allowlist checking by the caller. */
export const CategoryLinesSchema = z.array(
  z.object({ id: z.string().min(1), category: z.string().min(1) }),
);
