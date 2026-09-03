# SPEC-P11 — Split the Tauri capability grant: main, content windows, splash

- **Task:** Close audit item **P11** — `src-tauri/capabilities/default.json` is one flat grant
  applied to `main`, `splashscreen`, `thread-*` and `compose-*`. Give the windows that render
  untrusted email (`thread-*`, `compose-*`) only what they demonstrably call; give the splash
  page nothing; leave `main` exactly as it is.
- **Tier:** **2** — `CLAUDE.md` names `src-tauri/capabilities/*` as Tier 2 outright (security
  configuration for the whole app). Plan, threat pass and rollback in the PR before code; two
  review legs. No dependency, no schema, CSP untouched.
- **Base:** `main` @ `2d764a9` (code pin `1116348`, #73). The 2026-09-01 draft was pinned at
  `1ab7518`; every claim below was re-grepped at `2d764a9` and the ones that moved are marked.
- **Status:** landed `e05f6cd` (#75, 2026-09-03) — four review passes, dispositions in LOG.md.
  **Manual QA (Jim) is open, not done** — see *Verification*.
- **Source:** `docs/audits/2026-09-01-optimize-audit.md` §P11; the 2026-09-01 draft of this
  brief (its two blockers, kept below); ROADMAP §3.
- **Effort:** S · ½ day of agent work, plus Jim's five QA steps.

## Outcome

A pop-out thread window or compose window can no longer create webview windows, delete files,
register shortcuts or autostart, restart the app, post notifications, set the badge, check for
updates or read OS details. It can still do everything a pop-out does today: render and act on a
thread, reply and send (draft auto-save), unsubscribe, open links, save and cache attachments,
and talk to a local model server. The splash page, which runs no script, holds no permissions.
The main window is unchanged.

## Why this is worth doing (from the 2026-09-01 draft, still true)

Pop-out windows render untrusted email HTML and hold **the same powers as the main window**:
`sql:*`, `fs:allow-write-file` / `fs:allow-remove`, `http://*` + `https://*`, and
`core:webview:allow-create-webview-window`. The sanitizer (42-vector corpus, DOM-based
remote-content blocking) is the first layer; the iframe is still `sandbox="allow-same-origin"`,
so DOMPurify is the only layer, and **if it is ever bypassed, the flat grant is what turns a
rendering bug into full local-database access and unrestricted exfiltration.** Narrowing the
grant makes a future bypass cost less.

## What exists, verified at `2d764a9`

1. **One file, four windows.** `src-tauri/capabilities/default.json` lists `main`, `splashscreen`,
   `thread-*`, `compose-*` and 60 permissions. `tauri.conf.json` names no capability list under
   `app.security`, so every file in the directory is loaded (`tauri.conf.json:41-43` carries the
   CSP only). `src-tauri/gen/schemas/` is gitignored — nothing generated to commit.
2. **The pop-outs run migrations and the full composer.** `ThreadWindow.tsx:8,37` and
   `ComposerWindow.tsx:7,26` call `runMigrations()` on mount (writes `_migrations`);
   `ThreadWindow.tsx:190` renders `Composer` (draft auto-save writes every 3 s). **Blocker 1 of the
   draft stands: SQL execute stays.**
3. **`http` stays, for two callers.** `src/services/unsubscribe/unsubscribeManager.ts:3` (POST to
   sender-supplied `List-Unsubscribe` URLs; rendered by `ActionBar.tsx` and `MessageItem.tsx`, both
   inside `ThreadView`) and `src/services/ai/providers/ollamaProvider.ts:2` (reachable from the
   composer's AI features). The custom endpoint already goes through the Rust `ai_fetch` command
   (#65), so the day Ollama moves to it and unsubscribe moves to a validated Rust command, `http`
   leaves the content grant entirely — a follow-up, not this PR. The scope's allow list is pinned
   by `src/config/capabilities.test.ts` (SPEC-280) and must stay identical in both files.
4. **Window creation is reachable from inside a pop-out — the draft said it was not.** The draft
   claimed "only `App.tsx` opens pop-outs". In the tree: `ThreadView.tsx:30-56` (`handlePopOut`,
   wired at `:396` to `ActionBar`'s "Open in new window" button, `ActionBar.tsx:327`) and
   `Composer.tsx:409-447` (`handlePopOutComposer`, button at `:509`) both call
   `new WebviewWindow(...)`, and both components render inside the pop-out roots.
   `ContextMenuPortal.tsx:389` is the third creator, rendered by `App.tsx` only. So removing
   `core:webview:allow-create-webview-window` from content windows needs a UI change, or the
   buttons fail silently (both handlers `catch` and `console.error`). Inside a `thread-*` window
   the thread's own pop-out button is meaningless (same label → `getByLabel` → `setFocus` on
   itself); inside a `compose-*` window "Open in new window" would spawn a second compose window
   with the same content and then `closeComposer()` on itself. The one real path lost is
   **popping the reply composer out of a thread pop-out** into its own window — recorded as the
   trade in §Not doing.
5. **Window controls are main-only.** `getCurrentWindow().minimize/toggleMaximize/close/isMaximized`
   live in `components/layout/TitleBar.tsx:11-25`, rendered by `App.tsx`/`routeTree.tsx`; the
   pop-outs are created with native decorations (`ThreadView.tsx:43-49`, `Composer.tsx:435-441`)
   and never call them. `setFocus` is called only on *another* window from the three pop-out
   creators (§4). `setBadgeCount` is `badgeManager.ts:14`, imported by `App.tsx` only.
6. **Main-only services, by import:** `notificationManager` (`App.tsx`, `gmail/sync.ts`,
   `followupManager.ts` — the sync loop and follow-ups run in `main`), `badgeManager` (`App.tsx`),
   `globalShortcut` / `updateManager` / `deepLinkHandler` (`App.tsx`, `UpdateToast.tsx`,
   `SettingsPage.tsx`), `plugin-os` (`SettingsPage.tsx:1752`), `plugin-process` and
   `plugin-updater` (`updateManager.ts:16,51`). None is reachable from `ThreadWindow` or
   `ComposerWindow`.
7. **`fs:allow-remove` is main-only.** `cacheManager.ts:92,109` (`evictOldestCached`,
   `clearAllCache`) — `clearAllCache` is called from `SettingsPage.tsx:608`; `evictOldestCached`
   has no caller. Everything else the pop-outs touch on disk is read, write, mkdir, exists under
   `$APPDATA` (`crypto.ts:7,36,62` for `velo.key`; `cacheManager.ts:25,57`; attachment save in
   `AttachmentList.tsx:3`, `ThreadView.tsx:326`, `AttachmentLibrary.tsx:3` with `dialog` save).
8. **The pop-outs need events.** `sessionManager.ts` registers a `listen` on first use (#73), and
   `core:event:default` already covers listen/unlisten/emit/emit-to (`acl-manifests.json`).
9. **The splash page runs no script.** `splashscreen.html` (repo root) has no `<script>` and no
   Tauri reference; `close_splashscreen` is invoked by `main` (`App.tsx`). It needs no grant.
10. **What `core:default` gives every window** (from the generated manifest): path, event,
    window *read-only* queries (`is-maximized`, `inner-size`, monitors…), webview read-only
    (`get-all-webviews`, position/size, devtools toggle), app, image, resources, menu, tray. No
    window creation, no minimize/close/focus, no badge.
11. **A test can reach the files.** `src/config/capabilities.test.ts` already parses the JSON in
    vitest (SPEC-280); the split's invariants are the same kind of assertion. What no test can
    reach is the runtime: whether a narrowed window still works, and whether a removed
    permission is actually denied — the draft's Blocker 2, unchanged. `cargo build` (tauri-build)
    validates identifiers and schema, so a typo fails CI; an over-restriction does not.

## Requirements

- **REQ-1** As the machine's owner I want the windows that render email to hold only what they use.
  - REQ-1.1 THE SYSTEM SHALL have `capabilities/main.json` with `windows: ["main"]` and exactly
    today's permission list, and `capabilities/content.json` with `windows: ["thread-*",
    "compose-*"]`; `default.json` SHALL be gone; no file SHALL list `splashscreen`.
  - REQ-1.2 The content grant SHALL NOT contain: `core:webview:allow-create-webview-window`,
    `fs:allow-remove`, any `notification:*`, `core:window:allow-set-badge-count`, any
    `autostart:*`, any `global-shortcut:*`, `deep-link:default`, `updater:default`,
    `process:allow-restart`, `os:default`, nor the main title bar's window controls
    (`core:window:allow-minimize`, `-toggle-maximize`, `-close`, `-is-maximized`,
    `-start-dragging`, `-show`, `-set-focus`).
  - REQ-1.3 The content grant SHALL contain: `core:default`; `sql:default` and
    `sql:allow-execute`; `opener:default`; `dialog:default`; `fs:default`,
    `fs:allow-appdata-read-recursive`, `fs:allow-appdata-write-recursive`, `fs:allow-read-file`,
    `fs:allow-write-file`, `fs:allow-exists`, `fs:allow-mkdir`, the `fs:scope` for `$APPDATA`
    and `$APPDATA/**`; and `http:default` with an allow list **identical** to main's.
  - REQ-1.4 Every permission in the content grant SHALL also be in the main grant (a strict
    subset), and the main grant SHALL equal today's list exactly.
- **REQ-2** As a user I want nothing I can do in a pop-out today to break, except one button
  that cannot work there.
  - REQ-2.1 WHEN `ThreadView` renders inside a pop-out window THE SYSTEM SHALL NOT offer
    "Open in new window" (the thread is already in one).
  - REQ-2.2 WHEN `Composer` renders inside a pop-out window (a `compose-*` window, or the reply
    composer of a `thread-*` window) THE SYSTEM SHALL NOT offer "Open in new window".
  - REQ-2.3 The pop-out detection SHALL be one function shared with `main.tsx`'s routing, so the
    two cannot disagree.
- **REQ-3** As Jim I want the runtime proof to be mine and recorded as open until I do it.
  - REQ-3.1 The PR SHALL state that the five manual QA steps were not performed by the agent.

## Not doing

- **Not moving unsubscribe to Rust, not moving Ollama to `ai_fetch`.** Together they would let
  `http` leave the content grant; each needs its own brief and threat pass (arbitrary outbound
  POST to sender-controlled URLs is the real risk). Recorded as the next narrowing.
- **Not narrowing `sql` for pop-outs.** Migrations and draft auto-save write; a read-only grant
  breaks both (draft Blocker 1).
- **Not routing window creation through a Rust command** (which would let `main` drop
  `core:webview:allow-create-webview-window` too — today that permission lets a compromised
  main renderer open *any* URL in a webview). Worth its own brief; here the buttons are hidden
  where they cannot work.
- **Popping the reply composer out of a thread pop-out** stops being offered (§4). The reply
  composer inside a thread pop-out still works; a compose window can still be opened from `main`.
  Jim can strike this and keep `core:webview:allow-create-webview-window` in `thread-*` only.
- **Not changing the iframe sandbox** (P9's owner). **Not touching the CSP.**

## Design

- **`src-tauri/capabilities/main.json`** — today's `default.json` with `identifier: "main"`,
  `windows: ["main"]`, permissions unchanged, byte for byte in order.
- **`src-tauri/capabilities/content.json`** — `identifier: "content"`, `windows: ["thread-*",
  "compose-*"]`, with a `description` that says why each entry is there so a later reader does
  not "tidy" one away. *(Amended after review — Grok H1/L7, Gemini 3.8 N7: REQ-1.3's set-level
  list became path-level.)* The grant is: `core:path:default` (`join()` in the cache);
  `core:event:allow-listen` + `allow-unlisten` (the session manager's listener) and **no emit**
  — `main` listens for `single-instance-args` and opens a composer on it, so a pop-out must not
  be able to send it; `sql:allow-load/select/execute` (no `close`); `opener:allow-open-url` +
  `allow-default-urls` (http, https, mailto, tel — not `reveal-item-in-dir`); `dialog:allow-save`
  only; **fs by path**: `exists` and `read-text-file` on `$APPDATA/velo.key` (credentials
  decrypt in the page; the key is read, never written, by a pop-out — `crypto.ts` creates it
  only on the first-run branch, which `main` takes), `exists`/`read-file`/`mkdir`/`write-file`
  on `$APPDATA/attachment_cache`, `write-text-file` with no static path (the `.eml` export goes
  to a dialog-picked path) and `deny-default`; a dialog-picked save path reaches `write-file`
  through the runtime scope the dialog plugin extends
  (`tauri-plugin-dialog-2.7.3/src/commands.rs:195`; the fs plugin ORs it with the permission's
  own scope, `tauri-plugin-fs/src/commands.rs:1564`). No `fs:default` (it carries recursive
  read of the app directories), no blanket `fs:scope`: a pop-out cannot read the database file
  or write beside the key. `http:default` with main's scope stays — the residual.
- **`src-tauri/capabilities/default.json`** — deleted. No file for `splashscreen`.
- **`src/utils/windowKind.ts`** (new, pure): `windowKindFromSearch(search): "main" | "thread" |
  "compose"` with `main.tsx`'s exact rule (`thread` **and** `account` → thread; `compose` →
  compose; else main), `windowKindFromLabel(label)` with the grant's globs, and
  `currentWindowKind()` / `isPopoutWindow()` — **by the window label through the public
  `getCurrentWindow()` when Tauri gives one** (the grant is keyed by label, and a page cannot
  edit its label), by the URL rule otherwise (dev server, tests). **`main.tsx` picks its root
  by the same call**, so the root and the gate cannot disagree: a `thread-*` window whose query
  string went missing renders `ThreadWindow` (which then shows its own error), never the full
  app under the narrow grant. *(Amended after review: Gemini 3.8 M3, Grok H2, delta F1/F2.)*
- **The splash window** is `splashscreen.html`, a static file, in dev and in the bundle alike
  (`tauri.conf.json` `windows[1].url`); it never boots the React app, so a grant of nothing is
  fail-closed and correct. *(Grok N on #75.)*
- **`opener`** in content is `opener:allow-open-url` + `opener:allow-default-urls`, not
  `opener:default`, which also carries `reveal-item-in-dir`. *(Amended after review: Gemini
  3.8 N7.)*
- **`ThreadView.tsx`**: `onPopOut={isPopoutWindow() ? undefined : () => handlePopOut(thread)}`;
  **`ActionBar.tsx`** renders the button only when `onPopOut` is given.
- **`Composer.tsx`**: the "Open in new window" button is rendered only when `!isPopoutWindow()`.
- **Tests, written first** (`src/config/capabilities.test.ts`, rewritten around the two files):
  the window partition; content ⊂ main; the forbidden list absent from content (by id and by
  plugin prefix); the required list present; the `http` allow list identical in both and the
  SPEC-280 scope assertions run against both; main equals a literal snapshot of today's list.
  `src/utils/windowKind.test.ts`: the rule, including `?thread=` without `account` → main.
- **Decision & alternatives** — (a) two files plus hidden buttons (chosen). (b) Keep
  `create-webview-window` in content and change nothing in the UI: keeps the highest-value
  removal off the table for the window that renders hostile HTML. (c) The audit's
  `content.json` with read-only SQL and no `http`: breaks pop-outs (draft Blocker 1).
- **Data / schema** — none.
- **Failure modes** — an over-narrow content grant fails at *runtime* in a window that opens
  on user action (the draft's Blocker 2): the five QA steps are the gate. A typo in an identifier
  fails `cargo build` in CI. If the split were reverted, the app is back to the flat grant with
  no other state involved.

## Tasks (risk-first)
- [ ] 1. `capabilities.test.ts` rewritten and red (no `content.json` yet); `windowKind.test.ts`
  red. — REQ-1, REQ-2.3
- [ ] 2. `main.json`, `content.json`; delete `default.json`; `cargo check --locked` proves the
  files validate; tests green. — REQ-1
- [ ] 3. `windowKind.ts`; `main.tsx` on it; the two buttons gated. — REQ-2
- [ ] 4. `CLAUDE.md` (the two capability lines), `docs/architecture.md` tree line; LOG.md;
  HANDOFF after merge. — REQ-3.1 in the PR body.

## Done when
`npx vitest run`, `tsc`, `graph:check`, `docs:check` green; `cargo build --locked` green in CI
(tauri-build validates the capability files); the CSP line in `tauri.conf.json` unchanged
(`git diff` shows no change to it); CI green on the merge commit. **Manual (Jim, open):** the
five steps under *Verification*.

## Rollback
`git revert`; the two files become one again. No state, no migration. The risk is not data loss
but a pop-out failing at runtime — which is why the QA steps gate the merge rather than follow it.

## Threat pass (Tier 2)
- **Assets:** the local database and `velo.key` (all credentials), the attachment cache, the
  network (exfiltration), the OS (windows, shortcuts, autostart, process).
- **Entry points:** the `thread-*` and `compose-*` webviews rendering sanitized email HTML; a
  sanitizer bypass executing same-realm there is the attacker.
- **What an attacker gains today, and after:** today, everything `main` can do. After: **no**
  webview creation (so no window pointed at an attacker URL, no second same-realm surface), no
  file deletion, no shortcut or autostart registration, no process restart, no notifications
  (phishing via native toasts), no badge, no OS fingerprint. **Still, and accepted for now:** SQL
  execute on the whole database, read/write under `$APPDATA`, `http(s)` fetch to any URL
  (unsubscribe, Ollama), `opener` to any URL the opener default allows. That residual is why
  the follow-up (unsubscribe → Rust, Ollama → `ai_fetch`) matters.
- **Spoofing / tampering:** unchanged — capabilities are keyed by window label, and labels are
  assigned by the creator (`main` for pop-outs; `thread-<id>` is sanitised to `[a-zA-Z0-9_-]`
  at `ThreadView.tsx:33`). A content window cannot relabel itself.
- **Repudiation:** none new.
- **Elevation:** the ACL is enforced by Tauri in Rust per command, per window, before the
  command runs — not by the frontend hiding buttons. Hiding the buttons is UX; the denial is the
  control. A `thread-*` window that calls `plugin:webview|create_webview_window` gets a denial
  whether or not the button exists — QA step 5 proves it.
- **Residual:** the iframe sandbox (P9), `sql` and `http` in content windows (follow-up),
  `main`'s own breadth (unchanged by design), per-window session binding for the IMAP pool
  (ADR-003) — the pool's session id is still usable from any window that has `core:default`,
  because app commands are not capability-gated. That last one is worth naming here: **this
  split does not bind IMAP sessions to windows.**

## Verification — the part that needs Jim

Automated (agent runs): tests above · `cargo build --locked` · CI green · CSP unchanged.

**Manual QA (Jim, required before the QA line below is signed).** In a dev build
(`npm run tauri dev`), for a popped-out thread window:

1. The window **opens** and renders a thread. *(Catches over-restriction of sql/events.)*
2. **Reply from the pop-out** and send. *(Draft auto-save + SMTP — catches sql execute removal.)*
3. **Unsubscribe** from a newsletter in the pop-out. *(Catches `http` removal.)*
4. **Save an attachment** from the pop-out. *(Catches dialog/fs removal.)*
5. In its devtools console, `await window.__TAURI__.core.invoke('plugin:fs|remove', {path:'…'})`
   is **denied**, and `await window.__TAURI__.core.invoke('plugin:webview|create_webview_window',
   {options:{label:'x',url:'index.html'}})` is **denied**. *(Proves the narrowing took effect.)*

If step 5 succeeds, the split did nothing. If steps 1–4 fail, it went too far.

## Review
Two legs on the PR: Gemini 3.8 Flash High via `agy`; Grok 4.6 via the `grok` CLI. Diffs from
committed SHAs. Dispositions on the PR and in LOG.md.

## Approval
- Plan approved by: Jim, 2026-09-03 (ROADMAP §The prompt for the next session: *"Take P11 …
  write the plan with threat pass and rollback into the brief and open the PR with the plan
  before any code"*). The plan is this file, committed before the code.
- **Manual QA performed by: __________ date: ______** ← **open**; the agent did not and cannot
  perform it. The merge lands the narrowing behind this line, per the roadmap instruction
  ("record as open, not done").
