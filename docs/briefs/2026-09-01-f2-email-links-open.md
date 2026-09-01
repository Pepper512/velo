> Brief copied from the vault Build Queue (`Pepper Knowledge/10 Projects/Velo/Build Queue/00-Now/SPEC-F-2_Email-Links-Open.md`) at approval, per the Approval section. The vault copy is the record of what was asked; this copy travels with the code.

# SPEC-F-2 — Links in emails must open in the system browser

- **Task:** Make every URL in an email — plain-text or HTML — clickable and open in the default browser, and make any failure to do so visible instead of silently swallowed.
- **Tier:** **1** (checked). Touches the email renderer (untrusted HTML boundary) and the outbound-URL path. No schema change, no capability change in Phase A. If Phase B needs a capability edit it becomes Tier 2 per `CLAUDE.md` ("`src-tauri/capabilities/*`"). **Risk stated plainly [R3]:** Phase A makes every URL in every plain-text email one-click actionable while the phishing interstitial (`LinkConfirmDialog`) is unwired — a real widening of the one-click phishing surface, on exactly the IMAP/system-notification mail most affected. Accepted for this PR because today those URLs are copy-pasted into a browser with no interstitial either; **F-3 (wire `LinkConfirmDialog`) is sequenced immediately after this spec**, not "someday".
- **Base:** `main` @ `d2d8aa7`.
- **Status:** reviewed by Kimi K3 (APPROVE WITH CHANGES) — all three required changes adopted below (marked **[R1]–[R3]**) — **approved by Jim 2026-09-01** — ready to build. Phase B is gated on a reproduction.
- **Source:** fork-found by Jim 2026-09-01 (ledger **F-2**, P1), observed on the upstream v0.4.21 DMG.
- **Effort:** S · Phase A 1.0 day (linkify + error surfacing) · Phase B 0.5 day repro + S fix.

## Outcome
Clicking a link in any email opens it in the user's browser. If the OS refuses, the user sees a toast saying so with the URL, and the failure is in the log. URLs in plain-text emails are clickable, which they are not today.

## Requirements

- **REQ-1** As a reader I want URLs in plain-text emails to be clickable, so that I don't have to copy-paste them.
  - REQ-1.1 WHEN a message has no HTML body and its text contains an `http://`, `https://` or `mailto:` URL THE SYSTEM SHALL render that URL as an anchor whose `href` is the URL and whose visible text is the URL, with all other text HTML-escaped exactly as today.
  - REQ-1.2 WHEN the linkifier encounters text that is not a URL (including `javascript:`, `data:`, bare domains without scheme) THE SYSTEM SHALL leave it as escaped text.
  - REQ-1.3 Trailing punctuation (`.`, `,`, `)`, `>`) SHALL not be included in the URL.
- **REQ-2** As a reader I want clicking a link in an HTML or plain-text email to open my default browser.
  - REQ-2.1 WHEN an anchor inside the email iframe is clicked THE SYSTEM SHALL prevent in-app navigation and call the Tauri opener with the anchor's resolved `href` (existing behaviour, `EmailRenderer.tsx:183-194`).
  - REQ-2.2 WHEN the opener call rejects THE SYSTEM SHALL show a toast "Couldn't open link — <host>" with a **Copy link** action and log the error with the URL's host (not the full URL, which may carry tokens).
  - REQ-2.3 **[R2]** WHEN the clicked `href` uses `http:`, `https:`, `mailto:` or `tel:` THE SYSTEM SHALL pass it to the opener (these four are exactly what `opener:default` permits — `tauri-plugin-opener 2.5.5` `permissions/default.toml`). WHEN it uses any other scheme the sanitizer lets through (`ftp:`, `sms:`, `callto:`, `xmpp:`, `cid:` — DOMPurify's default URI allow-list is wider than the opener's) THE SYSTEM SHALL not call the opener and SHALL show the toast with "This kind of link (<scheme>) can't be opened from Velo".
  - REQ-2.4 **[R1]** WHEN the clicked anchor has no `href`, or its `href` is a pure fragment (`#…`) or resolves to the iframe's own document (`about:blank`, `about:srcdoc`, the app origin) THE SYSTEM SHALL do nothing — no opener call, no toast — preserving today's silent no-op for newsletter tables of contents and `<a name>` anchors.
