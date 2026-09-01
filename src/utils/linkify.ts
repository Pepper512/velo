/**
 * Turn URLs in an ALREADY-HTML-ESCAPED plain-text body into anchors (SPEC-F-2 REQ-1).
 *
 * The input must have gone through `escapeHtml` first, so it contains no raw
 * `<`, `>` or `"` — only `&lt;`, `&gt;`, `&quot;` and `&amp;`. That is what makes
 * emitting `<a href="…">…</a>` around a match safe: the href is text that was
 * already on screen, and it cannot close the attribute or open a tag. The
 * function never un-escapes anything (NFR-1).
 *
 * Only `http://`, `https://` and `mailto:` are recognised (REQ-1.2); anything
 * else — `javascript:`, `data:`, bare domains — stays inert text.
 */

const URL_START = /\b((?:https?:\/\/|mailto:)\S+)/gi;

/** An escaped-entity that cannot belong to a URL: it marks where the URL ends. */
const ENTITY_CUT = /&(?:lt|gt|quot|#39);/i;

/** Sentence punctuation that trails a URL rather than belonging to it (REQ-1.3). */
const TRAILING_PUNCT = /[.,;:!?)\]'"]+$/;

function splitTrailing(raw: string): { url: string; rest: string } {
  let url = raw;
  let rest = "";

  const cut = url.search(ENTITY_CUT);
  if (cut >= 0) {
    rest = url.slice(cut);
    url = url.slice(0, cut);
  }

  const punct = TRAILING_PUNCT.exec(url);
  if (punct) {
    rest = punct[0] + rest;
    url = url.slice(0, -punct[0].length);
  }

  return { url, rest };
}

export function linkifyEscapedText(escaped: string): string {
  if (!escaped) return escaped;
  return escaped.replace(URL_START, (raw: string) => {
    const { url, rest } = splitTrailing(raw);
    if (!url) return raw;
    return `<a href="${url}">${url}</a>${rest}`;
  });
}
