import {
  getAllAccounts,
  getAccount,
  getAccountByEmail,
  insertImapAccount,
  insertAccount,
  deleteAccount,
  updateAccountTokens,
  updateAccountSyncState,
} from "./accounts";
import { createMockGmailAccount, createMockImapAccount } from "@/test/mocks";

const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock("./connection", () => ({
  getDb: vi.fn(() => ({
    execute: (...args: unknown[]) => mockExecute(...args),
    select: (...args: unknown[]) => mockSelect(...args),
  })),
  selectFirstBy: vi.fn(),
}));

// The error classes are the REAL ones -- a stub would let a test pass while the
// production code threw something else entirely.
vi.mock("@/utils/crypto", async () => {
  const actual = await vi.importActual<typeof import("@/utils/crypto")>("@/utils/crypto");
  return {
    CredentialDecryptError: actual.CredentialDecryptError,
    KeyFileError: actual.KeyFileError,
    encryptValue: vi.fn((val: string) => Promise.resolve(`enc:${val}`)),
    decryptValue: vi.fn((val: string) => Promise.resolve(val.replace("enc:", ""))),
    isEncrypted: vi.fn((val: string) => val.startsWith("enc:")),
  };
});

import { selectFirstBy } from "./connection";

const mockSelectFirstBy = vi.mocked(selectFirstBy);

