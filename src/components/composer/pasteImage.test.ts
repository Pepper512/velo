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

describe("pickPastedImage — non-image files and odd casing (#69 review)", () => {
  it("ignores a non-image file so the default paste runs (a PDF is not a refusal)", () => {
    const pdf = new File(["%PDF-1.4"], "doc.pdf", { type: "application/pdf" });
    expect(pickPastedImage(transfer({ files: [pdf] }))).toBeNull();
  });

  it("admits an upper-case declared type", () => {
    const file = new File([new Uint8Array(4)], "SHOT.PNG", { type: "image/PNG" });
    expect(pickPastedImage(transfer({ files: [file] }))).toEqual({ kind: "image", file });
  });
});

describe("readImageAsDataUrl (SPEC-281 REQ-2.3)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("reads a real PNG to a data URL carrying the file's own type", async () => {
    const url = await readImageAsDataUrl(new File([PNG], "shot.png", { type: "image/png" }));
    expect(url).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("lower-cases an upper-case declared type in the URL", async () => {
    const url = await readImageAsDataUrl(new File([PNG], "shot.png", { type: "image/PNG" }));
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects a file whose bytes are not its declared type (a spoofed label, #69 L3)", async () => {
    const svgAsPng = new File(["<svg onload=alert(1)></svg>"], "x.png", { type: "image/png" });
    await expect(readImageAsDataUrl(svgAsPng)).rejects.toThrow(/not the image type it claims/);
    const htmlAsJpeg = new File(["<html>"], "x.jpg", { type: "image/jpeg" });
    await expect(readImageAsDataUrl(htmlAsJpeg)).rejects.toThrow(/not the image type/);
  });

  it.each([
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0]],
    ["image/gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
  ] as const)("accepts a real %s by its magic bytes", async (type, head) => {
    const url = await readImageAsDataUrl(new File([new Uint8Array(head)], "x", { type }));
    expect(url.startsWith(`data:${type};base64,`)).toBe(true);
  });

  it("rejects an empty or truncated file", async () => {
    await expect(readImageAsDataUrl(new File([], "empty.png", { type: "image/png" }))).rejects.toThrow();
    await expect(readImageAsDataUrl(new File([new Uint8Array([0x89])], "t.png", { type: "image/png" }))).rejects.toThrow();
  });
});
