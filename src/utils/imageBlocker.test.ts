import { describe, it, expect } from "vitest";
import { stripRemoteImages, restoreRemoteImages, hasBlockedImages } from "./imageBlocker";

describe("stripRemoteImages", () => {
  it("blocks remote http images", () => {
    const html = '<img src="http://tracker.example.com/pixel.gif" />';
    const result = stripRemoteImages(html);
    expect(result).toContain('data-blocked-src="http://tracker.example.com/pixel.gif"');
    // The original src should be replaced with empty string
    expect(result).toContain('src=""');
    // Make sure original src= with URL is gone (not counting the data-blocked-src)
    expect(result.replace(/data-blocked-src="[^"]*"/g, "")).not.toContain('src="http://');
  });

  it("blocks remote https images", () => {
    const html = '<img src="https://cdn.example.com/image.png" alt="photo" />';
    const result = stripRemoteImages(html);
    expect(result).toContain('data-blocked-src="https://cdn.example.com/image.png"');
  });

  it("preserves data: URIs", () => {
    // Asserts the src VALUE, not the serialised string: blocking is now
    // DOM-based (audit P9), so HTML is normalised on the round trip -- `/>`
    // becomes `>` and single quotes become double. Both are the same document.
    const result = stripRemoteImages('<img src="data:image/png;base64,iVBOR..." />');
    expect(result).toContain('src="data:image/png;base64,iVBOR..."');
    expect(result).not.toContain("data-blocked-src");
  });

  it("preserves cid: URIs", () => {
    const result = stripRemoteImages('<img src="cid:image001@example.com" />');
    expect(result).toContain('src="cid:image001@example.com"');
    expect(result).not.toContain("data-blocked-src");
  });

  it("handles multiple images", () => {
    const html = '<img src="https://a.com/1.png" /><img src="https://b.com/2.png" />';
    const result = stripRemoteImages(html);
    expect(result).toContain('data-blocked-src="https://a.com/1.png"');
    expect(result).toContain('data-blocked-src="https://b.com/2.png"');
  });

  it("handles single-quoted src", () => {
    const result = stripRemoteImages("<img src='https://cdn.example.com/img.jpg' />");
    // Quote style is normalised by serialisation; the value is what matters.
    expect(result).toContain('data-blocked-src="https://cdn.example.com/img.jpg"');
    expect(result).toContain('src=""');
  });

  it("handles HTML with no images", () => {
    const html = "<p>Hello world</p>";
    const result = stripRemoteImages(html);
    expect(result).toBe(html);
  });

  it("strips url() in inline CSS", () => {
    const html = '<div style="background-image: url(https://tracker.com/bg.png)">text</div>';
    const result = stripRemoteImages(html);
    expect(result).not.toContain("https://tracker.com/bg.png");
  });
});

describe("restoreRemoteImages", () => {
  it("restores blocked images", () => {
    const original = '<img src="https://cdn.example.com/image.png" alt="photo" />';
    const blocked = stripRemoteImages(original);
    const restored = restoreRemoteImages(blocked);
    expect(restored).toContain('src="https://cdn.example.com/image.png"');
    expect(restored).not.toContain("data-blocked-src");
  });

  it("handles HTML with no blocked images", () => {
    const result = restoreRemoteImages('<img src="data:image/png;base64,abc" />');
    expect(result).toContain('src="data:image/png;base64,abc"');
  });
});

describe("hasBlockedImages", () => {
  it("returns true when blocked images exist", () => {
    const html = '<img data-blocked-src="https://cdn.example.com/img.png" src="" />';
    expect(hasBlockedImages(html)).toBe(true);
  });

  it("returns false when no blocked images", () => {
    const html = '<img src="https://cdn.example.com/img.png" />';
    expect(hasBlockedImages(html)).toBe(false);
  });

  it("returns false for empty HTML", () => {
    expect(hasBlockedImages("")).toBe(false);
  });

  it("returns false for data-blocked-src with data: URI", () => {
    const html = '<img data-blocked-src="data:image/png;base64,abc" />';
    expect(hasBlockedImages(html)).toBe(false);
  });
});
