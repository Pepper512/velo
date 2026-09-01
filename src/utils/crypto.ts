/**
 * Application-level AES-GCM encryption using a device-derived key.
 * Key is randomly generated on first launch and stored in a separate file
 * via Tauri's filesystem in the app data directory.
 */

import { exists, readTextFile, writeTextFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";

const KEY_FILE_NAME = "velo.key";
const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const FS_OPTIONS = { baseDir: BaseDirectory.AppData };

let cachedKey: CryptoKey | null = null;

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function ensureAppDataDir(): Promise<void> {
  try {
    await mkdir("", { ...FS_OPTIONS, recursive: true });
  } catch {
    // directory may already exist
  }
}

// Web Crypto API accepts BufferSource (ArrayBuffer | ArrayBufferView).
// TypeScript's ES2021 lib types are strict about Uint8Array<ArrayBufferLike> vs ArrayBufferView<ArrayBuffer>.
// This cast satisfies the type checker while passing the Uint8Array directly to the API.
function asBufferSource(arr: Uint8Array): BufferSource {
  return arr as unknown as BufferSource;
}

async function getOrCreateKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  let rawKeyB64: string;
  if (await exists(KEY_FILE_NAME, FS_OPTIONS)) {
    rawKeyB64 = (await readTextFile(KEY_FILE_NAME, FS_OPTIONS)).trim();
  } else {
    // Generate a new random key
    const rawKey = new Uint8Array(KEY_LENGTH / 8);
    crypto.getRandomValues(rawKey);
    rawKeyB64 = base64Encode(rawKey);

    await ensureAppDataDir();
    await writeTextFile(KEY_FILE_NAME, rawKeyB64, FS_OPTIONS);
  }

  // Validate the key file before it reaches importKey (audit P5). Previously
  // whatever the file contained was decoded and passed straight through, so a
  // truncated or corrupted velo.key surfaced later as an indistinguishable
  // "decryption failed" on every credential rather than as a key problem.
  let rawKey: Uint8Array;
  try {
    rawKey = base64Decode(rawKeyB64);
  } catch (err) {
    throw new KeyFileError("it is not valid base64", err);
  }
  if (rawKey.length !== KEY_LENGTH / 8) {
    throw new KeyFileError(
      `expected ${KEY_LENGTH / 8} bytes after base64-decoding, found ${rawKey.length}`,
    );
  }

  try {
    cachedKey = await crypto.subtle.importKey(
      "raw",
      asBufferSource(rawKey),
      { name: ALGORITHM },
      false,
      ["encrypt", "decrypt"],
    );
  } catch (err) {
    throw new KeyFileError("the key material was rejected by the Web Crypto API", err);
  }

  return cachedKey;
}

/**
 * Encrypt a plaintext string. Returns a base64 string in the format: iv:ciphertext
 * (GCM tag is appended to ciphertext by the Web Crypto API)
 */
export async function encryptValue(plaintext: string): Promise<string> {
  const key = await getOrCreateKey();
  const iv = new Uint8Array(IV_LENGTH);
  crypto.getRandomValues(iv);

  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: asBufferSource(iv) },
    key,
    asBufferSource(data),
  );

  const ivB64 = base64Encode(iv);
  const ciphertextB64 = base64Encode(new Uint8Array(encrypted));
  return `${ivB64}:${ciphertextB64}`;
}

/**
 * Decrypt a value produced by encryptValue. Returns the original plaintext.
 */
export async function decryptValue(encrypted: string): Promise<string> {
  const key = await getOrCreateKey();

  const parts = encrypted.split(":");
  if (parts.length !== 2) {
    throw new Error("Invalid encrypted value format");
  }
  const [ivB64, ciphertextB64] = parts;
  if (!ivB64 || !ciphertextB64) {
    throw new Error("Invalid encrypted value format");
  }

  const iv = base64Decode(ivB64);
  const ciphertext = base64Decode(ciphertextB64);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: asBufferSource(iv) },
    key,
    asBufferSource(ciphertext),
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/** Thrown when a stored credential cannot be decrypted. See `decryptValue`. */
export class CredentialDecryptError extends Error {
  constructor(
    /** Which credential failed, for the UI message. Never the value itself. */
    readonly field: string,
    readonly reason?: unknown,
  ) {
    super(
      `Could not decrypt the stored ${field}. The encryption key file (velo.key) ` +
        `is missing, unreadable, or does not match the stored data.`,
    );
    this.name = "CredentialDecryptError";
  }
}

/** Thrown when `velo.key` exists but is not a usable 256-bit key. */
export class KeyFileError extends Error {
  constructor(reason: string, readonly detail?: unknown) {
    super(`The encryption key file (velo.key) is unusable: ${reason}`);
    this.name = "KeyFileError";
  }
}

/**
 * Does this value have the exact structure `encryptValue` produces?
 *
 * # Why this is structural rather than a length heuristic
 *
 * The previous implementation was `parts.length === 2 && atob(both) &&
 * parts[0].length === 16`. A 12-byte IV *is* 16 base64 characters, but the
 * converse does not hold: **any** 16-character base64-decodable prefix followed
 * by `:` and more base64 passed. A plaintext password of that shape — and
 * `atob` is lenient, so that is not exotic — was classified as ciphertext, sent
 * to `decryptValue`, and failed. Combined with the old caller behaviour of
 * falling through to the raw value on failure (audit P5), the result was that a
 * *plaintext* password could be misread as ciphertext and then transmitted
 * anyway. The two defects composed, which is why both are fixed together.
 *
 * This now verifies what the format actually guarantees: two well-formed base64
 * segments, the first decoding to exactly `IV_LENGTH` bytes, the second
 * non-empty. That rejects wrong-length IVs, non-base64 alphabets, and lengths
 * `btoa` could never emit.
 *
 * # What it still cannot decide, and why that is now safe
 *
 * A 12-byte IV encodes to exactly 16 base64 characters, so a plaintext value of
 * the form `<16 base64 chars>:<base64>` is **structurally indistinguishable from
 * real ciphertext**. No shape check can separate them; only trial decryption
 * can, and that is what the caller does.
 *
 * What changed is the consequence of guessing wrong. Previously a
 * misclassification meant "decrypt fails → silently use the raw value → send it
 * to the mail server". Now it means "decrypt fails → `CredentialDecryptError` →
 * the user is told the key is unreadable". A wrong guess is loud and local
 * instead of quiet and on the wire. This function is a **fast path, not an
 * authority**; treat its `true` as "worth attempting", never as "this is safe to
 * transmit if decryption fails".
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 2) return false;

  const [ivPart, ctPart] = parts as [string, string];

  // `atob` is lenient in some engines about both alphabet and length. Check
  // explicitly so this means what it says: canonical base64 as `btoa` emits it,
  // which is always a multiple of 4 characters including padding.
  const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
  const wellFormed = (s: string) =>
    s.length > 0 && s.length % 4 === 0 && BASE64.test(s);
  if (!wellFormed(ivPart) || !wellFormed(ctPart)) return false;

  try {
    if (base64Decode(ivPart).length !== IV_LENGTH) return false;
    return base64Decode(ctPart).length > 0;
  } catch {
    return false;
  }
}
