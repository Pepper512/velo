import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { EmailRenderer } from "./EmailRenderer";

/**
 * SPEC-F-2: plain-text bodies get clickable anchors (REQ-1.1) and every anchor
 * click — HTML or plain-text — routes through `openEmailLink` (REQ-2.1).
 */
const mockOpenEmailLink = vi.fn().mockResolvedValue("opened");

vi.mock("@/services/links/openLink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/links/openLink")>();
  return {
    ...actual, // keep the real `isOpenableHref` — the gate's first question
    openEmailLink: (...args: unknown[]) => mockOpenEmailLink(...args),
  };
});
// SPEC-F-3: the phishing gate. Default answer "open at once"; tests flip it.
const mockAssess = vi.fn().mockResolvedValue(null);
vi.mock("@/services/links/linkGuard", () => ({
  assessLinkForConfirmation: (...args: unknown[]) => mockAssess(...args),
}));
// The dialog itself is rendered as two buttons so the tests can press them.
vi.mock("./LinkConfirmDialog", () => ({
  LinkConfirmDialog: ({ linkAnalysis, onCancel, onConfirm }: { linkAnalysis: { url: string }; onCancel: () => void; onConfirm: () => void }) => (
    <div data-testid="link-confirm" data-url={linkAnalysis.url}>
      <button onClick={onCancel}>Go Back</button>
      <button onClick={onConfirm}>Open Anyway</button>
    </div>
  ),
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
    // The phishing gate (SPEC-F-3) awaits its settings before the seam is called.
    await waitFor(() => expect(mockOpenEmailLink).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(mockOpenEmailLink).toHaveBeenCalledWith("https://plain.test/p", expect.any(String)));
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

/**
 * SPEC-F-3: the phishing gate in front of the opener seam. A flagged link
 * waits in the dialog; a safe one opens at once; an in-page anchor is never
 * even analysed.
 */
describe("EmailRenderer phishing gate (SPEC-F-3)", () => {
  const RISKY = "http://203.0.113.9/login";
  const analysis = {
    url: RISKY,
    displayText: "Verify your account",
    riskScore: 55,
    riskLevel: "medium" as const,
    triggeredRules: [{ ruleId: "ip-address", name: "IP address", score: 40, detail: "IP host" }],
  };

  async function renderAndClick(html: string, selector = "a") {
    const utils = render(
      <EmailRenderer html={html} text={null} accountId="acc-1" senderAddress="sender@example.com" messageId="m1" />,
    );
    let anchor: HTMLAnchorElement | null = null;
    await waitFor(() => {
      anchor = frameDoc(utils.container).querySelector(selector);
      expect(anchor).not.toBeNull();
    });
    const doc = frameDoc(utils.container);
    anchor!.dispatchEvent(new (doc.defaultView!.MouseEvent)("click", { bubbles: true, cancelable: true }));
    return utils;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssess.mockResolvedValue(null);
  });

  it("shows the dialog for a flagged link and does not open it (REQ-1.1)", async () => {
    mockAssess.mockResolvedValue(analysis);
    const { findByTestId } = await renderAndClick(`<a href="${RISKY}">Verify your account</a>`);

    const dialog = await findByTestId("link-confirm");
    expect(dialog.getAttribute("data-url")).toBe(RISKY);
    expect(mockAssess).toHaveBeenCalledWith(RISKY, "Verify your account", { accountId: "acc-1", senderAddress: "sender@example.com" });
    expect(mockOpenEmailLink).not.toHaveBeenCalled();
  });

  it("Open Anyway opens through the seam; Go Back opens nothing (REQ-1.2)", async () => {
    mockAssess.mockResolvedValue(analysis);
    const { container, findByTestId, findByText, queryByTestId } = await renderAndClick(`<a href="${RISKY}">x</a>`);
    await findByTestId("link-confirm");

    (await findByText("Go Back")).click();
    await waitFor(() => expect(queryByTestId("link-confirm")).toBeNull());
    expect(mockOpenEmailLink).not.toHaveBeenCalled();

    // Click the same anchor again and confirm this time.
    const doc = frameDoc(container);
    doc.querySelector("a")!.dispatchEvent(new (doc.defaultView!.MouseEvent)("click", { bubbles: true, cancelable: true }));
    await findByTestId("link-confirm");
    (await findByText("Open Anyway")).click();

    await waitFor(() => expect(mockOpenEmailLink).toHaveBeenCalledWith(RISKY, expect.any(String)));
    expect(mockOpenEmailLink).toHaveBeenCalledTimes(1);
    expect(queryByTestId("link-confirm")).toBeNull();
  });

  it("a safe link opens at once with no dialog (REQ-1.3)", async () => {
    const { queryByTestId } = await renderAndClick('<a href="https://www.example.com/read">read</a>');

    await waitFor(() => expect(mockOpenEmailLink).toHaveBeenCalledWith("https://www.example.com/read", expect.any(String)));
    expect(mockAssess).toHaveBeenCalledTimes(1);
    expect(queryByTestId("link-confirm")).toBeNull();
  });

  it("an in-page anchor is never analysed and stays a silent no-op (REQ-1.4)", async () => {
    await renderAndClick('<a href="#top">top</a>');

    expect(mockAssess).not.toHaveBeenCalled();
    // The seam is still consulted (it answers "ignored" for these) — behaviour unchanged.
    expect(mockOpenEmailLink).toHaveBeenCalledTimes(1);
  });
});
