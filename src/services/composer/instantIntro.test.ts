import { describe, it, expect } from "vitest";
import {
  buildInstantIntro,
  introducerFirstName,
  replyAllRecipients,
  type IntroSource,
} from "./instantIntro";

/**
 * SPEC-II: one action turns an introduction into the right reply — everyone
 * but the introducer stays, the introducer moves to Bcc, the opener thanks
 * them by name.
 */

const me = ["me@acme.com", "Me Alias <alias@acme.com>"];

function msg(over: Partial<IntroSource> = {}): IntroSource {
  return {
    from_address: "alice@intro.io",
    from_name: "Alice Smith",
    reply_to: null,
    to_addresses: "me@acme.com, bob@third.org",
    cc_addresses: null,
    subject: "Intro: Jim <> Bob",
    ...over,
  };
}

describe("replyAllRecipients", () => {
  it("puts the reply target first in To, then the To header, with me removed", () => {
    expect(replyAllRecipients(msg(), me)).toEqual({
      to: ["alice@intro.io", "bob@third.org"],
      cc: [],
    });
  });

  it("removes my aliases and compares case-insensitively through display names", () => {
    const m = msg({ to_addresses: '"Jim" <ME@acme.com>, Alias <alias@ACME.com>, Bob <bob@third.org>' });
    expect(replyAllRecipients(m, me).to).toEqual(["alice@intro.io", "Bob <bob@third.org>"]);
  });

  it("collapses duplicates by bare address, keeping the first chip", () => {
    const m = msg({ to_addresses: "Bob <bob@third.org>, BOB@third.org", cc_addresses: "bob@third.org, carol@third.org" });
    expect(replyAllRecipients(m, me)).toEqual({
      to: ["alice@intro.io", "Bob <bob@third.org>"],
      cc: ["carol@third.org"],
    });
  });

  it("prefers reply_to over from_address as the reply target", () => {
    const m = msg({ reply_to: "alice.replies@intro.io" });
    expect(replyAllRecipients(m, me).to[0]).toBe("alice.replies@intro.io");
  });

  it("copes with null headers", () => {
    const m = msg({ from_address: null, to_addresses: null, cc_addresses: null });
    expect(replyAllRecipients(m, me)).toEqual({ to: [], cc: [] });
  });
});

describe("introducerFirstName (REQ-2.1)", () => {
  it("is the first word of the display name", () => {
    expect(introducerFirstName("Alice Smith", "alice@intro.io")).toBe("Alice");
  });

  it("falls back to the local part of the address", () => {
    expect(introducerFirstName(null, "alice.smith@intro.io")).toBe("alice.smith");
    expect(introducerFirstName("   ", "alice@intro.io")).toBe("alice");
  });

  it("reads the address out of a display-name chip", () => {
    expect(introducerFirstName(null, "Alice <alice@intro.io>")).toBe("alice");
  });
});

describe("buildInstantIntro (REQ-1, REQ-2)", () => {
  it("moves the introducer to Bcc and leaves the third party in To", () => {
    const intro = buildInstantIntro(msg(), me);
    expect(intro).not.toBeNull();
    expect(intro!.to).toEqual(["bob@third.org"]);
    expect(intro!.cc).toEqual([]);
    expect(intro!.bcc).toEqual(["alice@intro.io"]);
    expect(intro!.subject).toBe("Re: Intro: Jim <> Bob");
    expect(intro!.introducerName).toBe("Alice");
    expect(intro!.openerHtml).toBe("<p>Thanks Alice, moving you to Bcc.</p>");
  });

  it("removes the introducer from To and Cc when the header repeats them", () => {
    const m = msg({
      to_addresses: "me@acme.com, Alice Smith <alice@intro.io>, bob@third.org",
      cc_addresses: "ALICE@intro.io, carol@third.org",
    });
    const intro = buildInstantIntro(m, me)!;
    expect(intro.to).toEqual(["bob@third.org"]);
    expect(intro.cc).toEqual(["carol@third.org"]);
    expect(intro.bcc).toEqual(["alice@intro.io"]);
  });

  it("carries the reply_to address into Bcc, as the header wrote it", () => {
    const m = msg({ reply_to: "Alice Replies <alice.replies@intro.io>" });
    expect(buildInstantIntro(m, me)!.bcc).toEqual(["Alice Replies <alice.replies@intro.io>"]);
  });

  it("escapes the introducer's name in the opener", () => {
    const m = msg({ from_name: "<b>Alice</b> Smith" });
    expect(buildInstantIntro(m, me)!.openerHtml).toBe("<p>Thanks &lt;b&gt;Alice&lt;/b&gt;, moving you to Bcc.</p>");
  });

  it("does not prefix Re: twice", () => {
    expect(buildInstantIntro(msg({ subject: "Re: hello" }), me)!.subject).toBe("Re: hello");
    expect(buildInstantIntro(msg({ subject: null }), me)!.subject).toBe("Re: ");
  });

  it("is unavailable when there is no introducer address", () => {
    expect(buildInstantIntro(msg({ from_address: null }), me)).toBeNull();
  });

  it("is unavailable when the last message is my own", () => {
    expect(buildInstantIntro(msg({ from_address: "alias@acme.com" }), me)).toBeNull();
  });

  it("is unavailable when nobody is left to be introduced to", () => {
    expect(buildInstantIntro(msg({ to_addresses: "me@acme.com" }), me)).toBeNull();
    expect(buildInstantIntro(msg({ to_addresses: "me@acme.com, alice@intro.io" }), me)).toBeNull();
  });

  it("is available when the only other person is on Cc", () => {
    const intro = buildInstantIntro(msg({ to_addresses: "me@acme.com", cc_addresses: "bob@third.org" }), me)!;
    expect(intro.to).toEqual([]);
    expect(intro.cc).toEqual(["bob@third.org"]);
  });
});
