# SPEC-233 — Flatpak: a supported runtime, a Node that matches, and a bundle that can find it

- **Task:** Move the Flatpak build from the end-of-life GNOME 46 runtime (and a Node 20 SDK
  extension the app no longer accepts) to GNOME 50 with the Node 24 extension, make the
  release bundle point at Flathub so `flatpak install velo.flatpak` can fetch the runtime,
  and make the packaging job runnable on a branch so a bump can be proven before a release.
- **Tier:** **1** — packaging only: the manifest `com.velomail.app.yml`, the packaging
  workflow, `CONTRIBUTING.md`, `docs/architecture.md`, and a config test. No source, no
  `tauri.conf.json`, no capability, no Cargo/npm dependency (the runtime is the sandbox's
  base image; this is a version bump of an existing pin, not an addition — called out here
  so Jim can object). Reversible by revert.
- **Base:** `main` @ `b1604d5` (code pin `c90d1f0`). Every citation grepped at that pin.
- **Status:** building — branch `f233-flatpak-runtime`.
- **Source:** upstream avihaymenahem/velo#233 ("Flatpak release artefact does not work and
  appears malformed": `flatpak install --user velo.flatpak` → *requires the runtime
  org.gnome.Platform/x86_64/46 which was not found*; the reporter also expected a
  `.flatpakref` / Flathub listing). The fork's 2026-09-01 triage: P3, S, Tier 1 — *"Manifest
  pins org.gnome.Platform 46 (EOL); bump runtime, publish .flatpakref/Flathub."* Bug-fix
  queue item 11.
- **Effort:** S · ½ day, plus one packaging run on CI (~25 min) as the proof.

## Outcome

The next release's `velo.flatpak` installs on a current Linux desktop: `flatpak install
velo.flatpak` offers to pull `org.gnome.Platform//50` from Flathub instead of failing, and
the bundle is built against a runtime Flathub still updates. A maintainer can run the
packaging job on any branch to prove a future bump.

## The defect, verified in the fork

1. **The runtime is dead.** `com.velomail.app.yml:2-3` pins `org.gnome.Platform` `"46"`;
   `.github/workflows/packaging.yml:30-31` installs `org.gnome.Platform/x86_64/46` and
   `org.gnome.Sdk/x86_64/46`; `CONTRIBUTING.md:135-143` tells contributors the same. Flathub
   declared **46 end-of-life on 2025-04-17**, and **48 on 2026-03-24**; the current runtime
   is **50** (Flathub lists "GNOME Application Platform version 50"). A user on a current
   system has no 46 runtime and Flathub no longer serves one to install — the reporter's
   exact error.
2. **The Node extension does not match the app.** The manifest uses
   `org.freedesktop.Sdk.Extension.node20` (`:6`, `:8`) at branch `23.08` (`packaging.yml:32`)
   while `package.json:8` requires `"node": ">=24"` and CI builds on Node 24
   (`ci.yml:37,56,127`, `.nvmrc`). The extension for the 25.08 base is
   `org.freedesktop.Sdk.Extension.node24//25.08` (Flathub manifest: Node 24.20.0,
   `runtime-version: '25.08'`), which is the base GNOME 49 and 50 are built on.
3. **The bundle carries no runtime repo.** `packaging.yml:37` runs `flatpak build-bundle repo
   velo.flatpak com.velomail.app` without `--runtime-repo`, so `flatpak install` of the file
   cannot resolve a missing runtime at all — with `--runtime-repo=https://flathub.org/repo/
   flathub.flatpakrepo` it adds Flathub and offers the runtime. This half is what turns
   "not found" into an install.
4. **The job cannot be run on a branch.** `packaging.yml:3-8` is `workflow_call` only, taken
   from the release workflow with a tag; there is no way to prove a manifest change before a
   release cuts an artefact.

## Requirements

