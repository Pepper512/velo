# Brief — `move_messages` / `delete_messages`: wrong-path fallback and folder-global EXPUNGE

- **Task:** Stop `move_messages` from falling back to COPY on failures that are not "server lacks MOVE", and stop both `move_messages` and `delete_messages` from issuing an untargeted `EXPUNGE` that permanently deletes mail the operation was never asked to touch.
- **Tier:** **2** — not a judgment call. `CLAUDE.md:55-57` names **Rust IMAP/SMTP/OAuth** as Tier 2 outright ("plan + threat pass + rollback approved before code"), and this is the app's only irreversible data path. Threat pass and rollback are below; **this brief is the plan, and its approval on the docs PR is the Tier-2 plan approval.**
- **Base:** `main` @ `afeaa9f` (F-1 snooze, #22). Every line number below was re-verified at that commit; #22 touched none of the files cited here.
- **Date / owner:** 2026-09-01 · agent-authored.
- **Status:** **Awaiting plan approval — no code written.** Decision 1 **answered by Jim (a), with four conditions**, folded in below as REQ-2.2 and REQ-4. Independent second read by Kimi K3 (2026-09-01) raised the EXPUNGE defect, now the highest-severity item here; all crate-level claims re-verified against the pinned source before adoption (see *Verification*).
- **Source:** the `_`-arm half was found during the E2/P15 brief review (HANDOFF §2c, item **(B)**). The EXPUNGE half came from the Kimi review of that finding; `delete_messages` was then found to carry the same defect independently.
- **Effort:** M — roughly 1.5 days including tests and the live-server transcript. No dependency.

---

## Outcome

A move that fails permanently reports that failure instead of silently copying. A move or delete only ever removes the messages it was given, never other messages that happen to be flagged `\Deleted` in the same folder. On a server that cannot target an expunge, the app says so out loud instead of reporting success. All three hold with and without the `MOVE` and `UIDPLUS` extensions.

---

## Requirements

**REQ-1 — The MOVE outcome is classified, not collapsed.**
`move_messages` (`src-tauri/src/imap/client.rs:485`) currently matches `Ok(Ok(()))` for success and `_` for everything else (`:496-498`). Three distinct outcomes are collapsed into one fallback:

- REQ-1.1 WHEN the server does not advertise `MOVE` THE SYSTEM SHALL skip `uid_mv` entirely and use the COPY path directly. Capability is checked, not inferred from an error.
- REQ-1.2 WHEN `uid_mv` returns `Err(Error::Bad(_))` — the server advertised `MOVE` and rejected the command as malformed or unknown — THE SYSTEM SHALL fall back to the COPY path, and SHALL log that it did so with the server's message.
- REQ-1.3 WHEN `uid_mv` returns `Err(Error::No(_))` — MOVE was understood and refused (over quota, `TRYCREATE`, ACL denied) — THE SYSTEM SHALL propagate that error unchanged and SHALL NOT fall back. COPY cannot fix a refusal, and on a quota boundary COPY may succeed where MOVE was refused, leaving the message in both folders.
- REQ-1.4 WHEN the `with_timeout` wrapper fires (the outer `Err`) THE SYSTEM SHALL abort the operation and SHALL NOT issue any command on that session. It SHALL return an error that names the outcome as **unknown** — the server may have completed the MOVE after the client stopped waiting — and the caller SHALL NOT retry it blindly.
- REQ-1.5 WHEN `uid_mv` returns any other `Err` (`Io`, `ConnectionLost`, `Parse`, `Validate`) THE SYSTEM SHALL propagate it and SHALL NOT fall back.

**REQ-2 — No operation expunges messages it was not given.**

- REQ-2.1 WHEN the COPY fallback in `move_messages` (`:516`) or `delete_messages` (`:551`) needs to remove messages AND the server advertises `UIDPLUS` THE SYSTEM SHALL issue `UID EXPUNGE <uid_set>` against the same UID set it flagged, never a bare `EXPUNGE`.
- REQ-2.2 WHEN the server does not advertise `UIDPLUS` THE SYSTEM SHALL leave the `\Deleted` flags set, SHALL NOT expunge, and SHALL report `expunged: false` (Decision 1(a)).
- REQ-2.3 **WHEN a `UID EXPUNGE` fails for any reason THE SYSTEM SHALL NOT fall back to a bare `EXPUNGE`.** It reports the failure and leaves the flags set. There is no path in this codebase, after this change, by which an untargeted `EXPUNGE` is sent. *(Jim's condition 4.)*
- REQ-2.4 The UID set expunged SHALL be the same set the operation was called with. No operation widens its own scope.

**REQ-3 — Partial failure is reported as partial, not as failure.**

- REQ-3.1 WHEN COPY succeeds and the subsequent `STORE +Deleted` or expunge fails THE SYSTEM SHALL return an error that states the messages were **copied but not removed from the source**, distinct from "nothing happened".
- REQ-3.2 That distinction SHALL be legible to the caller, so a retry can complete the removal rather than re-running the COPY and duplicating the message. (Consuming it in a retry policy is out of scope — see *Not doing*.)

**REQ-4 — A degraded delete says so, out loud.** *(Jim's conditions 1–3.)*

- REQ-4.1 `imap_delete_messages` and `imap_move_messages` SHALL return a result carrying `expunged: bool` rather than `()`. `expunged: false` means the messages were flagged but not removed from the server.
- REQ-4.2 WHEN a permanent delete or draft delete returns `expunged: false` THE SYSTEM SHALL surface the notice **"Marked for deletion — the server will remove it later"** and SHALL NOT report the operation as a completed deletion.
- REQ-4.3 WHEN a move's COPY path returns `expunged: false` — the message is now in the destination but still flagged in the source — THE SYSTEM SHALL surface the same class of notice naming the source folder.
- REQ-4.4 The missing `UIDPLUS` capability SHALL be logged **once per account**, not once per operation, at `warn`, naming the account and host.
- REQ-4.5 "Permanently" SHALL degrade to "eventually" only where REQ-4.2/4.3 fire. No silent success.

**NFR-1** Capabilities are read once per session and reused, not re-queried per operation.
**NFR-2** The classification logic is a pure function over the crate's error type, unit-tested without a live server, matching the existing test style (`client.rs:1910`, `wire.rs`).
**NFR-3** No new dependency. Everything required is in the pinned `async-imap 0.10.4`, and the notice surface already exists (see *Design*).

---

## Decision 1 — non-UIDPLUS servers ✅ **DECIDED: (a), Jim, 2026-09-01**

`UID EXPUNGE` is RFC 4315 and requires the `UIDPLUS` capability. Without it there is no way to expunge a specific UID set. The options were:

| Option | Consequence |
|---|---|
| **(a) — CHOSEN.** Leave `\Deleted` set, do not expunge, report `expunged: false`. | Permanent delete becomes deferred on such servers. Nothing is destroyed that the user did not name. |
| (b) STORE `-Deleted` on every *other* message, `EXPUNGE`, then STORE `+Deleted` back — the crate's documented workaround. | Rewrites flags on messages the operation was never given; an interruption mid-sequence clears other clients' `\Deleted` flags. Worse blast radius than the bug. |
| (c) Keep the bare `EXPUNGE` on non-UIDPLUS servers only. | Preserves today's defect. The crate's own doc: *"risking the unintended removal of some messages."* |

**Jim's rationale (2026-09-01):** UIDPLUS is mandatory in IMAP4rev2 and present on every mainstream server, so the trade is small; and failing toward "do less" is the right direction on an irreversible path. **Conditions attached, all binding:** report `expunged: false` (REQ-4.1); the UI says "marked for deletion — the server will remove it later" rather than reporting success (REQ-4.2); log the capability miss once per account (REQ-4.4); and the classifier never falls back from a failed `UID EXPUNGE` to a bare `EXPUNGE` (REQ-2.3). *"'Permanently' may degrade to 'eventually' only when the app says so out loud."*

**How common is this?** Unmeasured. UIDPLUS is near-universal on Dovecot, Gmail, Fastmail and Exchange; the servers likely to lack it are the same non-standard hosts that already drive the `AsyncImapEmpty` raw-fetch fallback. **ASSUMPTION:** rare but non-zero. Nobody has counted, and this brief does not claim otherwise.

---

## Not doing

- **Retry policy in the TS layer.** REQ-3 makes partial failure *expressible*. Teaching the caller to act on it — completing the delete instead of re-copying — is a separate change whose design overlaps the idempotency-aware retry already written into the E2/P15 brief. Doing it here would fork that design.
- **Changing the `EmailProvider` interface.** `archive`, `trash`, `permanentDelete`, `moveToFolder` and `deleteDraft` all return `Promise<void>` (`src/services/email/types.ts:52-92`) and are implemented by `gmailProvider` too. REQ-4's notice is raised inside `imapSmtpProvider` via `useUIStore.getState().addNotice(...)` — the established pattern (`services/links/openLink.ts:48`, `emailActions.ts`, `queueProcessor.ts`) — so the shared interface and the Gmail path are untouched.
- **Session pooling (E2/P15).** This fix must land independently and must not assume a pool. It does make the pooled world safer, and the E2 brief should be updated to state the rule pooled sessions need: mailbox state (selected folder, flags) is shared and volatile across sessions, so a cap of 2 sessions per account means two sessions can hold the same folder selected. That is a one-paragraph edit to the E2 brief, not code here.
- **Reading `COPYUID` from the COPY response.** The natural-looking way to confirm what the server actually copied. **Not available:** `uid_copy` in async-imap 0.10.4 (`client.rs:856-868`) calls `run_command_and_check_ok` and discards the response, so the `COPYUID` response code never reaches the caller. It is also not needed — the expunge in REQ-2 targets *source* UIDs, which we already hold. Noted because it is the obvious next idea and it is a dead end without a raw-command rewrite.
- **The other `.collect()` sites that discard per-message errors.** `uid_store` streams are collected into `Vec<_>` and dropped throughout this file (`:474`, `:509`, `:545`). Real, and a separate cleanup — folding it in here would blur what this change is being reviewed for.

---

## Design

### Current behaviour — verified at `afeaa9f`

`move_messages` (`client.rs:485-525`), reached from `imap_move_messages` (`commands.rs:136`, call at `:154`):

```rust
match net::with_timeout(IMAP_CMD_TIMEOUT, "UID COPY", session.uid_mv(uid_set, dest_folder)).await {
    Ok(Ok(())) => return Ok(()),
    _ => {
        // COPY, then STORE +Deleted, then EXPUNGE
```

Two defects, and the second is worse:

**(1) The `_` arm.** `IMAP_CMD_TIMEOUT` is 30 s (`client.rs:52`). A `UID MOVE` that the server *executed* but whose response did not arrive in 30 s lands in `_` and is COPY'd again — the message now exists twice in the destination. The same arm also swallows `NO` refusals and connection errors. A third consequence: the timeout drops `uid_mv`'s future mid-protocol, leaving unread bytes in the TLS buffer, and the fallback then issues `uid_copy` **on that same `&mut session`** — so the COPY reads the tail of the aborted MOVE as its own response. (The `with_timeout` label on this call is also wrong: it says `"UID COPY"` for a `uid_mv`, which is why the logs do not show what actually failed.)

**(2) `session.expunge()` is folder-global — the higher-severity defect.** Both `:516` and `:551` call bare `expunge()`, which permanently removes **every** message in the selected folder carrying `\Deleted`, not only the UIDs this operation flagged. That includes flags set by other clients, by another session of this same client, and leftovers from a previous partial failure of this very function. The crate's own doc for the bare-expunge fallback says it risks *"the unintended removal of some messages."*

`delete_messages` (`client.rs:530-560`, from `imap_delete_messages` at `commands.rs:160`/`:177`) has defect (2) on its own, with no MOVE involved. It is reached by `deleteDraft` (`imapSmtpProvider.ts:550`) — so discarding one draft expunges everything flagged `\Deleted` in the Drafts folder.

**Blast radius.** These two functions sit under every destructive mail action in the app: `archive` (`imapSmtpProvider.ts:279`), `trash` (`:294`), permanent delete (`:306`), move-to-folder (`:349`), spam/not-spam (`:363`) and `deleteDraft` (`:550`), via `tauriCommands.ts:208`/`:219`.

**Velo has never read server capabilities.** `grep -rn "capabilities()\|CAPABILITY\|uid_expunge" src-tauri/src/` returns nothing. Both fixes need capability data, so this change introduces the first use of it.

### Change

1. **`imap/caps.rs` (new, small).** Fetch `Capabilities` once after login (`Session::capabilities`, crate `client.rs:637`) and carry `{ has_move, has_uidplus }` alongside the session. Read with `has_str("MOVE")` / `has_str("UIDPLUS")` (crate `types/capabilities.rs:63`). One query per session, per NFR-1. The `has_uidplus == false` case logs once per account (REQ-4.4), keyed on the account so a 60-second sync loop cannot spam the log.

2. **A pure classifier, `MoveOutcome`.** Maps the `with_timeout` result to an explicit decision, and is where the tests live:

   | Input | Outcome |
   |---|---|
   | `Ok(Ok(()))` | `Moved` |
   | `Ok(Err(Error::Bad(m)))` | `FallBackToCopy(m)` — REQ-1.2 |
   | `Ok(Err(Error::No(m)))` | `Refused(m)` — propagate, REQ-1.3 |
   | `Ok(Err(other))` | `Failed(other)` — propagate, REQ-1.5 |
   | `Err(_)` (timeout) | `OutcomeUnknown` — abort, do not touch the session, REQ-1.4 |

   `Error::Bad` and `Error::No` are distinct variants in the pinned crate (`error.rs:20`, `:23`), so this classification is available and does not need string matching.

3. **`move_messages`:** if `!has_move`, go straight to the COPY path (REQ-1.1). Otherwise call `uid_mv` — with a correct `"UID MOVE"` timeout label — and act on `MoveOutcome`. Only `Moved` and `FallBackToCopy` continue; the rest return.

4. **The COPY path becomes a shared helper** used by both `move_messages` and `delete_messages`, so the expunge rule exists in exactly one place: `STORE +Deleted` on `uid_set`, then `UID EXPUNGE uid_set` if `has_uidplus` (crate `client.rs:683`), else stop and report `expunged: false`. A failed `UID EXPUNGE` returns an error and never degrades to `expunge()` (REQ-2.3). On failure after a successful COPY it returns the REQ-3.1 "copied, not removed" error.

5. **`delete_messages`** uses that same helper. Its `EXPUNGE` at `:551` is narrowed by the same rule.

6. **Result shape (REQ-4.1).** Both commands return a serialized `{ expunged: bool }` instead of `()`. `tauriCommands.ts:208`/`:219` change from `invoke<void>` to the result type; `imapSmtpProvider` raises the REQ-4.2/4.3 notice when `expunged === false`. **The notice surface already exists** — F-2 landed the `notices` slice and `addNotice` in `uiStore` (`src/stores/uiStore.ts:80-81`, `Notice` at `:20-24`) with `NoticeToast` mounted in `App.tsx` and `ThreadWindow.tsx`. No new UI infrastructure, no new dependency.

### Decisions & alternatives

- *Chosen:* check `MOVE` capability up front. *Alt:* keep inferring from `BAD` — rejected; it is the guess that produced this bug, and it cannot distinguish "unknown command" from "malformed command", which is our own bug and should be loud.
- *Chosen:* `UID EXPUNGE` gated on `UIDPLUS`, degrade to flag-only. *Alt:* the crate's STORE-`-Deleted`-around-EXPUNGE dance — rejected as Decision 1(b); it writes flags on messages the operation was never given.
- *Chosen:* abort on timeout, report outcome unknown. *Alt:* retry the MOVE — rejected; `UID MOVE` is not idempotent from the client's side and this is precisely the duplication being fixed. A local-first client reconciles on the next delta sync, which is the honest recovery.
- *Chosen:* notice raised inside `imapSmtpProvider`. *Alt:* widen the `EmailProvider` interface — rejected; it would drag `gmailProvider` into a change that has no meaning for the Gmail API.

### Failure modes

Every change fails toward doing *less*. A wrong capability read means the COPY path runs on a server that supports MOVE (slower; previously the only path anyway) or `\Deleted` flags are left set with a notice shown. A wrong classification surfaces an error that today is silently swallowed. The residual user-visible regression is Decision 1(a) making permanent delete deferred on non-UIDPLUS servers — accepted by Jim, bounded by REQ-4's requirement that the app say so.

---

## Threat

Per `CLAUDE.md:55-57`, Tier 2 requires this pass before code. The change adds no network surface, no command argument, and no credential handling; the one genuinely new trust dependency is the server's `CAPABILITY` response.

- **Spoofing.** No new identity surface. Capability data arrives on the already-authenticated session and is trusted exactly as much as any other response from that server.
- **Tampering — the one line that matters.** A hostile or broken server now influences a *destructive* decision through `CAPABILITY`. Both directions fail safe by construction: claiming **no** `UIDPLUS` makes the app delete **less** (flags only, plus a user-visible notice); falsely claiming `UIDPLUS` makes `UID EXPUNGE` fail, and REQ-2.3 forbids degrading that into a bare `EXPUNGE`, so the result is an error, not a wide delete. There is no capability answer that causes the app to remove more than it was asked to. The UID set is still validated by `wire::validate_uid_set` before it reaches the wire.
- **Repudiation.** The `UIDPLUS` miss is logged once per account with account and host (REQ-4.4); a `BAD`-triggered COPY fallback is logged with the server's message (REQ-1.2). Both were previously silent, so this is strictly more auditable than today.
- **Disclosure.** No credential, token or message content is read, written or logged by this change. `ImapConfig` handling is untouched.
- **DoS.** `CAPABILITY` is fetched once per session, not per operation (NFR-1), so no added per-message round trip. The removed bare `EXPUNGE` reduces server work.
- **Elevation.** No authz decision exists on this path and none is added; no change to `src-tauri/capabilities/*` or the CSP, so nothing here is reachable from a pop-out window that was not reachable before.

**Residual risk accepted:** on a non-UIDPLUS server, messages the user asked to delete remain on the server until something else expunges them. Accepted by Jim under Decision 1, bounded by REQ-4.2's notice. If it needs to outlive this release it belongs in `docs/decisions/EXCEPTIONS.md` with a review date.

## Rollback

Revert the PR. There is no schema change, no migration, and no persisted state introduced — the change is confined to two functions, one new capability read, a result field, and a toast call.

**Why a plain revert is sufficient here.** The only state the change leaves behind is `\Deleted` flags set on messages that were not expunged (Decision 1(a)). Those flags are ordinary IMAP state that the pre-change code already produced and already expunges: after a revert, the next `move`/`delete` on that folder runs the old bare `EXPUNGE` and clears them. So the rollback path is not merely "redeploy the previous version" — the residual state is forward- and backward-compatible with both versions, which is exactly the condition that makes a revert honest. Reverting does, of course, restore the over-wide `EXPUNGE`; a revert is therefore a decision to re-accept the original defect, not a no-op, and should say so in the revert message.

---

## Done when

1. `grep -n "\.expunge()" src-tauri/src/imap/client.rs` returns **no** call reachable from `move_messages` or `delete_messages` — currently 2 (`:516`, `:551`). REQ-2.3 means the count should be **zero**.
2. `move_messages` contains no `_ =>` arm over the `uid_mv` result; every variant of `async_imap::error::Error` is named.
3. A `NO` from `uid_mv` propagates: the caller receives the server's message and **no** `UID COPY` is sent. Unit-tested on the classifier.
4. A `with_timeout` failure on `uid_mv` issues **no** further command on that session. Unit-tested on the classifier; asserted by inspection in the function.
5. **Live transcript, attached to the PR** *(Jim's verification condition)*: against a throwaway Dovecot-in-Docker account with `UIDPLUS` enabled — another client flags `\Deleted` on message **X**; Velo permanently deletes message **Y**; **X survives**. Transcript shows the IMAP commands issued.
6. **Live transcript, attached to the PR**: the same scenario for a draft delete, and the same scenario on a Dovecot instance with `UIDPLUS` disabled — Velo reports `expunged: false`, shows "Marked for deletion — the server will remove it later", **X survives, Y survives**, and the capability miss appears in the log exactly once.
7. A COPY that succeeds followed by a failed STORE/expunge returns an error distinguishable from total failure (REQ-3.1).
8. `cargo test --locked` and `cargo clippy --all-targets --locked -- -D warnings` pass; frontend suite passes with the `.claude` excludes, at or above the count `docs/development.md` records (152 files at `afeaa9f`, plus whatever this adds).
9. `npm run docs:check` and `npm run graph:check` pass.

---

## Test plan

**Automated.** The `MoveOutcome` classifier is a pure function over `async_imap::error::Error`; every row of the table above becomes a unit test, including the two that matter most (`No` → no fallback, timeout → no session use). Capability gating is likewise pure over a `has_str` result, including the REQ-2.3 case: a failed `UID EXPUNGE` must not produce a bare `EXPUNGE`. On the TS side, `imapSmtpProvider` tests assert that `expunged: false` raises the notice and that `expunged: true` raises none. This follows the existing pattern (`client.rs:1910`, `wire.rs`) — the tree's Rust tests are pure-function tests, because there is no IMAP mock.

**Live, by transcript.** `EXPUNGE` cannot be driven from the tree, and Jim has accepted that rather than requiring a harness be built. Done-when 5 and 6 are therefore run by hand against a disposable Dovecot container (both `UIDPLUS`-enabled and `UIDPLUS`-disabled), with the session transcript attached to the PR as the evidence. **This is the only proof the expunge fix works**; without those transcripts the change is verified by reading only and must not merge.

---

## Constraints & context

- Pinned crate is `async-imap 0.10.4` (`src-tauri/Cargo.toml:46`, `Cargo.lock:170-173`). Every API relied on was checked in that source, not from memory: `capabilities()` `client.rs:637` · `expunge()` `:651` · `uid_expunge()` `:683` · `uid_copy()` `:856` (returns `Result<()>`, discards `COPYUID`) · `Error::Bad`/`Error::No` `error.rs:20`/`:23`.
- **No dependency is added.** Per `CLAUDE.md`, none was added without asking, and none is proposed. The notice surface is reused from F-2 (`4eac24a`).
- HANDOFF §6 warns that both the 2026-09-01 audit and rev 1 of the E2 brief carried unverified numbers. Every line number and API claim here was re-checked at `afeaa9f` before it was written down. The E2 brief's own line numbers were verified at `d704ea0` and should be re-grepped separately.
- Related: E2/P15's eviction-on-error rule addresses the same desync class REQ-1.4 avoids. Neither change depends on the other.
- **Landing order** for the three changes that touch `src-tauri/src/imap/client.rs` (Jim, 2026-09-01): **(1)** this brief's fix · **(2)** E2/P15 session pooling · **(3)** the `async-imap` 0.11 bump from the dependency audit (vault: `Pepper Knowledge/10 Projects/Velo/2026-09-01_Velo_Dependency-Audit.md`). Each rebases on the one before it.
- **After the 0.11 bump, `caps.rs` gets a fast path — but does not go away.** The audit notes that 0.11.3 adds `login_with_capabilities()`, which it describes as removing `caps.rs`'s extra round-trip. **Verified in the 0.11.3 source, and the claim is slightly stronger than the API:** the function returns `(Session, Option<Capabilities>)` (`client.rs:197-201`) and its own doc says capabilities come back *"if the response contained `CAPABILITY` response code"*. Servers that do not volunteer `CAPABILITY` on the LOGIN response still need the explicit call. So the bump turns the round-trip from unconditional into conditional; `caps.rs` keeps its `capabilities()` fallback. `capabilities()` (`:674`) and `uid_expunge()` (`:720`) both still exist in 0.11.3, so nothing in this design breaks across the bump.

---

## Verification

Claims sourced from the Kimi K3 second read were checked against the pinned crate and the tree before adoption. Two were corrected in the process: `COPYUID` is **not** reachable through `uid_copy` in 0.10.4 (and is not needed), and the `delete_messages` instance of the EXPUNGE defect was not in Kimi's material — it was found by grepping the other call site afterwards. Full second-read text: `scratchpad/kimi-d4/KIMI-ANSWER.md` (session-local, not committed).

## Approval

- **Decision 1:** ✅ **(a) — approved by Jim, 2026-09-01**, with the four conditions folded in as REQ-2.3 and REQ-4.
- **Tier-2 plan approved by:** **Jim, 2026-09-01, PR #23 comment** — Decision 1 = (a); REQ-2.3 and REQ-4.1–4.5 binding as written. REQ-1 (the classifier) may start. The expunge slice does not merge without the Done-when 5/6 Dovecot transcripts attached to its PR.
