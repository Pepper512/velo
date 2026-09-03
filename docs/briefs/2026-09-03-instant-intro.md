# SPEC-II — Instant Intro: one action that replies all, moves the introducer to Bcc, and opens with thanks

- **Task:** When someone has introduced me to a third party by email, one key (or one
  button on the thread action bar) opens a reply to everyone on that message with the
  introducer moved from To/Cc to Bcc and the body starting "Thanks {first name}, moving you
  to Bcc." — the reply-all etiquette for introductions, done for me.
- **Tier:** **1** — frontend feature on existing data; no schema, no Rust, no dependency, no
  capability, no CSP. Brief in the PR before code; one PR; two review legs (Jim's 2026-09-03
  wave-1 instruction).
- **Base:** `main` @ `d6b1d17` (code pin `3b63d73`, #88). Citations grepped at `d6b1d17`.
- **Status:** approved (brief) — branch `instant-intro`, PR opened with this file before any
  code. Jim, 2026-09-03: *"Continue enhancement wave 1 from docs/ROADMAP.md §4 in order — next
  is Instant Intro (reply-all, introducer → Bcc) … briefs first, Tier 1, one PR per item."*
- **Source:** ROADMAP §4 wave 1, item 3 (P2, 0.5 days); the vault's
  `2026-09-01_Velo_Superhuman-Parity_Enhancements.md` ("Instant Intro (reply-all, introducer →
  Bcc, one key)"; parity table: "Instant Intro | None | missing"); the effort model ("One
  composer action: reply-all, move introducer to Bcc, canned opener"); the vault queue
  `Build Queue/20-Enhancements/_queue-enhancements.md` row 3.
- **Effort:** S · 0.5 day.

## Outcome

Alice writes to me and Bob: "Bob, meet Jim — he's the person I mentioned." I open the thread
and press `b` (or click the handshake on the action bar). The composer opens addressed to Bob,
with Alice in Bcc, the subject "Re: …", and the body already reading "Thanks Alice, moving you
to Bcc." above the quoted message. I write my line to Bob and send. Alice sees that the
introduction landed and is out of the rest of the conversation. If there is nobody to introduce
me to — the message is from Alice to me alone — the action is unavailable and says so.

## What exists, verified at `d6b1d17`

1. **Reply-all is computed in four places, none shared.** `ThreadView.handleReplyAll`
   (`ThreadView.tsx:151-171`): To = `reply_to ?? from_address` plus the message's
   `to_addresses` split on commas; Cc = `cc_addresses` split on commas; then
   `openComposer({ mode: "replyAll", to, cc, subject: "Re: …", bodyHtml: buildQuote(lastMessage),
   threadId, inReplyToMessageId })`. The same logic, with `activeAccount.email` removed, in
   `InlineReply.getRecipients` (`InlineReply.tsx:125-154`); without self-removal in the thread
   context menu (`ContextMenuPortal.tsx:261-283`) and the message context menu
   (`ContextMenuPortal.tsx:642-663`). Header chunks are passed to the composer as they are —
   a chip can read `"Alice Smith" <alice@acme.com>` (the SPEC-AR review found this,
   `autoReminders.ts:29-38 bareAddress`).
2. **The message has what the rule needs.** `DbMessage` (`messages.ts:3-13`): `from_address`,
   `from_name`, `to_addresses`, `cc_addresses`, `reply_to` — comma-joined strings, nullable.
3. **The composer takes Bcc and shows it.** `openComposer` accepts `bcc` and sets `showCcBcc`
   when Cc or Bcc is non-empty (`composerStore.ts:103-116`); `Composer.tsx:577-587` renders the
   Bcc field when `showCcBcc`. Tested: `composerStore.test.ts:63-70, 99`.
4. **"My own addresses" are known.** `activeAccount.email` (`accountStore`) and the send-as
   aliases (`sendAsAliases.ts getAliasesForAccount`); the SPEC-AR rule already takes an
   `ownAddresses` list (`autoReminders.ts isExternalSend`).
5. **The action bar's reply group** (`ActionBar.tsx:208-238`): Reply, Reply All, Forward as
   icon-only `Button`s with `(key)` in the title, disabled with a reason when `noReply`
   (`isNoReplyAddress(reply_to ?? from_address)`, `ThreadView.tsx:378`), then a `Separator`.
   `lucide-react` 0.563.0 ships `Handshake`.
6. **Shortcuts.** `SHORTCUTS` (`shortcuts.ts:12-56`) is the registry the help overlay, the
   Settings rebind page and the dispatcher all read; `action.replyAll` is `a`, and the
   dispatcher sends a window event that `InlineReply` listens for
   (`useKeyboardShortcuts.ts:292-296`, `InlineReply.tsx:107-116`). Single keys are looked up by
   `e.key` (`useKeyboardShortcuts.ts:196`), so a default written as `Shift+I` would never
   match — see *Not doing*. **Free single keys:** `b d h l n q w x y z`; `i` is Ask AI.
7. **Help** has a "Reply, Reply All & Forward" entry with the three shortcuts as tips
   (`helpContent.ts:318-334`); `CLAUDE.md:189` lists `a | Reply all` in the shortcut table.
   `helpContent.test.ts` and `shortcuts.test.ts` (ids unique, keys non-empty) exist;
   `useKeyboardShortcuts.test.ts` tests three event-dispatching keys with the stores mocked.
8. **Quoting.** `buildQuote(msg)` (`ThreadView.tsx:524-531`, module-private) builds the
   "On {date}, {from} wrote:" block; `escapeHtml` from `@/utils/sanitize` for text in HTML.

## Requirements

- **REQ-1** As a user I want one action that turns an introduction into the right reply.
  - REQ-1.1 WHEN the user triggers Instant Intro on a thread THE SYSTEM SHALL open the composer
    in reply-all mode on the thread's last message with: **To** = the message's To recipients,
    **Cc** = the message's Cc recipients, each list minus the account's own addresses and minus
    the introducer, order preserved, duplicates removed by bare lower-cased address;
    **Bcc** = the introducer; **Subject** = `Re: {subject}`; **body** = the opener (REQ-2)
    followed by the quoted message, exactly as Reply All quotes it; `threadId` and
    `inReplyToMessageId` as Reply All sets them.
  - REQ-1.2 The **introducer** is the message's reply target, `reply_to ?? from_address` — the
    same address Reply All puts first in To — carried into Bcc as the header wrote it.
  - REQ-1.3 The action SHALL be **unavailable** (button disabled with a reason; key does
    nothing) WHEN: there is no last message; the sender does not accept replies (the existing
    `noReply` rule); the introducer is one of the account's own addresses (the last message is
    mine — there is nobody to thank); or To and Cc are both empty after REQ-1.1 (nobody to be
    introduced to: the message was to me alone).
