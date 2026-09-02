import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { createRef } from "react";
import { MessageItem } from "./MessageItem";
import type { DbMessage } from "@/services/db/messages";

vi.mock("./EmailRenderer", () => ({
  EmailRenderer: () => <div data-testid="email-renderer" />,
}));

vi.mock("./InlineAttachmentPreview", () => ({
  InlineAttachmentPreview: () => null,
}));

vi.mock("./AttachmentList", () => ({
  AttachmentList: () => null,
  getAttachmentsForMessage: vi.fn().mockResolvedValue([]),
}));

vi.mock("./AuthBadge", () => ({
  AuthBadge: () => null,
}));

vi.mock("./AuthWarningBanner", () => ({
  AuthWarningBanner: () => null,
}));

// SPEC-F-3 REQ-2: the phishing scan is mocked at the service; the banner is real.
const mockScan = vi.fn().mockResolvedValue(null);
vi.mock("@/services/phishing/phishingScanner", () => ({
  scanMessageLinks: (...args: unknown[]) => mockScan(...args),
}));
const mockAllowlist = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/db/phishingAllowlist", () => ({
  addToPhishingAllowlist: (...args: unknown[]) => mockAllowlist(...args),
}));

function makeMessage(overrides: Partial<DbMessage> = {}): DbMessage {
  return {
    id: "m1",
    account_id: "a1",
    thread_id: "t1",
    from_address: "bob@example.com",
    from_name: "Bob",
    to_addresses: "alice@example.com",
    cc_addresses: null,
    bcc_addresses: null,
    reply_to: null,
    subject: "Test subject",
    snippet: "Test snippet",
    date: Date.now(),
    is_read: 0,
    is_starred: 0,
    body_html: "<p>Hello</p>",
    body_text: "Hello",
    body_cached: 1,
    raw_size: 100,
    internal_date: null,
    list_unsubscribe: null,
    list_unsubscribe_post: null,
    auth_results: null,
    message_id_header: null,
    references_header: null,
    in_reply_to_header: null,
    ...overrides,
  };
}

describe("MessageItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders sender name", () => {
    render(<MessageItem message={makeMessage()} isLast={true} blockImages={false} />);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("applies red background when isSpam is true", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={true} blockImages={false} isSpam={true} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("bg-red-500/8");
  });

  it("does not apply red background when isSpam is false", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={true} blockImages={false} isSpam={false} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).not.toContain("bg-red-500");
  });

  it("does not apply red background when isSpam is undefined", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={true} blockImages={false} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).not.toContain("bg-red-500");
  });

  it("applies focus ring when focused prop is true", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={true} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("ring-accent/50");
  });

  it("does not apply focus ring when focused is false", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={false} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).not.toContain("ring-accent/50");
  });

  it("auto-expands when focused becomes true", () => {
    // Render collapsed (isLast=false, not focused)
    const { container, rerender } = render(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={false} />,
    );
    // Should be collapsed — no email renderer visible
    expect(container.querySelector("[data-testid='email-renderer']")).toBeNull();

    // Now set focused=true
    rerender(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={true} />,
    );
    // Should now be expanded — email renderer visible
    expect(container.querySelector("[data-testid='email-renderer']")).toBeInTheDocument();
  });

  it("forwards ref to outer div", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <MessageItem ref={ref} message={makeMessage()} isLast={true} blockImages={false} />,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

/** SPEC-F-3 REQ-2 — the phishing banner, wired for the first time (audit P19). */
describe("MessageItem phishing banner (SPEC-F-3)", () => {
  const flagged = {
    messageId: "m1",
    links: [],
    maxRiskScore: 55,
    suspiciousLinkCount: 2,
    showBanner: true,
    scannedAt: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockScan.mockResolvedValue(null);
    mockAllowlist.mockResolvedValue(undefined);
  });

  it("scans the message and shows the banner when the scan says so (REQ-2.1)", async () => {
    mockScan.mockResolvedValue(flagged);
    render(<MessageItem message={makeMessage()} isLast={true} blockImages={false} />);

    expect(await screen.findByText(/2 suspicious links found/)).toBeInTheDocument();
    expect(mockScan).toHaveBeenCalledWith("a1", "m1", "<p>Hello</p>", "bob@example.com");
  });

  it("shows no banner when the scan is clean or disabled", async () => {
    mockScan.mockResolvedValue({ ...flagged, showBanner: false });
    render(<MessageItem message={makeMessage()} isLast={true} blockImages={false} />);
    await act(async () => {});
    expect(screen.queryByText(/suspicious link/)).toBeNull();

    mockScan.mockResolvedValue(null); // detection off or sender allowlisted
    render(<MessageItem message={makeMessage({ id: "m2" })} isLast={true} blockImages={false} />);
    await act(async () => {});
    expect(screen.queryByText(/suspicious link/)).toBeNull();
  });

  it("Trust this sender allowlists the sender and hides the banner (REQ-2.2)", async () => {
    mockScan.mockResolvedValue(flagged);
    render(<MessageItem message={makeMessage()} isLast={true} blockImages={false} />);
    await screen.findByText(/2 suspicious links found/);

    await act(async () => {
      screen.getByText("Trust this sender").click();
    });

    expect(mockAllowlist).toHaveBeenCalledWith("a1", "bob@example.com");
    expect(screen.queryByText(/suspicious link/)).toBeNull();
  });

  it("a collapsed message is not scanned until it is expanded (#71 L5)", async () => {
    mockScan.mockResolvedValue(flagged);
    render(<MessageItem message={makeMessage()} isLast={false} blockImages={false} />);
    await act(async () => {});

    expect(mockScan).not.toHaveBeenCalled();
    expect(screen.queryByText(/suspicious link/)).toBeNull();
  });

  it("a scan that rejects leaves the message rendered without a banner", async () => {
    mockScan.mockRejectedValue(new Error("db closed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<MessageItem message={makeMessage()} isLast={true} blockImages={false} />);
    await act(async () => {});

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText(/suspicious link/)).toBeNull();
    warn.mockRestore();
  });
});
