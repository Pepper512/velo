import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn(),
}));
vi.mock("@/services/db/phishingAllowlist", () => ({
  isPhishingAllowlisted: vi.fn(),
}));

import { getSetting } from "@/services/db/settings";
import { isPhishingAllowlisted } from "@/services/db/phishingAllowlist";
import { assessLinkForConfirmation } from "./linkGuard";
import { analyzeLink, linkNeedsConfirmation } from "@/utils/phishingDetector";

const mockGetSetting = vi.mocked(getSetting);
const mockAllowlisted = vi.mocked(isPhishingAllowlisted);

/** Settings as the store would answer them. */
function settings(values: Record<string, string | null>) {
  mockGetSetting.mockImplementation(async (key: string) => values[key] ?? null);
}

const CTX = { accountId: "acc-1", senderAddress: "sender@example.com" };

// Links whose scores the detector's own rules fix (ip-address 40, suspicious
// keywords 15, display/href mismatch 60, url-shortener 15). Verified in the
// first test so the rest of the file cannot drift from the detector.
const SAFE = "https://www.example.com/article";
const IP_LINK = "http://203.0.113.9/login"; // ip 40 + keyword 15 (+ mismatch 60 with BANK_TEXT) — high
const BANK_TEXT = "https://secure.bank-example.com";
const SHORTENER = "https://bit.ly/login"; // shortener 15 + keyword 15 = 30 — the 20–39 band

describe("linkNeedsConfirmation (SPEC-F-3 REQ-1.1)", () => {
  it("uses the sensitivity's score threshold — 60 / 40 / 20", () => {
    const at = (riskScore: number) => ({ ...analyzeLink(SAFE, SAFE), riskScore });
    expect(linkNeedsConfirmation(at(59), "low")).toBe(false);
    expect(linkNeedsConfirmation(at(60), "low")).toBe(true);
    expect(linkNeedsConfirmation(at(39), "default")).toBe(false);
    expect(linkNeedsConfirmation(at(40), "default")).toBe(true);
    expect(linkNeedsConfirmation(at(19), "high")).toBe(false);
    expect(linkNeedsConfirmation(at(20), "high")).toBe(true);
  });

  it("the fixtures sit where the tests below assume", () => {
    expect(analyzeLink(SAFE, SAFE).riskScore).toBe(0);
    expect(analyzeLink(IP_LINK, BANK_TEXT).riskScore).toBeGreaterThanOrEqual(60);
    const shortener = analyzeLink(SHORTENER, SHORTENER).riskScore;
    expect(shortener).toBeGreaterThanOrEqual(20);
    expect(shortener).toBeLessThan(40);
  });
});

describe("assessLinkForConfirmation (SPEC-F-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings({});
    mockAllowlisted.mockResolvedValue(false);
  });

  it("returns the analysis for a risky link and null for a safe one (REQ-1.1, 1.3)", async () => {
    const risky = await assessLinkForConfirmation(IP_LINK, BANK_TEXT, CTX);
    expect(risky?.riskLevel).toBe("high");
    expect(risky?.url).toBe(IP_LINK);
    expect(risky?.triggeredRules.length).toBeGreaterThan(0);

    expect(await assessLinkForConfirmation(SAFE, "read more", CTX)).toBeNull();
  });

  it("sensitivity moves the line: a shortener asks only at high sensitivity", async () => {
    settings({ phishing_sensitivity: "low" });
    expect(await assessLinkForConfirmation(SHORTENER, SHORTENER, CTX)).toBeNull();
    settings({ phishing_sensitivity: "default" });
    expect(await assessLinkForConfirmation(SHORTENER, SHORTENER, CTX)).toBeNull();
    settings({ phishing_sensitivity: "high" });
    expect((await assessLinkForConfirmation(SHORTENER, SHORTENER, CTX))?.url).toBe(SHORTENER);
  });

  it("an unknown sensitivity value means default", async () => {
    settings({ phishing_sensitivity: "paranoid" });
    expect(await assessLinkForConfirmation(SHORTENER, SHORTENER, CTX)).toBeNull();
    expect(await assessLinkForConfirmation(IP_LINK, BANK_TEXT, CTX)).not.toBeNull();
  });

  it("returns null when detection is disabled (REQ-1.3)", async () => {
    settings({ phishing_detection_enabled: "false" });
    expect(await assessLinkForConfirmation(IP_LINK, BANK_TEXT, CTX)).toBeNull();
    expect(mockAllowlisted).not.toHaveBeenCalled();
  });

  it("returns null when the sender is allowlisted (REQ-1.3)", async () => {
    mockAllowlisted.mockResolvedValue(true);
    expect(await assessLinkForConfirmation(IP_LINK, BANK_TEXT, CTX)).toBeNull();
    expect(mockAllowlisted).toHaveBeenCalledWith("acc-1", "sender@example.com");
  });

  it("does not consult the allowlist without an account or sender", async () => {
    expect((await assessLinkForConfirmation(IP_LINK, BANK_TEXT, { accountId: null, senderAddress: null }))?.riskLevel).toBe("high");
    expect(mockAllowlisted).not.toHaveBeenCalled();
  });

  it("fails closed: a setting or allowlist read that rejects still yields the analysis (REQ-1.5)", async () => {
    mockGetSetting.mockRejectedValue(new Error("db closed"));
    mockAllowlisted.mockRejectedValue(new Error("db closed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await assessLinkForConfirmation(IP_LINK, BANK_TEXT, CTX))?.riskLevel).toBe("high");
    expect(await assessLinkForConfirmation(SAFE, SAFE, CTX)).toBeNull();

    warn.mockRestore();
  });
});
