//! PR E REQ-0 — the parser's behaviour today, pinned before any bump.
//!
//! Two kinds of fixture, both inline `&[u8]` messages so the corpus is
//! greppable:
//!
//! - `invariant`: RFC-compliant messages whose persisted fields must be
//!   byte-identical on `mail-parser` 0.9.4 and 0.11.8. **These assertions do
//!   not change between the two commits** (REQ-0.3); a change here is the suite
//!   catching a regression, not a fixture to edit.
//! - `hardening`: malformed or edge inputs where today's behaviour is asserted
//!   as it is (a panic caught by `catch_unwind`, or a degraded output) and the
//!   newer parser is expected to differ. Each assertion that changes in commit 2
//!   is one dispositioned line in the PR body.
//!
//! Every field `parse_message` persists (`ImapMessage`, `ImapAttachment`) has
//! at least one fixture below. Values were taken from a probe run on 0.9.4, not
//! from the RFCs: where the two disagree the fixture says so and sits in
//! `hardening`.
//!
//! Two things the probe showed about today, recorded here because they are
//! findings, not fixtures: (1) `List-Unsubscribe` is parsed by 0.9.4 as an
//! address list, so `extract_header_text` sees no text and the field is never
//! persisted on the IMAP path; (2) a folded `Authentication-Results` keeps only
//! its first line. Both are pinned in `hardening` and named in the PR.

use super::{build_imap_section_map, parse_message, FetchEnvelope, MessageParser};
use crate::imap::types::ImapMessage;

/// Parse `raw` as UID 7 in INBOX with neutral flags and no INTERNALDATE, so
/// every field under test comes from the MIME bytes alone.
fn parse(raw: &[u8]) -> ImapMessage {
    parse_message(
        &MessageParser::default(),
        raw,
        FetchEnvelope {
            uid: 7,
            folder: "INBOX",
            raw_size: raw.len() as u32,
            is_read: false,
            is_starred: false,
            is_draft: false,
            internal_date: None,
        },
    )
    .expect("fixture parses")
}

/// The IMAP section map of `raw`, keyed by mail-parser part index, as a sorted
/// list so assertions read naturally.
fn sections(raw: &[u8]) -> Vec<(usize, String)> {
    let message = MessageParser::default().parse(raw).expect("fixture parses");
    let mut out: Vec<(usize, String)> = build_imap_section_map(&message).into_iter().collect();
    out.sort();
    out
}

/// Run `f` and report whether it panicked — the hardening suite's way of
/// pinning "today this panics" without the panic failing the test. The panic
/// hook is left alone so other tests' messages are not swallowed; a caught
/// panic prints its message once, which is fine.
fn outcome<T>(f: impl FnOnce() -> T + std::panic::UnwindSafe) -> Result<T, String> {
    std::panic::catch_unwind(f).map_err(|e| {
        e.downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| e.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".to_string())
    })
}

/// 2026-09-01T10:45:00Z.
const SEPT_1_1045_UTC: i64 = 1_788_259_500;

mod invariant {
    use super::*;

    const SINGLE_TEXT: &[u8] = b"From: Alice Example <alice@example.com>\r\n\
To: bob@example.net\r\n\
Subject: Plain text\r\n\
Date: Tue, 01 Sep 2026 10:45:00 +0000\r\n\
Message-ID: <single-1@example.com>\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
\r\n\
Hello Bob,\r\n\
\r\n\
this is the body.\r\n";

