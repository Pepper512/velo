## Verdict

**APPROVE WITH NITS**

The implementation cleanly resolves upstream #252 and #253. Secrets are properly encrypted with AES-256-GCM via `encryptValue`, `smtp_password` is correctly registered in `ENCRYPTED_FIELDS` for fail-closed decryption, migration 28 is strictly additive and idempotent, and deriving both the SMTP test and save credentials from `resolveSmtpCredentials` eliminates the diverging-ternary bug class. A few minor edge-case discrepancies and test gaps should be addressed.

---

## Findings

### 1. [MEDIUM] `src/services/db/accounts.ts` (`insertImapAccount`) & `src/services/imap/smtpCredentials.ts` (`resolveSmtpCredentials`)
- **Concern:** Falsy check on `account.smtpPassword` coerces an empty string `""` to `null`, creating a divergence between the SMTP test and runtime email sending.
- **Exact Scenario:** A user unchecks *"Use same credentials as IMAP"*, enters a custom `smtpUsername` (e.g. `"relay-user"`), but leaves `smtpPassword` blank (`""`).
  1. `resolveSmtpCredentials` returns `{ username: "relay-user", password: "" }`.
  2. `testSmtpConnection` runs against Rust with `password: ""`.
  3. On save, `insertImapAccount` evaluates `account.smtpPassword ? await encryptValue(...) : null`. Because `""` is falsy, `encSmtpPassword` becomes `null` and `accounts.smtp_password` is saved as `NULL`.
  4. At runtime, `buildSmtpConfig` executes `account.smtp_password ?? account.imap_password ?? ""`. Since `smtp_password` is `NULL`, it falls back to `account.imap_password`.
- **Consequence:** `testSmtpConnection` tests authentication with an empty password `""`, whereas subsequent runtime sending uses `imap_password`.
- **Fix:** In `insertImapAccount`, distinguish between omitted (`undefined`/`null`) and empty string, or validate in the form that `smtpPassword` cannot be empty when `samePassword` is false. If empty password is intentionally supposed to fall back to IMAP password, ensure `resolveSmtpCredentials` performs the same fallback so `testSmtpConnection` tests what will actually be used.

---

### 2. [LOW] `src/services/db/accounts.test.ts` (`getAccount` / `decryptAccountTokens`)
- **Concern:** Missing negative test for fail-closed decryption failure on `smtp_password`.
- **Exact Scenario:** The spec states: *"A decryption failure on `smtp_password` fails closed like the other four fields (P5) and names 'SMTP password' in the banner."* While `accounts.test.ts` verifies positive decryption of `smtp_password`, there is no test simulating corrupted or un-decryptable ciphertext in `smtp_password`.
- **Consequence:** Regression risk if decryption error handling or field labeling in `FIELD_LABELS` regresses for `smtp_password`.
- **Fix:** Add a unit test in [accounts.test.ts](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src/services/db/accounts.test.ts) passing corrupted ciphertext (e.g. `smtp_password: "enc:invalid-ciphertext"`) to verify that `getAccount` fails closed and surfaces the expected `"SMTP password"` label in the error banner state.

---

### 3. [LOW] `src/components/accounts/AddImapAccount.tsx`
- **Concern:** Missing component-level UI and form integration tests.
- **Exact Scenario:** `AddImapAccount.tsx` introduced new form fields, state management, and branching in both `testSmtpConnection` and the save handler, but no tests in `AddImapAccount.test.tsx` were added or updated.
- **Consequence:** Regressions in form state toggling, field visibility, or argument forwarding to `invoke("smtp_test_connection")` and `insertImapAccount` will not be caught in CI.
- **Fix:** Add component tests verifying:
  1. Toggling *"Use same credentials as IMAP"* displays/hides the `smtp-username` and `smtp-password` inputs.
  2. Clicking *"Test SMTP"* when unticked passes the resolved separate SMTP username and password to Tauri's `smtp_test_connection`.
  3. Saving the form persists `smtpUsername` and `smtpPassword` when unticked, and `undefined`/`null` when ticked.

---

