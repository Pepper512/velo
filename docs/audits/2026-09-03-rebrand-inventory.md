# Rebrand inventory — what has to change to rename the product

> Read-only inventory taken 2026-09-03 at `c03082a` by two Explore subagents (frontend +
> docs; native + packaging + CI), consolidated by the build seat. **No change was made.**
> Brand tokens searched: `Velo`, `VeloMail`, `velomail`, `com.velomail.app`, `velo.db`,
> `velo.key`, the `velomail.app` domain, the tagline, the logo/icon assets. Historical records
> (`CHANGELOG.md`, `docs/decisions/LOG.md`, `docs/briefs/`, `docs/reviews/`, dated audits and
> reports) are **excluded on purpose** — they describe the past and should keep the old name.

## 1. The short version

Renaming the product is four different jobs with very different risk:

| Job | Size | Risk | What it is |
|---|---|---|---|
| **A. Words the user sees** | ~40 strings in 17 files | none | window/tray/notification titles, settings "About", OAuth success page, a few error sentences, help card, splash, README/CONTRIBUTING/SECURITY |
| **B. Identity the OS keys data on** | 4 identifiers | **data loss unless migrated** | bundle identifier `com.velomail.app` (→ app-data directory, single-instance key, autostart entry, Windows AUMID), `velo.db`, `velo.key`, the updater endpoint |
| **C. Build and packaging names** | ~40 hits in 10 files + **5 file renames** | breaks CI/release if any one is missed | Cargo/npm package names, binary name, Flatpak app-id + manifest/desktop/metainfo files, RPM spec, workflow artefact names, Homebrew cask, release-please `extra-files` |
| **D. Internal contracts** | ~110 hits in ~45 files | safe, mechanical | `velo-*` window event names (9), Rust↔TS error sentinels (`VELO_TX_*`, `VELO_OUTCOME_UNKNOWN:`, `velo:pool:*`, `velo:fetch:*`), Message-ID/CID domains, `.ics` PRODID, ~60 comments, ~90 test assertions |

Plus the **marketing site** (`landing/`, 58 hits incl. the tagline and `velomail.app` everywhere),
the **brand artwork** (55 icon/logo files, none brand-named except `Square*Logo.png`), and the
**external identity** (`velomail.app` domain and mailboxes, `github.com/avihaymenahem/velo`
links, Cloudflare worker `velomail`, Homebrew tap `homebrew-velo`).

**Decision needed first:** keep or change the bundle identifier `com.velomail.app`. Everything
in B hangs on it. Keeping it (and `velo.db`/`velo.key`) makes a rename a pure string/asset job
with no migration; changing it requires a first-run migration shim or every existing install
starts empty and its stored credentials become unrecoverable.

## 2. Job B — identity, in detail (highest severity)

| Identifier | Where | Consequence of changing | Migration |
|---|---|---|---|
| `com.velomail.app` | `src-tauri/tauri.conf.json:5`; AUMID `src-tauri/src/lib.rs:85`; file names `com.velomail.app.{yml,desktop,metainfo.xml}`; `metainfo.xml:3,13,17`; Homebrew `zap` paths (`update-homebrew.yml:112-116` list the real macOS data dirs) | The app-data root moves (`~/Library/Application Support/com.velomail.app`, `~/.local/share/com.velomail.app`, `%APPDATA%\com.velomail.app`): **no accounts, no mail, no key** on next launch. Single-instance key and autostart entry are derived from it (old and new build can run side by side; stale LaunchAgent/autostart entry left behind). macOS treats it as a different app; notarisation identity changes | A first-run shim: before opening the DB, if the legacy dir exists and the new one is empty, move `velo.db*` (incl. `-wal`/`-shm`), `velo.key` and the attachment cache; remove the legacy autostart entry |
| `velo.key` | `src/utils/crypto.ts:9` (also named in user-facing errors `crypto.ts:155-165`, `App.tsx:371`) | AES-256-GCM key for every stored OAuth token and IMAP/SMTP password. A new name = a new key = **all credentials decrypt to garbage** | Rename together with the DB, inside the same shim |
| `velo.db` | `src/services/db/connection.ts:8`; `src-tauri/tauri.conf.json:64`; `src-tauri/src/db/tx.rs:34` (**the Rust constant must stay byte-identical to the config string**) | New empty database beside the old one | Rename-on-first-run, or simply keep the filename |
| Updater endpoint | `src-tauri/tauri.conf.json:70` → `github.com/avihaymenahem/velo/releases/latest/download/latest.json` | Every installed copy keeps polling the old URL forever; a move to a different repo silently ends updates | Keep the old URL serving `latest.json` (or a redirect) for at least one release cycle |