- **REQ-3** As the maintainer I want the failure that Jim saw to be diagnosable from the app, so that Phase B can be a fix and not a guess.
  - REQ-3.1 WHEN link opening fails THE SYSTEM SHALL emit an `error()` through `@tauri-apps/plugin-log` (Rust side registered at `lib.rs:168` — corrected from the draft's `:152`, which is the opener plugin) so it lands in `~/Library/Logs/com.velomail.app/`, containing the scheme and host only.
- **NFR-1** Linkification is deterministic (regex), runs on the escaped text only, and never produces markup from user text other than the anchor itself.
- **NFR-2** No new dependency (a hand-written matcher; `linkify-it` and friends are not needed for three schemes; no toast library either).

## Not doing
- **Wiring `LinkConfirmDialog`.** The phishing link-confirmation dialog (`components/email/LinkConfirmDialog.tsx`, fed by `services/phishing/phishingScanner.scanMessageLinks`) is mounted nowhere — the help page advertises a feature that does not run. It is the natural place to intercept clicks, but it is a security feature with its own acceptance criteria and belongs in its own spec (`10-Bug-Fixes/` candidate: **F-3**). This spec must not make wiring it harder: the click handler is factored so a confirm step can be inserted before `openUrl`.
- **Widening the opener scope.** `opener:default` already covers http/https/mailto/tel. If Phase B shows the scope is the problem, that is a capability edit → Tier 2, separate approval.
- **Linkifying inside HTML bodies.** HTML mail carries its own anchors; touching text nodes inside sanitized HTML is a different risk class.

## Design

**Current behaviour.**
- HTML mail: `sanitizeHtml` (DOMPurify, `utils/sanitize.ts`) keeps `href`; the iframe is `sandbox="allow-same-origin"` so in-frame navigation is blocked; a click listener on the iframe document calls `openUrl(anchor.href)` and swallows rejection into `console.error` (`EmailRenderer.tsx:183-194`). Opener permissions are granted for `main`, `splashscreen`, `thread-*`, `compose-*` (`capabilities/default.json:5-9, 28-29`); `tauri-plugin-opener 2.5.5` / JS `^2.5.3`.
- Plain-text mail: `EmailRenderer.tsx:92-96` renders `<pre>${escapeHtml(text)}</pre>`. **No linkification exists anywhere in `src/`** (grep for linkify/autolink/URL regex = 0). URLs are inert text. This alone explains the symptom for every text/plain message — common on IMAP accounts and system notifications.

**Change — Phase A.**
1. `utils/linkify.ts`: `linkifyEscapedText(escaped: string): string`. Input is already HTML-escaped; the matcher recognises `https?://` and `mailto:` runs of non-whitespace, trims trailing `.,;:!?)]>'"` and a trailing `&quot;`, and wraps each match in `<a href="…">…</a>` where the href is the matched escaped text (safe: it contains no `<`, `>` or raw `"`). Everything else passes through untouched. Pure function, unit-tested.
2. `EmailRenderer.tsx:96`: `escapeHtml(text)` → `linkifyEscapedText(escapeHtml(text))`.
3. Extract the click handler into `openEmailLink(href: string, frameOrigin: string): Promise<"opened"|"ignored"|"unsupported"|"failed">` in `services/links/openLink.ts`. Order of checks **[R1][R2]**: (i) no href, pure fragment, or same-document (`about:` scheme or `url.origin === frameOrigin`) → `"ignored"`, nothing happens; (ii) scheme ∈ {http, https, mailto, tel} → `openUrl`; (iii) any other scheme → `"unsupported"` + toast; (iv) `openUrl` rejects → `"failed"` + `error()` log (scheme + host) + toast with **Copy link**. `new URL()` is used to read scheme/origin, not as a validation gate — the DOM has already resolved `anchor.href`, so it will not throw on real anchors. Handler in `EmailRenderer` becomes three lines.
3b. **Toast: there is no generic toast store today** — only `UpdateToast.tsx` and `UndoSendToast.tsx` as one-off components (Kimi could not verify my draft's "existing infrastructure" claim; on checking, it was overstated). Add a minimal `notice` slice to `uiStore` (`{ id, text, action?: {label, onClick} }`, auto-dismiss 6 s) and one `NoticeToast` component rendered in `App.tsx` and `ThreadWindow.tsx`, built on the same `CSSTransition` pattern `UpdateToast` uses. Small, reusable by F-3 and by #280's error surfacing. No dependency.

**Change — Phase B (after reproduction).** Run the fork's dev build with devtools, click a failing link, read the rejection. Expected causes in order: (a) release build's ad-hoc signature causing `open` to fail under Gatekeeper quarantine — fix is #278 (signing), not code; (b) tracked-redirect anchors whose `href` DOMPurify dropped (e.g. `ALLOW_UNKNOWN_PROTOCOLS: false` on an odd scheme) — fix is REQ-2.3's toast plus, if warranted, an allow-list entry; (c) pop-out `thread-*` window difference — fix is a capability edit (Tier 2). The toast from Phase A is what turns "nothing happens" into a named cause.

**Decision & alternatives.**
- *Chosen:* hand-written linkifier on escaped text. *Alt:* `linkify-it`/`autolinker` — rejected, dependency for a 30-line function; *Alt:* linkify before escaping — rejected, would have to escape inside the regex output and is the classic XSS mistake.
- *Chosen:* toast + log on failure. *Alt:* fall back to `window.open` — rejected; the iframe is sandboxed and `window.open` inside Tauri opens nothing useful.

**Failure modes.** A wrong regex can only produce an anchor whose href is escaped text that was already on screen; it cannot introduce markup. If `openUrl` keeps failing, the user now gets the URL on the clipboard instead of nothing.

## Tasks (risk-first)
- [ ] 1. Unit tests for `linkifyEscapedText`: http/https/mailto; **uppercase `HTTP://`**; trailing punctuation; `javascript:` and `data:` untouched; `&amp;` inside a URL preserved; text with `<` `>` already escaped stays escaped; a URL wrapped in `&quot;…&quot;`. — REQ-1.1, REQ-1.2, REQ-1.3, NFR-1
- [ ] 2. Implement `utils/linkify.ts`; wire into `EmailRenderer` plain-text path; component test renders an anchor for a text body. — REQ-1.1
- [ ] 3. `services/links/openLink.ts` with the four-way outcome; unit tests: `openUrl` mocked to reject → `"failed"` + log + toast; `tel:` → opener called; `ftp:`/`sms:` → `"unsupported"` toast, opener **not** called; `#top`, `about:blank#x`, same-origin, and `<a name>` (no href) → `"ignored"`, no toast. — REQ-2.2, REQ-2.3, REQ-2.4, REQ-3.1
- [ ] 3b. `uiStore` notice slice + `NoticeToast`, mounted in `App.tsx` and `ThreadWindow.tsx`; test that a notice renders and auto-dismisses. — REQ-2.2
- [ ] 4. Replace the inline handler in `EmailRenderer` with `openEmailLink`; keep the `preventDefault`. **Component test for the HTML path:** render an HTML body with an anchor into the iframe, click it, assert `openEmailLink` is called with the resolved href (Kimi: task 4 had no paired test). — REQ-2.1
- [ ] 5. Manual repro on the dev build (main window + pop-out) with devtools; record the rejection text in this spec under Phase B; open the follow-up if it is signing (#278) or capabilities (Tier 2). — REQ-3
- [ ] 6. Ledger: add **F-3** "LinkConfirmDialog unwired" to `10-Bug-Fixes/`. — housekeeping

## Done when
- A plain-text email containing `https://example.com/a?b=1&c=2.` renders one anchor with href `https://example.com/a?b=1&c=2` and the trailing `.` outside it.
- Clicking any link in an HTML email and in a plain-text email opens the browser on macOS, Windows, Linux (manual, dev build).
- Forcing `openUrl` to reject shows the toast and writes one log line.
- Clicking a newsletter's "back to top" (`#top`) anchor does nothing — no toast, no navigation.
- CI green on the merge commit.

## Rollback
Revert the PR. No persisted state involved.

## Review

**Kimi K3, 2026-09-01 — verdict: APPROVE WITH CHANGES.** Claim check: every code claim confirmed except three it could not see (`lib.rs` log plugin, toast infrastructure, opener scope); on re-checking, **two of those three were wrong or overstated in the draft** and are corrected above. Raw review: [[2026-09-01_Velo_Spec-Review_Kimi-K3]].

| # | Finding | Disposition |
|---|---|---|
| R1 | In-page anchors (`#section`) and `<a name>` resolve to `about:blank#…`/app origin inside the sandboxed iframe; the draft's REQ-2.3 would turn today's silent no-op into a toast on every table-of-contents click — "the spec's biggest functional hole". | **Adopted.** New REQ-2.4; `openEmailLink` gains an `"ignored"` outcome checked first; tests added. |
| R2 | DOMPurify's default URI allow-list (tel, callto, sms, cid, xmpp, ftp) is wider than the draft's http/https/mailto, so "unsupported" would fire on real mail; behaviour should be specified, not incidental. | **Adopted.** `tel:` added to the opener set (it is in `opener:default`); the rest get a named, specific toast. |
| R3 | Phase A widens the one-click phishing surface while `LinkConfirmDialog` is dead code; the Tier section should say so and F-3 be sequenced. | **Adopted.** Risk stated in the Tier line; F-3 is queued directly after this spec in `10-Bug-Fixes/`. |
| — | `lib.rs:152` is the opener plugin, not the log plugin. | **Corrected** to `lib.rs:168`. |
| — | "Existing toast infrastructure" could not be verified. | **Corrected** — there is none generic; a minimal notice slice is now in scope (design §3b, task 3b). |
| — | `compose-*` also in the capability windows array. | **Corrected** in Design. |
| — | `new URL()` is not a validation gate for resolved hrefs. | **Adopted** — wording fixed in §3. |
| — | Missing tests: fragment, no-href, uppercase scheme, HTML-path handler. | **Adopted** in tasks 1, 3, 4. |

## Approval
**Approved by Jim, 2026-09-01** (Claude Code session, after Kimi K3 review and adoption of all required changes). Tier 1: build on a branch from `main`, copy this spec to `velo/docs/briefs/2026-09-01-f2-email-links-open.md`, PR with plan visible, CI green on the merge commit, then merge and move this file to `99-Landed/` with the SHA.

## Build notes (2026-09-01, Phase A built in worktree `fix/f2-email-links-open`)

- **Delivered:** REQ-1.1–1.3 (`src/utils/linkify.ts`), REQ-2.1–2.4 (`src/services/links/openLink.ts`, `EmailRenderer.tsx` handler), the notice slice + `NoticeToast` (design §3b) mounted in `App.tsx` and `ThreadWindow.tsx`. 27 new tests across 5 files (TDD: each watched red before green). Gates run locally: `tsc --noEmit`, `vitest` (149 files / 1,784 tests), `npm run build`, `graph:check`, `docs:check` — all green. CI on the PR is the source of record.
- **Deviation — REQ-3.1 (file log) not delivered.** Writing to `~/Library/Logs/com.velomail.app/` from the frontend needs the JS package `@tauri-apps/plugin-log` (not installed; only the Rust plugin is) **and** a `log:default` grant in `src-tauri/capabilities/default.json`. That is a dependency (ask first) plus a Tier-2 capability edit — both outside this Tier-1 PR. `openEmailLink` takes an injectable `log` sink (default `console.error`, scheme + host only), so wiring the file logger later is a one-line change. **Owner: Jim** — approve the dependency + capability, or accept the toast as the diagnostic.
- **Phase B (reproduce Jim's failing click) not done.** Needs a dev build with devtools while the release app is closed (single-instance plugin). Task 5 stays open; the toast from Phase A is what will name the cause.
- **Rollback:** revert the PR. No persisted state.
