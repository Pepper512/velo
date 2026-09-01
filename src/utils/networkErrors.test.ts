import {
  classifyError,
  formatSyncError,
  OUTCOME_UNKNOWN_PREFIX,
} from "./networkErrors";

describe("classifyError", () => {
  it("classifies 'Failed to fetch' as network (retryable)", () => {
    const result = classifyError(new Error("Failed to fetch"));
    expect(result.type).toBe("network");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies timeout errors as network (retryable)", () => {
    const result = classifyError(new Error("Request timeout after 30s"));
    expect(result.type).toBe("network");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies ECONNREFUSED as network (retryable)", () => {
    const result = classifyError(new Error("connect ECONNREFUSED 127.0.0.1:443"));
    expect(result.type).toBe("network");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies 401 as auth (not retryable)", () => {
    const result = classifyError(new Error("HTTP 401 Unauthorized"));
    expect(result.type).toBe("auth");
    expect(result.isRetryable).toBe(false);
  });

  it("classifies 403 as auth (not retryable)", () => {
    const result = classifyError(new Error("HTTP 403 Forbidden"));
    expect(result.type).toBe("auth");
    expect(result.isRetryable).toBe(false);
  });

  it("classifies 429 as quota (retryable)", () => {
    const result = classifyError(new Error("HTTP 429 Too Many Requests"));
    expect(result.type).toBe("quota");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies 500 as server (retryable)", () => {
    const result = classifyError(new Error("HTTP 500 Internal Server Error"));
    expect(result.type).toBe("server");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies 503 as server (retryable)", () => {
    const result = classifyError(new Error("HTTP 503 Service Unavailable"));
    expect(result.type).toBe("server");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies unknown errors as permanent (not retryable)", () => {
    const result = classifyError(new Error("Something completely unexpected"));
    expect(result.type).toBe("permanent");
    expect(result.isRetryable).toBe(false);
  });

  it("handles non-Error objects", () => {
    const result = classifyError("string error");
    expect(result.type).toBe("permanent");
    expect(result.message).toBe("string error");
  });

  it("handles null/undefined", () => {
    const result = classifyError(null);
    expect(result.type).toBe("permanent");
    expect(result.message).toBe("Unknown error");
  });

  it("classifies objects with status property", () => {
    const result = classifyError({ status: 500, message: "server error" });
    expect(result.type).toBe("server");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies socket hang up as network", () => {
    const result = classifyError(new Error("socket hang up"));
    expect(result.type).toBe("network");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies DNS errors as network", () => {
    const result = classifyError(new Error("getaddrinfo ENOTFOUND gmail.googleapis.com"));
    expect(result.type).toBe("network");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies 'timed out' as network (IMAP pattern)", () => {
    const result = classifyError("TCP connect timed out (os error 60)");
    expect(result.type).toBe("network");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies 'tcp connect' as network (IMAP pattern)", () => {
    const result = classifyError("tcp connect failed");
    expect(result.type).toBe("network");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies 'tls handshake' as network (IMAP pattern)", () => {
    const result = classifyError("tls handshake error: certificate verify failed");
    expect(result.type).toBe("network");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies IMAP 'authentication failed' as auth", () => {
    const result = classifyError("authentication failed for user@example.com");
    expect(result.type).toBe("auth");
    expect(result.isRetryable).toBe(false);
  });

  it("classifies IMAP 'login failed' as auth", () => {
    const result = classifyError("login failed: invalid password");
    expect(result.type).toBe("auth");
    expect(result.isRetryable).toBe(false);
  });

  it("classifies 'invalid credentials' as auth", () => {
    const result = classifyError("invalid credentials");
    expect(result.type).toBe("auth");
    expect(result.isRetryable).toBe(false);
  });
});

describe("formatSyncError", () => {
  it("translates timeout errors", () => {
    expect(formatSyncError("TCP connect timed out (os error 60)")).toBe(
      "Connection timed out \u2014 check your internet or server settings",
    );
  });

  it("translates auth errors", () => {
    expect(formatSyncError("authentication failed for user@test.com")).toBe(
      "Authentication failed \u2014 check your password",
    );
  });

  it("translates TLS errors", () => {
    expect(formatSyncError("TLS handshake failed: certificate verify error")).toBe(
      "Secure connection failed \u2014 check security settings",
    );
  });

  it("translates connection refused", () => {
    expect(formatSyncError("connect ECONNREFUSED 127.0.0.1:993")).toBe(
      "Could not reach mail server \u2014 check address and port",
    );
  });

  it("translates DNS errors", () => {
    expect(formatSyncError("DNS resolution failed for imap.bad.host")).toBe(
      "Server not found \u2014 check hostname",
    );
  });

  it("truncates long errors at 100 chars", () => {
    const longError = "A".repeat(150);
    const result = formatSyncError(longError);
    expect(result).toHaveLength(101); // 100 chars + ellipsis
    expect(result.endsWith("\u2026")).toBe(true);
  });

  it("passes through short unknown errors unchanged", () => {
    expect(formatSyncError("Something unexpected")).toBe("Something unexpected");
  });
});

describe("classifyError — indeterminate outcomes (REQ-1.4)", () => {
  // The Rust side returns this when a UID MOVE timed out: the server may have
  // completed the move after the client stopped waiting. Retrying duplicates
  // the message, which is the bug REQ-1 exists to prevent. The Rust classifier
  // declining to retry is worthless if this side retries on its behalf.
  const RUST_TIMEOUT_ERROR =
    "VELO_OUTCOME_UNKNOWN:UID MOVE timed out after 30s — check your " +
    "server settings or network connection. The move may already have " +
    "completed on the server.";

  it("marks an outcome-unknown error non-retryable despite 'timed out'", () => {
    const result = classifyError(new Error(RUST_TIMEOUT_ERROR));
    expect(result.isRetryable).toBe(false);
    expect(result.type).toBe("indeterminate");
  });

  it("would otherwise be classified retryable — guards the ordering", () => {
    // Same message without the sentinel: the network patterns claim it. This
    // is what shipped before the prefix existed, and why the prefix check must
    // run first.
    const withoutSentinel = RUST_TIMEOUT_ERROR.replace(
      "VELO_OUTCOME_UNKNOWN:",
      "",
    );
    const result = classifyError(new Error(withoutSentinel));
    expect(result.isRetryable).toBe(true);
    expect(result.type).toBe("network");
  });

  it("strips the sentinel from the user-visible message", () => {
    const result = classifyError(new Error(RUST_TIMEOUT_ERROR));
    expect(result.message.startsWith("UID MOVE timed out")).toBe(true);
    expect(result.message).not.toContain("VELO_OUTCOME_UNKNOWN");
  });

  it("pins the literal shared with move_outcome.rs", () => {
    // If OUTCOME_UNKNOWN_PREFIX changes on either side without the other, the
    // retry guard silently stops matching and the duplication bug returns.
    expect(OUTCOME_UNKNOWN_PREFIX).toBe("VELO_OUTCOME_UNKNOWN:");
  });

  it("takes precedence over a status code in the server's text", () => {
    // The message after the sentinel is free text from the server and may
    // contain anything, including something the status-code scan would claim.
    const result = classifyError(
      new Error("VELO_OUTCOME_UNKNOWN:UID MOVE timed out; server said 503"),
    );
    expect(result.isRetryable).toBe(false);
    expect(result.type).toBe("indeterminate");
  });
});
