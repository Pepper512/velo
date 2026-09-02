# SPEC-F-3 — Wire the phishing interstitial and banner (audit P19)

- **Task:** Make the phishing detection that already exists reach the user: a click on a
  link the detector rates medium or high risk shows `LinkConfirmDialog` before anything
  opens, and a message whose scan says so shows `PhishingBanner`. Both components exist
  and are mounted nowhere.
- **Tier:** **1** — `components/email/`, `services/links/`, `services/phishing/` and
  `utils/phishingDetector.ts` (a pure detector). No Rust, no CSP, no capability, no
  dependency. It sits on the email-HTML trust boundary but only adds a gate in front of
  the existing opener seam. One independent review leg.
- **Base:** `main` @ `c03082a` (code pin `66a9355`). Every citation grepped at that pin.
- **Status:** building — branch `f3-link-confirm`.
- **Source:** audit P19 ("phishing UI appears wired out", 2026-09-01), the F-2 brief's
  risk R3 (Phase A made every plain-text URL one-click while the interstitial was dead
  code; F-3 was sequenced "immediately after"), vault bug-fix row 14, and **Jim's decision
  5 of 2026-09-02: wire it.**
- **Effort:** S · 1 day (the ROADMAP's estimate).

## Outcome

Clicking a risky link in a message opens a dialog naming the destination and the rules it
tripped, with "Go Back" as the default and "Open Anyway" as the escape; safe links open as
before with no extra click. A message with risky links shows the warning banner above its
body with a "Trust sender" action that allowlists the sender. Sensitivity and the sender
allowlist in Settings govern both. The help page and `SECURITY.md` say what is true.

## What exists, verified in the fork

1. **The detector runs nowhere on the click path.** `EmailRenderer.tsx:188-195`: every
   anchor click calls `openEmailLink(href, origin)` (`services/links/openLink.ts`, SPEC-F-2)
   directly. `LinkConfirmDialog` (`components/email/LinkConfirmDialog.tsx`) is imported by
   no file; `PhishingBanner.tsx` likewise; `scanMessageLinks`
   (`services/phishing/phishingScanner.ts`) has no caller (`grep -rn` = 0 outside the file).
2. **The pieces are complete.** `utils/phishingDetector.ts`: `analyzeLink(url, displayText)
   → LinkAnalysis` (pure, ten rules, `riskLevel` safe/low/medium/high at 20/40/60),
   `scanMessage(messageId, html, sensitivity) → MessageScanResult` with `showBanner` from
   `SENSITIVITY_THRESHOLDS` (low 60/5, default 40/3, high 20/1). `scanMessageLinks` adds the
   `phishing_detection_enabled` setting, the sender allowlist (`db/phishingAllowlist.ts`),
   the `phishing_sensitivity` setting and the `link_scan_results` cache. The dialog takes
   `{ linkAnalysis, onCancel, onConfirm }`; the banner `{ scanResult, onTrustSender }`.
   `MessageItem.tsx:137-146` renders `EmailRenderer` with `accountId`, `messageId`,
   `senderAddress`, `html`.
3. **The docs over-promise.** `helpContent.ts:998` says *every* click shows a confirmation
   with the URL; `SECURITY.md:43-47` says the feature is not surfaced. Both change.
4. **Tests:** `EmailRenderer.links.test.tsx` and `MessageItem.test.tsx` exist; the detector
   has `phishingDetector.test.ts`; the scanner has none.

## Requirements

- **REQ-1** As a reader I want a risky link to stop and show me where it goes.
  - REQ-1.1 WHEN a clicked anchor's `analyzeLink(href, text)` risk level is `medium` or
    `high` — with the score threshold taken from the sensitivity setting (low: 60, default:
    40, high: 20) — THE SYSTEM SHALL show `LinkConfirmDialog` and SHALL NOT call the opener.
  - REQ-1.2 WHEN the user presses "Open Anyway" THE SYSTEM SHALL open the link through
    `openEmailLink` (unchanged seam); "Go Back" or dismissing SHALL open nothing.
  - REQ-1.3 WHEN the risk level is `safe`/`low`, or detection is disabled, or the sender is
    allowlisted, THE SYSTEM SHALL open the link exactly as today (no dialog).
  - REQ-1.4 In-page anchors, no-href anchors and same-document links SHALL keep their
    silent no-op (F-2 REQ-2.4) — the gate runs only for a link the seam would open.
  - REQ-1.5 WHEN reading a setting or the allowlist fails THE SYSTEM SHALL fail **closed**:
    treat detection as enabled and the sender as not allowlisted.
- **REQ-2** As a reader I want the warning banner the help page promises.
  - REQ-2.1 WHEN `scanMessageLinks` for the message returns `showBanner: true` THE SYSTEM
    SHALL render `PhishingBanner` above the body.
  - REQ-2.2 "Trust sender" SHALL add the sender to the phishing allowlist and hide the banner
    for this and future messages from that sender.
- **REQ-3** Docs tell the truth: the help card says the dialog appears for links the
  detector flags (not every link); `SECURITY.md` drops the "not surfaced" caveat and names
  the two surfaces.

## Not doing

- A confirmation on *every* link (the help card's old promise) — the component is a risk
  interstitial with "Open Anyway"; a preview on every click is a different product choice.
- Changing the detector's rules or thresholds.
- The seven other P19 orphans (`ConfirmDialog`, `HelpTooltip`, `useContextMenu`,
  `imageResize`, `localDrafts`, `google/calendar.ts`) — separate housekeeping.
- Scanning attachments or `mailto:`/`tel:` links (the detector is about web URLs).

## Design

- **Change**
  - `utils/phishingDetector.ts`: export `linkNeedsConfirmation(analysis, sensitivity):
    boolean` = `analysis.riskScore >= SENSITIVITY_THRESHOLDS[sensitivity].scoreThreshold`
    (the same table the banner uses; the dialog's own copy distinguishes high from the rest).
  - `services/links/linkGuard.ts` (new): `assessLinkForConfirmation(href, displayText,
    { accountId, senderAddress }): Promise<LinkAnalysis | null>` — reads the enabled
    setting, the allowlist and the sensitivity (each read failing closed per REQ-1.5), runs
    `analyzeLink`, returns the analysis when `linkNeedsConfirmation`, else `null`.
  - `EmailRenderer.tsx`: the click handler becomes: resolve `href` as today; if the seam
    would ignore it, ignore; else `assessLinkForConfirmation(...)` → `null` →
    `openEmailLink`; analysis → `setPendingLink({ href, analysis })`. Render
    `LinkConfirmDialog` while `pendingLink` is set: confirm → `openEmailLink(href, origin)`
    and clear; cancel → clear.
  - `MessageItem.tsx`: `scanMessageLinks(account, id, body_html, from_address)` in an
    effect keyed on the message; render `PhishingBanner` when `showBanner`; "Trust sender"
    → `addToPhishingAllowlist` and clear the result.
  - `helpContent.ts` and `SECURITY.md` per REQ-3.
- **Decision & alternatives** — (a) Per-click `analyzeLink` on the exact `href` the DOM
  resolved, gated by the same settings the banner uses: cheap (pure function), exact
  (plain-text linkified anchors included), and no cache dependency. (b) Look the clicked URL
  up in the message's cached `MessageScanResult.links`: relies on the HTML extractor's URL
  matching the DOM-resolved `href` (relative hrefs and linkified plain text would miss) —
  rejected. (c) Confirm every click: rejected above. (a).
- **Failure modes** — a threshold bug either nags on safe links (visible, annoying) or lets
  a risky one through with no dialog (the pre-F-3 behaviour); REQ-1.1's table test pins
  the boundary at each sensitivity. A DB error never disables the gate (REQ-1.5).

## Tasks (risk-first)
- [ ] 1. `linkGuard.test.ts` red: medium/high → analysis, safe/low → null; sensitivity moves
  the line (a 45-point link: dialog at default and high, none at low); disabled → null;
  allowlisted → null; setting/allowlist read rejects → still the analysis; then the module
  and `linkNeedsConfirmation`. — REQ-1.1, 1.3, 1.5
- [ ] 2. `EmailRenderer.links.test.tsx`: a click on a flagged anchor renders the dialog and
  does not call the opener; "Open Anyway" opens; "Go Back" does not; a safe anchor opens
  directly; an in-page anchor stays a no-op. — REQ-1.1–1.4
- [ ] 3. `MessageItem.test.tsx`: banner rendered when the scan says so; "Trust sender"
  allowlists and hides it. — REQ-2
- [ ] 4. Help card and `SECURITY.md`. — REQ-3
- [ ] 5. LOG.md; vault row 14; HANDOFF pin after merge.

## Done when
`npm run test` green with the new cases; `tsc`, `graph:check`, `docs:check` green; CI green
on the merge commit. Manual, optional (needs the running app): open a message with an
IP-address link — clicking it shows the dialog; a link to a well-known host opens at once.

## Rollback
`git revert`; the components go back to unreferenced, the docs to their caveat.

## Review
One independent leg (Tier 1): Gemini 3.7 via `agy`, diff from committed SHAs.

## Approval
Jim, 2026-09-02 (decision 5: *"wire `LinkConfirmDialog`"*) and 2026-09-03 (*"First P19/F-3 —
wire LinkConfirmDialog on the email link path"*). The plan is this file, committed before
the code. The banner is included because the scan result exists once the gate reads the
same settings and the audit's acceptance names it; Jim can strike it.
