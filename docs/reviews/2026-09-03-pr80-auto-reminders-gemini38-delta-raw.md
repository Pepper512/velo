thought

**CHANGES REQUESTED**

### Findings

#### [H1] Missing `threadId` guard when scheduling auto-reminder on failed local save
- **Lines (`src/components/composer/Composer.tsx:349-365`):**
  ```typescript
            if (!sent?.id) {
              console.warn(
                "[autoReminders] No sent message id (send failed or was queued); no reminder set",
              );
            } else {
              try {
                await scheduleAutoReminder(
                  { getFollowUpForThread, insertFollowUpReminder },
                  {
                    accountId: activeAccountId,
                    threadId: sent.threadId ?? state.threadId,
                    messageId: sent.id,
  ```
- **Defect:** As demonstrated by the new IMAP test, when a fresh send succeeds over the wire but local DB save fails, `sent.id` exists (`imap-sent-...`) while `sent.threadId` and `state.threadId` are both `undefined`. Because `!sent?.id` only checks `id`, execution enters the `else` branch and invokes `scheduleAutoReminder` with `threadId: undefined`, causing runtime / query failure.
- **Change:** Check both `id` and thread availability before scheduling:
  ```typescript
  const threadId = sent?.threadId ?? state.threadId;
  if (!sent?.id || !threadId) {
    console.warn("[autoReminders] No sent message id or thread id; no reminder set");
  } else {
    // schedule with threadId
  ```

#### [H2] `bareAddress` fails on multi-recipient chips, unmatched brackets, and empty `<>`
- **Lines (`src/services/followup/autoReminders.ts:33-36`):**
  ```typescript
  function bareAddress(raw: string): string {
    const angle = raw.match(/<([^>]*)>/);
    return (angle ? angle[1]! : raw).trim().toLowerCase();
  }
  ```
- **Defect:** 
  1. *Multi-recipient chip:* `raw.match` is not `/g` and matches only the first `<...>`. If a chip contains multiple addresses (e.g. `"Alice <alice@acme.com>, Bob <bob@example.com>"`), all recipients after the first are dropped.
  2. *Unmatched closing bracket:* `"alice@acme.com>"` returns `"alice@acme.com>"`. Its domain becomes `"acme.com>"`, which compares unequal to `fromDomain` (`"acme.com"`), falsely marking an internal send as external.
  3. *Unmatched open bracket:* `"Alice <alice@acme.com"` falls back to the full string, failing `own.has()`.
  4. *Empty `<>`:* returns `""`. If `input.from` has `<>`, `fromDomain` becomes `null`, causing `domain !== null` to evaluate to `true` for all valid recipients.
- **Change:** Parse/split comma-separated recipients, validate email format, and strip unmatched `<` and `>`:
  ```typescript
  function bareAddress(raw: string): string {
    const match = raw.match(/<([^<>\s@]+@[^<>\s@]+)>/);
    if (match) return match[1]!.trim().toLowerCase();
    return raw.replace(/[<>]/g, "").trim().toLowerCase();
  }
  ```

#### [M1] `vi.mocked(upsertMessage).mockReset()` wipes mock implementation and leaks on assertion failure
- **Lines (`src/services/email/imapSmtpProvider.test.ts:760-762`):**
  ```typescript
        // clearAllMocks keeps implementations; drop the rejection for the tests after this one.
        vi.mocked(upsertMessage).mockReset();
        spy.mockRestore();
  ```
- **Defect:** `mockReset()` does not revert to the default mock implementation; it replaces `upsertMessage` with a stub returning `undefined` synchronously, breaking subsequent tests (e.g. `createDraft`) expecting an async/resolved result. In addition, inline cleanup without `try...finally` or `afterEach` leaves the rejection in place if an assertion fails.
- **Change:** Reset the mock to its default resolved value, and perform cleanup in `afterEach`:
  ```typescript
  afterEach(() => {
    vi.mocked(upsertMessage).mockResolvedValue(/* default message or void */);
  });
  ```

#### [M2] Missing guard for `fromDomain === null` in `isExternalSend`
- **Lines (`src/services/followup/autoReminders.ts:54-61`):**
  ```typescript
    const fromDomain = domainOf(bareAddress(input.from));
    const own = new Set(input.ownAddresses.map(bareAddress));
    return input.recipients.some((r) => {
      const addr = bareAddress(r);
      if (own.has(addr)) return false;
      const domain = domainOf(addr);
      if (domain === null) return false;
      return domain !== fromDomain;
    });
  ```
- **Defect:** If `input.from` is invalid or lacks a domain, `fromDomain` is `null`. The condition `domain !== fromDomain` evaluates to `true` for any recipient with a valid domain, incorrectly treating internal sends as external.
- **Change:** Return `false` immediately if `fromDomain === null`:
  ```typescript
  const fromDomain = domainOf(bareAddress(input.from));
  if (fromDomain === null) return false;
  ```

#### [L1] Warn branch triggers on normal send failures
- **Lines (`src/components/composer/Composer.tsx:346-352`):**
  ```typescript
            const sent = sendResult.success
              ? (sendResult.data as { id?: string; threadId?: string } | undefined)
              : undefined;
            if (!sent?.id) {
              console.warn(
                "[autoReminders] No sent message id (send failed or was queued); no reminder set",
              );
  ```
- **Defect:** Nothing that used to run is skipped, but if `sendResult.success` is `false` (an outright send failure), emitting an auto-reminder warning about missing IDs pollutes logs.
- **Change:** Keep the auto-reminder logic gated on `if (sendResult.success && autoReminderWanted)`.

#### [N1] DST test in `autoReminders.test.ts` does not exercise reordered weekend-roll logic
- **Lines (`src/services/followup/autoReminders.test.ts:121-126`):**
  Friday 30 Oct + 3 days lands directly on Monday 2 Nov (`day === 1`). The weekend-roll branches (`day === 6` and `day === 0`) never run, so this test does not actually verify the interaction between `due.setHours` reordering and weekend roll across DST.
- **Change:** Use a send date that lands on the transition weekend (e.g. Thursday 29 Oct + 3 days = Sunday 1 Nov rolling to Monday 2 Nov).

---

### Test Asserting the Wrong Thing

- `autoReminders.test.ts:27` asserts `false` for an alias using the sender's own domain (`"Me Too <Alias@Acme.com>"` with sender `"me@acme.com"`), which passes solely via the same-domain check (`domain === fromDomain`) rather than verifying that an alias from `ownAddresses` on an external domain is exempt.