describe("accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAccount", () => {
    it("returns null for non-existent account", async () => {
      mockSelectFirstBy.mockResolvedValue(null);

      const result = await getAccount("nonexistent");

      expect(result).toBeNull();
    });

    it("returns a Gmail account with decrypted tokens", async () => {
      mockSelectFirstBy.mockResolvedValue(createMockGmailAccount());

      const result = await getAccount("acc-gmail");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("acc-gmail");
      expect(result!.provider).toBe("gmail_api");
      expect(result!.access_token).toBe("access-token");
      expect(result!.refresh_token).toBe("refresh-token");
    });

    it("returns an IMAP account with decrypted imap_password", async () => {
      mockSelectFirstBy.mockResolvedValue(createMockImapAccount());

      const result = await getAccount("acc-imap");

      expect(result).not.toBeNull();
      expect(result!.provider).toBe("imap");
      expect(result!.imap_host).toBe("imap.example.com");
      expect(result!.imap_port).toBe(993);
      expect(result!.imap_security).toBe("tls");
      expect(result!.smtp_host).toBe("smtp.example.com");
      expect(result!.smtp_port).toBe(465);
      expect(result!.smtp_security).toBe("tls");
      expect(result!.auth_method).toBe("password");
      expect(result!.imap_password).toBe("secret-password");
    });

    it("decrypts a stored SMTP password like the other credentials (SPEC-252 REQ-1.1)", async () => {
      const smtpSecret = ["relay", "secret"].join("-");
      mockSelectFirstBy.mockResolvedValue(
        createMockImapAccount({ id: "split-imap", smtp_username: "relay-user", smtp_password: `enc:${smtpSecret}` }),
      );

      const account = await getAccount("split-imap");

      expect(account?.smtp_username).toBe("relay-user");
      expect(account?.smtp_password).toBe(smtpSecret);
    });

    it("handles IMAP account with null imap_password gracefully", async () => {
      mockSelectFirstBy.mockResolvedValue(
        createMockImapAccount({ imap_password: null }),
      );

      const result = await getAccount("acc-imap");

      expect(result!.imap_password).toBeNull();
    });
  });

  describe("getAccountByEmail", () => {
    it("returns account matching email", async () => {
      mockSelectFirstBy.mockResolvedValue(createMockImapAccount());

      const result = await getAccountByEmail("user@example.com");

      expect(result).not.toBeNull();
      expect(result!.email).toBe("user@example.com");
    });

    it("returns null when email not found", async () => {
      mockSelectFirstBy.mockResolvedValue(null);

      const result = await getAccountByEmail("unknown@example.com");

      expect(result).toBeNull();
    });
  });

  describe("getAllAccounts", () => {
    it("returns all accounts with decrypted tokens", async () => {
      mockSelect.mockResolvedValue([createMockGmailAccount(), createMockImapAccount()]);

      const result = await getAllAccounts();

      expect(result).toHaveLength(2);
      expect(result[0]!.provider).toBe("gmail_api");
      expect(result[0]!.access_token).toBe("access-token");
      expect(result[1]!.provider).toBe("imap");
      expect(result[1]!.imap_password).toBe("secret-password");
    });

    it("returns empty array when no accounts exist", async () => {
      mockSelect.mockResolvedValue([]);

      const result = await getAllAccounts();

      expect(result).toEqual([]);
    });

    it("decrypts imap_password for IMAP accounts in the list", async () => {
      mockSelect.mockResolvedValue([createMockImapAccount()]);

      const result = await getAllAccounts();

      expect(result[0]!.imap_password).toBe("secret-password");
    });
  });

  describe("insertImapAccount", () => {
    it("inserts IMAP account with encrypted password", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertImapAccount({
        id: "new-imap",
        email: "user@fastmail.com",
        displayName: "Fastmail User",
        avatarUrl: null,
        imapHost: "imap.fastmail.com",
        imapPort: 993,
        imapSecurity: "ssl",
        smtpHost: "smtp.fastmail.com",
        smtpPort: 465,
        smtpSecurity: "ssl",
        authMethod: "password",
        password: "my-app-password",
      });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("INSERT INTO accounts");
      expect(sql).toContain("'imap'");
      expect(params).toEqual([
        "new-imap",
        "user@fastmail.com",
        "Fastmail User",
        null,
        "imap.fastmail.com",
        993,
        "ssl",
        "smtp.fastmail.com",
        465,
        "ssl",
        "password",
        "enc:my-app-password", // encrypted
        null, // imap_username
        0, // accept_invalid_certs
        null, // smtp_username (SPEC-252: same credentials as IMAP)
        null, // smtp_password
      ]);
    });

    it("stores separate SMTP credentials with the password encrypted (SPEC-252 REQ-1.1/1.2)", async () => {
      mockExecute.mockResolvedValue(undefined);
      const smtpSecret = ["relay", "secret"].join("-");

      await insertImapAccount({
        id: "split-imap",
        email: "user@corp.test",
        displayName: null,
        avatarUrl: null,
        imapHost: "imap.corp.test",
        imapPort: 993,
        imapSecurity: "ssl",
        smtpHost: "relay.corp.test",
        smtpPort: 587,
        smtpSecurity: "starttls",
        authMethod: "password",
        password: "imap-app-password",
        smtpUsername: "relay-user",
        smtpPassword: smtpSecret,
      });

      const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("smtp_username, smtp_password");
      expect(params.slice(-2)).toEqual(["relay-user", `enc:${smtpSecret}`]);
      // The plain SMTP secret never reaches the statement.
      expect(params).not.toContain(smtpSecret);
    });

    it("inserts IMAP account with custom username", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertImapAccount({
        id: "new-imap-2",
        email: "user@example.com",
        displayName: null,
        avatarUrl: null,
        imapHost: "imap.example.com",
        imapPort: 993,
        imapSecurity: "ssl",
        smtpHost: "smtp.example.com",
        smtpPort: 465,
        smtpSecurity: "ssl",
        authMethod: "password",
        password: "pass",
        imapUsername: "custom-login-id",
      });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("imap_username");
      expect(params).toContain("custom-login-id");
    });

    it("sets access_token and refresh_token to NULL for IMAP accounts", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertImapAccount({
        id: "imap-1",
        email: "test@test.com",
        displayName: null,
        avatarUrl: null,
        imapHost: "imap.test.com",
        imapPort: 993,
        imapSecurity: "tls",
        smtpHost: "smtp.test.com",
        smtpPort: 587,
        smtpSecurity: "starttls",
        authMethod: "password",
        password: "pass",
      });

      const [sql] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("NULL, NULL");
      expect(sql).toContain("'imap'");
    });
  });

  describe("insertAccount (Gmail/OAuth)", () => {
    it("inserts OAuth account with encrypted tokens", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertAccount({
        id: "gmail-1",
        email: "user@gmail.com",
        displayName: "Test User",
        avatarUrl: "https://example.com/avatar.jpg",
        accessToken: "access-token-123",
        refreshToken: "refresh-token-456",
        tokenExpiresAt: 9999999999,
      });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("INSERT INTO accounts");
      expect(params).toContain("enc:access-token-123");
      expect(params).toContain("enc:refresh-token-456");
    });
  });

  describe("deleteAccount", () => {
    it("deletes account by id", async () => {
      mockExecute.mockResolvedValue(undefined);

      await deleteAccount("acc-1");

      const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("DELETE FROM accounts");
      expect(params).toEqual(["acc-1"]);
    });
  });

  describe("updateAccountTokens", () => {
    it("updates access_token with encryption", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateAccountTokens("acc-1", "new-token", 1234567890);

      const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("UPDATE accounts SET access_token");
      expect(params).toContain("enc:new-token");
      expect(params).toContain(1234567890);
    });
  });

  describe("updateAccountSyncState", () => {
    it("updates history_id and last_sync_at", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateAccountSyncState("acc-1", "history-999");

      const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("UPDATE accounts SET history_id");
      expect(params).toEqual(["history-999", "acc-1"]);
    });
  });
});

