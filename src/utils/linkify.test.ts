import { describe, it, expect } from "vitest";
import { linkifyEscapedText } from "./linkify";

/**
 * SPEC-F-2 REQ-1: URLs in plain-text bodies become anchors. Input is ALREADY
 * HTML-escaped (`escapeHtml` runs first), so `&` arrives as `&amp;` and `"` as
 * `&quot;`; the linkifier must never un-escape anything.
 */
describe("linkifyEscapedText", () => {
  it("wraps an https URL in an anchor whose href and text are the URL", () => {
    expect(linkifyEscapedText("see https://example.com/path now")).toBe(
      'see <a href="https://example.com/path">https://example.com/path</a> now',
    );
  });

  it("wraps http and mailto URLs", () => {
    expect(linkifyEscapedText("http://a.test/x")).toBe(
      '<a href="http://a.test/x">http://a.test/x</a>',
    );
    expect(linkifyEscapedText("write mailto:bob@example.com today")).toBe(
      'write <a href="mailto:bob@example.com">mailto:bob@example.com</a> today',
    );
  });

  it("matches an uppercase scheme", () => {
    expect(linkifyEscapedText("HTTP://Example.com/A")).toBe(
      '<a href="HTTP://Example.com/A">HTTP://Example.com/A</a>',
    );
  });

  it("leaves trailing sentence punctuation outside the anchor (REQ-1.3)", () => {
    expect(linkifyEscapedText("Go to https://example.com/a?b=1&amp;c=2.")).toBe(
      'Go to <a href="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a>.',
    );
    expect(linkifyEscapedText("(https://example.com/a)")).toBe(
      '(<a href="https://example.com/a">https://example.com/a</a>)',
    );
    expect(linkifyEscapedText("&lt;https://example.com/a&gt;")).toBe(
      '&lt;<a href="https://example.com/a">https://example.com/a</a>&gt;',
    );
  });

  it("keeps a URL wrapped in escaped quotes intact", () => {
    expect(linkifyEscapedText("&quot;https://example.com/a&quot;")).toBe(
      '&quot;<a href="https://example.com/a">https://example.com/a</a>&quot;',
    );
  });

  it("preserves &amp; inside a URL and never un-escapes (NFR-1)", () => {
    const out = linkifyEscapedText("https://x.test/?a=1&amp;b=2");
    expect(out).toBe('<a href="https://x.test/?a=1&amp;b=2">https://x.test/?a=1&amp;b=2</a>');
    expect(out).not.toContain("&b=");
  });

  it("does not linkify javascript:, data: or bare domains (REQ-1.2)", () => {
    expect(linkifyEscapedText("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(linkifyEscapedText("data:text/html,x")).toBe("data:text/html,x");
    expect(linkifyEscapedText("visit example.com today")).toBe("visit example.com today");
  });

  it("leaves already-escaped markup untouched", () => {
    const escaped = "&lt;a href=&quot;https://evil.test&quot;&gt;x&lt;/a&gt;";
    expect(linkifyEscapedText(escaped)).toBe(
      '&lt;a href=&quot;<a href="https://evil.test">https://evil.test</a>&quot;&gt;x&lt;/a&gt;',
    );
  });

  it("handles several URLs and multi-line text", () => {
    expect(linkifyEscapedText("a https://one.test\nb https://two.test/x, c")).toBe(
      'a <a href="https://one.test">https://one.test</a>\nb <a href="https://two.test/x">https://two.test/x</a>, c',
    );
  });

  it("returns empty input unchanged", () => {
    expect(linkifyEscapedText("")).toBe("");
  });
});
