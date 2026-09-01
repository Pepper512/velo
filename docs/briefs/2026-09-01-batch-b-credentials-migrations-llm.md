# Brief — Batch B: credentials, migrations, and the LLM boundary

- **Task:** Close audit items **P5**, **P6**, **P10**, and build the **P12 real-SQLite test harness**
  (pulled forward from a later batch by Jim, 2026-09-01).
- **Tier:** **2** on all three counts — credential handling at rest, a destructive migration, and the
  LLM output boundary are each named Tier 2 by `CLAUDE.md` Part I and ADR-000's "Standard → this
  stack" table. Blast radius: every stored credential, every user's local mail database, and the
  compose/send path. Reversibility: **P5 and P10 are revertible; P6 is not** — see **Rollback**.
- **Date / owner:** 2026-09-01 · agent drafts, **Jim approves before any code** (no pre-approval on
  this batch, unlike Batch A).
- **Source:** `docs/audits/2026-09-01-optimize-audit.md` §P5, §P6, §P10, §P12; delegation map §3.
- **Base:** `main` @ `f7e890b` (Batch A merged). Re-verify before building — see **Constraints**.

> **Scope note.** The delegation map (§3) is authoritative on batch membership: **B = P5 + P6 + P10.**
> An earlier draft of `HANDOFF.md` said "P5–P8"; that was wrong and is corrected in `LOG.md`.
> **P7 and P8 are Batch C**, with P9 and P14. The harness is Jim's addition to B.

---

## Outcome

1. A corrupt, rotated, or truncated `velo.key` produces a **visible re-auth prompt**, not a silent
   attempt to log into the user's mail server using AES ciphertext as the password.
2. The destructive IMAP "repair" in `runMigrations` either completes fully or leaves **nothing**
   deleted, and is proven so by a test that actually executes SQL.
3. A crafted email cannot steer Velo's AI features by breaking out of the prompt delimiter, and no
   model output reaches the composer without passing a shape check.
4. The test suite can run real SQL for the first time.

---

## Not doing

- **No OS-keychain migration.** ADR-000 lists keychain storage as a tripwire and the audit marks it
  "related, separately briefed". P5 makes the *current* scheme fail closed; it does not change where
  the key lives. That is a bigger, separate Tier 2 decision.
- **No `crypto.ts` rewrite beyond what P5 names** — key-file validation at load and a structural
  `isEncrypted`. Not touching the AES scheme, the IV handling, or the file location.
- **No P7/P8** (Batch C), **no P9 sanitizer corpus** (Batch C), **no P11 capability split** (Batch G).
  The P9+P11 chain is the largest open risk in the codebase and it is *not* this batch — flagged here
  so the sequencing is a decision rather than an oversight.
- **No conversion of the other ~79 console-only catch blocks** (P14, Batch C). Only the five in
  `decryptAccountTokens`.
- **No `runMigrations` restructuring** beyond making the repair atomic and moving it into the numbered
  ledger. The 924-line file stays 924 lines.
- **No new component tests.** (See the note under *Constraints* — the audit's "components 0% tested"
  claim is false; that work is smaller than advertised, but it is still not this batch.)

---

## Done when

### P12 — the harness (build first; P6 depends on it)

1. `src/test/sqliteHarness.ts` exports a helper that returns an in-memory `better-sqlite3` database
   presenting the same surface `runMigrations` consumes (`select` / `execute`), so the **production**
   `runMigrations` can be pointed at it — not a copy of it.
2. **No new dependency.** `better-sqlite3` (devDependency), `src/test/better-sqlite3.d.ts`, and the
   smoke test `src/test/sqliteHarness.test.ts` all landed in D0 under **ADR-001**, which already
   covers exactly this use.
3. The existing smoke test still passes; the harness is exercised by the P6 tests below.

### P5 — credential decrypt fails closed

4. `decryptAccountTokens` (`src/services/db/accounts.ts:39-75`) **throws a typed
   `CredentialDecryptError`** instead of its five
   `console.warn("Failed to decrypt …, using raw value")` blocks. It must never return a value for
   which `isEncrypted()` is true.
5. The five affected fields are `access_token`, `refresh_token`, `imap_password`,
   `oauth_client_secret`, `caldav_password`.
6. The error surfaces as a **re-auth banner**, following the existing `CalendarReauthBanner` pattern —
   the user is told the key is unreadable, not shown "wrong password".
7. **Key-file validation at load** (`crypto.ts:47-74`): reject a `velo.key` that is not exactly 32
   bytes after base64-decode, with a distinct error from "decrypt failed". Today `base64Decode` feeds
   whatever it finds straight into `importKey`.
