/**
 * Header injection via `mailto:` (audit P7).
 *
 * A `mailto:` link on any web page reaches Velo's composer through the deep-link
 * handler. Headers are newline-delimited, so a CR or LF in a header value does
 * not corrupt that header — it starts a new one. `?subject=x%0ABcc:evil@x`
 * therefore produced a real `Bcc` on the outgoing message.
 */
import { describe, it, expect } from "vitest";
import { buildRawEmail } from "./emailBuilder";
import { parseMailtoUrl } from "./mailtoParser";

/**
 * Decode the base64url MIME message `buildRawEmail` returns and take its
 * headers, which end at the first blank line.
 */
function headersOf(base64url: string): string {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  const raw = new TextDecoder().decode(bytes);
  const end = raw.indexOf("\r\n\r\n");
  return end === -1 ? raw : raw.slice(0, end);
}

const base = {
  from: "me@example.com",
  to: ["you@example.com"],
  subject: "Hello",
  htmlBody: "<p>hi</p>",
};

describe("P7 — header injection", () => {
  const INJECTION_VECTORS: [string, string][] = [
    ["LF + Bcc", "x\nBcc: evil@example.com"],
    ["CRLF + Bcc", "x\r\nBcc: evil@example.com"],
    ["CR + Bcc", "x\rBcc: evil@example.com"],
    ["folded continuation", "x\r\n Bcc: evil@example.com"],
    ["double newline into body", "x\r\n\r\nInjected body text"],
    ["multiple headers", "x\nBcc: a@evil.com\nX-Custom: pwned"],
    ["leading newline", "\nBcc: evil@example.com"],
  ];

  it.each(INJECTION_VECTORS)("subject: %s", (_name, hostile) => {
    const raw = buildRawEmail({ ...base, subject: hostile });
    const headers = headersOf(raw);

    // The injected text is now inert *content of the Subject header*, which is
    // the correct outcome -- so assert on header structure, not on whether the
    // address string appears anywhere. What must not exist is a Bcc HEADER.
    expect(headers).not.toMatch(/^Bcc:/im);
    expect(headers).not.toMatch(/^X-Custom:/im);
    // Exactly one Subject header, and the injected text is inside it.
    expect(headers.match(/^Subject:/gim) ?? []).toHaveLength(1);
    // No header line other than the ones we build may appear.
    const headerNames = headers
      .split("\r\n")
      .filter((l) => /^[A-Za-z-]+:/.test(l))
      .map((l) => l.slice(0, l.indexOf(":")).toLowerCase());
    expect(headerNames).not.toContain("bcc");
    expect(headerNames).not.toContain("x-custom");
  });

  it.each(INJECTION_VECTORS)("recipient: %s", (_name, hostile) => {
    const raw = buildRawEmail({ ...base, to: [`ok@example.com${hostile}`] });
    const headers = headersOf(raw);

    expect(headers).not.toMatch(/^Bcc:/im);
    expect(headers).not.toMatch(/^X-Custom:/im);
    expect(headers.match(/^To:/gim) ?? []).toHaveLength(1);
  });

  it("collapses folding whitespace instead of dropping content", () => {
    const raw = buildRawEmail({ ...base, subject: "Long subject\r\n  continued here" });
    expect(headersOf(raw)).toContain("Subject: Long subject continued here");
  });
});

describe("P7 — RFC 2047 encoding of non-ASCII headers", () => {
  it("encodes a non-ASCII subject rather than emitting it raw", () => {
    const raw = buildRawEmail({ ...base, subject: "héllo wörld" });
    const headers = headersOf(raw);

    expect(headers).toMatch(/Subject: =\?utf-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(headers).not.toContain("héllo");

    // Round-trips to the original text.
    const encoded = /Subject: =\?utf-8\?B\?([A-Za-z0-9+/=]+)\?=/.exec(headers)![1]!;
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe("héllo wörld");
  });

  it("leaves a pure-ASCII subject unencoded and readable", () => {
    const raw = buildRawEmail({ ...base, subject: "Quarterly review" });
    expect(headersOf(raw)).toContain("Subject: Quarterly review");
  });

  it("encodes emoji correctly", () => {
    const raw = buildRawEmail({ ...base, subject: "Ship it 🚀" });
    const headers = headersOf(raw);
    const encoded = /Subject: =\?utf-8\?B\?([A-Za-z0-9+/=]+)\?=/.exec(headers)![1]!;
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe("Ship it 🚀");
  });
});

describe("P7 — the mailto: parser must not throw", () => {
  const MALFORMED = [
    "mailto:%zz",
    "mailto:a@b.c?subject=%",
    "mailto:a@b.c?subject=%2",
    "mailto:a@b.c?body=%E0%A4%A",
    "mailto:%€x@example.com",
    "mailto:",
    "mailto:?subject=hi",
  ];

  it.each(MALFORMED)("does not throw on %s", (url) => {
    expect(() => parseMailtoUrl(url)).not.toThrow();
  });

  it("still parses a well-formed mailto", () => {
    const parsed = parseMailtoUrl("mailto:a@b.c?subject=Hello%20there&body=Hi");
    expect(parsed?.to).toEqual(["a@b.c"]);
    expect(parsed?.subject).toBe("Hello there");
    expect(parsed?.body).toBe("Hi");
  });

  it("a malformed escape in a subject cannot become an injected header", () => {
    const parsed = parseMailtoUrl("mailto:a@b.c?subject=x%0ABcc:evil@example.com");
    const raw = buildRawEmail({ ...base, subject: parsed?.subject ?? "" });
    expect(headersOf(raw)).not.toMatch(/^Bcc:/im);
  });
});
