import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { EmailRenderer } from "./EmailRenderer";

/**
 * SPEC-F-2: plain-text bodies get clickable anchors (REQ-1.1) and every anchor
 * click — HTML or plain-text — routes through `openEmailLink` (REQ-2.1).
 */
const mockOpenEmailLink = vi.fn().mockResolvedValue("opened");

vi.mock("@/services/links/openLink", () => ({
  openEmailLink: (...args: unknown[]) => mockOpenEmailLink(...args),
}));

vi.mock("@/services/db/imageAllowlist", () => ({
  addToAllowlist: vi.fn(),
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: (selector: (s: { theme: string }) => string) => selector({ theme: "light" }),
}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

function frameDoc(container: HTMLElement): Document {
  const iframe = container.querySelector("iframe");
  if (!iframe?.contentDocument) throw new Error("iframe document not available");
  return iframe.contentDocument;
}

describe("EmailRenderer links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a URL in a plain-text body as an anchor and keeps trailing punctuation outside it", async () => {
    const { container } = render(
      <EmailRenderer html={null} text="Details: https://example.com/a?b=1&c=2. Thanks" />,
    );
    await waitFor(() => {
      const anchor = frameDoc(container).querySelector("a");
      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute("href")).toBe("https://example.com/a?b=1&c=2");
      expect(anchor?.textContent).toBe("https://example.com/a?b=1&c=2");
    });
    expect(frameDoc(container).body.textContent).toContain("&c=2. Thanks");
  });

  it("still escapes markup in plain-text bodies", async () => {
    const { container } = render(<EmailRenderer html={null} text={'<img src=x onerror=alert(1)> https://ok.test'} />);
    await waitFor(() => {
      expect(frameDoc(container).querySelector("a")).not.toBeNull();
    });
    expect(frameDoc(container).querySelector("img")).toBeNull();
  });

  it("routes an HTML anchor click through openEmailLink with the resolved href and prevents navigation", async () => {
    const { container } = render(
      <EmailRenderer html={'<p>See <a href="https://example.com/x">here</a></p>'} text={null} />,
    );
    const doc = frameDoc(container);
    await waitFor(() => expect(doc.querySelector("a")).not.toBeNull());

    const anchor = doc.querySelector("a")!;
    const event = new (doc.defaultView!.MouseEvent)("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(mockOpenEmailLink).toHaveBeenCalledTimes(1);
    expect(mockOpenEmailLink.mock.calls[0]?.[0]).toBe("https://example.com/x");
    expect(typeof mockOpenEmailLink.mock.calls[0]?.[1]).toBe("string");
  });

  it("routes a plain-text anchor click through openEmailLink too", async () => {
    const { container } = render(<EmailRenderer html={null} text="go https://plain.test/p" />);
    const doc = frameDoc(container);
    await waitFor(() => expect(doc.querySelector("a")).not.toBeNull());

    doc.querySelector("a")!.dispatchEvent(
      new (doc.defaultView!.MouseEvent)("click", { bubbles: true, cancelable: true }),
    );
    expect(mockOpenEmailLink).toHaveBeenCalledWith("https://plain.test/p", expect.any(String));
  });

  it("does not call openEmailLink for a click that is not on an anchor", async () => {
    const { container } = render(<EmailRenderer html={"<p>plain paragraph</p>"} text={null} />);
    const doc = frameDoc(container);
    await waitFor(() => expect(doc.querySelector("p")).not.toBeNull());

    doc.querySelector("p")!.dispatchEvent(
      new (doc.defaultView!.MouseEvent)("click", { bubbles: true, cancelable: true }),
    );
    expect(mockOpenEmailLink).not.toHaveBeenCalled();
  });
});
