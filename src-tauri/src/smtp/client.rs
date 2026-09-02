use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use lettre::{
    transport::smtp::{
        authentication::{Credentials, Mechanism},
        client::{Tls, TlsParametersBuilder},
    },
    AsyncSmtpTransport, AsyncTransport, Tokio1Executor,
};

use super::types::{SmtpConfig, SmtpSendResult};

/// Decode a base64url-encoded string (Gmail format) to raw bytes.
fn decode_base64url(input: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD
        .decode(input)
        .map_err(|e| format!("Base64 decode error: {}", e))
}

/// Build an async SMTP transport from the given config.
fn build_transport(
    config: &SmtpConfig,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    let credentials = Credentials::new(config.username.clone(), config.password.clone());

    // For OAuth2, force XOAUTH2 mechanism; for password, use default mechanisms
    let auth_mechanisms = if config.auth_method == "oauth2" {
        vec![Mechanism::Xoauth2]
    } else {
        vec![Mechanism::Plain, Mechanism::Login]
    };

    let transport = match config.security.as_str() {
        "tls" => {
            // Implicit TLS (typically port 465)
            let mut builder = AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)
                .map_err(|e| format!("SMTP relay error: {}", e))?
                .port(config.port)
                .credentials(credentials)
                .authentication(auth_mechanisms);

            if config.accept_invalid_certs {
                let tls_params = TlsParametersBuilder::new(config.host.clone())
                    .dangerous_accept_invalid_certs(true)
                    .dangerous_accept_invalid_hostnames(true)
                    .build()
                    .map_err(|e| format!("SMTP TLS params error: {}", e))?;
                builder = builder.tls(Tls::Required(tls_params));
            }

            builder.build()
        }
        "starttls" => {
            // STARTTLS (typically port 587)
            let mut builder = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
                .map_err(|e| format!("SMTP STARTTLS error: {}", e))?
                .port(config.port)
                .credentials(credentials)
                .authentication(auth_mechanisms);

            if config.accept_invalid_certs {
                let tls_params = TlsParametersBuilder::new(config.host.clone())
                    .dangerous_accept_invalid_certs(true)
                    .dangerous_accept_invalid_hostnames(true)
                    .build()
                    .map_err(|e| format!("SMTP TLS params error: {}", e))?;
                builder = builder.tls(Tls::Required(tls_params));
            }

            builder.build()
        }
        _ => {
            // Plain / no encryption (typically port 25) — not recommended
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host)
                .port(config.port)
                .credentials(credentials)
                .authentication(auth_mechanisms)
                .build()
        }
    };

    Ok(transport)
}

/// Extract an SMTP envelope (sender + recipients) from raw RFC 2822 bytes.
///
/// The envelope tells the SMTP server who the mail is from and who to deliver
/// it to, which is separate from the header fields visible to the recipient.
fn extract_envelope(raw: &[u8]) -> Result<lettre::address::Envelope, String> {
    let message = mail_parser::MessageParser::default()
        .parse(raw)
        .ok_or("Failed to parse email for envelope extraction")?;

    // Extract From address
    let from = message
        .from()
        .and_then(|list| list.first())
        .and_then(|addr| addr.address())
        .ok_or("No From address found in email")?;

    let from_addr: lettre::Address = from
        .parse()
        .map_err(|e| format!("Invalid From address '{}': {}", from, e))?;

    // Collect all recipient addresses (To, Cc, Bcc)
    let mut recipients: Vec<lettre::Address> = Vec::new();

    if let Some(to_list) = message.to() {
        for addr in to_list.iter() {
            if let Some(email) = addr.address() {
                if let Ok(a) = email.parse::<lettre::Address>() {
                    recipients.push(a);
                }
            }
        }
    }

    if let Some(cc_list) = message.cc() {
        for addr in cc_list.iter() {
            if let Some(email) = addr.address() {
                if let Ok(a) = email.parse::<lettre::Address>() {
                    recipients.push(a);
                }
            }
        }
    }

    if let Some(bcc_list) = message.bcc() {
        for addr in bcc_list.iter() {
            if let Some(email) = addr.address() {
                if let Ok(a) = email.parse::<lettre::Address>() {
                    recipients.push(a);
                }
            }
        }
    }

    if recipients.is_empty() {
        return Err("No recipients found in email".to_string());
    }

    lettre::address::Envelope::new(Some(from_addr), recipients)
        .map_err(|e| format!("Envelope error: {}", e))
}

