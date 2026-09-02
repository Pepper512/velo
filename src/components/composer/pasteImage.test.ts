import { describe, it, expect } from "vitest";
import { INLINE_IMAGE_TYPES, MAX_INLINE_IMAGE_BYTES, pickPastedImage, readImageAsDataUrl } from "./pasteImage";

/** A DataTransfer-shaped object: jsdom has no clipboard, so the shape is built by hand. */
function transfer(opts: { files?: File[]; text?: string }): DataTransfer {
  const files = opts.files ?? [];
  const items: DataTransferItem[] = [
    ...(opts.text !== undefined
      ? [{ kind: "string", type: "text/plain", getAsFile: () => null } as unknown as DataTransferItem]
      : []),
    ...files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file }) as unknown as DataTransferItem),
  ];
  return {
    items: items as unknown as DataTransferItemList,
    files: files as unknown as FileList,
    types: [...(opts.text !== undefined ? ["text/plain"] : []), ...(files.length ? ["Files"] : [])],
  } as unknown as DataTransfer;
}

const png = (size = 8, name = "shot.png") => new File([new Uint8Array(size)], name, { type: "image/png" });

describe("pickPastedImage (SPEC-281)", () => {
  it("returns null for a text-only paste so the editor's default handling runs (REQ-1.2)", () => {
    expect(pickPastedImage(transfer({ text: "hello" }))).toBeNull();
    expect(pickPastedImage(null)).toBeNull();
    expect(pickPastedImage(transfer({}))).toBeNull();
  });

  it("picks a PNG screenshot (REQ-1.1)", () => {
    const file = png();
    expect(pickPastedImage(transfer({ files: [file] }))).toEqual({ kind: "image", file });
  });

  it("prefers the image file when text/HTML travels with it (REQ-1.3)", () => {
    const file = png();
    expect(pickPastedImage(transfer({ text: "<img>", files: [file] }))).toEqual({ kind: "image", file });
  });

  it.each(["image/jpeg", "image/gif", "image/webp"])("admits %s", (type) => {
    const file = new File([new Uint8Array(4)], "x", { type });
    expect(pickPastedImage(transfer({ files: [file] }))).toEqual({ kind: "image", file });
    expect(INLINE_IMAGE_TYPES.has(type)).toBe(true);
  });

  it("refuses SVG and other image types with the reason (REQ-2.2)", () => {
    const svg = new File(["<svg onload=alert(1)/>"], "x.svg", { type: "image/svg+xml" });
    const out = pickPastedImage(transfer({ files: [svg] }));
    expect(out).toEqual({ kind: "refused", reason: expect.stringContaining("PNG, JPEG, GIF or WebP") });
    const bmp = new File([new Uint8Array(4)], "x.bmp", { type: "image/bmp" });
    expect(pickPastedImage(transfer({ files: [bmp] }))?.kind).toBe("refused");
  });

  it("refuses an image over the cap and names the limit (REQ-2.1)", () => {
    const big = png(MAX_INLINE_IMAGE_BYTES + 1);
    const out = pickPastedImage(transfer({ files: [big] }));
    expect(out).toEqual({ kind: "refused", reason: expect.stringContaining("5 MB") });
    const atCap = png(MAX_INLINE_IMAGE_BYTES);
    expect(pickPastedImage(transfer({ files: [atCap] }))?.kind).toBe("image");
  });

  it("falls back to `files` when `items` is absent", () => {
    const file = png();
    const data = { items: undefined, files: [file] } as unknown as DataTransfer;
    expect(pickPastedImage(data)).toEqual({ kind: "image", file });
  });
});

describe("readImageAsDataUrl (SPEC-281 REQ-2.3)", () => {
  it("reads the file to a data URL carrying the file's own type", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const url = await readImageAsDataUrl(new File([bytes], "shot.png", { type: "image/png" }));
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(url).toBe("data:image/png;base64,iVBORw==");
  });
});
