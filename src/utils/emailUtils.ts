/**
 * Normalize an email address for case-insensitive comparison.
 * Email addresses are case-insensitive per RFC 5321.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * The bare, lower-cased address inside a recipient string. Reply-all
 * prefills recipients straight from the To/Cc headers, so a chip can read
 * `"Alice Smith" <alice@acme.com>`; a rule comparing people must see
 * `alice@acme.com`. Shared by SPEC-AR (auto reminders) and SPEC-II
 * (Instant Intro).
 */
export function bareAddress(raw: string): string {
  const angle = raw.match(/<([^<>]+)>/);
  // No bracketed address: take the chip as typed, minus any stray bracket.
  return (angle ? angle[1]! : raw.replace(/[<>]/g, "")).trim().toLowerCase();
}
