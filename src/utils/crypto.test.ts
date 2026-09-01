import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockTauriFs } from "@/test/mocks";

const tauriFs = createMockTauriFs();

vi.mock("@tauri-apps/plugin-fs", () => tauriFs.mock);

describe("crypto", () => {
  beforeEach(() => {
    vi.resetModules();
    tauriFs.store.clear();
  });

  it("encrypts and decrypts a value roundtrip", async () => {
    const { encryptValue, decryptValue } = await import("./crypto");
    const plaintext = "my-secret-api-key-12345";
    const encrypted = await encryptValue(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(":")).toHaveLength(2);

    const decrypted = await decryptValue(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", async () => {
    const { encryptValue } = await import("./crypto");
    const plaintext = "same-value";
    const enc1 = await encryptValue(plaintext);
    const enc2 = await encryptValue(plaintext);
    expect(enc1).not.toBe(enc2);
  });

  it("decryptValue throws on invalid format", async () => {
    const { decryptValue } = await import("./crypto");
    await expect(decryptValue("not-valid")).rejects.toThrow("Invalid encrypted value format");
  });

  it("isEncrypted returns true for encrypted values", async () => {
    const { encryptValue, isEncrypted } = await import("./crypto");
    const encrypted = await encryptValue("test");
    expect(isEncrypted(encrypted)).toBe(true);
  });

  it("isEncrypted returns false for plaintext", async () => {
    const { isEncrypted } = await import("./crypto");
    expect(isEncrypted("sk-ant-1234567890abcdef")).toBe(false);
    expect(isEncrypted("")).toBe(false);
    expect(isEncrypted("just-a-regular-string")).toBe(false);
  });

  it("handles empty string encryption", async () => {
    const { encryptValue, decryptValue } = await import("./crypto");
    const encrypted = await encryptValue("");
    const decrypted = await decryptValue(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles unicode content", async () => {
    const { encryptValue, decryptValue } = await import("./crypto");
    const plaintext = "Hello World! Emoji test";
    const encrypted = await encryptValue(plaintext);
    const decrypted = await decryptValue(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("uses baseDir option for FS operations", async () => {
    const { encryptValue } = await import("./crypto");

    await encryptValue("test");

    expect(tauriFs.mock.exists).toHaveBeenCalledWith(
      "velo.key",
      expect.objectContaining({ baseDir: 26 }),
    );
    expect(tauriFs.mock.writeTextFile).toHaveBeenCalledWith(
      "velo.key",
      expect.any(String),
      expect.objectContaining({ baseDir: 26 }),
    );
  });

  it("reads existing key from file using baseDir", async () => {
    // Pre-seed a key in the mock store
    const mockKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));
    tauriFs.store.set("velo.key", mockKey);

    const { encryptValue, decryptValue } = await import("./crypto");
    const encrypted = await encryptValue("round-trip-test");

    expect(tauriFs.mock.readTextFile).toHaveBeenCalledWith(
      "velo.key",
      expect.objectContaining({ baseDir: 26 }),
    );

    const decrypted = await decryptValue(encrypted);
    expect(decrypted).toBe("round-trip-test");
  });
});

// ---------------------------------------------------------------------------
// Audit P5: key-file validation and the isEncrypted heuristic.
// ---------------------------------------------------------------------------

describe("crypto — key file validation (P5)", () => {
  beforeEach(() => {
    vi.resetModules();
    tauriFs.store.clear();
  });

  it("rejects a truncated key file with a distinct error, not 'decrypt failed'", async () => {
    // 16 bytes instead of 32 — a plausible half-written file.
    tauriFs.store.set("velo.key", btoa("0123456789abcdef"));
    const { encryptValue, KeyFileError } = await import("./crypto");
    await expect(encryptValue("x")).rejects.toThrow(KeyFileError);
    await expect(encryptValue("x")).rejects.toThrow(/expected 32 bytes/);
  });

  it("rejects a key file that is not base64", async () => {
    tauriFs.store.set("velo.key", "!!! not base64 !!!");
    const { encryptValue, KeyFileError } = await import("./crypto");
    await expect(encryptValue("x")).rejects.toThrow(KeyFileError);
  });

  it("accepts a well-formed 32-byte key", async () => {
    const key = new Uint8Array(32).fill(7);
    let binary = "";
    for (const b of key) binary += String.fromCharCode(b);
    tauriFs.store.set("velo.key", btoa(binary));
    const { encryptValue, decryptValue } = await import("./crypto");
    expect(await decryptValue(await encryptValue("hello"))).toBe("hello");
  });
});

describe("crypto — isEncrypted is structural, not a length heuristic (P5)", () => {
  beforeEach(() => {
    vi.resetModules();
    tauriFs.store.clear();
  });

  it("rejects plaintext whose halves are not canonical base64 lengths", async () => {
    const { isEncrypted } = await import("./crypto");
    // `hunter2` is 7 chars — a length `btoa` can never emit. The old check
    // accepted it because `atob` is lenient.
    expect(isEncrypted("abcdefghijklmnop:hunter2")).toBe(false);
    expect(isEncrypted("abcdefghijklmnop:pw")).toBe(false);
  });

  it("DOCUMENTS the residual ambiguity it cannot resolve", async () => {
    const { isEncrypted } = await import("./crypto");
    // A 12-byte IV is exactly 16 base64 chars, so a plaintext shaped like
    // `<16 base64 chars>:<base64>` is structurally identical to real
    // ciphertext. No shape check can separate them — only trial decryption can.
    //
    // This test asserts the limitation on purpose, so that nobody "fixes"
    // isEncrypted into something that silently guesses. The safety comes from
    // the caller failing closed (see accounts.test.ts): a wrong guess now
    // raises CredentialDecryptError instead of putting the value on the wire.
    expect(isEncrypted("0123456789abcdef:somepassword")).toBe(true);
  });

  it("rejects a wrong-length IV even when both halves are base64", async () => {
    const { isEncrypted } = await import("./crypto");
    // 8 bytes -> 12 base64 chars, and 16 bytes -> 24: both decode cleanly but
    // neither is a 12-byte GCM IV.
    expect(isEncrypted(`${btoa("12345678")}:${btoa("ciphertext")}`)).toBe(false);
    expect(isEncrypted(`${btoa("0123456789abcdef")}:${btoa("ciphertext")}`)).toBe(false);
  });

  it("rejects non-base64 alphabets and empty halves", async () => {
    const { isEncrypted } = await import("./crypto");
    for (const bad of ["", ":", "a:", ":b", "not base64!:alsobad!", "one:two:three"]) {
      expect(isEncrypted(bad)).toBe(false);
    }
  });

  it("still accepts real output of encryptValue", async () => {
    const { encryptValue, isEncrypted } = await import("./crypto");
    for (const plaintext of ["", "a", "a longer secret value with spaces"]) {
      expect(isEncrypted(await encryptValue(plaintext))).toBe(true);
    }
  });
});