    #[test]
    fn single_part_text_is_section_one_and_every_scalar_field_round_trips() {
        assert_eq!(sections(SINGLE_TEXT), vec![(0, "1".to_string())]);
        let m = parse(SINGLE_TEXT);
        assert_eq!(m.uid, 7);
        assert_eq!(m.folder, "INBOX");
        assert_eq!(m.raw_size, SINGLE_TEXT.len() as u32);
        assert!(!m.is_read && !m.is_starred && !m.is_draft);
        assert_eq!(m.message_id.as_deref(), Some("single-1@example.com"));
        assert_eq!(m.subject.as_deref(), Some("Plain text"));
        assert_eq!(m.from_address.as_deref(), Some("alice@example.com"));
        assert_eq!(m.from_name.as_deref(), Some("Alice Example"));
        assert_eq!(m.to_addresses.as_deref(), Some("bob@example.net"));
        assert_eq!(m.cc_addresses, None);
        assert_eq!(m.bcc_addresses, None);
        assert_eq!(m.reply_to, None);
        assert_eq!(m.in_reply_to, None);
        assert_eq!(m.references, None);
        assert_eq!(m.date, SEPT_1_1045_UTC);
        // A single-part text body keeps its trailing CRLF …
        assert_eq!(
            m.body_text.as_deref(),
            Some("Hello Bob,\r\n\r\nthis is the body.\r\n")
        );
        // … and mail-parser synthesises an HTML body from it.
        assert_eq!(
            m.body_html.as_deref(),
            Some("<html><body>Hello Bob,<br/><br/>this is the body.<br/></body></html>")
        );
        // Each whitespace byte becomes one space; runs are not squeezed.
        assert_eq!(
            m.snippet.as_deref(),
            Some("Hello Bob,    this is the body.")
        );
        assert!(m.attachments.is_empty());
        assert_eq!(m.list_unsubscribe, None);
        assert_eq!(m.list_unsubscribe_post, None);
        assert_eq!(m.auth_results, None);
    }

    #[test]
    fn the_date_header_beats_internaldate_and_internaldate_backs_a_missing_one() {
        let dated = parse_message(
            &MessageParser::default(),
            SINGLE_TEXT,
            FetchEnvelope {
                uid: 1,
                folder: "Sent",
                raw_size: 1,
                is_read: true,
                is_starred: true,
                is_draft: true,
                internal_date: Some(42),
            },
        )
        .unwrap();
        assert_eq!(dated.date, SEPT_1_1045_UTC);
        assert_eq!(dated.folder, "Sent");
        assert!(dated.is_read && dated.is_starred && dated.is_draft);

        let undated = parse_message(
            &MessageParser::default(),
            b"From: a@example.com\r\n\r\nx\r\n",
            FetchEnvelope {
                uid: 1,
                folder: "INBOX",
                raw_size: 1,
                is_read: false,
                is_starred: false,
                is_draft: false,
                internal_date: Some(42),
            },
        )
        .unwrap();
        assert_eq!(undated.date, 42);
        // Neither a Date header nor INTERNALDATE: 0, as today.
        assert_eq!(
            parse(b"From: a@example.com\r\nSubject: undated\r\n\r\nx\r\n").date,
            0
        );
    }

    #[test]
    fn a_date_with_a_negative_numeric_zone_is_the_same_instant() {
        let raw = b"From: a@example.com\r\nDate: Tue, 01 Sep 2026 05:45:00 -0500\r\n\r\nx\r\n";
        assert_eq!(parse(raw).date, SEPT_1_1045_UTC);
    }

    const MIXED_WITH_ALTERNATIVE_AND_FILE: &[u8] = b"From: alice@example.com\r\n\
To: bob@example.net\r\n\
Subject: Mixed\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"outer\"\r\n\
\r\n\
--outer\r\n\
Content-Type: multipart/alternative; boundary=\"inner\"\r\n\
\r\n\
--inner\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
\r\n\
Plain body\r\n\
--inner\r\n\
Content-Type: text/html; charset=utf-8\r\n\
\r\n\
<p>HTML body</p>\r\n\
--inner--\r\n\
--outer\r\n\
Content-Type: application/pdf; name=\"report.pdf\"\r\n\
Content-Disposition: attachment; filename=\"report.pdf\"\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
JVBERi0xLjQKJcOkw7zDtsOfCg==\r\n\
--outer--\r\n";

    #[test]
    fn mixed_with_nested_alternative_and_a_file_numbers_sections_like_imap() {
        // Part indices: 0 root, 1 alternative, 2 text, 3 html, 4 pdf.
        assert_eq!(
            sections(MIXED_WITH_ALTERNATIVE_AND_FILE),
            vec![
                (2, "1.1".to_string()),
                (3, "1.2".to_string()),
                (4, "2".to_string()),
            ]
        );
        let m = parse(MIXED_WITH_ALTERNATIVE_AND_FILE);
        // Multipart bodies come back without the trailing CRLF before the boundary.
        assert_eq!(m.body_text.as_deref(), Some("Plain body"));
        assert_eq!(m.body_html.as_deref(), Some("<p>HTML body</p>"));
        assert_eq!(m.snippet.as_deref(), Some("Plain body"));
        assert_eq!(m.attachments.len(), 1);
        let a = &m.attachments[0];
        assert_eq!(a.part_id, "2");
        assert_eq!(a.filename, "report.pdf");
        assert_eq!(a.mime_type, "application/pdf");
        // 28 base64 characters with two `=` decode to 19 bytes.
        assert_eq!(a.size, 19);
        assert_eq!(a.content_id, None);
        assert!(!a.is_inline);
    }