- **REQ-1** As a Linux user I want the release Flatpak to install.
  - REQ-1.1 The manifest and the workflow SHALL target `org.gnome.Platform`/`Sdk` **50**.
  - REQ-1.2 The manifest and the workflow SHALL use `org.freedesktop.Sdk.Extension.node24`
    at branch **25.08**, and the `append-path` SHALL be `/usr/lib/sdk/node24/bin`.
  - REQ-1.3 `flatpak build-bundle` SHALL pass `--runtime-repo=https://flathub.org/repo/flathub.flatpakrepo`.
- **REQ-2** As a maintainer I want the pins to agree and to be provable.
  - REQ-2.1 A test SHALL read the manifest, the workflow and `CONTRIBUTING.md` and fail if
    the runtime version, the Node extension name/branch, or the `append-path` disagree, if
    the Node extension's major differs from `package.json`'s `engines.node` floor, or if
    `--runtime-repo` is missing.
  - REQ-2.2 The packaging workflow SHALL also accept `workflow_dispatch` with an optional
    `tag_name`; the upload step SHALL run only when a tag is given.
  - REQ-2.3 The bump SHALL be proven by one dispatched run of the packaging job on the PR
    branch that builds the bundle (upload skipped).

## Not doing

- Publishing to Flathub or shipping a `.flatpakref` — a distribution decision for Jim
  (EX-007; the ROADMAP's "release + signing" ADR). Recorded, not done.
- The SRPM job in the same workflow (untouched).
- Any change to the app's `finish-args` sandbox permissions.

## Design

- **Change** — `com.velomail.app.yml`: `runtime-version: "50"`, `sdk-extensions:
  org.freedesktop.Sdk.Extension.node24`, `append-path: /usr/lib/sdk/node24/bin`.
  `packaging.yml`: `on: workflow_call | workflow_dispatch` (optional `tag_name`), install
  Platform/Sdk 50 and node24//25.08, `build-bundle --runtime-repo=…`, upload `if:
  inputs.tag_name != ''`. `CONTRIBUTING.md` and `docs/architecture.md` say 50 / node24.
  `src/config/flatpakManifest.test.ts` pins the agreement (REQ-2.1) the way
  `tauriConfig.test.ts` pins the CSP.
- **Decision & alternatives** — (a) GNOME 50 (current, supported until ~March 2027). (b)
  GNOME 49 — still supported this month but end-of-life on GNOME 51's release in weeks. (c)
  `org.freedesktop.Platform//25.08` directly — Velo needs webkit2gtk-4.1, which the GNOME
  runtime carries and the bare freedesktop one does not. (a).
- **Failure modes** — a wrong extension branch fails the packaging run at install time
  (proven by REQ-2.3 before merge, never at a release); a future EOL repeats this issue —
  the test cannot know Flathub's calendar, so the "supported until" date is recorded in
  ROADMAP's standing chores.

## Tasks (risk-first)
- [ ] 1. `flatpakManifest.test.ts` red against the current files, then the manifest/workflow/
  docs edits. — REQ-1.1/1.2/1.3, REQ-2.1
- [ ] 2. `workflow_dispatch` + guarded upload; dispatch the job on the branch; record the run
  URL and result on the PR. — REQ-2.2/2.3
- [ ] 3. LOG.md; vault row 11; HANDOFF pin after merge; ROADMAP chore: "GNOME 50 runtime EOL
  ~March 2027 — bump again".

## Done when
`npm run test` green with the config test; the dispatched packaging run on the branch
reaches "Build Flatpak bundle" green with upload skipped; CI green on the merge commit.
Manual, for the reporter: install the next release's bundle on a current distro.

## Rollback
`git revert`; the next release would again build against 46 and fail to install — so the
revert is only the right move if 50 itself fails to build, which REQ-2.3 rules out first.

## Review
One independent leg (Tier 1): Gemini 3.7 via `agy`, diff from committed SHAs.

## Approval
Jim, 2026-09-03: *"#233 (Flatpak runtime bump … Tier 1 unless it touches capabilities or a
dependency, in which case ask)"*. Neither is touched; the runtime pin bump is named above.
