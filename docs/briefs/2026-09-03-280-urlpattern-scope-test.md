# SPEC-280-U — the http scope tested with the plugin's own matcher

- **Task:** Close SPEC-280's "Open for Jim": a Rust test that rebuilds the `http:default`
  allow entries of both capability files exactly as `tauri-plugin-http` does and checks the
  same URL table `capabilities.test.ts` checks — with the `urlpattern` crate the shipped
  binary matches with, not Node's `URLPattern`.
- **Tier:** **1** — test only, plus one **dev-dependency**, `urlpattern` 0.3.0, approved by Jim
  on 2026-09-03 (decision 4: "Add it as a dev-dependency only; justify it in the PR (need,
  zero transitive cost, not shipped)"). No runtime change, no capability change.
- **Base:** `main` after PR E (#84).
- **Status:** approved (Jim, 2026-09-03) — branch `urlpattern-scope-test`, PR opened with
  this file before the code.
- **Source:** `docs/briefs/2026-09-02-280-http-scope-local-ai.md` §"Open for Jim — the test
  oracle (Grok M1 on #56)".
- **Effort:** XS · 0.25 day.

## Outcome

A change to either capability file's `http` scope that the plugin would read differently
from Node fails `cargo test` in CI, on the crate that decides at runtime.

## What exists, verified

- `src/config/capabilities.test.ts` pins the allow list and a table of allowed and refused
  URLs with Node 24's `URLPattern` — a regression net for the JSON, not proof the plugin
  accepts a request.
- The plugin's matcher: `tauri-plugin-http-2.6.0/src/scope.rs` — `parse_url_pattern` parses
  the constructor string with the `urlpattern` crate and defaults an empty `search`, `hash`
  and an empty or `/` `pathname` to `*`; `Scope::is_allowed` tests `UrlPatternMatchInput::Url`.
  The module is private, so the test rebuilds those three defaults.
- `urlpattern` 0.3.0 is already in the graph through the plugin (and `tauri-utils`); as a
  dev-dependency at the same version it adds no package. Its `quirks` API builds a pattern
  from a string and a match input from a string without naming `regex` or `url`, so no
  second crate is needed.

## Requirements

- **REQ-1** THE SYSTEM SHALL have a Rust test, in CI, that for each of `capabilities/main.json`
  and `capabilities/content.json` (a) asserts the `http:default` allow list is exactly the
  eight intended entries and carries no `*:*`, (b) accepts every URL the TypeScript test
  accepts, and (c) refuses every URL it refuses — matched with `urlpattern` after the plugin's
  three defaults are applied.
- **REQ-2** The dependency SHALL be `[dev-dependencies] urlpattern = "0.3.0"` and nothing
  else; `cargo tree -e normal` SHALL be unchanged and the lockfile SHALL gain no package.

## Not doing

- Making the plugin's `scope` module public, vendoring it, or changing the scope.
- Replacing the TypeScript test — both stay; they check different things.

## Design

`src-tauri/src/http_scope_matcher.rs`, test-only, declared under `#[cfg(test)]` in
`lib.rs`. Three tests: the exact allow list, the accepted table, the refused table, each over
both files. Cargo.toml gains the dev-dependency with a comment naming the approval.

## Done when

`cargo test --locked http_scope_matcher` green; `cargo tree --locked -e normal` identical to
before; CI green; the TypeScript test unchanged.

## Rollback

Revert the squash commit; nothing persisted, nothing shipped.

## Review

Two cross-vendor legs on the diff from committed SHAs; findings verified against source.

## Approval

- Jim, 2026-09-03 (decision 4 of the next-session prompt).