    const INLINE_IMAGE: &[u8] = b"From: alice@example.com\r\n\
Subject: Inline\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/related; boundary=\"rel\"\r\n\
\r\n\
--rel\r\n\
Content-Type: text/html; charset=utf-8\r\n\
\r\n\
<img src=\"cid:logo@example.com\">\r\n\
--rel\r\n\
Content-Type: image/png; name=\"logo.png\"\r\n\
Content-ID: <logo@example.com>\r\n\
Content-Disposition: inline; filename=\"logo.png\"\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
iVBORw0KGgo=\r\n\
--rel--\r\n";

    #[test]
    fn inline_image_carries_its_content_id_and_inline_flag() {
        assert_eq!(
            sections(INLINE_IMAGE),
            vec![(1, "1".to_string()), (2, "2".to_string())]
        );
        let m = parse(INLINE_IMAGE);
        assert_eq!(m.attachments.len(), 1);
        let a = &m.attachments[0];
        assert_eq!(a.part_id, "2");
        assert_eq!(a.filename, "logo.png");
        assert_eq!(a.mime_type, "image/png");
        assert_eq!(a.size, 8);
        assert_eq!(a.content_id.as_deref(), Some("logo@example.com"));
        assert!(a.is_inline);
        assert_eq!(
            m.body_html.as_deref(),
            Some("<img src=\"cid:logo@example.com\">")
        );
        // No text part: the text body is present and empty, not absent.
        assert_eq!(m.body_text.as_deref(), Some(""));
        assert_eq!(m.snippet.as_deref(), Some(""));
    }

    const NESTED_RFC822: &[u8] = b"From: alice@example.com\r\n\
Subject: Forwarded\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"fwd\"\r\n\
\r\n\
--fwd\r\n\
Content-Type: text/plain\r\n\
\r\n\
See attached.\r\n\
--fwd\r\n\
Content-Type: message/rfc822\r\n\
Content-Disposition: attachment; filename=\"original.eml\"\r\n\
\r\n\
From: carol@example.org\r\n\
Subject: The original\r\n\
Content-Type: text/plain\r\n\
\r\n\
Original body\r\n\
--fwd--\r\n";

    #[test]
    fn nested_rfc822_is_one_attachment_at_section_two_and_its_body_stays_inside() {
        // Part indices: 0 root, 1 text, 2 the nested message — a leaf for IMAP
        // numbering; its own parts are not sections of the outer message.
        let s = sections(NESTED_RFC822);
        assert_eq!(s[0], (1, "1".to_string()));
        assert_eq!(s[1], (2, "2".to_string()));
        let m = parse(NESTED_RFC822);
        assert_eq!(m.body_text.as_deref(), Some("See attached."));
        assert_eq!(
            m.body_html.as_deref(),
            Some("<html><body>See attached.</body></html>")
        );
        assert_eq!(m.attachments.len(), 1);
        let a = &m.attachments[0];
        assert_eq!(a.part_id, "2");
        assert_eq!(a.filename, "original.eml");
        assert_eq!(a.mime_type, "message/rfc822");
        // The nested message's own bytes, headers included.
        assert_eq!(a.size, 89);
        assert!(!a.is_inline);
    }

    #[test]
    fn iso_8859_1_and_windows_1252_bodies_decode_to_the_right_characters() {
        // The full_encoding guard: without the encoding tables these bodies are
        // not decoded. `caf\xe9` is "café" in ISO-8859-1; `\x80` is "€" in
        // Windows-1252.
        let latin1: &[u8] = b"From: a@example.com\r\n\
Content-Type: text/plain; charset=iso-8859-1\r\n\
\r\n\
caf\xe9\r\n";
        let m = parse(latin1);
        assert_eq!(m.body_text.as_deref(), Some("caf\u{e9}\r\n"));
        assert_eq!(
            m.body_html.as_deref(),
            Some("<html><body>caf\u{e9}<br/></body></html>")
        );
        let cp1252: &[u8] = b"From: a@example.com\r\n\
Content-Type: text/plain; charset=windows-1252\r\n\
\r\n\
5 \x80\r\n";
        assert_eq!(parse(cp1252).body_text.as_deref(), Some("5 \u{20ac}\r\n"));
    }

