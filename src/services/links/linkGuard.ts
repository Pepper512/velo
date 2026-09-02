/**
 * The gate in front of `openEmailLink` (SPEC-F-3, audit P19).
 *
 * The phishing detector existed and ran nowhere on the click path; the
 * interstitial it feeds was mounted nowhere. This module decides, for one
 * clicked link, whether the user should see `LinkConfirmDialog` first: the
 * link is analysed with the detector's ten rules and compared against the
 * score line the user's sensitivity setting sets — the same line the banner
 * uses — unless detection is off or the sender is allowlisted.
 *
 * Fail closed: if a setting or the allowlist cannot be read, the gate behaves
 * as if detection were on and the sender unknown. A database hiccup must never
 * quietly turn the interstitial off.
 */
import { getSetting } from "@/services/db/settings";
import { isPhishingAllowlisted } from "@/services/db/phishingAllowlist";
import {
  analyzeLink,
  linkNeedsConfirmation,
  type LinkAnalysis,
  type PhishingSensitivity,
} from "@/utils/phishingDetector";

export interface LinkGuardContext {
  accountId?: string | null;
  senderAddress?: string | null;
}

async function readOr<T>(read: () => Promise<T>, fallback: T, what: string): Promise<T> {
  try {
    return await read();
  } catch (err) {
    console.warn(`[linkGuard] could not read ${what}; failing closed:`, err instanceof Error ? err.message : String(err));
    return fallback;
  }
}

/**
 * The analysis to show in the interstitial, or `null` to open the link at once.
 */
export async function assessLinkForConfirmation(
  href: string,
  displayText: string,
  ctx: LinkGuardContext,
): Promise<LinkAnalysis | null> {
  const enabled = await readOr(() => getSetting("phishing_detection_enabled"), null, "phishing_detection_enabled");
  if (enabled === "false") return null;

  if (ctx.accountId && ctx.senderAddress) {
    const allowlisted = await readOr(
      () => isPhishingAllowlisted(ctx.accountId!, ctx.senderAddress!),
      false,
      "the phishing allowlist",
    );
    if (allowlisted) return null;
  }

  const raw = await readOr(() => getSetting("phishing_sensitivity"), null, "phishing_sensitivity");
  const sensitivity: PhishingSensitivity = raw === "low" || raw === "high" ? raw : "default";

  const analysis = analyzeLink(href, displayText);
  return linkNeedsConfirmation(analysis, sensitivity) ? analysis : null;
}
