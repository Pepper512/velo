/**
 * PKCE (RFC 7636) helpers, in one place (audit P16(7)).
 *
 * These twenty-odd lines existed byte-identically in `gmail/auth.ts` and
 * `oauth/oauthFlow.ts`. Duplicated **security** code is worse than duplicated
 * anything else: a fix to one copy silently leaves the other weak, and PKCE is
 * the only thing binding an authorization code to the client that requested it —
 * Velo's OAuth flow uses no client secret, so if the verifier were ever
 * weakened, an intercepted code would be redeemable by anyone.
 */

/** Bytes of entropy in a code verifier. RFC 7636 §4.1 requires 32–96 octets. */
const VERIFIER_BYTES = 32;

/**
 * Base64url without padding, as RFC 7636 §A requires.
 *
 * Standard base64's `+`, `/` and `=` are not URL-safe and would be re-encoded in
 * transit, breaking the verifier/challenge comparison at the server.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Generate a cryptographically random code verifier.
 *
 * Uses `crypto.getRandomValues`; a `Math.random`-based verifier would be
 * predictable and defeat the point of PKCE entirely.
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(VERIFIER_BYTES);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Derive the S256 code challenge for a verifier.
 *
 * `code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))`, RFC 7636 §4.2.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}
