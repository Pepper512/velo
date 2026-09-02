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

  // Case-insensitive: some platforms emit `image/PNG` (#69 review, Gemini L3).
  if (!INLINE_IMAGE_TYPES.has(file.type.toLowerCase())) {
    return { kind: "refused", reason: "Only PNG, JPEG, GIF or WebP images can be pasted inline." };
  }
  if (file.size > MAX_INLINE_IMAGE_BYTES) {
    const mb = Math.round(MAX_INLINE_IMAGE_BYTES / (1024 * 1024));
    return { kind: "refused", reason: `Pasted images must be under ${mb} MB — add it as an attachment instead.` };
  }
  return { kind: "image", file };
}

/**
 * The bytes a real file of each admitted type starts with. A declared type is
 * a label anyone can set; the bytes are what the receiving client will decode
 * (#69 review, Gemini L3 — defence in depth: `<img>` executes nothing, but a
 * mislabelled payload has no business becoming a `cid:` part).
 */
const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  // RIFF....WEBP
  "image/webp": (b) =>
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

/** The first bytes of a file, via FileReader (present in every webview and in jsdom). */
function readHead(file: File, bytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the pasted image."));
    reader.onload = () => {
      const result = reader.result;
      resolve(result instanceof ArrayBuffer ? new Uint8Array(result) : new Uint8Array());
    };
    reader.readAsArrayBuffer(file.slice(0, bytes));
  });
}

/** Does the file start the way its declared type must? */
export async function bytesMatchType(file: File): Promise<boolean> {
  const check = MAGIC[file.type.toLowerCase()];
  if (!check) return false;
  const head = await readHead(file, 12);
  return head.length >= 3 && check(head);
}

/**
 * Read an admitted file to a `data:<type>;base64,…` URL the image node accepts.
 * Rejects when the bytes do not match the declared type, when the reader fails,
 * or when the result is not the exact `data:<type>;base64,` shape the outgoing
 * builder's extractor expects.
 */
export async function readImageAsDataUrl(file: File): Promise<string> {
  const type = file.type.toLowerCase();
  if (!(await bytesMatchType(file))) {
    throw new Error("The pasted file is not the image type it claims to be.");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the pasted image."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || !result.toLowerCase().startsWith(`data:${type};base64,`)) {
        reject(new Error("Could not read the pasted image."));
        return;
      }
      // Normalise the type to lower case so the extractor's `Content-Type` is canonical.
      resolve(`data:${type};base64,${result.slice(result.indexOf(",") + 1)}`);
    };
    reader.readAsDataURL(file);
  });
}
