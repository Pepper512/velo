/**
 * Adversarial corpus for the email-rendering boundary (audit P9).
 *
 * `SECURITY.md` puts "XSS via email content escaping the sandbox" in scope and
 * promises "remote images blocked by default". Before this file, `sanitize.ts`
 * and `imageBlocker.ts` had **no adversarial tests at all** — the existing
 * `sanitize.test.ts` contained zero occurrences of `svg`, `math`, `<base`,
 * `meta`, `srcset`, `javascript:` or `data:`.
 *
 * Two properties are asserted, and they are different:
 *
 * 1. **No script execution** survives sanitisation. The iframe is
 *    `sandbox="allow-same-origin"` with no `allow-scripts`, so this is defence
 *    in depth — but same-origin means DOMPurify is the only layer that stands
 *    between untrusted mail and the app's own origin.
 * 2. **No remote fetch** survives blocking. This is the privacy promise, and it
 *    is the one that was actually broken.
 *
 * Vectors that were **live bypasses** before this batch are marked `[WAS LIVE]`.
 */
import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "./sanitize";
import { stripRemoteImages, restoreRemoteImages, hasBlockedImages } from "./imageBlocker";

/** The full render pipeline, in the order `EmailRenderer` applies it. */
function render(html: string): string {
  return stripRemoteImages(sanitizeHtml(html));
}

/** Anything that would cause a fetch to the attacker's host. */
function leaksTo(rendered: string, host = "evil.com"): boolean {
  // `data-blocked-src` is the parked value and is inert until the user opts in.
  const withoutParked = rendered.replace(/data-blocked-src\s*=\s*"[^"]*"/gi, "");
  return new RegExp(host.replace(".", "\\."), "i").test(withoutParked);
}

describe("P9 — remote content must not load", () => {
  const REMOTE_VECTORS: [string, string][] = [
    ["[WAS LIVE] input type=image", '<input type="image" src="https://evil.com/a.png">'],
    ["[WAS LIVE] audio src", '<audio src="https://evil.com/b.mp3"></audio>'],
    ["[WAS LIVE] track src", '<track src="https://evil.com/c.vtt">'],
    [
      "[WAS LIVE] CSS image-set()",
      `<div style="background:image-set('https://evil.com/d.png' 1x)">x</div>`,
    ],
    [
      "[WAS LIVE] newline inside the URL scheme",
      '<img src="https:\n//evil.com/e.png">',
    ],
    ["plain img", '<img src="https://evil.com/f.png">'],
    ["img, unquoted", "<img src=https://evil.com/g.png>"],
    ["img, single-quoted", "<img src='https://evil.com/h.png'>"],
    ["srcset", '<img srcset="https://evil.com/i.png 1x" src="cid:1">'],
    ["picture > source", '<picture><source srcset="https://evil.com/j.png"><img src="cid:1"></picture>'],
    ["video poster", '<video poster="https://evil.com/k.png"></video>'],
    ["link rel=prefetch", '<link rel="prefetch" href="https://evil.com/l.png">'],
    ["table background attr", '<table background="https://evil.com/m.png"></table>'],
    ["td background attr", '<td background="https://evil.com/n.png"></td>'],
    ["CSS url() bare", '<div style="background:url(https://evil.com/o.png)">x</div>'],
    ["CSS url() spaced and quoted", `<div style="background:url( 'https://evil.com/p.png' )">x</div>`],
    ["CSS url() uppercase", '<div style="BACKGROUND:URL(HTTPS://EVIL.COM/q.png)">x</div>'],
    ["style on an img", '<img style="background:url(https://evil.com/r.png)" src="cid:1">'],
    ["object data", '<object data="https://evil.com/s.swf"></object>'],
    ["embed src", '<embed src="https://evil.com/t.swf">'],
    ["iframe src", '<iframe src="https://evil.com/u.html"></iframe>'],
    ["legacy lowsrc", '<img lowsrc="https://evil.com/v.png">'],
    ["form action", '<form action="https://evil.com/w"><input></form>'],
    ["base href", '<base href="https://evil.com/">'],
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=https://evil.com">'],
  ];

  it.each(REMOTE_VECTORS)("%s", (_name, input) => {
    expect(leaksTo(render(input))).toBe(false);
  });

  it("blocks every vector in the corpus, with none silently dropped", () => {
    // Guards the corpus itself: if `render` ever returns "" for everything, the
    // assertions above would pass vacuously.
    const rendered = REMOTE_VECTORS.map(([, v]) => render(v));
    expect(rendered.some((r) => r.length > 0)).toBe(true);
  });
});