- **REQ-2** As a user I want the opener written for me, addressed by name.
  - REQ-2.1 The body SHALL begin `<p>Thanks {name}, moving you to Bcc.</p>` where `{name}` is
    the first word of `from_name` when the message has one, else the local part of the
    introducer's address (before `@`); HTML-escaped.
- **REQ-3** As a user I want it one key away and discoverable.
  - REQ-3.1 A new shortcut `action.instantIntro`, default **`b`** (a free key; mnemonic: Bcc
    the introducer), in the Actions category, rebindable like the others.
  - REQ-3.2 A button in the action bar's reply group after Forward, `Handshake` icon, title
    "Instant Intro (b)" or the unavailability reason; the same disabled styling as Reply.
  - REQ-3.3 The Help entry "Reply, Reply All & Forward" and the `CLAUDE.md` shortcut table
    name the action and its key.
- **REQ-4** Nothing else changes: Reply, Reply All, Forward, the inline reply, the context
  menus, auto-drafts and auto reminders behave as before. (The auto-reminder rule will see the
  intro's recipients like any reply-all's — an external introducee gets the default reminder,
  which is right.)

## Not doing

- **A context-menu entry** (thread and message menus) and **a quick-step action** — the key
  and the button are the item; recorded for a later polish pass.
- **An inline-reply mode** — the intro needs Bcc, which the inline reply has no field for; the
  full composer is the right surface.