8. **`isEncrypted` becomes structural** (`crypto.ts:~131`). Today it is
   `parts.length === 2 && atob(both) && parts[0].length === 16` — so **any 16-character base64-ish
   prefix followed by `:` is misclassified as ciphertext**. Replace with an explicit `iv:ct` check:
   both halves base64-alphabet, IV decodes to exactly 12 bytes, ciphertext non-empty.
9. **Tests:** corrupt key → `CredentialDecryptError` and **no network call attempted** · truncated key
   file → distinct error at load · a 16-char plaintext prefix → `isEncrypted === false` · negative
   test that `getAllAccounts()` never resolves with an `isEncrypted()`-true value in any credential
   field.

### P6 — the destructive repair becomes atomic and tested

10. The repair (`src/services/db/migrations.ts:898-923`) currently runs **outside any transaction**:
    three `DELETE`/`UPDATE` statements, then a separate `INSERT` of the
    `imap_attachment_repair_v1` flag. A failure between them re-deletes on **every subsequent
    launch**. Wrap the deletes **and** the flag write in one transaction.
11. Move the repair into a **numbered migration** so it passes through the `_migrations` ledger
    instead of being a settings-flag special case bolted onto the end of `runMigrations`.
12. `ROLLBACK.catch(() => {})` at `:890` must not swallow a rollback failure silently — a failed
    rollback is a corrupt-state signal.
13. Export the production `splitStatements` and delete the **copy** in `migrations.test.ts:3-40`,
    which today tests a duplicate rather than the shipped function.
14. **Tests (against the real harness):** fresh DB → all migrations applied · second run → **zero**
    applied (idempotent) · simulated failure between the repair's DELETEs and its flag write →
    **nothing deleted and the flag unset** · `splitStatements` tested as the production export.
15. **Gate note:** the migration-pairing gate from `04-gates.md` is recorded **N/A with reason** —
    SQLite, and no down migrations exist anywhere in this project. That is written down, not assumed.

### P10 — the LLM boundary

16. **Delimiter escaping.** `aiService.ts:46` builds
    `` `<email_content>From: ${from}\nDate: ${date}\n\n${body}</email_content>` `` with **no escaping**,
    so an email whose body contains `</email_content>` closes the delimiter and everything after it is
    read as instructions. Strip or neutralise the delimiter tag in every interpolated value —
    `from`, `date`, and `body`.
17. **A single `parseModelOutput<T>(raw, guard)`** replaces the ad-hoc parsing. **`zod` is already
    approved for exactly this** — `LOG.md` 2026-09-01: *"Approved dependency: `zod` … first use is
    P10 (LLM output). Dependency block required in the Batch B brief."* The dependency block is in
    this PR. Scope it to the AI-output parser; do not retrofit zod elsewhere in this batch.
18. **The smart-reply fallback must fail closed.** `generateSmartReplies` (`:116-135`) currently does
    `replies = jsonMatch ? JSON.parse(...) : [result]` and, on a parse throw, splits raw model text by
    newline. So non-JSON model output becomes user-facing reply suggestions. It must produce `[]`.
19. The `replace(/<[^>]*>/g, "")` tag-strip is **not** a sanitizer and must not be relied on as one;
    replies are plain text, length-capped, and shape-checked before they reach the composer.
20. `categorizeThreads`' `validThreadIds` + `VALID_CATEGORIES` allowlist is **sound but untested** —
    add the test rather than rewriting it. Reference implementation for the good pattern:
    `taskExtraction.ts:24-56`.
21. **Tests:** a body containing `</email_content>` plus forged `id:category` lines does **not** change
    any thread's category · smart replies on non-JSON → `[]` · extra-key JSON accepted, wrong-shape
    rejected · length caps enforced. 8 of 10 `aiService.ts` exports are currently never named in a
    test; that must go down.

### Batch-wide

22. `npx tsc --noEmit` clean · `vitest` green in **both** TZ legs · `cargo` untouched (this batch is
    TypeScript only) · CI green on the PR.

---

## Constraints & context

- **Re-verify before building.** Line numbers were checked against `f7e890b` on 2026-09-01, but the
  audit has been **wrong three times** now (`serde_json` "unused"; P1's injection sites undercounted;
  "components 0% tested" — there are 32 component test files). **Spot-check every audit claim against
  the code before building to it.** Its §6 metrics table in particular is unverified.
- **Decisions already made** (do not relitigate): `zod` approved with P10 as its first use ·
  `better-sqlite3` approved (ADR-001) · batch order · agents merge when the gates are green.
