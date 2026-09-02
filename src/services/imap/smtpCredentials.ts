/**
 * Which credentials an IMAP/SMTP account uses for SMTP (SPEC-252).
 *
 * The add-account form's SMTP connection *test* and its *save* both go
 * through this one function. Upstream #252 was the two paths disagreeing:
 * the test used the SMTP password the user typed, the save used the IMAP
 * password (an identical ternary), so setup said "connected" and the first
 * send failed.
 */
export interface SmtpCredentialInputs {
  isOAuth: boolean;
  /** For OAuth accounts: the access token authenticates SMTP. */
  oauthAccessToken?: string | null;
  /** "Use same credentials as IMAP". */
  sameCredentials: boolean;
  imapUsername: string;
  /** The IMAP password. */
  password: string;
  smtpUsername: string;
  smtpPassword: string;
}

export interface SmtpCredentials {
  /** `null` means "the IMAP username (or the email) applies". */
  username: string | null;
  password: string;
}

export function resolveSmtpCredentials(form: SmtpCredentialInputs): SmtpCredentials {
  if (form.isOAuth) {
    return { username: null, password: form.oauthAccessToken ?? "" };
  }
  if (form.sameCredentials) {
    return { username: null, password: form.password };
  }
  const username = form.smtpUsername.trim();
  return { username: username.length > 0 ? username : null, password: form.smtpPassword };
}
