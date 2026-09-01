# SPEC-F-1 — Snoozed threads must stay out of the Inbox until they are due

- **Task:** Stop background sync from putting snoozed threads back into the Inbox, so snooze behaves as a holding area ("Snoozed" folder) until the chosen time.
- **Tier:** **1** (checked). Touches the sync label-write path for every account — blast radius is every synced thread — but the change is a pure filter with no schema change and no server write in Phase A, so it is fully reversible by revert. Phase B (Gmail server write) stays Tier 1: it reuses an existing, already-shipped call pattern.
- **Base:** `main` @ `d2d8aa7`.
- **Status:** reviewed by Kimi K3 (APPROVE WITH CHANGES) — all three required changes adopted below (marked **[R1]–[R3]**) — **approved by Jim 2026-09-01** — ready to build.
- **Source:** fork-found by Jim 2026-09-01 (ledger **F-1**, P1). Not in upstream's tracker.
- **Effort:** S–M · Phase A 1.0 day · Phase B +1.0 day.

## Outcome
When a thread is snoozed it leaves the Inbox, appears in the **Snoozed** folder, and stays there through any number of syncs. At the due time it returns to the Inbox. On Gmail accounts the snooze is also reflected server-side so the thread does not reappear on other devices.

## Requirements

- **REQ-1** As a user I want a snoozed thread to stay out of my Inbox until it is due, so that snooze actually clears my attention.
  - REQ-1.1 WHEN a thread has `is_snoozed = 1` and `snooze_until > now` and a sync writes that thread's labels THE SYSTEM SHALL keep `SNOOZED` and omit `INBOX` in the stored label set, regardless of what the server reports.
  - REQ-1.2 WHEN a thread's `snooze_until <= now` THE SYSTEM SHALL restore `INBOX` and clear `is_snoozed` (existing behaviour, `snoozeManager.ts:10-40`), and subsequent syncs SHALL store labels normally.
  - REQ-1.3 **[R1]** WHEN a sync stores a message for a snoozed thread whose id is **not already in the local `messages` table** and whose sender is **not the account's own address or one of its send-as aliases** THE SYSTEM SHALL un-snooze the thread and return it to the Inbox (a reply from someone else is a reason to look; the user's own reply from another device is not).
  - REQ-1.4 **[R3]** WHEN a snooze expires THE SYSTEM SHALL remove the `SNOOZED` label row in the same transaction that restores `INBOX`, so the thread is never in both folders.
- **REQ-2** As a user I want the Snoozed folder to list every snoozed thread, so that I can see what is on hold.
  - REQ-2.1 **[R2]** WHEN the user opens the Snoozed folder THE SYSTEM SHALL list all threads bearing the `SNOOZED` label for the active account(s) (the folder is label-driven, `EmailList.tsx:43`), ordered by `snooze_until` ascending, soonest first — a **new ordering branch**, since today's queries order by `is_pinned, last_message_at` (`threads.ts:37,47,69,82`).
- **REQ-3** (Phase B, Gmail only) As a Gmail user I want the snooze reflected on the server, so the thread does not sit in my Inbox on other devices.
  - REQ-3.1 WHEN a Gmail thread is snoozed THE SYSTEM SHALL remove the server `INBOX` label via the existing provider call; WHEN it is un-snoozed THE SYSTEM SHALL add it back.
  - REQ-3.2 WHEN the app is offline THE SYSTEM SHALL queue the server change through `pending_operations` exactly as archive does, and the local state SHALL be correct regardless.
  - REQ-3.3 **[R3]** WHILE a snooze/unsnooze op is pending for a thread, delta sync skips that thread's metadata (`gmail/sync.ts:357`, existing conflict guard); the local checker (`checkSnoozedThreads`) does not depend on sync, so expiry still returns the thread to the Inbox on time. The pending op drains as idempotent add/remove-label. Documented; no code change.
- **NFR-1** No additional round-trip per thread on the sync hot path beyond one indexed SELECT (index `idx_threads_snoozed` already exists, `migrations.ts:55`).
- **NFR-2** Behaviour identical for Gmail API and IMAP accounts in Phase A.