Recommendation: **change the product name and artwork; keep `com.velomail.app`, `velo.db` and
`velo.key` unless there is a reason strong enough to pay for the migration shim.** Tauri lets
`productName` and `identifier` differ.

## 3. Job A — user-visible strings

App: `index.html:6`, `splashscreen.html:6,59-75` (inline wordmark SVG), `TitleBar.tsx:35`,
`ReadingPane.tsx:14`, `UpdateToast.tsx:51` ("Velo v… is available"), `ReconcileStopDialog.tsx:65-70`,
`AddAccount.tsx:112`, `SettingsPage.tsx:548,1106,1903-1974` (About section: name, icon `alt`,
`https://velomail.app`, GitHub links, `info@velomail.app`, copyright "Velo Mail"),
`reconcileOp.ts:172`, `openLink.ts:51`, `badgeManager.ts:19` (tray tooltip), `notificationManager.ts:144`
(notification title), `helpContent.ts:1042`.

Native: `tauri.conf.json:3` `productName` (macOS `.app` name, Windows install dir, Linux binary
and desktop entry, About box) and `:16` window title; `lib.rs:253,266,305,314,320` (tray menu
"Show Velo", tooltip, KSNI title); `oauth.rs:89,93` (browser tab after OAuth); `imap/client.rs:695`
(an error sentence); `Cargo.toml:4` description/tagline "Email at the speed of thought".

Packaging listings: `com.velomail.app.desktop:2,8` (`Name`, `StartupWMClass` — must equal the
WM class the binary sets, i.e. `productName`); `com.velomail.app.metainfo.xml:6,9,18`;
`velo.spec:33`; release title `release.yml:104` and Homebrew cask `update-homebrew.yml:94-108`.

Docs to edit (not historical): `README.md` (11), `CONTRIBUTING.md` (17), `SECURITY.md` (6,
incl. `security@velomail.app`), `CLAUDE.md` (6), `ORIENTATION.md` (4), `docs/architecture.md`
(4), `docs/keyboard-shortcuts.md` (2), `docs/decisions/ADR-000.md` (18, incl. `$APPDATA/velo.key`
and the security mailbox), `docs/decisions/EXCEPTIONS.md` (3), `docs/ROADMAP.md` (6),
`HANDOFF.md` (13), the Dovecot harness README/compose files (test credentials `velo` /
`velo-test-only`, container names — cosmetic, optional).

## 4. Job C — build and packaging

Files to **rename** (every reference listed must move in the same commit):
1. `com.velomail.app.yml` — referenced by `package.json:18`, `.github/workflows/packaging.yml:47`, `src/config/flatpakManifest.test.ts:17` (the test hard-codes the path), `CONTRIBUTING.md`.
2. `com.velomail.app.desktop` — referenced by the manifest `:33` and `metainfo.xml:13`.
3. `com.velomail.app.metainfo.xml` — referenced by the manifest `:34` and `release-please-config.json:19` (**silent failure**: version bumps stop if the path is stale).
4. `velo.spec` — referenced by `packaging.yml:87-92` and `release-please-config.json:23`.
5. `landing/src/components/WhyVelo.tsx` — imported by `landing/src/App.tsx`.

Edits: `Cargo.toml:2` package name → binary name `velo` (Flatpak manifest `:11,23,29`, desktop
`Exec=velo`, spec `%global app_name velo`, `Cargo.lock` regenerates); `package.json:2`;
Flatpak manifest `:1,15,16,30-34`; spec `:1,13,14,52-56` (note the **pre-existing
inconsistency**: the spec lists `Velo.desktop` — `productName`-derived, as Tauri's RPM bundler
emits — while the Flatpak installs `com.velomail.app.desktop` — app-id-derived; a rename must
handle both derivations); `packaging.yml:47,48,57,80-92` (artefact `velo.flatpak`, tarball prefix
`velo-<version>` which must match `%setup -n`); `release.yml:7,30,104,192-226` (tag scheme
`velo-vX.Y.Z`, fork guard `github.repository == 'avihaymenahem/velo'`, DMG asset
`Velo_<version>_universal.dmg`); `release-please.yml:15-21`; `update-homebrew.yml` (tap
`avihaymenahem/homebrew-velo`, cask token `velo`, `Velo.dmg`, `Velo.app`, `zap` paths);
`.github/CODEOWNERS`; `.gitignore:76`; `landing/wrangler.jsonc:2` (worker `velomail`).

## 5. Job D — internal contracts (safe, but atomic)