/// Index at which the body starts — just after the header block's last line
/// terminator, so the blank line and everything after it belong to the tail.
/// The whole input when there is no blank line.
fn header_block_end(raw: &[u8]) -> usize {
    let mut i = 0;
    while i < raw.len() {
        let rest = &raw[i..];
        if rest.starts_with(b"\r\n\r\n") {
            return i + 2;
        }
        // Bare LF, and the mixed `\n\r\n` a builder can produce (Gemini NIT 2).
        if rest.starts_with(b"\n\n") || rest.starts_with(b"\n\r\n") {
            return i + 1;
        }
        i += 1;
    }
    raw.len()
}

/// Split into lines, each keeping its own terminator; a final unterminated
/// line is returned as well.
fn lines_inclusive(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut start = 0;
    std::iter::from_fn(move || {
        if start >= bytes.len() {
            return None;
        }
        let end = bytes[start..]
            .iter()
            .position(|&b| b == b'\n')
            .map(|p| start + p + 1)
            .unwrap_or(bytes.len());
        let line = &bytes[start..end];
        start = end;
        Some(line)
    })
}

/// Is this header line a `Bcc` or `Resent-Bcc` field (RFC 5322 §3.6.3 and
/// §3.6.6 remove both before transmission)? The field name is everything
/// before the first colon with surrounding whitespace removed — §4.5.3
/// obsolete syntax allows `Bcc :`, and `mail_parser` accepts it, so it must
/// be caught.
fn is_bcc_field(line: &[u8]) -> bool {
    let Some(colon) = line.iter().position(|&b| b == b':') else {
        return false;
    };
    let name = line[..colon].trim_ascii();
    name.eq_ignore_ascii_case(b"bcc") || name.eq_ignore_ascii_case(b"resent-bcc")
}

/// Remove every `Bcc` and `Resent-Bcc` header field — with its folded
/// continuation lines — from the header block of an RFC 5322 message, leaving
/// every other byte as it was (#297, REQ-1.1/1.3). The body is never touched:
/// a line reading `Bcc: …` after the blank line is content.
fn strip_bcc_header(raw: &[u8]) -> Vec<u8> {
    let body_at = header_block_end(raw);
    let mut out = Vec::with_capacity(raw.len());
    let mut skipping = false;
    let mut seen_field = false;
    for line in lines_inclusive(&raw[..body_at]) {
        let continuation = matches!(line.first(), Some(b' ') | Some(b'\t'));
        // A whitespace-led line continues the field above it; with no field
        // above (a malformed first line) it is judged on its own (Gemini NIT 3).
        if !continuation || !seen_field {
            skipping = is_bcc_field(line);
            seen_field = true;
        }
        if !skipping {
            out.extend_from_slice(line);
        }
    }
    out.extend_from_slice(&raw[body_at..]);
    out
}

/// The fail-closed guard (#297, REQ-1.4): parse the bytes about to leave and
/// refuse if a `Bcc` field is still visible to the parser. Any spelling the
/// scanner misses becomes a refused send, never a disclosure.
fn refuse_if_bcc(wire: &[u8]) -> Result<(), String> {
    let message = mail_parser::MessageParser::default()
        .parse(wire)
        .ok_or("Failed to parse the outgoing message after removing Bcc")?;
    if message.bcc().is_some() || message.resent_bcc().is_some() {
        return Err("Refusing to send: a Bcc header survived removal".to_string());
    }
    Ok(())
}

/// Turn the message as built into what goes on the wire: the envelope is read
/// from the original bytes (so blind recipients are delivered to), and the
/// bytes transmitted carry no `Bcc` field (#297).
fn prepare_for_wire(raw: &[u8]) -> Result<(lettre::address::Envelope, Vec<u8>), String> {
    let envelope = extract_envelope(raw)?;
    let wire = strip_bcc_header(raw);
    refuse_if_bcc(&wire)?;
    Ok((envelope, wire))
}

/// Send a pre-built RFC 2822 email via SMTP.
///
/// The `raw_email_base64url` parameter is the full email message encoded as
/// base64url (the same encoding Gmail uses: `+` → `-`, `/` → `_`, no padding).
/// The function decodes it, extracts the envelope from headers, removes the
/// `Bcc` field from the transmitted bytes (RFC 5322 §3.6.3), and sends it.
pub async fn send_raw_email(
    config: &SmtpConfig,
    raw_email_base64url: &str,
) -> Result<SmtpSendResult, String> {
    let raw_bytes = decode_base64url(raw_email_base64url)?;
    let (envelope, wire) = prepare_for_wire(&raw_bytes)?;
    let transport = build_transport(config)?;

    transport
        .send_raw(&envelope, &wire)
        .await
        .map(|_response| SmtpSendResult {
            success: true,
            message: "Email sent successfully".to_string(),
        })
        .map_err(|e| format!("SMTP send error: {}", e))
}

