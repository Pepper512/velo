# SPEC-252 — Separate, encrypted SMTP credentials (upstream #252 + #253)

- **Task:** Store an IMAP/SMTP account's SMTP username and password as their own encrypted
  columns, persist what the add-account form collects, and have the SMTP config builder use
  them — falling back to the IMAP credentials so every existing account keeps working.
- **Tier:** **2** — `services/db/accounts.ts` and `services/db/migrations.ts` are named Tier-2
  files in `CLAUDE.md`; the change adds an encrypted credential column. Plan in the PR before
  code; threat pass and rollback below; both cross-vendor legs (ADR-004).
- **Base:** `main` @ `497955b` (code pin `848ccaa`). Every citation below was grepped at that pin.
- **Status:** building — branch `f252-smtp-credentials`; Jim's instruction 2026-09-02. The
  build seat owns the PR and the merge.
- **Source:** upstream avihaymenahem/velo#252 (bug: the SMTP password entered at setup is
  discarded; the connection test passes, sending fails afterwards) and #253 (feature: separate
  SMTP username and password — relay services, corporate split auth, per-protocol app
  passwords). The fork's 2026-09-01 triage ranked the pair **P1** and located the ternary. Bug-fix
  queue item 5.
- **Effort:** M · 1–2 days (the model's 2; the form is most of it).

## Outcome

A user who unticks "Use same credentials as IMAP" can enter an SMTP username and password,
see both connection tests pass, save, and then send mail with exactly those credentials. Every
account that exists today keeps sending with its IMAP credentials, untouched.

## The defect, verified in the fork

1. **The form collects a separate SMTP password and throws it away.** `AddImapAccount.tsx`
   holds `smtpPassword` (`:47`, input at `:809`) and uses it for the SMTP *test*
   (`:311-315` picks `form.smtpPassword` when `samePassword` is false). On save (`:387`) it
   passes `password: form.samePassword ? form.password : form.password` — both arms are the IMAP
   password — and never mentions `smtpPassword`. The test and the save disagree, which is the
   whole of #252: setup says "connected", the first send fails.
2. **Nothing could have stored it.** `accounts` has `imap_password` (migration `:535`) and no
   SMTP credential column; `insertImapAccount` (`accounts.ts:206-243`) takes one `password`.
3. **The SMTP builder reads the IMAP credential.** `buildSmtpConfig` (`imapConfigBuilder.ts:65-88`)
   uses `account.imap_password` and `account.imap_username || account.email` for SMTP.
4. **Only `imap_username` overrides the login name**, for both protocols — #253's complaint.
5. **Untouched on purpose:** `oauthTokenManager.ts:20` falls back to `imap_password` for the
   IMAP token path; OAuth accounts authenticate SMTP with the access token
   (`buildSmtpConfig`, `authMethod === "oauth2"`), so they get no SMTP password.

## Requirements

- **REQ-1** As a user with different SMTP credentials I want them saved and used.
  - REQ-1.1 THE SYSTEM SHALL store `smtp_username` and `smtp_password` on `accounts`
    (migration 28), `smtp_password` encrypted with the same AES-256-GCM path as
    `imap_password` and decrypted by the same fail-closed reader.
  - REQ-1.2 WHEN the add-account form is saved with "Use same credentials as IMAP" unticked
    THE SYSTEM SHALL persist the SMTP username (empty → `NULL`) and the SMTP password entered;
    WHEN ticked THE SYSTEM SHALL persist `NULL` for both.
  - REQ-1.3 THE SYSTEM SHALL derive the credentials used by the SMTP connection *test* and by
    the *save* from **one** function, so the two paths cannot diverge again (the root of #252).
  - REQ-1.4 WHEN building an SMTP config THE SYSTEM SHALL use `smtp_password` if set, else
    `imap_password`; and `smtp_username` if set, else `imap_username`, else the email. OAuth
    accounts keep using the access token.
- **REQ-2** As an existing user I want nothing to change.
  - REQ-2.1 An account with `NULL` SMTP columns SHALL produce exactly the SMTP config it
    produces today.
  - REQ-2.2 The migration SHALL be additive only; the contract step is recorded, not run.
- **REQ-3** Secrets stay secrets.
  - REQ-3.1 `smtp_password` SHALL never be logged, never appear in an error message, and
    SHALL be listed in `ENCRYPTED_FIELDS` so the re-auth banner names it without its value.
  - REQ-3.2 Test fixtures SHALL keep fake credentials out of literal form (the secret scan reads
    commit history — lesson from #56).

## Not doing

- An edit-account UI for SMTP credentials — there is no account-editing form for IMAP settings
  in the tree today; adding one is its own item. Re-adding the account is the path for existing
  users who need split credentials.
- OAuth accounts with a separate SMTP password (OAuth authenticates SMTP with the token).
- CalDAV credentials — already separate (`caldav_password`).

## Design

- **Migration 28** (expand): `ALTER TABLE accounts ADD COLUMN smtp_username TEXT;
  ALTER TABLE accounts ADD COLUMN smtp_password TEXT;`. Contract step (not run):
  `ALTER TABLE accounts DROP COLUMN smtp_username / smtp_password`.
- **`DbAccount`** gains both fields; `ENCRYPTED_FIELDS` gains `smtp_password` (+ label
  "SMTP password"), so `decryptAccountTokens` handles it with no other change.
- **`insertImapAccount`** takes optional `smtpUsername` / `smtpPassword`; encrypts the password
  when present; binds `NULL` otherwise. `insertOAuthImapAccount` is unchanged.
- **`resolveSmtpCredentials(form)`** — a pure function in `services/imap/smtpCredentials.ts`,
  used by the form's SMTP test and by its save (REQ-1.3): OAuth → token as password, no
  username override; same-credentials → IMAP username/password; otherwise the SMTP fields
  (username empty → `null`, meaning "use the IMAP username").
- **`buildSmtpConfig`** applies REQ-1.4.
- **Form:** the checkbox becomes "Use same credentials as IMAP"; unticked shows SMTP Username
  (optional, placeholder "same as IMAP username") and SMTP Password.
- **Decision & alternatives.** (a) Password only (#252 alone) — leaves #253's relay case and a
  second column later; the username is the same seam and the same fallback rule. (b) Both
  columns now — recommended. (c) A generic `smtp_credentials` JSON blob — hides a secret in
  a non-secret-typed column; no.
- **Failure modes** — a wrong fallback would break existing accounts' sending; REQ-2.1 is a
  test on the exact config object. A decryption failure on `smtp_password` fails closed like
  the other four fields (P5) and names "SMTP password" in the banner.

## Tasks (risk-first)
- [ ] 1. Tests first, red: `buildSmtpConfig` with and without the new columns (REQ-1.4, 2.1);
  `insertImapAccount` binding an encrypted `smtp_password` and `NULL`s; `getAccount` decrypting
  it; migration 28 on the harness; `resolveSmtpCredentials` for the four cases. — REQ-1, 2
- [ ] 2. Migration, type, `ENCRYPTED_FIELDS`, insert, builder, resolver.
- [ ] 3. Form: label, username field, test and save through the resolver; the identical
  ternary gone.
- [ ] 4. Mocks (`entities.mock.ts`) carry the new fields; docs counts; `CLAUDE.md` gotcha.
- [ ] 5. LOG.md; vault row; HANDOFF pin after merge.

## Done when
`npm run test` green with the tests above; `tsc` clean; migrations harness runs 28 up and
idempotently; CI green on the merge commit. Manual, optional: add an account against the Dovecot
harness with a different (wrong) SMTP password and see the SMTP test fail while IMAP passes —
then a correct one, save, and send through `:11143`'s SMTP if configured (the harness has no
SMTP; recorded as a reporter re-test).

## Rollback
`git revert` of the squash commit. The two columns stay (additive, ignored by the reverted
code); accounts saved with split credentials would fall back to the IMAP password for SMTP —
the pre-fix behaviour, which is exactly what #252 reports, so a revert is safe but visible.

## Threat pass (Tier 2)
- **Assets:** the SMTP password (a second credential per account); the account row.
- **Entry points:** the add-account form (user input) → `insertImapAccount`; the SMTP builder.
- **What an attacker gains:** nothing new — the column is encrypted exactly like
  `imap_password` with the same key; a reader who can decrypt one can decrypt the other.
- **Mitigations in this change:** encryption via `encryptValue`, fail-closed decryption (P5),
  the field named in `ENCRYPTED_FIELDS`, no logging of either credential, fixtures without
  literal secrets, parameters bound.
- **Residual:** the same single encryption key protects every credential (pre-existing).

## Review
Both cross-vendor legs on the PR, diffs from committed SHAs. Dispositions on the PR and in
LOG.md.

## Approval
Jim, 2026-09-02, by instruction; the plan is this file, committed before the code on the same
branch.
