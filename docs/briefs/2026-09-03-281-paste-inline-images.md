# SPEC-281 — Paste an image from the clipboard into the composer

- **Task:** Let a screenshot on the clipboard be pasted into the message body as an inline
  image, which the existing builder already ships as a `cid:` part.
- **Tier:** **1** — `components/composer/` only, plus a pure helper and tests. Clipboard
  content is untrusted input; the helper is the boundary (type allow-list, size cap). No
  Rust, no CSP, no capability, no dependency (TipTap's image extension is already installed
  and configured). Reversible by revert.
- **Base:** `main` @ `2dfc1b2` (the #204 merge; code pin). Citations grepped at `1ea767e`,
  unchanged by #204 (which touched no composer file).
- **Status:** building — branch `f281-paste-inline-images`.
- **Source:** upstream avihaymenahem/velo#281 ("Allow pasting of inline images": *"sharing
  screenshots in tutorials and walkthroughs to clients … paste from clipboard"*). The fork's
  2026-09-01 triage: P3, M, Tier 1 — *"TipTap image node + CID attachment in emailBuilder"*.
  Bug-fix queue item 13, the last of the tail.
- **Effort:** S · ½ day (the triage's M assumed the CID half was missing; it is not).

## Outcome

Copy a screenshot, press paste in the composer: the image appears at the cursor, sized to
the editor, and the sent mail carries it as an inline `cid:` part that every client renders.
Pasting text or HTML behaves exactly as before. An unsupported or oversized image is
refused with a short notice rather than silently dropped or silently embedded.

## What exists, verified in the fork

1. **The image node is already there.** `Composer.tsx:83-86` configures
   `@tiptap/extension-image` with `inline: true, allowBase64: true`, so a `data:` URL image
   renders in the editor and survives `getHTML()` → `composerStore.bodyHtml`.
2. **The builder already turns it into a CID part.** `emailBuilder.ts:78-89`
   `extractInlineImages` rewrites every `<img src="data:<mime>;base64,…">` to `src="cid:…"`
   and emits a `multipart/related` part with `Content-ID` and `Content-Disposition: inline`
   (`:186-191`).
3. **Nothing handles a pasted file.** `editorProps` (`:127-141`) has a `handleDrop` that
   deliberately routes dropped files to the attachment picker and no `handlePaste`.
   ProseMirror's default paste handles text and HTML only; an image file on the clipboard
   (a screenshot) is ignored — the reporter's "can't paste".
4. **No composer test exists** beyond `AddressInput` and `scheduleSendPresets`.

## Requirements

- **REQ-1** As a user I want to paste a screenshot into the body.
  - REQ-1.1 WHEN the clipboard carries an image file of type `image/png`, `image/jpeg`,
    `image/gif` or `image/webp` THE SYSTEM SHALL insert it at the cursor as an inline image
    with a `data:` URL, and SHALL consume the paste event.
  - REQ-1.2 WHEN the clipboard carries no image file THE SYSTEM SHALL leave the paste to
    the editor's default handling (text/HTML unchanged).
  - REQ-1.3 WHEN the clipboard carries both text/HTML and an image file (some apps do)
    THE SYSTEM SHALL prefer the image file.
- **REQ-2** As the sender I want limits that keep the mail sane and safe.
  - REQ-2.1 An image over **5 MiB** SHALL be refused with a notice naming the limit.
  - REQ-2.2 `image/svg+xml` and any other type SHALL be refused (SVG can carry scripts,
    and mail clients differ on it); the notice says "PNG, JPEG, GIF or WebP".
  - REQ-2.3 The image's `data:` URL SHALL be built from the file's own declared type and its
    bytes; the helper SHALL never trust a type it cannot find in the allow-list.
- **REQ-3** The sent mail carries the pasted image as a CID part — pinned by a builder test
  with a data-URL `<img>`, since that path is the one this relies on.

## Not doing

- Drag-and-drop of images into the body (dropped files go to attachments by design,
  `handleDrop`; changing that is a product call).
- Resizing or compressing pasted images; the 5 MiB cap is the guard.
- Pasting remote `<img src="https://…">` HTML — unchanged (existing behaviour).
- A component test that mounts the whole composer; the helper is pure and tested, the
  editor wiring is three lines.

## Design

- **Change**
  - `src/components/composer/pasteImage.ts` (new, pure): `INLINE_IMAGE_TYPES`,
    `MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024`, `pickPastedImage(data: DataTransfer | null):
    { file: File } | { refused: string } | null` (null = no image file present; refused =
    a human-readable reason), `readImageAsDataUrl(file): Promise<string>` (FileReader,
    validated `data:<type>;base64,` prefix).
  - `Composer.tsx`: `editorProps.handlePaste(view, event)` → `pickPastedImage(event.
    clipboardData)`; `null` → `false`; refused → show the notice (the composer's existing
    error surface, or `console.warn` + a transient toast if none) and `true`; a file →
    read, `editor.chain().focus().setImage({ src }).run()`, `true`.
- **Decision & alternatives** — (a) `handlePaste` + the existing base64 image node + the
  existing CID extraction: smallest change, one boundary. (b) Attach the pasted file as a
  regular attachment: not what the reporter asked (inline in the flow of the text). (c)
  Upload to a host and link: no. (a).
- **Failure modes** — a wrong allow-list check lets an SVG through: REQ-2.2's test. A huge
  paste: the cap. A read error: the notice, nothing inserted.

## Tasks (risk-first)
- [ ] 1. `pasteImage.test.ts` red: picks a PNG file item; ignores a text-only paste (null);
  prefers the file over text; refuses SVG and a 5 MiB + 1 file with the right reasons; reads
  a small Blob to a `data:image/png;base64,` URL. Then the helper. — REQ-1.1–1.3, 2.1–2.3
- [ ] 2. `emailBuilder.test.ts`: a body with a pasted data-URL `<img>` yields a
  `multipart/related` with the CID part and `src="cid:…"`. — REQ-3
- [ ] 3. The composer wiring and notice. — REQ-1.1
- [ ] 4. LOG.md; vault row 13; help card ("paste a screenshot"); HANDOFF pin after merge.

## Done when
`npm run test` green with the new cases; `tsc`, `graph:check`, `docs:check` green; CI green
on the merge commit. Manual, optional (needs the running app): copy a screenshot, paste into
a new message — it appears inline; send to yourself — it renders in the received mail.

## Rollback
`git revert`; a draft that already holds a pasted image keeps working (the node and the
builder are pre-existing).

## Review
One independent leg (Tier 1): Gemini 3.7 via `agy`, diff from committed SHAs.

## Approval
Jim, 2026-09-03: *"Then #281 (paste inline images in the composer, Tier 1)"*. The plan is
this file, committed before the code.