    #[test]
    fn quoted_printable_and_base64_text_bodies_decode() {
        let qp: &[u8] = b"From: a@example.com\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
Content-Transfer-Encoding: quoted-printable\r\n\
\r\n\
caf=C3=A9 =\r\n\
continued\r\n";
        assert_eq!(
            parse(qp).body_text.as_deref(),
            Some("caf\u{e9} continued\r\n")
        );
        let b64: &[u8] = b"From: a@example.com\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
Y2Fmw6kNCg==\r\n";
        assert_eq!(parse(b64).body_text.as_deref(), Some("caf\u{e9}\r\n"));
    }

    #[test]
    fn addresses_plain_encoded_quoted_comma_empty_group_and_several() {
        let raw: &[u8] = b"From: =?UTF-8?B?SsO8cmdlbiBNw7xsbGVy?= <juergen@example.de>\r\n\
To: \"Pepper, Jim\" <jim@example.com>, bob@example.net, Carol <carol@example.org>\r\n\
Cc: undisclosed-recipients:;\r\n\
Bcc: hidden@example.com\r\n\
Reply-To: Replies <reply@example.de>\r\n\
Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=\r\n\
\r\n\
x\r\n";
        let m = parse(raw);
        assert_eq!(m.from_address.as_deref(), Some("juergen@example.de"));
        assert_eq!(m.from_name.as_deref(), Some("J\u{fc}rgen M\u{fc}ller"));
        assert_eq!(
            m.to_addresses.as_deref(),
            Some("Pepper, Jim <jim@example.com>, bob@example.net, Carol <carol@example.org>")
        );
        // An empty group has no addresses: the field is absent.
        assert_eq!(m.cc_addresses, None);
        assert_eq!(m.bcc_addresses.as_deref(), Some("hidden@example.com"));
        assert_eq!(m.reply_to.as_deref(), Some("Replies <reply@example.de>"));
        assert_eq!(m.subject.as_deref(), Some("Gr\u{fc}\u{df}e"));
    }

    #[test]
    fn a_group_with_members_flattens_to_its_members() {
        let raw: &[u8] = b"From: a@example.com\r\n\
To: Team: alice@example.com, Bob <bob@example.net>;\r\n\
\r\n\
x\r\n";
        assert_eq!(
            parse(raw).to_addresses.as_deref(),
            Some("alice@example.com, Bob <bob@example.net>")
        );
    }

    #[test]
    fn threading_headers_lose_their_angle_brackets_and_references_join_with_spaces() {
        // References on one line: both ids, space-joined. (The folded form is
        // a hardening case — today it keeps only the first id.)
        let raw: &[u8] = b"From: a@example.com\r\n\
Message-ID: <msg-3@example.com>\r\n\
In-Reply-To: <msg-2@example.com>\r\n\
References: <msg-1@example.com> <msg-2@example.com>\r\n\
\r\n\
x\r\n";
        let m = parse(raw);
        assert_eq!(m.message_id.as_deref(), Some("msg-3@example.com"));
        assert_eq!(m.in_reply_to.as_deref(), Some("msg-2@example.com"));
        assert_eq!(
            m.references.as_deref(),
            Some("msg-1@example.com msg-2@example.com")
        );
    }

    #[test]
    fn unsubscribe_post_and_a_single_line_authentication_results_are_extracted_verbatim() {
        let raw: &[u8] = b"From: news@example.com\r\n\
List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\
Authentication-Results: mx.example.net; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass\r\n\
\r\n\
x\r\n";
        let m = parse(raw);
        assert_eq!(
            m.list_unsubscribe_post.as_deref(),
            Some("List-Unsubscribe=One-Click")
        );
        assert_eq!(
            m.auth_results.as_deref(),
            Some("mx.example.net; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass")
        );
    }

    #[test]
    fn snippet_collapses_whitespace_and_truncates_at_two_hundred_characters() {
        let long = "w".repeat(250);
        let raw = format!("From: a@example.com\r\n\r\n  {long}\t\r\n");
        let m = parse(raw.as_bytes());
        let snippet = m.snippet.unwrap();
        assert!(snippet.starts_with("wwww"));
        assert!(snippet.ends_with("..."));
        assert_eq!(snippet.chars().count(), 203);
    }

