## Verdict

**APPROVE WITH NITS**

The architecture is clean, minimal, and correctly builds on existing TipTap and `emailBuilder` infrastructure. The boundary checks are well-isolated in a pure helper. Addressing the state-coupling in the error notice and adding async view guards will make the implementation robust.

---

## Numbered Findings

### 1. Reusing `setSaveError` for paste notices causes race conditions with auto-save
* **Severity:** MEDIUM
* **File & Function:** `src/components/composer/Composer.tsx` (`handlePaste`)
* **Concern:** Reusing `useComposerStore.getState().setSaveError` couples transient user input validation with draft persistence state.
* **Exact Scenario:**
  1. A user pastes an invalid/oversized image; `setSaveError("Pasted images must be under 5 MB...")` is set with a 5-second clear timer.
  2. 2 seconds later, the background draft auto-save timer triggers, succeeds, and calls `setSaveError(null)`, prematurely wiping out the user's notification.
  3. Conversely, if a real draft persistence error exists in `saveError`, pasting an invalid file overwrites the real error message, and the 5-second `setTimeout` unconditionally clears `saveError`, hiding the failure to save from the user.
* **Consequence:** Error notices disappear unpredictably or mask critical draft save failures.
* **Fix:** Introduce a dedicated transient notification state in `composerStore` (or a local state/toast handler) with its own timer cleanup:
  ```ts
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  // or a dedicated store action: setTransientNotice(msg, durationMs)
  ```

---

### 2. Async dispatch after `readImageAsDataUrl` ignores view destruction and selection movement
* **Severity:** LOW
* **File & Function:** `src/components/composer/Composer.tsx` (`handlePaste`)
* **Concern:** `readImageAsDataUrl` is asynchronous; dispatching transactions directly against `view` in `.then()` without checking view lifecycle or capturing the selection can lead to misplaced insertion or errors on unmount.
* **Exact Scenario:**
  1. The user pastes a ~5 MiB image (FileReader takes ~20–50ms to convert to base64).
  2. While the read is pending, the user clicks into another paragraph or immediately closes/cancels the composer.
  3. When the promise resolves, `view.dispatch(view.state.tr.replaceSelectionWith(node))` executes at the *new* selection location, or throws if the ProseMirror view was destroyed.
* **Consequence:** Images can be inserted at unexpected cursor locations or log unhandled errors on rapid component teardown.
* **Fix:** Capture the selection/position at paste time or guard against view destruction:
  ```ts
  if (view.isDestroyed) return;
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  ```

---

### 3. MIME type checking is case-sensitive and lacks magic-byte sniffing
* **Severity:** LOW
* **File & Function:** `src/components/composer/pasteImage.ts` (`pickPastedImage`)
* **Concern:** `file.type` is matched with exact case (`INLINE_IMAGE_TYPES.has(file.type)`) and trusts the declared clipboard MIME type without validating file header signatures.
* **Exact Scenario:**
  1. An operating system or clipboard tool emits `image/PNG` or `IMAGE/JPEG`.
  2. `INLINE_IMAGE_TYPES.has("image/PNG")` evaluates to `false`, and the paste is refused.
  3. Alternatively, a file named `payload.png` containing raw SVG or text with `file.type === "image/png"` passes the allow-list and gets embedded as a data URL. (While modern browser `<img>` rendering context prevents script execution inside image tags, it will produce a broken image and downstream CID attachment).
* **Consequence:** Legitimate screenshots with uppercase MIME types are rejected; spoofed files can enter the document as broken CID parts.
* **Fix:** Normalize case with `file.type.toLowerCase()` and optionally check the first 4–8 magic bytes (`89 50 4E 47` for PNG, `FF D8 FF` for JPEG, `47 49 46 38` for GIF, `52 49 46 46` for WebP) before generating the data URL.

---

