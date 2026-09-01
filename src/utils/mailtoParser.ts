export interface MailtoFields {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

/**
 * `decodeURIComponent` that never throws (audit P7).
 *
 * A malformed escape -- `mailto:%zz` from any web page -- raises `URIError`.
 * That propagated out of the parser into an un-awaited `handleUrl` call and
 * became an unhandled rejection. Malformed input should produce no draft, not
 * an unhandled error; returning the raw text lets the address validation that
 * follows reject it normally.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseMailtoUrl(url: string): MailtoFields {
  const result: MailtoFields = {
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    body: "",
  };

  if (!url.startsWith("mailto:")) {
    return result;
  }

  // Remove the "mailto:" prefix
  const rest = url.slice(7);

  // Split on the first "?" to get address part and query part
  const qIndex = rest.indexOf("?");
  const addressPart = qIndex >= 0 ? rest.slice(0, qIndex) : rest;
  const queryPart = qIndex >= 0 ? rest.slice(qIndex + 1) : "";

  // Parse the "to" addresses from the address part
  if (addressPart) {
    result.to = safeDecode(addressPart)
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
  }

  // Parse query parameters
  if (queryPart) {
    const params = new URLSearchParams(queryPart);

    const toParam = params.get("to");
    if (toParam) {
      const extraTo = toParam
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      result.to = [...result.to, ...extraTo];
    }

    const cc = params.get("cc");
    if (cc) {
      result.cc = cc
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
    }

    const bcc = params.get("bcc");
    if (bcc) {
      result.bcc = bcc
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
    }

    const subject = params.get("subject");
    if (subject) {
      result.subject = subject;
    }

    const body = params.get("body");
    if (body) {
      result.body = body;
    }
  }

  return result;
}
