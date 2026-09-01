import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

import { openUrl } from "@tauri-apps/plugin-opener";
import { openEmailLink } from "./openLink";
import { useUIStore } from "@/stores/uiStore";

const FRAME = "http://localhost:1420";

/**
 * SPEC-F-2 REQ-2.1–2.4, REQ-3.1. `openEmailLink` is the single seam between
 * a click inside the email iframe and the OS; every outcome is observable.
 */
describe("openEmailLink", () => {
  const log = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(openUrl).mockResolvedValue(undefined);
    useUIStore.setState({ notices: [] });
  });

  it("opens http, https, mailto and tel links through the opener (REQ-2.3)", async () => {
    for (const href of [
      "http://example.com/a",
      "https://example.com/b?x=1",
      "mailto:bob@example.com",
      "tel:+15551234567",
    ]) {
      expect(await openEmailLink(href, FRAME, { log })).toBe("opened");
      expect(openUrl).toHaveBeenLastCalledWith(href);
    }
    expect(useUIStore.getState().notices).toHaveLength(0);
  });

  it("ignores anchors with no href (REQ-2.4)", async () => {
    expect(await openEmailLink(null, FRAME, { log })).toBe("ignored");
    expect(await openEmailLink("", FRAME, { log })).toBe("ignored");
    expect(openUrl).not.toHaveBeenCalled();
    expect(useUIStore.getState().notices).toHaveLength(0);
  });

  it("ignores fragment-only and same-document links silently (REQ-2.4)", async () => {
    for (const href of [
      "about:blank#top",
      "about:srcdoc#section-2",
      `${FRAME}/#top`,
      `${FRAME}/index.html#x`,
    ]) {
      expect(await openEmailLink(href, FRAME, { log })).toBe("ignored");
    }
    expect(openUrl).not.toHaveBeenCalled();
    expect(useUIStore.getState().notices).toHaveLength(0);
  });

  it("refuses schemes the sanitizer allows but the opener does not, with a specific notice (REQ-2.3)", async () => {
    for (const href of ["ftp://files.example.com/x", "sms:+15551234567", "xmpp:someone@x.test"]) {
      expect(await openEmailLink(href, FRAME, { log })).toBe("unsupported");
    }
    expect(openUrl).not.toHaveBeenCalled();
    const notices = useUIStore.getState().notices;
    expect(notices).toHaveLength(3);
    expect(notices[0]?.text).toBe("This kind of link (ftp:) can't be opened from Velo");
  });

  it("reports a failed open with a Copy-link action and logs scheme + host only (REQ-2.2, REQ-3.1)", async () => {
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("os refused"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const result = await openEmailLink("https://example.com/secret?token=abc", FRAME, { log });

    expect(result).toBe("failed");
    const notice = useUIStore.getState().notices[0];
    expect(notice?.text).toBe("Couldn't open link — example.com");
    expect(notice?.action?.label).toBe("Copy link");
    await notice?.action?.onClick();
    expect(writeText).toHaveBeenCalledWith("https://example.com/secret?token=abc");

    expect(log).toHaveBeenCalledTimes(1);
    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain("https:");
    expect(logged).toContain("example.com");
    expect(logged).not.toContain("token=abc");
  });

  it("treats an unparseable href as ignored rather than throwing", async () => {
    expect(await openEmailLink("not a url at all", FRAME, { log })).toBe("ignored");
    expect(openUrl).not.toHaveBeenCalled();
  });
});