### 4. Missing test coverage for `FileReader` error handling and unsupported non-image files
* **Severity:** NIT
* **File & Function:** `src/components/composer/pasteImage.test.ts`
* **Concern:** Several error and boundary branches in `pasteImage.ts` have no unit tests.
* **Exact Scenario:**
  1. A non-image file (e.g. `application/pdf`) is on the clipboard: `pickPastedImage` returns `null` (falling through to default paste), but no test verifies that non-image files are ignored rather than refused.
  2. `readImageAsDataUrl` encounters a read error (triggering `reader.onerror`) or mismatched data URL prefix, but the rejection branch is untested.
* **Consequence:** Regressions in file filtering or error handling could pass CI.
* **Fix:** Add tests in `pasteImage.test.ts` for:
  - Non-image files (e.g. `new File(["..."], "doc.pdf", { type: "application/pdf" })`) returning `null`.
  - Uppercase MIME types (e.g. `image/PNG`) resolving correctly.
  - `readImageAsDataUrl` rejecting when reading invalid blobs or on simulated reader errors.

---

## Specific Review Questions Addressed

1. **Security of the Boundary:**
   - *Content-type spoofing:* If a file is labeled `image/png` but contains SVG/HTML, TipTap renders `<img src="data:image/png;base64,...">`. In modern web engines, `<img>` tags execute neither scripts nor SVG `<script>` payloads. The outgoing builder ships it as a CID part with `Content-Type: image/png`. When received, mail clients render it via `<img>` tags, maintaining execution isolation.
   - *Magic number sniffing:* Not strictly required for XSS mitigation due to `<img>` context constraints, but recommended as defense-in-depth to reject non-raster polyglots or corrupt files early.
   - *Builder Regex (`src="data:([^;]+);base64,([^"]+)"`):* `readImageAsDataUrl` strictly guarantees the format `data:${file.type};base64,...` without parameters. `alt` attributes containing quotes are escaped by ProseMirror's DOM serializer and will not break the regex match.

2. **The Paste Path:**
   - *Synchronous `preventDefault()` before async read:* Correct pattern for ProseMirror paste interception. For typical screenshots (<2 MiB), `readAsDataURL` resolves within ~10–30ms; the UI appears responsive without visible stutter.
   - *Selection & Context:* `replaceSelectionWith` replaces whatever selection is active when the promise resolves. If pasted inside a block that forbids inline images (e.g., a code block), ProseMirror's schema rules will split the block or drop invalid nodes. Adding `view.isDestroyed` checking prevents dangling dispatch calls.

3. **Size and Memory:**
   - 5 MiB binary produces ~6.67 MiB of base64 text.
   - In TipTap, document nodes use structural sharing in memory. However, `getHTML()` during the 3-second draft auto-save will allocate a ~7 MB string and pass it across the Tauri IPC boundary to SQLite. While within acceptable desktop resource limits, keeping the 5 MiB ceiling is critical to prevent IPC lag.

4. **The Notice:**
   - Reusing `setSaveError` creates a clear lifecycle collision with draft auto-save (as detailed in Finding #1). It should be separated into a distinct feedback channel.

5. **The Tests:**
   - Existing tests correctly verify the positive PNG case, size cap, allow-list rejection, and CID transformation.
   - Missing concrete cases: non-image file clipboard pass-through (`application/pdf` -> `null`), uppercase MIME types (`image/JPEG`), and `readImageAsDataUrl` rejection on read failure.

---

## Questions

1. Should pasting a non-image file (e.g. dragging vs copying a PDF) fall through silently to default paste, or should it trigger an explicit notice directing the user to use the attachment button (similar to the drop handler)?
2. Is there an existing toast system in Velo (e.g., `uiStore.showToast`) that can display the 5-second refusal notice instead of using the composer status line?

---

## What is Good

- **Clean separation:** `pasteImage.ts` is pure, framework-independent, and easily testable without mounting DOM or ProseMirror instances.
- **Strict allow-list:** Explicitly rejecting SVG (`image/svg+xml`) prevents cross-client rendering inconsistencies and script injection risks.
- **Zero new dependencies:** Leverages existing `@tiptap/extension-image` and `emailBuilder` CID pipeline without adding third-party packages.
- **Accurate spec adherence:** Follows SPEC-281 requirements, adheres to the 5 MiB cap, and maintains updated test counts and documentation.
