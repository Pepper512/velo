### 1. Verdict
**APPROVE**

---

### 2. Findings

- **[N] N-01 — `src/components/email/ThreadView.tsx`**
  The button outside the delta reportedly retains `disabled={noReply || introUnavailableReason !== null}`. Because `instantIntroUnavailableReason` in `src/services/composer/instantIntro.ts` now directly includes `if (isNoReplyAddress(target)) return "This sender does not accept replies";`, any message whose effective target is a no-reply address evaluates `introUnavailableReason !== null` to `true`. Consequently, `noReply` on the button is now strictly redundant with `introUnavailableReason !== null`. This redundancy is harmless (and in fact corrected the blank `reply_to` slip on the button as well), but `noReply` can be deprecated and removed from the button in a subsequent cleanup.

- **[N] N-02 — `src/components/email/ThreadView.tsx`**
  In `handleInstantIntro`, `composerOptionsForIntro(..., aliases ?? [])` uses nullish coalescing to satisfy TypeScript typing (`SendAsAlias[] | null`). We rely on the invariant that outside the delta, `introUnavailableReason` (or `ownAddresses`) treats `aliases === null` as unavailable (per the comment: *"`aliases` is `null` (not known) on first render and on the render right after an account switch — the intro never runs on a half-known or another account's address list"*). If `introUnavailableReason` were ever `null` while `aliases` is `null`, `handleInstantIntro` would execute with `[]`, momentarily violating SPEC-II.

---

### 3. Verified-Correct List

1. **Elimination of Account-Switch Render Tear (Hole 1 Closed):**
   - In `src/components/email/ThreadView.tsx`, storing `{ accountId: string; list: SendAsAlias[] }` and deriving `const aliases = aliasState && aliasState.accountId === activeAccountId ? aliasState.list : null;` synchronously in the render body guarantees that on the exact render where `activeAccountId` changes, `aliases` immediately evaluates to `null`.
   - The previous account's aliases are never rendered alongside the new account's email; no asynchronous `useEffect` reset latency exists.

2. **Correct Derivation Across All Lifecycles:**
   - **First Render:** `aliasState` initializes to `null`, so `aliases` derives to `null` before fetch completion.
   - **Switch:** When switching from account A to B, `aliasState.accountId === 'A' !== 'B'`, so `aliases` immediately derives to `null` during the in-flight fetch for B.
   - **Late Resolution from Prior Account:** When an earlier fetch for account A settles after switching to B, `cancelled` is set to `true` by the cleanup function, dropping the update. Furthermore, even if the closure executed, `aliasState.accountId === activeAccountId` would evaluate `'A' === 'B'` (`false`), keeping `aliases` at `null` (or B's list).
   - **Error Handling:** If `getAliasesForAccount` rejects, it catches and sets `{ accountId: activeAccountId, list: [] }`, correctly resolving `aliases` to `[]`.

3. **Closure of the Blank `reply_to` Hole & Gate Equivalence (Hole 2 Closed):**
   - In `src/services/composer/instantIntro.ts`, `instantIntroUnavailableReason` checks `isNoReplyAddress(target)` where `target = replyTarget(message)`.
   - As verified by `instantIntro.test.ts`, `replyTarget` strips whitespace and falls through to `from_address` when `reply_to: "  "`.
   - In `handleInstantIntro`, gating on `if (!lastMessage || !instantIntro || introUnavailableReason !== null) return;` ensures that whenever the sender is no-reply, `introUnavailableReason` returns `"This sender does not accept replies"` and the handler immediately aborts.
   - Because `introUnavailableReason !== null` is `true` whenever `isNoReplyAddress(target)` is `true`, the handler's gate is strictly equivalent to the button's `disabled={noReply || introUnavailableReason !== null}`.
   - The defensive guards `!lastMessage || !instantIntro` safely narrow parameters for `composerOptionsForIntro(lastMessage, instantIntro, ...)` without deviating from button availability.

4. **Hook Dependency Arrays & Stale Closure Prevention:**
   - `useEffect` for alias fetching lists `[activeAccountId]`, properly re-triggering when the account changes and cancelling in-flight requests.
   - `handleInstantIntro` lists `[lastMessage, instantIntro, introUnavailableReason, aliases, openComposer]`, correctly capturing `introUnavailableReason` and `aliases`.

5. **Explicit External Dependencies:**
   - We depend on the event listener `useEffect` outside the delta (`window.addEventListener("velo-instant-intro", handleInstantIntro)`) including `handleInstantIntro` in its dependency array and returning a cleanup function (`window.removeEventListener`) to avoid stale handler closures.
   - We depend on `introUnavailableReason` (or `ownAddresses`) outside the delta evaluating to non-null / unavailable whenever `aliases === null`, preventing premature execution with empty aliases.
   - We depend on the button's `disabled` prop outside the delta matching `disabled={noReply || introUnavailableReason !== null}`.