- **A configurable opener** — YAGNI; the sentence is the convention. Recorded.
- **`Shift+I` as the default** (Superhuman's ⌘⇧I) — the dispatcher looks single keys up by
  `e.key`, so the string `Shift+I` never matches; and the Settings recorder writes exactly that
  string for a Shift-letter (`SettingsPage.tsx:2070-2078`). **That is a pre-existing gap for any
  Shift-letter rebind**, recorded here for Jim; not this brief's to fix.
- **Consolidating the four reply-all copies** — the intro module is written so the four could
  call it later (`replyAllRecipients` is its first step); replacing them is a separate,
  behaviour-preserving PR (the copies differ on self-removal). Recorded.
- **Quoted display names containing commas** (`"Smith, Alice" <a@x>`) split wrongly today in
  every reply-all path; the intro inherits the same split. Recorded, unchanged.

## Design

- **`src/utils/emailUtils.ts`** gains `bareAddress(raw)` (moved from `autoReminders.ts`, which
  imports it; behaviour unchanged, its cases move to `emailUtils.test.ts`) — the one shared
  helper both rules need.
- **`src/services/composer/instantIntro.ts`** (new, pure):
  - `replyAllRecipients(message, ownAddresses): { to: string[]; cc: string[] }` — the
    reply-all rule of *What exists* 1 with self removed and duplicates removed by bare address,
    original chip text kept.
  - `buildInstantIntro(message, ownAddresses): InstantIntro | null` — `null` for every REQ-1.3
    case; otherwise `{ to, cc, bcc: [introducer], subject, openerHtml, introducerName }`.
    `message` is the `Pick<DbMessage, "from_address" | "from_name" | "to_addresses" |
    "cc_addresses" | "reply_to" | "subject">` the rule reads, so a test builds one in a line.
  - `introducerFirstName(fromName, address)` per REQ-2.1.
- **`ThreadView.tsx`:** `handleInstantIntro` = `buildInstantIntro(lastMessage, ownAddresses)`
  → `openComposer({ mode: "replyAll", to, cc, bcc, subject, bodyHtml: openerHtml +
  buildQuote(lastMessage), threadId: lastMessage.thread_id, inReplyToMessageId: lastMessage.id })`;
  `ownAddresses` = `activeAccount.email` plus its aliases (`getAliasesForAccount`, loaded once
  per account as the composer's From selector does). `introAvailable` (the same call's
  non-null result, memoised on `lastMessage`) feeds the button; a `velo-instant-intro` window
  listener runs the handler, mirroring `InlineReply`'s `velo-inline-reply` listener.
- **`ActionBar.tsx`:** `onInstantIntro?: () => void`, `introUnavailableReason?: string | null`;
  the button per REQ-3.2.
- **`shortcuts.ts`:** `{ id: "action.instantIntro", keys: "b", desc: "Instant Intro (reply
  all, introducer to Bcc)" }`. **`useKeyboardShortcuts.ts`:** the case dispatches
  `velo-instant-intro` when a thread is selected, like `action.replyAll`.
- **Help / docs:** a tip in the "Reply, Reply All & Forward" entry; a `CLAUDE.md` table row.
- **Decision & alternatives** — (a) a pure module the thread view calls, opening the full
  composer (chosen: Bcc needs the composer; the rule is testable without React; the module
  seeds the reply-all consolidation). (b) Extend `InlineReply` with an "intro" mode: no Bcc
  field, and the auto-draft would fire over the opener. (c) A composer-side "move to Bcc"
  button on any reply-all: needs the user to reply-all first and then find the button — two
  steps, not one key. (d) Introducer = `from_address` ignoring `reply_to`: would thank the
  human but Bcc a different address than Reply All would have written to; the reply target is
  the address the introducer asked to be reached at.
- **Data / schema** — none.
- **Failure modes** — `from_address` and `reply_to` both null: unavailable; a To header that
  names only me and the introducer: unavailable (nobody to introduce); the introducer also
  appears in To (common: "To: me, Bob; Cc: —" from Alice, or Alice Cc'ing herself): removed
  from To/Cc, present once in Bcc; a display name with markup (`<b>Alice</b>`): escaped in
  the opener; the same person in To under two chip spellings: one chip, the first.

## Tasks (risk-first)
- [ ] 1. `emailUtils.test.ts` cases for `bareAddress`, move the function, point
  `autoReminders.ts` at it; its suite stays green. — groundwork
- [ ] 2. `instantIntro.test.ts` then `instantIntro.ts`: introducer to Bcc and out of To/Cc;
  self and aliases removed (case-insensitive, display-name chips); `reply_to` preferred; order
  kept and duplicates collapsed; the four unavailable cases; the name from `from_name`, from
  the local part, escaped; the subject. — REQ-1, REQ-2
- [ ] 3. `shortcuts.ts` entry (`shortcuts.test.ts` stays green) and the dispatcher case, with
  a `useKeyboardShortcuts.test.ts` case that `b` dispatches `velo-instant-intro` for a selected
  thread and nothing without one. — REQ-3.1
- [ ] 4. `ThreadView` handler + listener, `ActionBar` button. — REQ-1.1, REQ-3.2
- [ ] 5. Help tip, `CLAUDE.md` row, LOG.md entry; HANDOFF/ROADMAP after merge; the vault queue
  row. — REQ-3.3

## Done when
`npx vitest run` green with the new tests, `tsc`, `graph:check`, `docs:check` green; CI green
on the merge commit. **Manual (Jim, open):** on an introduction thread press `b`: the composer
opens with the introducer in Bcc, the third party in To, "Thanks {name}, moving you to Bcc."
above the quote; on a message from one person to me alone the button is disabled with
"Nobody to introduce you to".

## Rollback
`git revert`; no data, no setting. A rebind of `b` survives in the shortcut store as an
orphaned id, harmless.

## Review
Two legs on the PR: Gemini 3.8 Flash High via `agy`; Grok 4.6 via the `grok` CLI. Diffs from
committed SHAs; findings verified against source before adoption; dispositions on the PR and in
LOG.md.

## Approval
Jim, 2026-09-03, by the wave-1 instruction quoted under *Status*. The brief is this file,
committed before the code.
