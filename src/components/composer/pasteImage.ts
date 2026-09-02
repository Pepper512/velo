/**
 * An image on the clipboard, pasted into the composer (SPEC-281).
 *
 * The clipboard is untrusted input. This helper is the boundary: it picks an
 * image *file* off a paste, admits only the types every mail client renders,
 * caps the size, and builds the `data:` URL from the file's own bytes. The
 * editor's image node (`allowBase64`) shows it; `emailBuilder` turns it into a
 * `cid:` part on send — both existed before this module.
 */

/** Types every mail client renders inline. SVG is refused: it can carry script. */
export const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** A screenshot is well under this; a 20 MB photo has no place in a mail body. */
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

export type PastedImage =
  | { kind: "image"; file: File }
  | { kind: "refused"; reason: string };

/**
 * The image file on a paste, if there is one.
 *
 * `null` when the clipboard carries no image file — the editor's default paste
 * (text, HTML) should run. When an app puts both HTML and the file on the
 * clipboard, the file wins: that is what "paste a screenshot" means.
 */
export function pickPastedImage(data: DataTransfer | null | undefined): PastedImage | null {
  if (!data) return null;
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && file.type.startsWith("image/")) files.push(file);
  }
  // Some platforms expose files only on `files`.
  if (files.length === 0) {
    for (const file of Array.from(data.files ?? [])) {
      if (file.type.startsWith("image/")) files.push(file);
    }
  }
  const file = files[0];
  if (!file) return null;

  if (!INLINE_IMAGE_TYPES.has(file.type)) {
    return { kind: "refused", reason: "Only PNG, JPEG, GIF or WebP images can be pasted inline." };
  }
  if (file.size > MAX_INLINE_IMAGE_BYTES) {
    const mb = Math.round(MAX_INLINE_IMAGE_BYTES / (1024 * 1024));
    return { kind: "refused", reason: `Pasted images must be under ${mb} MB — add it as an attachment instead.` };
  }
  return { kind: "image", file };
}

/** Read an admitted file to a `data:<type>;base64,…` URL the image node accepts. */
export function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the pasted image."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || !result.startsWith(`data:${file.type};base64,`)) {
        reject(new Error("Could not read the pasted image."));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}