- **ADR-000's dissent** names credential-at-rest as the known weak row. P5 is that row.
- **`zod` is the only dependency in play.** Anything else needs a fresh decision.

---

## Threat (Tier 2)

**Surface 1 — credential decryption (`accounts.ts`, `crypto.ts`)**

- *Disclosure (the live bug):* on decrypt failure the app currently **sends AES ciphertext to the mail
  server as the password**. It is an authentication attempt with attacker-irrelevant but
  user-confidential material, over the network, logged server-side as a failed login. Failing closed
  removes the network egress entirely.
- *Spoofing:* `isEncrypted`'s length heuristic means a **plaintext** password shaped like
  `<16 base64 chars>:<something>` is treated as ciphertext, decryption fails, and the fall-through
  then sends it anyway — the two bugs compose.
- *Repudiation:* the user currently sees "wrong password" for what is actually a key problem, so they
  re-enter and re-store credentials against a broken key. Fixing the message stops that loop.
- *DoS:* a corrupt key currently soft-bricks every account with no stated cause. Fail-closed plus a
  re-auth banner makes it self-explaining.
- *Elevation:* none — no privilege boundary is crossed here; the risk is confidentiality and
  availability.

**Surface 2 — `runMigrations` repair (`migrations.ts`)**

- *Tampering / data loss (the live bug):* the deletes and the "already done" flag are **not in one
  transaction**. Any failure between them — a crash, a closed lid, a killed process — leaves the flag
  unset, so the deletes run again on the next launch, and every launch after that. It deletes cached
  attachments and `folder_sync_state`, forcing a full resync each time.
- *Availability:* on a large mailbox a repeating forced resync is effectively a self-inflicted DoS,
  and it is invisible because nothing logs it as abnormal.
- *Repudiation:* the repair is a settings-flag special case outside the `_migrations` ledger, so there
  is no durable record that it ran. Moving it into a numbered migration creates one.
- *Elevation / disclosure:* none.

**Surface 3 — LLM boundary (`aiService.ts`, `askInbox.ts`, `prompts.ts`)**

- *Tampering (the live bug):* email bodies are attacker-controlled and are interpolated into the
  prompt **inside a delimiter the body can close**. A body containing `</email_content>` followed by
  instructions is a prompt-injection primitive that ships today.
- *Elevation via the composer:* smart replies flow into the compose/send path. Unvalidated model text
  reaching a draft the user may send is the highest-consequence step in this app.
- *Disclosure:* Ask Inbox reads across the mailbox; a successful injection could try to get inbox
  content summarised into a reply. The mitigation is shape-checking output and never treating model
  text as instructions — the same rule as the global standard's "treat all LLM output as untrusted".
- *DoS / cost:* uncapped model output length; caps required.
- *Repudiation:* no audit log exists app-wide (`05-security.md` §7 is unmet repo-wide) — a known gap
  this batch neither opens nor closes.

---

## Rollback

- **P5 and P10: `git revert` the merge.** No schema change, no stored-data change, no key rotation.
  Reverting restores the previous behaviour exactly.
- **P6 is a one-way door and cannot be cleanly reverted.** Moving the repair into a numbered migration
  writes a row into `_migrations`. **There are no down migrations anywhere in this project.** A user
  who runs the fixed build and is then downgraded will have a `_migrations` row the old code does not
  know about, and the old code's settings-flag repair will not re-run. The plan states this because
  the audit requires it to; the honest mitigation is *don't downgrade*, and the practical one is that
  the repair is idempotent-by-flag in both directions.
- **Therefore land P6 in its own commit**, so P5 and P10 can be reverted without touching the
  migration ledger. This is the reverse of Batch A's outcome, where interleaved edits made per-item
  revert fictional — here the split is real because the files are disjoint
  (`accounts.ts`/`crypto.ts` vs `migrations.ts` vs `services/ai/*`).
- **Revert target:** `main` @ `f7e890b`, whose CI is green.
- **Known-bad signal after merge:** users reporting sudden "please sign in again" prompts would mean
  `isEncrypted`'s new structural check is rejecting values the old length check accepted. That is the
  risky edge of P5 — mitigate with a test over **real** stored-value shapes, and if it happens,
  revert the P5 commit alone.

---

## Sequencing within the batch

1. **P12 harness** — nothing else can be tested properly without it.
2. **P6** — needs the harness; own commit; the one-way door.
3. **P5** — independent files.
4. **P10** — independent files; carries the `zod` dependency block.

---

## Approval

- Plan approved by: __________ date: ______ ← **required before any code** (Tier 2, no pre-approval).
- Reviewed by: __________ date: ______