    #[test]
    fn an_attachment_without_a_name_or_type_gets_the_defaults() {
        let raw: &[u8] = b"From: a@example.com\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"b\"\r\n\
\r\n\
--b\r\n\
Content-Type: text/plain\r\n\
\r\n\
body\r\n\
--b\r\n\
Content-Disposition: attachment\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
AAEC\r\n\
--b--\r\n";
        let m = parse(raw);
        assert_eq!(m.attachments.len(), 1);
        let a = &m.attachments[0];
        assert_eq!(a.part_id, "2");
        assert_eq!(a.filename, "attachment");
        assert_eq!(a.mime_type, "application/octet-stream");
        assert_eq!(a.size, 3);
    }
}

mod hardening {
    use super::*;

    /// Result of parsing a malformed message: `Ok(parsed)` or `Err(panic text)`.
    fn try_parse(raw: &'static [u8]) -> Result<ImapMessage, String> {
        outcome(move || parse(raw))
    }

    #[test]
    fn an_obsolete_zone_name_is_read_as_utc_today() {
        // RFC 5322 §4.3: EST is -0500, so 05:45 EST is 10:45Z. 0.9.4 ignores the
        // name and reads the time as UTC; 0.10.0's changelog says obsolete zones
        // are parsed, so commit 2 is expected to move this to SEPT_1_1045_UTC.
        let raw = b"From: a@example.com\r\nDate: Tue, 01 Sep 2026 05:45:00 EST\r\n\r\nx\r\n";
        assert_eq!(parse(raw).date, SEPT_1_1045_UTC - 5 * 3600);
    }

    #[test]
    fn a_folded_references_header_keeps_only_its_first_id_today() {
        let raw: &[u8] = b"From: a@example.com\r\n\
References: <msg-1@example.com>\r\n\
 <msg-2@example.com>\r\n\
\r\n\
x\r\n";
        let m = try_parse(raw).expect("0.9.4 does not panic");
        assert_eq!(m.references.as_deref(), Some("msg-1@example.com"));
    }

    #[test]
    fn list_unsubscribe_is_never_persisted_today_and_a_folded_auth_results_is_truncated() {
        // Finding, not fixture: 0.9.4 parses List-Unsubscribe as an *address
        // list*, so the text extractor sees nothing and the IMAP path never
        // stores the header the one-click unsubscribe feature needs. And a
        // folded Authentication-Results keeps its first line only.
        let raw: &[u8] = b"From: news@example.com\r\n\
List-Unsubscribe: <https://example.com/u?x=1>, <mailto:unsub@example.com>\r\n\
Authentication-Results: mx.example.net; spf=pass smtp.mailfrom=example.com;\r\n\
 dkim=pass header.d=example.com; dmarc=pass\r\n\
\r\n\
x\r\n";
        let m = try_parse(raw).expect("0.9.4 does not panic");
        assert_eq!(m.list_unsubscribe, None);
        assert_eq!(
            m.auth_results.as_deref(),
            Some("mx.example.net; spf=pass smtp.mailfrom=example.com;")
        );
    }

    #[test]
    fn truncated_base64_attachment_yields_what_could_be_decoded() {
        // The base64 body stops mid-quantum. Today: no panic, the attachment
        // keeps the decodable prefix (six bytes of "AAECAwQFB").
        let raw: &[u8] = b"From: a@example.com\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"b\"\r\n\
\r\n\
--b\r\n\
Content-Type: text/plain\r\n\
\r\n\
body\r\n\
--b\r\n\
Content-Type: application/octet-stream; name=\"x.bin\"\r\n\
Content-Disposition: attachment; filename=\"x.bin\"\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
AAECAwQFB\r\n\
--b--\r\n";
        let m = try_parse(raw).expect("0.9.4 does not panic");
        assert_eq!(m.attachments.len(), 1);
        assert_eq!(m.attachments[0].filename, "x.bin");
        assert_eq!(m.attachments[0].size, 6);
    }

    #[test]
    fn missing_closing_boundary_still_yields_both_parts() {
        let raw: &[u8] = b"From: a@example.com\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"b\"\r\n\
\r\n\
--b\r\n\
Content-Type: text/plain\r\n\
\r\n\
body\r\n\
--b\r\n\
Content-Type: text/plain; name=\"notes.txt\"\r\n\
Content-Disposition: attachment; filename=\"notes.txt\"\r\n\
\r\n\
unterminated\r\n";
        let m = try_parse(raw).expect("0.9.4 does not panic");
        assert_eq!(m.body_text.as_deref(), Some("body"));
        assert_eq!(m.attachments.len(), 1);
        assert_eq!(m.attachments[0].filename, "notes.txt");
        assert_eq!(m.attachments[0].part_id, "2");
        // The unterminated part runs to the end of input, CRLF included.
        assert_eq!(m.attachments[0].size, 14);
    }