/// Test SMTP connectivity by connecting, authenticating, and disconnecting.
pub async fn test_connection(config: &SmtpConfig) -> Result<SmtpSendResult, String> {
    let transport = build_transport(config)?;

    transport
        .test_connection()
        .await
        .map(|success| SmtpSendResult {
            success,
            message: if success {
                "Connection successful".to_string()
            } else {
                "Connection failed".to_string()
            },
        })
        .map_err(|e| format!("SMTP test error: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_base64url_valid() {
        // "Hello" in base64url
        let encoded = "SGVsbG8";
        let decoded = decode_base64url(encoded).unwrap();
        assert_eq!(decoded, b"Hello");
    }

    #[test]
    fn test_decode_base64url_invalid() {
        let result = decode_base64url("!!!invalid!!!");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Base64 decode error"));
    }

    #[test]
    fn test_extract_envelope_valid() {
        let raw = b"From: alice@example.com\r\nTo: bob@example.com\r\nCc: carol@example.com\r\nSubject: Test\r\n\r\nBody";
        let envelope = extract_envelope(raw).unwrap();
        // Envelope should have from and 2 recipients (To + Cc)
        assert!(envelope.from().is_some());
        assert_eq!(envelope.to().len(), 2);
    }

    #[test]
    fn test_extract_envelope_no_from() {
        let raw = b"To: bob@example.com\r\nSubject: Test\r\n\r\nBody";
        let result = extract_envelope(raw);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No From address"));
    }

    #[test]
    fn test_extract_envelope_no_recipients() {
        let raw = b"From: alice@example.com\r\nSubject: Test\r\n\r\nBody";
        let result = extract_envelope(raw);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No recipients found"));
    }

    /// #297: the envelope must still carry the blind recipient, and the bytes
    /// handed to `send_raw` must not.
    #[test]
    fn test_extract_envelope_with_bcc() {
        let raw = b"From: alice@example.com\r\nTo: bob@example.com\r\nBcc: secret@example.com\r\nSubject: Test\r\n\r\nBody";
        let envelope = extract_envelope(raw).unwrap();
        assert_eq!(envelope.to().len(), 2);

        let (wire_envelope, wire) = prepare_for_wire(raw).unwrap();
        assert_eq!(wire_envelope.to().len(), 2);
        assert!(!contains_ci(&wire, b"bcc"), "Bcc reached the wire: {:?}", String::from_utf8_lossy(&wire));
        assert_eq!(
            wire,
            b"From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Test\r\n\r\nBody".to_vec()
        );
    }

    // ---------- #297: strip_bcc_header ----------

    fn contains_ci(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|w| w.eq_ignore_ascii_case(needle))
    }

    fn stripped(raw: &[u8]) -> Vec<u8> {
        strip_bcc_header(raw)
    }

    #[test]
    fn strip_removes_a_single_bcc_line_crlf_and_lf() {
        let crlf = b"From: a@x.org\r\nBcc: s@x.org\r\nTo: b@x.org\r\n\r\nBody\r\n";
        assert_eq!(stripped(crlf), b"From: a@x.org\r\nTo: b@x.org\r\n\r\nBody\r\n".to_vec());
        let lf = b"From: a@x.org\nBcc: s@x.org\nTo: b@x.org\n\nBody\n";
        assert_eq!(stripped(lf), b"From: a@x.org\nTo: b@x.org\n\nBody\n".to_vec());
    }

    #[test]
    fn strip_removes_a_folded_bcc_with_its_continuation_lines() {
        let raw = b"From: a@x.org\r\nBcc: s1@x.org,\r\n s2@x.org,\r\n\ts3@x.org\r\nSubject: hi\r\n\r\nBody";
        assert_eq!(stripped(raw), b"From: a@x.org\r\nSubject: hi\r\n\r\nBody".to_vec());
    }

    #[test]
    fn strip_is_case_insensitive_and_accepts_obsolete_whitespace_before_the_colon() {
        let raw = b"From: a@x.org\r\nBCC: s@x.org\r\nbcc : t@x.org\r\nBcc:\r\nTo: b@x.org\r\n\r\nBody";
        assert_eq!(stripped(raw), b"From: a@x.org\r\nTo: b@x.org\r\n\r\nBody".to_vec());
    }

    #[test]
    fn strip_leaves_every_other_header_and_the_body_alone() {
        let raw = b"From: a@x.org\r\nCc: c@x.org\r\nX-Bcc-Note: keep\r\nBcc-Ish: keep\r\nTo: b@x.org\r\n\r\nBcc: not-a-header@x.org\r\n Bcc: still body\r\n";
        assert_eq!(stripped(raw), raw.to_vec());
    }

    #[test]
    fn strip_handles_a_header_only_message_and_an_empty_input() {
        assert_eq!(stripped(b"From: a@x.org\r\nBcc: s@x.org"), b"From: a@x.org\r\n".to_vec());
        assert_eq!(stripped(b"Bcc: s@x.org\r\nTo: b@x.org"), b"To: b@x.org".to_vec());
        assert_eq!(stripped(b""), Vec::<u8>::new());
    }

    #[test]
    fn strip_does_not_treat_a_continuation_line_as_a_bcc_header() {
        // A folded Subject whose continuation happens to start with "Bcc:".
        let raw = b"Subject: about\r\n Bcc: handling\r\nTo: b@x.org\r\n\r\nBody";
        assert_eq!(stripped(raw), raw.to_vec());
    }

    #[test]
    fn strip_removes_resent_bcc_too_and_the_guard_sees_it() {
        // Gemini LOW 1 on #52: RFC 5322 §3.6.6 gives Resent-Bcc the same rule.
        let raw = b"From: a@x.org\r\nTo: b@x.org\r\nResent-From: a@x.org\r\nResent-To: c@x.org\r\nResent-Bcc: s@x.org\r\n\r\nBody";
        assert_eq!(
            stripped(raw),
            b"From: a@x.org\r\nTo: b@x.org\r\nResent-From: a@x.org\r\nResent-To: c@x.org\r\n\r\nBody".to_vec()
        );
        assert!(refuse_if_bcc(raw).is_err());
    }

    #[test]
    fn strip_finds_the_body_boundary_when_line_endings_are_mixed() {
        // LF headers, CRLF blank line (Gemini NIT 2): the body must stay untouched.
        let raw = b"From: a@x.org\nTo: b@x.org\n\r\nBody\nBcc: not-a-header@x.org\n";
        assert_eq!(stripped(raw), raw.to_vec());
        let with_bcc = b"From: a@x.org\nBcc: s@x.org\n\r\nBody\n";
        assert_eq!(stripped(with_bcc), b"From: a@x.org\n\r\nBody\n".to_vec());
    }

    #[test]
    fn strip_judges_a_whitespace_led_first_line_on_its_own() {
        // Malformed: nothing above it to continue (Gemini NIT 3).
        let raw = b" Bcc: s@x.org\r\nTo: b@x.org\r\n\r\nBody";
        assert_eq!(stripped(raw), b"To: b@x.org\r\n\r\nBody".to_vec());
    }

    #[test]
    fn strip_boundary_cases_folded_last_field_sole_field_and_non_contiguous_fields() {
        // Gemini NIT 4's three inputs.
        let folded_last = b"From: a@x.org\r\nTo: b@x.org\r\nBcc: s1@x.org,\r\n s2@x.org\r\n\r\nBody";
        assert_eq!(stripped(folded_last), b"From: a@x.org\r\nTo: b@x.org\r\n\r\nBody".to_vec());
        let sole = b"Bcc: secret@x.org\r\n\r\nBody";
        assert_eq!(stripped(sole), b"\r\nBody".to_vec());
        let two = b"Bcc: s1@x.org\r\nTo: b@x.org\r\nBcc: s2@x.org,\r\n\ts3@x.org\r\nSubject: Hi\r\n\r\nBody";
        assert_eq!(stripped(two), b"To: b@x.org\r\nSubject: Hi\r\n\r\nBody".to_vec());
    }

    #[test]
    fn prepare_for_wire_keeps_bcc_in_the_envelope_and_out_of_the_bytes() {
        let raw = b"From: a@x.org\r\nTo: b@x.org\r\nBcc: s1@x.org, s2@x.org\r\nSubject: hi\r\n\r\nBody";
        let (envelope, wire) = prepare_for_wire(raw).unwrap();
        assert_eq!(envelope.to().len(), 3);
        let parsed = mail_parser::MessageParser::default().parse(&wire).unwrap();
        assert!(parsed.bcc().is_none());
        assert_eq!(parsed.to().unwrap().first().unwrap().address(), Some("b@x.org"));
        assert!(!contains_ci(&wire, b"bcc"));
    }

    #[test]
    fn the_guard_refuses_bytes_that_still_carry_a_bcc() {
        let leaking = b"From: a@x.org\r\nTo: b@x.org\r\nBcc: s@x.org\r\n\r\nBody";
        let err = refuse_if_bcc(leaking).unwrap_err();
        assert!(err.contains("Bcc"), "{err}");
        assert!(refuse_if_bcc(b"From: a@x.org\r\nTo: b@x.org\r\n\r\nBody").is_ok());
    }
}
