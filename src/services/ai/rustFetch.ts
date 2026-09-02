/**
 * A `fetch` for user-configured AI endpoints that goes through Rust (SPEC-209).
 *
 * The webview's `fetch` is gated by the static CSP `connect-src`, so a base
 * URL the user typed can never be reached with it. `ai_fetch` in Rust is the
 * one door for those requests and holds the rule: `https` to any host, or
 * `http` to loopback only; no redirect followed; two methods; four request
 * headers; a body cap and a timeout. This wrapper gives the OpenAI SDK a
 * `fetch`-shaped function over that command and validates what comes back
 * before a `Response` is built from it — an `invoke()` result is a boundary.
 */
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

const AI_FETCH_RESPONSE = z.object({
  status: z.number().int().min(200).max(599),
  headers: z.array(z.tuple([z.string(), z.string()])),
  body: z.string(),
});

/** What the Rust command takes; field names are its serde names. */
interface AiFetchRequest {
  url: string;
  method: string;
  headers: [string, string][];
  body: string | null;
}

/** `localhost`, `127.0.0.0/8`, or `::1` — the same rule `ai_fetch.rs` applies. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost") return true;
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (bare === "::1") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  return v4 !== null && v4[1] === "127";
}

/**
 * The settings page's pre-check (SPEC-209 REQ-2.5): the same scheme/host rule
 * the Rust command enforces, so a refused URL is explained before it is saved.
 * Rust's check is the one that counts; this one is for the inline message.
 */
export function isAllowedAiUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.hostname === "") return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return isLoopbackHost(url.hostname);
  return false;
}

function headerPairs(headers: HeadersInit | undefined): [string, string][] {
  if (!headers) return [];
  if (Array.isArray(headers)) return headers.map(([k, v]) => [String(k), String(v)]);
  if (typeof (headers as Headers).forEach === "function") {
    const out: [string, string][] = [];
    (headers as Headers).forEach((value, key) => out.push([key, value]));
    return out;
  }
  return Object.entries(headers as Record<string, string>).map(([k, v]) => [k, String(v)]);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** A `fetch`-shaped function over the `ai_fetch` command. */
export const rustFetch: typeof fetch = async (input, init) => {
  const fromRequest = typeof input === "object" && !(input instanceof URL) ? input : null;
  const method = init?.method ?? fromRequest?.method ?? "GET";
  const headers = headerPairs(init?.headers ?? fromRequest?.headers);

  const rawBody = init?.body;
  let body: string | null = null;
  if (rawBody !== undefined && rawBody !== null) {
    if (typeof rawBody !== "string") {
      throw new Error("ai_fetch: only string bodies are supported");
    }
    body = rawBody;
  }

  const signal = init?.signal ?? null;
  if (signal?.aborted) {
    throw abortError();
  }

  const request: AiFetchRequest = { url: requestUrl(input), method, headers, body };
  // The command rejects with a plain string; the SDK expects an Error.
  const work = invoke("ai_fetch", { request }).catch((err: unknown) => {
    throw err instanceof Error ? err : new Error(typeof err === "string" ? err : "ai_fetch failed");
  });
  // The SDK's timeout aborts the signal mid-flight; reject then rather than
  // when Rust finishes (#65 review, Gemini N4). The Rust request itself runs
  // to its own timeout — an IPC call cannot be cancelled — but nothing waits.
  const raw: unknown = await raceWithAbort(work, signal);

  const parsed = AI_FETCH_RESPONSE.safeParse(raw);
  if (!parsed.success) {
    throw new Error("ai_fetch: malformed result from the Rust command");
  }
  // A 204/205/304 may not carry a body; `Response` throws if given one.
  const responseBody = NULL_BODY_STATUSES.has(parsed.data.status) ? null : parsed.data.body;
  return new Response(responseBody, {
    status: parsed.data.status,
    headers: parsed.data.headers,
  });
};

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function raceWithAbort<T>(work: Promise<T>, signal: AbortSignal | null): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
