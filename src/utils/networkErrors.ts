export type ErrorType =
  | "network"
  | "auth"
  | "quota"
  | "server"
  | "permanent"
  | "indeterminate";

/**
 * Marks a Rust-side error whose operation may or may not have taken effect.
 *
 * Must stay identical to `OUTCOME_UNKNOWN_PREFIX` in
 * `src-tauri/src/imap/move_outcome.rs`. A `UID MOVE` that timed out may have
 * succeeded server-side, so retrying it duplicates the message — the exact bug
 * the Rust classifier exists to prevent. Its refusal to retry is worthless if
 * this side retries on its behalf, and the message contains "timed out", which
 * `NETWORK_PATTERNS` would otherwise mark retryable.
 *
 * Interim: E2/P15 replaces the stringly-typed IPC error with a serialized enum.
 */
export const OUTCOME_UNKNOWN_PREFIX = "VELO_OUTCOME_UNKNOWN:";

export interface ClassifiedError {
  type: ErrorType;
  isRetryable: boolean;
  message: string;
}

const NETWORK_PATTERNS = [
  "failed to fetch",
  "network",
  "timeout",
  "timed out",
  "econnrefused",
  "connection refused",
  "econnreset",
  "enotfound",
  "dns",
  "socket hang up",
  "socket",
  "aborted",
  "network error",
  "net::err",
  "tcp connect",
  "tls handshake",
];

const AUTH_PATTERNS = [
  "authentication failed",
  "login failed",
  "invalid credentials",
  "login denied",
  "authenticate failed",
];

export function classifyError(error: unknown): ClassifiedError {
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const lower = message.toLowerCase();

  // An operation whose server-side outcome is unknown must never be retried
  // automatically: the retry is what duplicates the message. Checked before
  // every other rule, including the status-code scan, because the underlying
  // message is free text from the server and may contain anything.
  if (message.startsWith(OUTCOME_UNKNOWN_PREFIX)) {
    return {
      type: "indeterminate",
      isRetryable: false,
      message: message.slice(OUTCOME_UNKNOWN_PREFIX.length).trim(),
    };
  }

  // Check for HTTP status codes in the message
  const statusMatch = lower.match(/\b(4\d{2}|5\d{2})\b/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]!, 10) : null;

  if (statusCode === 401 || statusCode === 403) {
    return { type: "auth", isRetryable: false, message };
  }

  if (statusCode === 429) {
    return { type: "quota", isRetryable: true, message };
  }

  if (statusCode !== null && statusCode >= 500) {
    return { type: "server", isRetryable: true, message };
  }

  // Check IMAP auth error patterns
  if (AUTH_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return { type: "auth", isRetryable: false, message };
  }

  // Check network error patterns
  if (NETWORK_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return { type: "network", isRetryable: true, message };
  }

  // Check if the error object has a status property (e.g., fetch Response errors)
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: number }).status;
    if (status === 401 || status === 403) {
      return { type: "auth", isRetryable: false, message };
    }
    if (status === 429) {
      return { type: "quota", isRetryable: true, message };
    }
    if (status >= 500) {
      return { type: "server", isRetryable: true, message };
    }
  }

  return { type: "permanent", isRetryable: false, message };
}

/**
 * Translate a raw sync error string into a user-friendly message.
 */
export function formatSyncError(rawError: string): string {
  const lower = rawError.toLowerCase();

  if (AUTH_PATTERNS.some((p) => lower.includes(p))) {
    return "Authentication failed \u2014 check your password";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "Connection timed out \u2014 check your internet or server settings";
  }
  if (lower.includes("tls") || lower.includes("ssl") || lower.includes("certificate")) {
    return "Secure connection failed \u2014 check security settings";
  }
  if (lower.includes("econnrefused") || lower.includes("connection refused")) {
    return "Could not reach mail server \u2014 check address and port";
  }
  if (lower.includes("dns") || lower.includes("enotfound") || lower.includes("server not found")) {
    return "Server not found \u2014 check hostname";
  }

  // Fallback: truncate long technical errors
  if (rawError.length > 100) {
    return rawError.slice(0, 100) + "\u2026";
  }
  return rawError;
}
