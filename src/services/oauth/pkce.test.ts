/**
 * PKCE (audit P16(7)).
 *
 * This code was duplicated byte-for-byte across `gmail/auth.ts` and
 * `oauth/oauthFlow.ts` and had **no tests in either copy** — for the mechanism
 * that binds an authorization code to the client that requested it. Velo's OAuth
 * flow uses no client secret, so PKCE is the only thing stopping an intercepted
 * code from being redeemable by anyone.
 */
import { describe, it, expect } from "vitest";
import {
  base64UrlEncode,
  generateCodeVerifier,
  generateCodeChallenge,
} from "./pkce";

describe("base64UrlEncode", () => {
  it("uses the URL-safe alphabet and strips padding", () => {
    // 0xFB 0xFF exercises both `+` -> `-` and `/` -> `_`.
    const encoded = base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xfe]));
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toBe("-__-");
  });

  it("round-trips through atob after restoring the standard alphabet", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = base64UrlEncode(bytes);
    const standard = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
    const decoded = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });
});

describe("generateCodeVerifier", () => {
  it("meets RFC 7636 §4.1 length limits", () => {
    const verifier = generateCodeVerifier();
    // 32 bytes -> 43 base64url characters, inside the required 43..128.
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("only uses unreserved characters", () => {
    expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("is not predictable across calls", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateCodeVerifier()));
    expect(seen.size).toBe(50);
  });
});

describe("generateCodeChallenge", () => {
  it("matches the RFC 7636 Appendix B test vector", () => {
    // The spec's worked example: this exact verifier must produce this exact
    // challenge. It is the one assertion that would catch a wrong hash, a wrong
    // encoding, or a silent change to either.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    return expect(generateCodeChallenge(verifier)).resolves.toBe(expected);
  });

  it("is deterministic for the same verifier", async () => {
    const verifier = generateCodeVerifier();
    const [a, b] = await Promise.all([
      generateCodeChallenge(verifier),
      generateCodeChallenge(verifier),
    ]);
    expect(a).toBe(b);
  });

  it("differs for different verifiers", async () => {
    const [a, b] = await Promise.all([
      generateCodeChallenge(generateCodeVerifier()),
      generateCodeChallenge(generateCodeVerifier()),
    ]);
    expect(a).not.toBe(b);
  });

  it("produces a URL-safe, unpadded challenge", async () => {
    const challenge = await generateCodeChallenge(generateCodeVerifier());
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(challenge).toHaveLength(43); // SHA-256 -> 32 bytes -> 43 chars
  });
});
