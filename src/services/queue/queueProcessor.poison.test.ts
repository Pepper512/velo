/**
 * The poison-operation path (audit P14, and a correction to it).
 *
 * The audit claims a malformed `op.params` makes `JSON.parse` throw and be
 * "possibly retried forever every 30 s; no retry ceiling after
 * `incrementRetry:49`". **Both halves are wrong** — verified here so the
 * behaviour that already works stays working, rather than being "fixed".
 *
 * See `docs/decisions/ADR-002.md` for the policy and the correction.
 */
import { describe, it, expect } from "vitest";
import { classifyError } from "@/utils/networkErrors";

describe("classifyError — the poison-message path (P14 correction)", () => {
  it("classifies a JSON SyntaxError as permanent, not retryable", () => {
    let thrown: unknown;
    try {
      JSON.parse("{not json");
    } catch (err) {
      thrown = err;
    }

    const classified = classifyError(thrown);
    expect(classified.isRetryable).toBe(false);
    expect(classified.type).toBe("permanent");
  });

  it("defaults to permanent for anything it does not recognise", () => {
    for (const err of [
      new Error("something entirely unexpected"),
      new TypeError("cannot read properties of undefined"),
      "a bare string",
      null,
      undefined,
    ]) {
      expect(classifyError(err).isRetryable).toBe(false);
    }
  });

  it("still marks genuinely transient failures retryable", () => {
    // The default must not be so broad that real retries stop happening.
    expect(classifyError(new Error("HTTP 503 Service Unavailable")).isRetryable).toBe(true);
    expect(classifyError(new Error("429 Too Many Requests")).isRetryable).toBe(true);
  });

  it("treats auth failures as permanent so they are not retried against a locked account", () => {
    expect(classifyError(new Error("401 Unauthorized")).isRetryable).toBe(false);
    expect(classifyError(new Error("403 Forbidden")).isRetryable).toBe(false);
  });
});
