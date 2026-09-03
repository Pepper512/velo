import { describe, it, expect } from "vitest";
import {
  buildInstantIntro,
  composerOptionsForIntro,
  instantIntroUnavailableReason,
  introducerFirstName,
  replyAllRecipients,
  type IntroSource,
} from "./instantIntro";
import type { SendAsAlias } from "../db/sendAsAliases";

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

  it("treats a blank reply_to as absent (Grok II-5)", () => {
    expect(replyAllRecipients(msg({ reply_to: "   " }), me).to[0]).toBe("alice@intro.io");
    expect(buildInstantIntro(msg({ reply_to: "" }), me)!.bcc).toEqual(["alice@intro.io"]);
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

  it("strips quotes and punctuation around the first word (Gemini N F-04)", () => {
    expect(introducerFirstName('"Alice" Smith', "alice@intro.io")).toBe("Alice");
    expect(introducerFirstName("'Alice', Smith", "alice@intro.io")).toBe("Alice");
    expect(introducerFirstName("Élodie D.", "e@intro.io")).toBe("Élodie");
  });

  it("falls back to the address when the display name is only punctuation", () => {
    expect(introducerFirstName('"" -', "alice@intro.io")).toBe("alice");
  });
});

describe("composerOptionsForIntro (Grok II-2, II-4)", () => {
  // Primary first so a match on the second alias proves the header lookup,
  // not resolveFromAddress's default/primary/first fallback.
  const aliases = [
    { id: "a0", accountId: "acc", email: "me@acme.com", displayName: null, isPrimary: true, isDefault: false },
    { id: "a1", accountId: "acc", email: "alias@acme.com", displayName: null, isPrimary: false, isDefault: false },
  ] as unknown as SendAsAlias[];
  const m = { ...msg({ to_addresses: "alias@acme.com, bob@third.org" }), id: "m1", thread_id: "t1" };

  it("is one reply-all open: recipients, subject, opener above the quote, thread ids, and the From alias the intro was sent to", () => {
    const intro = buildInstantIntro(m, me)!;
    expect(composerOptionsForIntro(m, intro, "<blockquote>quoted</blockquote>", aliases)).toEqual({
      mode: "replyAll",
      to: ["bob@third.org"],
      cc: [],
      bcc: ["alice@intro.io"],
      subject: "Re: Intro: Jim <> Bob",
      bodyHtml: "<p>Thanks Alice, moving you to Bcc.</p><blockquote>quoted</blockquote>",
      threadId: "t1",
      inReplyToMessageId: "m1",
      fromEmail: "alias@acme.com",
    });
  });

  it("falls back to the primary alias when no header matches, as the composer itself would", () => {
    const plain = { ...m, to_addresses: "someone-else@acme.com, bob@third.org" };
    const intro = buildInstantIntro(plain, me)!;
    expect(composerOptionsForIntro(plain, intro, "", aliases).fromEmail).toBe("me@acme.com");
  });

  it("leaves From unset when the account has no aliases", () => {
    const intro = buildInstantIntro(m, me)!;
    expect(composerOptionsForIntro(m, intro, "", []).fromEmail).toBeNull();
  });
});

describe("instantIntroUnavailableReason (REQ-1.3, Gemini L F-03)", () => {
  it("is null when the intro is available", () => {
    expect(instantIntroUnavailableReason(msg(), me)).toBeNull();
  });

  it("names the missing introducer address", () => {
    expect(instantIntroUnavailableReason(msg({ from_address: null }), me)).toBe("No sender address to move to Bcc");
  });

  it("names my own last message even when others are on the thread", () => {
    const m = msg({ from_address: "alias@acme.com", to_addresses: "bob@third.org, carol@third.org" });
    expect(instantIntroUnavailableReason(m, me)).toBe("The last message is your own");
  });

  it("names the empty introduction", () => {
    expect(instantIntroUnavailableReason(msg({ to_addresses: "me@acme.com" }), me)).toBe("Nobody to introduce you to");
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
    const m = msg({ from_name: "A<b>lice</b>&co Smith" });
    expect(buildInstantIntro(m, me)!.openerHtml).toBe("<p>Thanks A&lt;b&gt;lice&lt;/b&gt;&amp;co, moving you to Bcc.</p>");
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