## Not doing
- **IMAP server-side snooze.** IMAP has no label; the only server representation would be moving the message to a `Snoozed` folder and back, which changes UIDs and interacts with `folder_sync_state`. Own spec if ever wanted.
- **Changing what snooze means for muted or pinned threads.** Untouched.
- **A "hold area" for scheduled sends.** Scheduled sends are outbound (`scheduled_emails`), already have their own status, and are not in the Inbox; Jim's report was about snooze.
- **Fixing the transaction-pool bug (#240).** This spec's writes go through the same `withTransaction`; it neither fixes nor worsens that.

## Design

**Current behaviour.** `snoozeThread` (`services/snooze/snoozeManager.ts:46-68`) sets `is_snoozed=1, snooze_until`, deletes the local `INBOX` row and inserts `SNOOZED` in `thread_labels`. Nothing goes to the server. Sync then calls `setThreadLabels` (`services/db/threads.ts:122-139`), which `DELETE`s every label row for the thread and re-inserts the server's set — INBOX returns and SNOOZED is lost. Call sites: `gmail/sync.ts:69, 90, 376`; `imap/imapSync.ts:290, 761`; `email/imapSmtpProvider.ts:460, 476`. Nothing outside `snoozeManager` reads `is_snoozed`.

**Precedent to copy.** Muted threads have the identical problem and sync already solves it: `gmail/sync.ts:370-380` collects `mutedThreadIds` before the pass, and for any that reappear with INBOX it calls `client.modifyThread(threadId, undefined, ["INBOX"])` then rewrites labels without INBOX. Snooze should follow that shape exactly.

**Change — Phase A (local, both providers).**
1. Add `applySnoozeOverride(accountId, threadId, labelIds, now): Promise<string[]>` in `services/db/threads.ts`: one `SELECT is_snoozed, snooze_until FROM threads WHERE …`; if snoozed-and-not-due, return `labelIds − {INBOX} ∪ {SNOOZED}`; else return `labelIds` unchanged.
2. Call it **inside `setThreadLabels`** before the delete/insert. Every writer is covered by construction, including the two `imapSmtpProvider` sent-path calls, and no call site changes.
3. New-message rule (REQ-1.3) **[R1]**: the first draft compared against `last_message_at`, but `upsertThread` runs *before* `setThreadLabels` (`gmail/sync.ts:57-69`) and overwrites it — Kimi caught that the value is gone by the time the override runs, and there is no stored snooze-creation time. Corrected mechanism, **no schema change**: before `upsertThread`, in `processAndStoreThread` (Gmail) and the IMAP thread-store path, compute `incomingIds − existingIds` with one `SELECT id FROM messages WHERE id IN (…)`; if the thread is snoozed and any genuinely-new message has `from_address` ∉ {account email} ∪ `send_as_aliases`, clear the snooze (`UPDATE threads SET is_snoozed=0, snooze_until=NULL`) and delete the `SNOOZED` row, so the override does not apply on this pass.
4. Expiry (REQ-1.4) **[R3]**: `checkSnoozedThreads` gains `DELETE FROM thread_labels … label_id='SNOOZED'` next to its existing `INSERT … 'INBOX'` (`snoozeManager.ts:22-35`).
5. Snoozed folder ordering (REQ-2.1) **[R2]**: `getThreadsForAccount` gets an explicit branch when `labelId === 'SNOOZED'`: `ORDER BY t.snooze_until ASC`.
6. **Behaviour change, stated:** sending a reply to a snoozed thread from Velo (`imapSmtpProvider.ts:460` adds `SENT` to existing labels) leaves the thread snoozed. Intended — the user chose to hold it. Not un-snoozed by REQ-1.3 because it is the account's own address.
7. **Muted ∧ snoozed:** the muted path (`gmail/sync.ts:370-380`) already strips INBOX server-side; the override is then a no-op. Compatible; no coordination needed.

**Change — Phase B (Gmail server write).**
8. In `snoozeThread` / `checkSnoozedThreads`, for accounts whose provider is `gmail_api`, route through `emailActions` so the label change is optimistic locally and queued via `pending_operations` when offline — the same path `archiveThread` uses. The provider interface already exposes `removeLabel`/`addLabel` (`email/types.ts:76-77`).

**Decision & alternatives.**
- *Chosen:* override inside `setThreadLabels` (single seam, all writers). *Cost:* one extra indexed SELECT per thread per sync.
- *Alt A:* filter at each of the seven call sites, passing a precomputed `snoozedIds` set (zero extra queries). Rejected for Phase A: seven edits, easy to miss the next writer; can be adopted later as a perf optimisation by adding an optional `snoozedIds` parameter.
- *Alt B:* make the Inbox query exclude `is_snoozed=1` and stop touching labels. Rejected: the Snoozed folder is label-driven (`EmailList.tsx:43`), unread counts are label-driven, and the server-side Phase B still needs the label removed.
- *Alt C:* Phase B only (server write), no local guard. Rejected: leaves IMAP broken and leaves a 60 s window on Gmail.

**Data / schema.** None. Index already exists.

**Failure modes.** If the override misfires (e.g. clock skew makes `snooze_until` look future), the thread stays in Snoozed until the checker's next pass; nothing is lost — the thread is always reachable from the Snoozed folder. If Phase B's server write fails, local state is still correct and the op retries via the queue.

## Tasks (risk-first)
- [ ] 1. Harness test that reproduces the bug: snooze a thread, call `setThreadLabels` with `["INBOX"]`, assert INBOX is back and SNOOZED gone (red). — REQ-1.1
- [ ] 2. Implement `applySnoozeOverride` and call it in `setThreadLabels`; test goes green; add the not-due / due / not-snoozed cases. — REQ-1.1, REQ-1.2
- [ ] 3. Sync-level test: run the Gmail `processAndStoreThread` and IMAP thread-store paths against the harness with a snoozed thread; assert label set. — REQ-1.1, NFR-2
- [ ] 4. New-message un-snooze rule with tests: genuinely-new message from a third party → INBOX restored and SNOOZED removed; the user's own reply (account email, then a send-as alias) → stays snoozed; a message already in `messages` → stays snoozed. — REQ-1.3
- [ ] 5. Expiry: checker deletes the SNOOZED row; test asserts the thread is in exactly one of Inbox/Snoozed after expiry. — REQ-1.4
- [ ] 5b. Expiry race test: `snooze_until` passes, a sync lands **before** the checker runs → thread returns to Inbox on that sync (override sees "due"), and the checker's later pass is a no-op. — REQ-1.2
- [ ] 5c. Snoozed-folder ordering branch (`ORDER BY snooze_until ASC`) with test; multi-account scoping test for the override SELECT (`account_id` in the WHERE). — REQ-2.1, NFR-1
- [ ] 6. **Phase B:** route Gmail snooze/unsnooze through `emailActions` with `removeLabel`/`addLabel`, offline-queued; tests for online and queued paths. — REQ-3.1, REQ-3.2
- [ ] 7. Help text: `helpContent.ts` snooze card already says "removes a thread from your inbox" — confirm it is now true; add the reply-un-snoozes sentence. — docs

## Done when
- Manual: snooze a thread for 2 minutes on an IMAP account and on a Gmail account; trigger sync twice; thread is absent from Inbox and present in Snoozed both times; at 2 minutes it returns.
- Tests 1–4 (and 6 if Phase B lands) pass in CI on the merge commit; `npm run test`, `tsc --noEmit`, lint green.
- Gmail web UI shows the thread archived while snoozed (Phase B).

## Rollback
Revert the PR. No schema change; local `thread_labels` are rewritten from the server on the next sync, which restores pre-fix behaviour exactly. Phase B: any queued label ops drain harmlessly (idempotent add/remove).

## Review

**Kimi K3, 2026-09-01 — verdict: APPROVE WITH CHANGES.** Independent read from the spec plus verbatim excerpts. Claim check: all `file:line` claims confirmed except two it could not see (`imapSync.ts:761`, the index at `migrations.ts:55`) — both re-verified by Claude in the repo. Raw review: [[2026-09-01_Velo_Spec-Review_Kimi-K3]].

| # | Finding | Disposition |
|---|---|---|
| R1 | REQ-1.3 compared against `last_message_at`, but `upsertThread` overwrites it before the override runs, and no snooze-creation time is stored — "not implementable as described". Also: the user's own reply from another device would un-snooze. | **Adopted.** Mechanism replaced with a pre-upsert "genuinely new message id" check plus a self/alias carve-out. No schema change. |
| R2 | REQ-2.1 said "threads with `is_snoozed=1`" but the folder is label-driven; ordering by `snooze_until` was a SHALL with only a "verify" task. | **Adopted.** Requirement reworded to the `SNOOZED` label; ordering is now a concrete design step and task (`ORDER BY snooze_until ASC` branch). |
| R3 | `checkSnoozedThreads` inserts INBOX but never deletes the SNOOZED row → thread in both folders until next sync. Phase B's pending op freezes the thread in delta sync (`sync.ts:357`). | **Adopted.** New REQ-1.4 + task 5; freeze documented as REQ-3.3 — verified the checker is independent of sync, so expiry is unaffected. |
| — | Sending a reply to a snoozed thread leaves it snoozed — a behaviour change presented as coverage. | **Adopted** as an explicit design note (§6). |
| — | Muted ∧ snoozed interaction. | **Adopted** as a design note (§7); no code. |
| — | Missing tests: expiry race, SNOOZED linger, self-reply, multi-account scoping. | **Adopted** as tasks 4, 5, 5b, 5c. |
| — | "Muted precedent" is a server-write pattern, analogy weaker than presented. | **Accepted** — kept as the Phase B precedent only. |

## Approval
**Approved by Jim, 2026-09-01** (Claude Code session, after Kimi K3 review and adoption of all required changes). Tier 1: build on a branch from `main`, copy this spec to `velo/docs/briefs/2026-09-01-f1-snooze-survives-sync.md`, PR with plan visible, CI green on the merge commit, then merge and move this file to `99-Landed/` with the SHA.

## Build notes (2026-09-01, built in worktree on `fix/f1-snooze-survives-sync`)

- **Delivered, both phases.** Phase A: `applySnoozeOverride` inside `setThreadLabels` (REQ-1.1), expiry race handled (REQ-1.2), `checkSnoozedThreads` now drops the SNOOZED row (REQ-1.4), `services/snooze/snoozeSync.ts` implements the new-external-message rule with the self/alias carve-out and is called before `upsertThread` in Gmail `processAndStoreThread` and both IMAP thread-store paths (REQ-1.3), Snoozed folder orders by `snooze_until` (REQ-2.1). Phase B: `snoozeThread` / expiry push `removeLabel` / `addLabel` INBOX to the provider for `gmail_api` accounts, queued through `pending_operations` when offline or on failure (REQ-3.1, 3.2) — done via `providerFactory` + `enqueuePendingOperation` directly rather than `emailActions`, to avoid a services→stores import cycle (`graph:check` green).
- **Tests:** 22 new across 5 files, TDD (each watched red first). Three are real-SQLite harness tests driving the production functions (`threads.snooze.test.ts`, `snoozeSync.test.ts`, `snoozeManager.test.ts`); two are wiring tests inside the existing Gmail/IMAP sync suites asserting the snooze rule runs *before* `upsertThread`. Harness note: `upsertThread`/`upsertMessage` reuse `$n` placeholders in their ON CONFLICT clauses, which the harness rejects by design, so those tests seed rows with raw SQL (allowed for setup).
- **Gates run locally:** `tsc --noEmit`, `vitest` (152 files / 1,806 tests), `npm run build`, `graph:check`, `docs:check` — green. CI on the PR is the source of record.
- **Not done:** task 3's "run `processAndStoreThread` against the harness" — replaced by the wiring tests above plus the harness tests on the units; the sync functions' network surface makes a full harness run heavier than it proves. IMAP server-side snooze remains out of scope (Not doing).
- **Rollback:** revert the PR. No schema change; labels are rewritten from the server on the next sync.
