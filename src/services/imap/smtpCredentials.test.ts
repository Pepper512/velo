import { describe, it, expect } from "vitest";
import { resolveSmtpCredentials } from "./smtpCredentials";

/**
 * SPEC-252 REQ-1.3: the add-account form's SMTP *test* and its *save* must
 * derive the credentials from one function — #252 was the two paths
 * disagreeing (the test used the SMTP password, the save used the IMAP one).
 * No literal that looks like a credential: the secret scan reads commit history.
 */
const imapPassword = ["imap", "pass"].join("-");
const smtpPassword = ["smtp", "pass"].join("-");
const token = ["oauth", "token"].join("-");

describe("resolveSmtpCredentials", () => {
  it("uses the IMAP credentials when 'same credentials' is ticked", () => {
    expect(
      resolveSmtpCredentials({
        isOAuth: false,
        sameCredentials: true,
        imapUsername: "user@x",
        password: imapPassword,
        smtpUsername: "ignored@x",
        smtpPassword: smtpPassword,
      }),
    ).toEqual({ username: null, password: imapPassword });
  });

  it("uses the SMTP fields when unticked, and an empty SMTP username means 'same as IMAP'", () => {
    expect(
      resolveSmtpCredentials({
        isOAuth: false,
        sameCredentials: false,
        imapUsername: "user@x",
        password: imapPassword,
        smtpUsername: "relay-user",
        smtpPassword: smtpPassword,
      }),
    ).toEqual({ username: "relay-user", password: smtpPassword });
    expect(
      resolveSmtpCredentials({
        isOAuth: false,
        sameCredentials: false,
        imapUsername: "user@x",
        password: imapPassword,
        smtpUsername: "   ",
        smtpPassword: smtpPassword,
      }),
    ).toEqual({ username: null, password: smtpPassword });
  });

  it("uses the access token for OAuth accounts whatever the checkbox says", () => {
    expect(
      resolveSmtpCredentials({
        isOAuth: true,
        oauthAccessToken: token,
        sameCredentials: false,
        imapUsername: "",
        password: "",
        smtpUsername: "relay-user",
        smtpPassword: smtpPassword,
      }),
    ).toEqual({ username: null, password: token });
    expect(
      resolveSmtpCredentials({ isOAuth: true, sameCredentials: true, imapUsername: "", password: "", smtpUsername: "", smtpPassword: "" }),
    ).toEqual({ username: null, password: "" });
  });
});
