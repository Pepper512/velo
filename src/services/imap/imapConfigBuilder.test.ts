import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock() is hoisted — inline factory, no external references.
vi.mock("../oauth/oauthTokenManager", () => ({
  ensureFreshToken: vi.fn(),
}));

import {
  buildImapConfig,
  buildSmtpConfig,
  buildImapConfigWithFreshToken,
} from "./imapConfigBuilder";
import { ensureFreshToken } from "../oauth/oauthTokenManager";
import { createMockDbAccount } from "@/test/mocks";

describe("buildImapConfig", () => {
  it("builds config from account with ssl security mapped to tls", () => {
    const account = createMockDbAccount();
    const config = buildImapConfig(account);

    expect(config).toEqual({
      host: "imap.example.com",
      port: 993,
      security: "tls",
      username: "user@example.com",
      password: "secret123",
      auth_method: "password",
      accept_invalid_certs: false,
    });
  });

  it("maps tls security to tls", () => {
    const account = createMockDbAccount({ imap_security: "tls" });
    const config = buildImapConfig(account);
    expect(config.security).toBe("tls");
  });

  it("maps starttls security to starttls", () => {
    const account = createMockDbAccount({ imap_security: "starttls" });
    const config = buildImapConfig(account);
    expect(config.security).toBe("starttls");
  });

  it("maps none security to none", () => {
    const account = createMockDbAccount({ imap_security: "none" });
    const config = buildImapConfig(account);
    expect(config.security).toBe("none");
  });

  it("defaults to tls when security is null", () => {
    const account = createMockDbAccount({ imap_security: null });
    const config = buildImapConfig(account);
    expect(config.security).toBe("tls");
  });

  it("defaults port to 993 when null", () => {
    const account = createMockDbAccount({ imap_port: null });
    const config = buildImapConfig(account);
    expect(config.port).toBe(993);
  });

  it("handles oauth2 auth method", () => {
    const account = createMockDbAccount({ auth_method: "oauth2" });
    const config = buildImapConfig(account);
    expect(config.auth_method).toBe("oauth2");
  });

  it("uses accessToken override for oauth2 accounts", () => {
    const account = createMockDbAccount({ auth_method: "oauth2", imap_password: "old" });
    const config = buildImapConfig(account, "fresh-token");
    expect(config.password).toBe("fresh-token");
    expect(config.auth_method).toBe("oauth2");
  });

  it("ignores accessToken override for password accounts", () => {
    const account = createMockDbAccount({ auth_method: "password" });
    const config = buildImapConfig(account, "should-not-use");
    expect(config.password).toBe("secret123");
  });

  it("throws when imap_host is missing", () => {
    const account = createMockDbAccount({ imap_host: null });
    expect(() => buildImapConfig(account)).toThrow("no IMAP host configured");
  });

  it("handles empty password gracefully", () => {
    const account = createMockDbAccount({ imap_password: null });
    const config = buildImapConfig(account);
    expect(config.password).toBe("");
  });
});

describe("buildSmtpConfig", () => {
  it("builds config from account SMTP fields", () => {
    const account = createMockDbAccount();
    const config = buildSmtpConfig(account);

    expect(config).toEqual({
      host: "smtp.example.com",
      port: 587,
      security: "starttls",
      username: "user@example.com",
      password: "secret123",
      auth_method: "password",
      accept_invalid_certs: false,
    });
  });

  it("defaults port to 587 when null", () => {
    const account = createMockDbAccount({ smtp_port: null });
    const config = buildSmtpConfig(account);
    expect(config.port).toBe(587);
  });

  it("throws when smtp_host is missing", () => {
    const account = createMockDbAccount({ smtp_host: null });
    expect(() => buildSmtpConfig(account)).toThrow("no SMTP host configured");
  });

  it("maps ssl security to tls for SMTP", () => {
    const account = createMockDbAccount({ smtp_security: "ssl" });
    const config = buildSmtpConfig(account);
    expect(config.security).toBe("tls");
  });

  it("uses accessToken override for oauth2 SMTP", () => {
    const account = createMockDbAccount({ auth_method: "oauth2" });
    const config = buildSmtpConfig(account, "smtp-oauth-token");
    expect(config.password).toBe("smtp-oauth-token");
    expect(config.auth_method).toBe("oauth2");
  });
});

