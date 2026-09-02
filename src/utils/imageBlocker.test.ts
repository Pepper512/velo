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

  // SPEC-197 (Gemini H1 on #60): once img-src allows https:, everything the
  // block relies on must be the blocker's. SVG href fetches on render.
  it("strips a remote href on SVG image and use, which fetch on render", () => {
    const html =
      '<svg><image href="https://tracker.com/px.png"/><use href="https://tracker.com/s.svg#i"/><image xlink:href="https://tracker.com/x.png"/></svg>';
    const result = stripRemoteImages(html);
    expect(result).not.toContain("tracker.com");
  });

  it("leaves a link's href alone — a link fetches on click, not on render", () => {
    const html = '<a href="https://example.com/read">Read</a><area href="https://example.com/a">';
    const result = stripRemoteImages(html);
    expect(result).toContain('href="https://example.com/read"');
    expect(result).toContain('href="https://example.com/a"');
  });

  it("still neutralises the other on-render image vectors the review named", () => {
    const html =
      '<img srcset="https://t.com/p.png 1x" src="https://t.com/p.png">' +
      '<picture><source srcset="https://t.com/s.png"><img src="https://t.com/i.png"></picture>' +
      '<video poster="https://t.com/v.png"></video>' +
      '<input type="image" src="https://t.com/b.png">' +
      '<table background="https://t.com/bg.png"><tr><td>x</td></tr></table>' +
      '<div style="background: image-set(\'https://t.com/is.png\' 1x)">y</div>';
    const result = stripRemoteImages(html);
    // Attribute names at a word boundary, so `data-blocked-src` is not counted as `src`.
    expect(result).not.toMatch(/(?:^|\s)(?:src|srcset|poster|background)="https?:/);
    expect(result).not.toContain("https://t.com/is.png");
    // Every <img>/<input> src became a restorable data-blocked-src.
    expect(result.match(/data-blocked-src="https:\/\/t\.com/g)).toHaveLength(3);
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