// ---------------------------------------------------------------------------
// Audit P5: credential decryption must fail closed.
// ---------------------------------------------------------------------------

describe("decryptAccountTokens fails closed (P5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Every credential column, and the exact failure the old code swallowed.
   * Previously each of these logged "using raw value" and returned the AES
   * ciphertext, which the IMAP/SMTP client then sent to the mail server as the
   * user's password.
   */
  const CREDENTIAL_FIELDS = [
    "access_token",
    "refresh_token",
    "imap_password",
    "oauth_client_secret",
    "caldav_password",
  ] as const;

  it.each(CREDENTIAL_FIELDS)(
    "throws CredentialDecryptError when %s cannot be decrypted",
    async (field) => {
      const { decryptValue } = await import("@/utils/crypto");
      const { CredentialDecryptError } = await vi.importActual<
        typeof import("@/utils/crypto")
      >("@/utils/crypto");

      vi.mocked(decryptValue).mockRejectedValueOnce(new Error("bad key"));

      const account = { ...createMockImapAccount(), [field]: "enc:whatever" };
      mockSelectFirstBy.mockResolvedValue(account);

      await expect(getAccount(account.id)).rejects.toThrow(CredentialDecryptError);
    },
  );

  it("never returns a value that still looks like ciphertext", async () => {
    const { decryptValue } = await import("@/utils/crypto");
    // Simulate decryptValue "succeeding" but handing back the input unchanged --
    // the belt-and-braces guard in decryptAccountTokens.
    vi.mocked(decryptValue).mockResolvedValueOnce("enc:still-encrypted");

    mockSelectFirstBy.mockResolvedValue({
      ...createMockImapAccount(),
      imap_password: "enc:secret",
    });

    await expect(getAccount("acct-1")).rejects.toThrow(/IMAP password/);
  });

  it("names the field but never leaks the value", async () => {
    const { decryptValue } = await import("@/utils/crypto");
    vi.mocked(decryptValue).mockRejectedValueOnce(new Error("bad key"));

    mockSelectFirstBy.mockResolvedValue({
      ...createMockImapAccount(),
      imap_password: "enc:hunter2-super-secret",
    });

    await expect(getAccount("acct-1")).rejects.toThrow(/IMAP password/);
    await expect(
      getAccount("acct-1").catch((e: Error) => e.message),
    ).resolves.not.toContain("hunter2");
  });

  it("getAllAccounts rejects rather than yielding a partly-decrypted list", async () => {
    const { decryptValue } = await import("@/utils/crypto");
    const { CredentialDecryptError } = await vi.importActual<
      typeof import("@/utils/crypto")
    >("@/utils/crypto");

    // First account decrypts fine, second fails. The old code would have
    // returned both, the second carrying ciphertext as its password.
    vi.mocked(decryptValue)
      .mockResolvedValueOnce("good-password")
      .mockRejectedValueOnce(new Error("bad key"));

    mockSelect.mockResolvedValue([
      { ...createMockImapAccount(), id: "a1", imap_password: "enc:one" },
      { ...createMockImapAccount(), id: "a2", imap_password: "enc:two" },
    ]);

    await expect(getAllAccounts()).rejects.toThrow(CredentialDecryptError);
  });

  it("leaves plaintext (non-encrypted) values untouched", async () => {
    const { decryptValue } = await import("@/utils/crypto");

    mockSelectFirstBy.mockResolvedValue({
      ...createMockImapAccount(),
      imap_password: "plain-text-password",
    });

    const account = await getAccount("acct-1");
    expect(account?.imap_password).toBe("plain-text-password");
    expect(decryptValue).not.toHaveBeenCalled();
  });
});
