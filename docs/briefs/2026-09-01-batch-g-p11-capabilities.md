# Brief — Batch G / P11: split the Tauri capability grant

- **Task:** Close audit item **P11** — `src-tauri/capabilities/default.json` is one flat grant applied
  to `main`, `splashscreen`, `thread-*` and `compose-*`.
- **Tier:** **2** — security configuration for the whole app. `CLAUDE.md` Part I names
  `src-tauri/capabilities/*` as Tier 2 outright.
- **Date / owner:** 2026-09-01 · agent drafts, **Jim approves and performs the QA** (see *Verification*).
- **Source:** `docs/audits/2026-09-01-optimize-audit.md` §P11.
- **Base:** `main` @ `1ab7518`.
- **Status:** ⚠️ **Not built.** This brief exists because P11 was deliberately deferred out of Batch C.
  Two blockers below; the second cannot be resolved by an agent at all.

---

## Why this is worth doing

Pop-out windows (`thread-*`, `compose-*`) render untrusted email HTML and currently hold **the same
powers as the main window**: `sql:*`, `fs:allow-write-file` / `fs:allow-remove`, `http://*` +
`https://*`, and `core:webview:allow-create-webview-window`.

This is the second half of the chain flagged throughout this project. Batch C closed the first half —
the sanitizer now has a 42-vector corpus and DOM-based remote-content blocking. But the iframe is
still `sandbox="allow-same-origin"`, so DOMPurify remains the only layer; **if it is ever bypassed,
the flat grant is what turns a rendering bug into full local-database access and unrestricted
exfiltration.** Narrowing the grant means a future sanitizer bypass costs less.

---

## Blocker 1 — the audit's proposed split is not viable as written

The audit proposes a `content.json` for `splashscreen`/`thread-*`/`compose-*` with
*"events + window controls + read-only sql if needed"*. Verified against the code, that would break
pop-out windows:

| What the audit would remove | Why a pop-out needs it |
|---|---|
| SQL **execute** | `ThreadWindow.tsx` calls `runMigrations()` on mount, which writes to `_migrations`. It also renders the full `Composer`, whose draft auto-save writes every 3 s. |
| `http` | `ActionBar.tsx` and `MessageItem.tsx` expose one-click unsubscribe; both render inside `ThreadView`, which `ThreadWindow` renders. `unsubscribeManager.ts:63` POSTs to **arbitrary sender-supplied URLs**, so no narrow allowlist covers it. The Ollama AI provider is also reachable from the composer. |

So "read-only sql" is wrong, and `http` cannot be narrowed **until the unsubscribe POST moves to a
Rust command with URL validation** — which is the audit's own alternative suggestion, and is separate
work with its own threat pass.

## Blocker 2 — this item cannot be verified by an agent

The audit states the acceptance itself: *"a `thread-*` window attempting `fs.writeTextFile` is denied
(**manual QA step** recorded by position 18 — **no automated harness exists for capability denial**)"*.

There is no test that can assert this, `cargo build` will not catch an over-restriction, and CI cannot
either. An over-narrow grant produces a **runtime** failure in a window that only opens on user
action. Shipping that unverified risks breaking pop-outs for users in exchange for a hardening
benefit — a bad trade made silently.

**This is why P11 is the one backlog item held for a human.**

---

## Proposed change

Split into two files. `main.json` keeps today's set for `main` + `splashscreen`. `content.json`
covers `thread-*` + `compose-*` and **removes only what is provably unnecessary there**:

**Remove from content windows**

| Permission | Why it is safe to remove |
|---|---|
| `core:webview:allow-create-webview-window` | Only `App.tsx` opens pop-outs; a pop-out never opens another. **Highest value: stops a renderer compromise spawning windows.** |
| `fs:allow-remove` | Nothing in the thread/compose path deletes files. Attachment caching writes; it does not remove. |
| `autostart:*`, `global-shortcut:*`, `updater:*`, `process:allow-restart`, `deep-link:default` | Registered once at app start in `App.tsx`. A pop-out neither registers nor uses them. |
| `notification:*`, `core:window:allow-set-badge-count` | Notifications and badge counts are driven from the main window's sync loop. |

**Keep in content windows** (with the reason, so a later reader does not "tidy" them away): `sql:*`
including execute (migrations + draft auto-save) · `http` (unsubscribe, Ollama — see Blocker 1) ·
`core:event:*` · window controls · `opener` (opening links) · `dialog:allow-save` and `fs` read/write
scoped to `$APPDATA` (attachment save/cache) · `os:default`.

This is a **smaller** narrowing than the audit imagined, and it is the honest one: it removes what is
demonstrably unused rather than what would be nice to remove.

---

## Verification — the part that needs Jim

Automated (agent can run): `cargo build --locked` succeeds · CI green · CSP in `tauri.conf.json`
unchanged.

**Manual QA (Jim, required before merge).** In a dev build, for a popped-out thread window:

1. The window **opens** and renders a thread. *(Catches over-restriction of sql/events.)*
2. **Reply from the pop-out** and send. *(Draft auto-save + SMTP — catches sql execute removal.)*
3. **Unsubscribe** from a newsletter in the pop-out. *(Catches `http` removal.)*
4. **Save an attachment** from the pop-out. *(Catches dialog/fs removal.)*
5. In its devtools console, `await window.__TAURI__.core.invoke('plugin:fs|remove', {path:'…'})`
   is **denied**. *(Proves the narrowing took effect — the one positive security assertion.)*

If step 5 succeeds, the split did nothing. If steps 1–4 fail, it went too far.

---

## Not doing

- **Not moving unsubscribe to Rust.** That is the prerequisite for narrowing `http` and needs its own
  brief and threat pass (arbitrary outbound POST to sender-controlled URLs is the actual risk).
- **Not changing the iframe sandbox.** The audit floats `sandbox=""` with `srcdoc` instead of
  `doc.write`. That would remove same-origin and make DOMPurify no longer the sole layer — a bigger
  win than this brief — but it changes rendering behaviour and belongs with P9's owner.
- **Not touching the CSP.**

## Rollback

Revert the commit; the JSON returns to one file. No state, no migration. The risk is not data loss —
it is a pop-out window failing at runtime, which is why the QA steps above gate the merge rather than
follow it.

## Approval

- Plan approved by: __________ date: ______
- **Manual QA performed by: __________ date: ______** ← required before merge; see *Verification*