### 4. [NIT] `src/services/imap/imapConfigBuilder.test.ts` (`buildSmtpConfig`)
- **Concern:** Incomplete test coverage for the asymmetric per-field fallback matrix.
- **Exact Scenario:** `imapConfigBuilder.test.ts` tests:
  - Both fields set (`smtp_username: "relay-login", smtp_password: "..."`).
  - Both fields null (`smtp_username: null, smtp_password: null`).
  - SMTP password set with null SMTP username (`smtp_username: null, smtp_password: "..."`).
  - It does not test the inverse: custom `smtp_username` with null `smtp_password`.
- **Consequence:** Asymmetric fallback behavior (`smtp_username` set, `smtp_password` falling back to `imap_password`) is not explicitly asserted.
- **Fix:** Add a test case in [imapConfigBuilder.test.ts](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src/services/imap/imapConfigBuilder.test.ts):
  ```ts
  it("falls back per field: an SMTP username with no SMTP password keeps the IMAP password", () => {
    const account = createMockDbAccount({ imap_username: "imap-login", smtp_username: "relay-login", smtp_password: null });
    const config = buildSmtpConfig(account);
    expect(config.username).toBe("relay-login");
    expect(config.password).toBe("secret123");
  });
  ```

---

### 5. [NIT] `src/components/accounts/AddImapAccount.tsx` (`testSmtpConnection`)
- **Concern:** Inconsistent string trimming on fallback IMAP username.
- **Exact Scenario:** On save, `form.imapUsername.trim() || null` is used, and in `resolveSmtpCredentials`, `form.smtpUsername.trim()` is used. However, in `testSmtpConnection`:
  ```tsx
  username: smtp.username || form.imapUsername || (isOAuth ? (form.oauthEmail ?? form.email) : form.email)
  ```
  `form.imapUsername` is not trimmed.
- **Consequence:** If a user enters `" user "` in the IMAP username field and leaves SMTP username blank, `testSmtpConnection` will test with leading/trailing spaces while save and runtime send will use the trimmed `"user"`.
- **Fix:** Use `smtp.username || form.imapUsername.trim() || (isOAuth ? ...)` in `testSmtpConnection`, or have `smtpCredentialInputs` pre-trim inputs.

---

### 6. [NIT] `src/components/accounts/AddImapAccount.tsx` (JSX layout)
- **Concern:** Missing vertical margin/spacing between the SMTP Username and SMTP Password fields.
- **Exact Scenario:** Inside `{!form.samePassword && (<div> ... </div>)}`, `<input id="smtp-username" />` is followed immediately by `<label htmlFor="smtp-password" />` without container gap styling (e.g. `space-y-3` or `mt-3`).
- **Consequence:** The SMTP Password label renders flush against the bottom edge of the SMTP Username input box.
- **Fix:** Add `className="space-y-3 mt-3"` to the wrapper `<div>`.

---

## Questions

1. **Form Validation:** When *"Use same credentials as IMAP"* is unchecked, should the form require `smtpPassword` to be non-empty before allowing submission, or is an empty/passwordless SMTP relay authentication explicitly supported?

---

## What is Good

- **Root Cause Elimination:** Routing both `testSmtpConnection` and `insertImapAccount` through the pure `resolveSmtpCredentials` function permanently prevents test/save divergence (#252).
- **Fail-Closed Security by Design:** Reusing the existing `ENCRYPTED_FIELDS` table in [accounts.ts](file:///Users/jpepper/.gemini/antigravity-cli/scratch/src/services/db/accounts.ts) ensures `smtp_password` automatically inherits AES-256-GCM encryption, parameterized query binding, and fail-closed decryption with user-friendly label reporting.
- **Zero-Risk Backward Compatibility:** `buildSmtpConfig` uses per-field nullish/falsy fallbacks (`account.smtp_password ?? account.imap_password`), guaranteeing all existing accounts (and OAuth accounts) behave exactly as before.
- **Clean Migration:** Migration 28 is purely additive, schema-safe for SQLite, and documents the expand/contract lifecycle contract.