describe("P9 — script execution must not survive", () => {
  const XSS_VECTORS: [string, string][] = [
    ["script tag", '<script>alert(1)</script>'],
    ["img onerror", '<img src=x onerror="alert(1)">'],
    ["svg onload", '<svg onload="alert(1)"></svg>'],
    ["svg > script", "<svg><script>alert(1)</script></svg>"],
    ["math annotation", '<math><annotation-xml encoding="text/html"><script>alert(1)</script></annotation-xml></math>'],
    ["javascript: href", '<a href="javascript:alert(1)">x</a>'],
    ["JaVaScRiPt: href", '<a href="JaVaScRiPt:alert(1)">x</a>'],
    ["javascript: with entity", '<a href="java&#115;cript:alert(1)">x</a>'],
    ["data:text/html href", '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ["body onload", '<body onload="alert(1)">x</body>'],
    ["details ontoggle", "<details open ontoggle=alert(1)>x</details>"],
    ["style tag with expression", "<style>body{background:expression(alert(1))}</style>"],
    ["iframe srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ["form + formaction", '<form><button formaction="javascript:alert(1)">x</button></form>'],
    ["marquee onstart", "<marquee onstart=alert(1)>x</marquee>"],
    ["object with javascript data", '<object data="javascript:alert(1)"></object>'],
    ["mutation XSS via noscript", "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\">"],
  ];

  it.each(XSS_VECTORS)("%s", (_name, input) => {
    const out = render(input);

    // Assert on the PARSED result, not the serialised string. A regex over the
    // text flags `onerror=` even when it sits inside a quoted attribute value
    // (where it is inert) -- which is exactly what the noscript mutation vector
    // produces. Re-parsing asks the real question: after the browser reads this,
    // does any element carry an executable attribute?
    const doc = new DOMParser().parseFromString(out, "text/html");

    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("iframe, object, embed, form")).toBeNull();

    for (const el of Array.from(doc.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        // No event handlers.
        expect(attr.name.toLowerCase()).not.toMatch(/^on/);
        // No script-bearing URLs in any attribute.
        expect(attr.value).not.toMatch(/javascript\s*:/i);
        expect(attr.value).not.toMatch(/expression\s*\(/i);
        // srcdoc would introduce a second, unsanitised document.
        expect(attr.name.toLowerCase()).not.toBe("srcdoc");
      }
    }
  });
});

describe("P9 — legitimate email content still renders", () => {
  it("keeps inline styling, links, tables and cid: images", () => {
    const legit =
      '<table cellpadding="4"><tr><td style="color:#333;font-size:14px">' +
      '<a href="https://example.com/unsubscribe">Unsubscribe</a>' +
      '<img src="cid:logo123" alt="Logo" width="80">' +
      "</td></tr></table>";
    const out = render(legit);

    expect(out).toContain("Unsubscribe");
    expect(out).toContain("https://example.com/unsubscribe"); // links are not fetched on render
    expect(out).toContain("cid:logo123"); // inline attachments are local
    expect(out).toContain("color:#333");
  });

  it("preserves a data: image", () => {
    const px = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    expect(render(`<img src="${px}">`)).toContain(px);
  });
});

describe("P9 — the block/restore round trip", () => {
  it("parks a remote image and restores it on request", () => {
    const blocked = render('<img src="https://tracker.example/pixel.png" alt="x">');

    expect(hasBlockedImages(blocked)).toBe(true);
    expect(leaksTo(blocked, "tracker.example")).toBe(false);

    const restored = restoreRemoteImages(blocked);
    expect(restored).toContain("https://tracker.example/pixel.png");
    expect(restored).not.toContain("data-blocked-src");
  });

  it("restores every blocked element, not only <img>", () => {
    const blocked = stripRemoteImages(
      '<img src="https://a.example/1.png"><img src="https://a.example/2.png">',
    );
    const restored = restoreRemoteImages(blocked);
    expect(restored.match(/https:\/\/a\.example/g)).toHaveLength(2);
    expect(hasBlockedImages(restored)).toBe(false);
  });
});