    #[test]
    fn quoted_printable_with_a_stray_equals_loses_the_body_today() {
        // `=` followed by something that is not two hex digits. 0.9.4 gives up
        // on the text: no body, and the part is listed as a nameless text
        // attachment at section 1. 0.11.4's changelog says such bodies are
        // decoded leniently, so commit 2 is expected to change this.
        let raw: &[u8] = b"From: a@example.com\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
Content-Transfer-Encoding: quoted-printable\r\n\
\r\n\
a=b 100=% done=\r\n";
        let m = try_parse(raw).expect("0.9.4 does not panic");
        assert_eq!(m.body_text, None);
        assert_eq!(m.body_html, None);
        assert_eq!(m.snippet, None);
        assert_eq!(m.attachments.len(), 1);
        assert_eq!(m.attachments[0].part_id, "1");
        assert_eq!(m.attachments[0].filename, "attachment");
        assert_eq!(m.attachments[0].mime_type, "text/plain");
        assert_eq!(m.attachments[0].size, 17);
    }

    #[test]
    fn corrupted_nested_rfc822_is_still_listed_as_an_attachment_today() {
        let raw: &[u8] = b"From: a@example.com\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"b\"\r\n\
\r\n\
--b\r\n\
Content-Type: text/plain\r\n\
\r\n\
outer\r\n\
--b\r\n\
Content-Type: message/rfc822\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
!!!!not base64 at all!!!!\r\n\
--b--\r\n";
        let m = try_parse(raw).expect("0.9.4 does not panic");
        assert_eq!(m.body_text.as_deref(), Some("outer"));
        assert_eq!(m.attachments.len(), 1);
        assert_eq!(m.attachments[0].mime_type, "message/rfc822");
        assert_eq!(m.attachments[0].filename, "attachment");
        assert_eq!(m.attachments[0].part_id, "2");
        assert_eq!(m.attachments[0].size, 25);
    }

    #[test]
    fn a_received_header_ending_in_a_whitespace_only_line_ends_the_headers_today() {
        // The shape 0.11.6 fixed a panic for. 0.9.4 does not panic, but it takes
        // the whitespace-only continuation line as the header/body separator:
        // everything after it becomes the body and From/Subject are lost.
        let raw: &[u8] = b"Received: from mx.example.net (mx.example.net [192.0.2.1])\r\n\
 by mail.example.com with ESMTPS id abc123\r\n\
 for <bob@example.com>;\r\n\
 \r\n\
From: a@example.com\r\n\
Subject: after received\r\n\
\r\n\
x\r\n";
        let m = try_parse(raw).expect("0.9.4 does not panic");
        assert_eq!(m.from_address, None);
        assert_eq!(m.subject, None);
        assert_eq!(
            m.body_text.as_deref(),
            Some("From: a@example.com\r\nSubject: after received\r\n\r\nx\r\n")
        );
    }

    #[test]
    fn a_name_followed_by_a_comment_keeps_the_comment_in_the_name_today() {
        // 0.11.6 changelog: "Multi-word display names followed by a comment no
        // longer produce a fabricated address". Today the comment rides along
        // inside the display name.
        let raw: &[u8] = b"From: a@example.com\r\n\
To: John Q Public (comment) <jqp@example.com>\r\n\
\r\n\
x\r\n";
        let m = try_parse(raw).expect("0.9.4 does not panic");
        assert_eq!(
            m.to_addresses.as_deref(),
            Some("John Q Public (comment) <jqp@example.com>")
        );
    }

    #[test]
    fn headers_without_a_body_separator_lose_the_last_header_today() {
        // 0.11.0's changelog: "Fix: Parsing of headers without LFs". Today the
        // last header of an unterminated header block is dropped.
        let raw: &[u8] = b"From: a@example.com\r\nSubject: no blank line";
        let m = try_parse(raw).expect("0.9.4 does not panic");
        assert_eq!(m.from_address.as_deref(), Some("a@example.com"));
        assert_eq!(m.subject, None);
        assert_eq!(m.body_text, None);
    }
}