- **Window events** (process-internal): `src/constants/events.ts:27,35-45` names `velo-sync-done`,
  `velo-threads-changed`, `velo-toggle-command-palette`, `velo-toggle-shortcuts-help`,
  `velo-toggle-ask-inbox`, `velo-move-to-folder`, `velo-inline-reply`, `velo-extract-task`,
  `velo-view-raw-message`; ~25 dispatch/listen sites (`App.tsx`, `ContextMenuPortal`, `EmailList`,
  `Sidebar`, `AttachmentLibrary`, `InlineReply`, `MoveToFolderDialog`, `ThreadView`, `ActionBar`,
  `CommandPalette`, `useKeyboardShortcuts`, `emailActions`, `followupManager`, `quickSteps/executor`,
  `snoozeManager`, `bundleManager`) and 5 test files. Find-and-replace; nothing persisted.
- **Rust↔TS sentinels** (one binary, but a *string* contract with no compiler check — rename
  both sides in one commit): `VELO_OUTCOME_UNKNOWN:` (`imap/move_outcome.rs:49` ↔
  `utils/networkErrors.ts:21`); `VELO_TX_BUSY|EXPIRED|UNKNOWN|NO_DB` (`db/tx.rs:37-40` ↔
  `db/connection.ts:56-62,125`); `velo:pool:*` (`imap/pool.rs:103` ↔ `imap/sessionManager.ts:69-71`);
  `velo:fetch:NeedRawFallback` (`commands.rs:250` ↔ `imap/tauriCommands.ts:344`); `sqlite:velo.db`
  (`tauri.conf.json:64` ↔ `db/tx.rs:34`). Asserted literally in `connection.test.ts`,
  `networkErrors.test.ts`, `emailActions.test.ts`, `sessionManager.test.ts`, `poolBoundary.test.ts`.
- **Wire-format domains** (leave the machine, nothing stored): inline-image CID `@velomail`
  (`emailBuilder.ts:82`), Message-ID fallback `velomail.local` (`emailBuilder.ts:96`), synthetic
  IMAP Message-ID `@velo.local` (`imapSync.ts:177` — **inconsistent with the builder's domain
  today**; a rename is the moment to unify), `.ics` `PRODID:-//Velo Mail//CalDAV Client//EN`
  (`icalHelper.ts:13`). Tests: `emailBuilder.test.ts:168,171`, `imapSync.test.ts:211`,
  `icalHelper.test.ts:27`.
- **Test-only**: `crypto.test.ts` (`velo.key` ×7), `UpdateToast.test.tsx`, `openLink.test.ts:66`,
  `db/tx_tests.rs:34` (`velo-tx-*.db` temp files), `imap/copyuid.rs:375-376` (Dovecot fixture
  credentials).
- **Comments** naming the product: ~20 TS files, 11 Rust files (counts in the raw reports).

Confirmed absent: no `User-Agent`/`X-Mailer` header, no OS keychain service name (the key file
is the credential root), no branded deep-link scheme (`mailto` only), no `localStorage` keys,
nothing brand-bearing in `capabilities/default.json`, `gen/schemas`, `Entitlements.plist`,
`build.rs`.

## 6. Artwork

`src-tauri/icons/**` (desktop `icon.{png,icns,ico}`, `32x32`, `64x64`, `128x128[@2x]`,
`StoreLogo`, 8 `Square*Logo.png`; `ios/` 18; `android/` 15 + 2 XML) — only the five paths in
`tauri.conf.json:9-14` and the three in the Flatpak manifest `:30-32` are load-bearing;
`src/assets/logo.svg` (wordmark glyphs), `src/assets/icon.png`, `assets/icon.png` (README),
`splashscreen.html:59-75` (inline wordmark), `landing/public/{favicon,logo,logo-white}.svg`,
`logo.png`, `og-image.{svg,png,html}` (wordmark + domain). `landing/index.html:38-40` reference
favicon PNGs that **do not exist** in `landing/public/` (pre-existing).

## 7. Suggested sequence, if the rename goes ahead

1. **Decide B** (identifier, DB and key names; updater URL policy). Record it as an ADR — it is
   a one-way door for existing users.
2. Artwork first (new icon set generated at every size; splash and landing wordmarks).
3. Job A strings + `productName` + `Cargo.toml` description, with the test assertions in D that
   pin user-visible text (`UpdateToast`, `openLink`, `icalHelper`).
4. Job C in one PR: the five renames, every referencing path, the flatpak pin test, release-please
   `extra-files`, workflow guards and artefact names; prove it with a dispatched packaging run.
5. Job D sentinels and events in one PR each side-pair at a time; docs pass last.
6. If B changes: the migration shim ships **before** the identifier change, in a release users
   have installed, so the move happens under the old identifier.

Raw subagent reports are in the session transcript; this file is the record.