describe("imap_username override", () => {
  it("uses imap_username when set for IMAP config", () => {
    const account = createMockDbAccount({ imap_username: "custom-user" });
    const config = buildImapConfig(account);
    expect(config.username).toBe("custom-user");
  });

  it("uses imap_username when set for SMTP config", () => {
    const account = createMockDbAccount({ imap_username: "custom-user" });
    const config = buildSmtpConfig(account);
    expect(config.username).toBe("custom-user");
  });

  it("falls back to email when imap_username is null", () => {
    const account = createMockDbAccount({ imap_username: null });
    const config = buildImapConfig(account);
    expect(config.username).toBe("user@example.com");
  });

  it("falls back to email when imap_username is empty string", () => {
    const account = createMockDbAccount({ imap_username: "" as string | null });
    const config = buildImapConfig(account);
    expect(config.username).toBe("user@example.com");
  });
});

describe("accept_invalid_certs", () => {
  it("defaults to false when account flag is 0", () => {
    const account = createMockDbAccount({ accept_invalid_certs: 0 });
    const imapConfig = buildImapConfig(account);
    const smtpConfig = buildSmtpConfig(account);
    expect(imapConfig.accept_invalid_certs).toBe(false);
    expect(smtpConfig.accept_invalid_certs).toBe(false);
  });

  it("sets to true when account flag is 1", () => {
    const account = createMockDbAccount({ accept_invalid_certs: 1 });
    const imapConfig = buildImapConfig(account);
    const smtpConfig = buildSmtpConfig(account);
    expect(imapConfig.accept_invalid_certs).toBe(true);
    expect(smtpConfig.accept_invalid_certs).toBe(true);
  });
});

/**
 * Regression guard for the OAuth-over-IMAP sync bug.
 *
 * `imapInitialSync` and `imapDeltaSync` used to call `buildImapConfig(account)`
 * with no token. For an OAuth IMAP account `imap_password` is NULL by
 * construction — `insertOAuthImapAccount` writes the literal NULL and keeps the
 * credential in `access_token` — so the sync path authenticated with `""` while
 * the interactive path (which did pass a token) worked. The account could
 * archive and read mail but never sync.
 *
 * This helper is the single place that gets it right, so the mistake cannot be
 * made once per call site again.
 */
describe("buildImapConfigWithFreshToken", () => {
  const mockEnsureFreshToken = vi.mocked(ensureFreshToken);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a freshly refreshed token as the password for oauth2 accounts", async () => {
    mockEnsureFreshToken.mockResolvedValue("fresh-oauth-token");
    // Exactly how the DB stores an OAuth IMAP account: no imap_password at all.
    const account = createMockDbAccount({
      auth_method: "oauth2",
      imap_password: null,
      access_token: "stale-token",
    });

    const config = await buildImapConfigWithFreshToken(account);

    expect(mockEnsureFreshToken).toHaveBeenCalledWith(account);
    expect(config.password).toBe("fresh-oauth-token");
    expect(config.auth_method).toBe("oauth2");
  });

  it("never produces an empty password for an oauth2 account with no imap_password", async () => {
    mockEnsureFreshToken.mockResolvedValue("fresh-oauth-token");
    const account = createMockDbAccount({
      auth_method: "oauth2",
      imap_password: null,
    });

    const config = await buildImapConfigWithFreshToken(account);

    expect(config.password).not.toBe("");
  });

  it("does not call the token manager for password accounts", async () => {
    const account = createMockDbAccount({
      auth_method: "password",
      imap_password: "secret-password",
    });

    const config = await buildImapConfigWithFreshToken(account);

    expect(mockEnsureFreshToken).not.toHaveBeenCalled();
    expect(config.password).toBe("secret-password");
  });
});
