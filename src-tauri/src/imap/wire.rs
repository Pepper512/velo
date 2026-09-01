//! IMAP wire-protocol argument validation.
//!
//! Every string Velo interpolates into an IMAP command passes through here first.
//!
//! # Why this module exists
//!
//! IMAP is a line-oriented protocol: commands are separated by CRLF. A value
//! containing `\r\n` that reaches the wire unescaped does not corrupt one command,
//! it *appends a second one* — which then runs inside the user's authenticated
//! session. Folder names in particular are not user-controlled in the trustworthy
//! sense: they arrive from the server via `LIST`, travel through the UI, and come
//! back across the Tauri IPC boundary as `#[tauri::command]` arguments.
//!
//! Per ADR-000 ("Standard → this stack"), each command validates its own arguments.
//! Tauri capabilities are the middleware, not the check.
//!
//! # What `async-imap` does and does not do for us
//!
//! Verified against the vendored source of `async-imap` 0.10.4:
//!
//! | Call | Argument | Validated by the library? |
//! |---|---|---|
//! | `select`, `examine` | mailbox | **yes** — `validate_str` (`client.rs:343`, `:380`) |
//! | `uid_copy`, `uid_mv` | mailbox | **yes** — `validate_str` (`:909`, `:928`) |
//! | `status` | mailbox | **yes** — `validate_str` (`:1064`) |
//! | `login` | username, password | **yes** — `validate_str` (`:188`) |
//! | `uid_store` | query (the flag list) | **NO** — raw `format!` (`:808-828`) |
//! | `uid_search` | query | **NO** — raw `format!` (`:1219-1221`) |
//! | `append` | mailbox **and** flags | **NO** — raw `format!` (`:1119-1136`) |
//!
//! So the library covers the mailbox argument on most commands but leaves three
//! sinks open, and Velo additionally hand-builds raw commands in
//! `raw_fetch_messages` / `raw_fetch_diagnostic`. This module covers both groups.

/// Maximum accepted length of a UID set string (`"1,2,3:9"`).
///
/// A UID set is generated from `Vec<u32>` on every internal path; the cap only
/// bounds what a hostile caller can push across the IPC boundary.
const MAX_UID_SET_LEN: usize = 4096;

/// The five RFC 3501 §2.3.2 system flags Velo will send.
const SYSTEM_FLAGS: [&str; 5] = ["Seen", "Answered", "Flagged", "Deleted", "Draft"];

/// Reject the three bytes that can break IMAP framing.
///
/// `\r` and `\n` terminate a command; NUL is not valid in an IMAP string and some
/// servers truncate on it. Everything else — including non-ASCII UTF-8 — is allowed
/// through, so international mailbox names keep working.
fn reject_control_bytes(value: &str, what: &str) -> Result<(), String> {
    for b in value.bytes() {
        if b == b'\r' || b == b'\n' || b == 0 {
            return Err(format!(
                "invalid {what}: contains a carriage return, line feed, or NUL byte"
            ));
        }
    }
    Ok(())
}

/// Quote a value as an IMAP quoted-string.
///
/// Escapes `\` and `"` (in that order — reversing them would double-escape the
/// backslashes introduced by the quote escape) and rejects CRLF/NUL outright,
/// because a quoted-string cannot contain them at all: RFC 3501 requires a literal
/// for that, and none of our call sites can emit one.
///
/// Deliberately matches `async-imap`'s own `validate_str` semantics so the raw and
/// library paths behave identically.
pub fn quote_string(value: &str) -> Result<String, String> {
    reject_control_bytes(value, "IMAP argument")?;
    Ok(format!(
        "\"{}\"",
        value.replace('\\', r"\\").replace('"', "\\\"")
    ))
}

/// Validate a mailbox name that is about to reach a command `async-imap` does *not*
/// validate for us (currently only `append`).
///
/// Returns the input unchanged so it can be used inline. Does **not** quote: the
/// caller (`session.append`) adds its own quotes.
pub fn validate_mailbox(folder: &str) -> Result<&str, String> {
    if folder.is_empty() {
        return Err("invalid mailbox: empty".to_string());
    }
    reject_control_bytes(folder, "mailbox name")?;
    // `append` interpolates the mailbox *inside* quotes without escaping, so an
    // embedded quote or backslash would break out of the quoted-string.
    if folder.contains('"') || folder.contains('\\') {
        return Err(
            "invalid mailbox: contains a quote or backslash that cannot be escaped here"
                .to_string(),
        );
    }
    Ok(folder)
}

/// Validate a UID set / sequence set (`"1"`, `"1,5,9"`, `"1:*"`, `"2:4,7"`).
///
/// Accepts only digits, `,`, `:` and `*` — the complete RFC 3501 §9 `sequence-set`
/// alphabet. Anything else (a space, a quote, CRLF, a letter) is rejected, so no
/// `uid_range` can smuggle a second command or an extra FETCH item.
pub fn validate_uid_set(uid_set: &str) -> Result<&str, String> {
    if uid_set.is_empty() {
        return Err("invalid UID set: empty".to_string());
    }
    if uid_set.len() > MAX_UID_SET_LEN {
        return Err(format!(
            "invalid UID set: longer than {MAX_UID_SET_LEN} bytes"
        ));
    }
    for b in uid_set.bytes() {
        if !(b.is_ascii_digit() || b == b',' || b == b':' || b == b'*') {
            return Err(
                "invalid UID set: only digits and the characters , : * are allowed".to_string(),
            );
        }
    }
    Ok(uid_set)
}

/// Build the parenthesised flag list for a `STORE` / `APPEND` command.
///
/// Each entry may be given with or without its leading backslash. System flags are
/// normalised to their canonical spelling; anything else must be a valid RFC 3501
/// `atom` (a keyword), which by construction contains no space, quote, backslash,
/// parenthesis, brace, `%`, `*`, `]`, or control byte — so the rendered list cannot
/// break framing.
///
/// Returns e.g. `(\Seen \Flagged)`.
pub fn build_flag_list(flags: &[String]) -> Result<String, String> {
    if flags.is_empty() {
        return Err("invalid flag list: empty".to_string());
    }

    let mut rendered = Vec::with_capacity(flags.len());
    for flag in flags {
        let bare = flag.strip_prefix('\\').unwrap_or(flag);
        if bare.is_empty() {
            return Err("invalid flag: empty".to_string());
        }

        match SYSTEM_FLAGS.iter().find(|sf| sf.eq_ignore_ascii_case(bare)) {
            // Canonical spelling, always backslash-prefixed.
            Some(canonical) => rendered.push(format!("\\{canonical}")),
            // A keyword. RFC 3501 keywords carry no backslash.
            None => {
                validate_atom(bare)?;
                rendered.push(bare.to_string());
            }
        }
    }

    Ok(format!("({})", rendered.join(" ")))
}

/// Validate an RFC 3501 §9 `atom`: any CHAR except `atom-specials`.
///
/// `atom-specials` = `(` `)` `{` SP CTL `list-wildcards` (`%` `*`) `quoted-specials`
/// (`"` `\`) `]`. We additionally reject non-ASCII, since an atom is defined over
/// CHAR (7-bit) and a keyword outside that range is not something Velo should invent.
fn validate_atom(value: &str) -> Result<(), String> {
    for b in value.bytes() {
        let is_special = matches!(
            b,
            b'(' | b')' | b'{' | b' ' | b'%' | b'*' | b'"' | b'\\' | b']'
        );
        if is_special || b.is_ascii_control() || !b.is_ascii() {
            return Err(format!(
                "invalid flag keyword: {value:?} contains a character not allowed in an IMAP atom"
            ));
        }
    }
    Ok(())
}

/// Validate an IMAP `SEARCH` date in RFC 3501 `date-text` form: `DD-Mon-YYYY`.
///
/// Reaches the wire through `uid_search("SINCE {date}")`, which `async-imap` does
/// not validate, so this is the only thing standing between a caller-supplied string
/// and an arbitrary `SEARCH` key.
pub fn validate_search_date(date: &str) -> Result<&str, String> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];

    let invalid = || format!("invalid search date {date:?}: expected DD-Mon-YYYY");

    let mut parts = date.split('-');
    let (Some(day), Some(month), Some(year), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(invalid());
    };

    // RFC 3501 allows 1 or 2 digits for the day; the year is always 4.
    if day.is_empty() || day.len() > 2 || !day.bytes().all(|b| b.is_ascii_digit()) {
        return Err(invalid());
    }
    if year.len() != 4 || !year.bytes().all(|b| b.is_ascii_digit()) {
        return Err(invalid());
    }
    if !MONTHS.contains(&month) {
        return Err(invalid());
    }

    let day_num: u32 = day.parse().map_err(|_| invalid())?;
    if !(1..=31).contains(&day_num) {
        return Err(invalid());
    }

    Ok(date)
}

/// Validate the username used in the XOAUTH2 SASL blob.
///
/// The blob is `user=<name>\x01auth=Bearer <token>\x01\x01` and is base64-encoded
/// before it reaches the wire, so CRLF cannot break framing here. What *can* go
/// wrong is a `\x01` inside the username desynchronising the server's field split.
pub fn validate_sasl_username(username: &str) -> Result<&str, String> {
    if username.is_empty() {
        return Err("invalid username: empty".to_string());
    }
    if username.bytes().any(|b| b.is_ascii_control()) {
        return Err("invalid username: contains a control character".to_string());
    }
    Ok(username)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- quote_string ----------

    #[test]
    fn quote_string_wraps_plain_input() {
        assert_eq!(quote_string("INBOX").unwrap(), "\"INBOX\"");
    }

    #[test]
    fn quote_string_escapes_quote_and_backslash() {
        assert_eq!(quote_string(r#"a"b"#).unwrap(), r#""a\"b""#);
        assert_eq!(quote_string(r"a\b").unwrap(), r#""a\\b""#);
        // Order matters: the backslash introduced by escaping the quote must not
        // itself be escaped again.
        assert_eq!(quote_string(r#"\""#).unwrap(), r#""\\\"""#);
    }

    #[test]
    fn quote_string_passes_non_ascii_through() {
        // Regression guard for the rollback risk named in the Batch A brief:
        // international mailbox names must keep working.
        assert_eq!(quote_string("Entwürfe").unwrap(), "\"Entwürfe\"");
        assert_eq!(quote_string("受信トレイ").unwrap(), "\"受信トレイ\"");
    }

    #[test]
    fn quote_string_rejects_crlf_and_nul() {
        for hostile in ["a\rb", "a\nb", "a\r\nb", "a\0b"] {
            assert!(quote_string(hostile).is_err(), "should reject {hostile:?}");
        }
    }

    #[test]
    fn quote_string_blocks_command_injection() {
        // The attack this module exists to stop.
        let hostile = "x\"\r\na9 DELETE INBOX";
        assert!(quote_string(hostile).is_err());
    }

    #[test]
    fn quoted_folder_cannot_escape_the_quoted_string() {
        // Without CRLF, a quote alone must not terminate the argument early.
        let quoted = quote_string(r#"Sent" (\Deleted) "#).unwrap();
        // Exactly two unescaped quotes: the opening and closing ones.
        let unescaped = quoted
            .char_indices()
            .filter(|&(i, c)| c == '"' && (i == 0 || quoted.as_bytes()[i - 1] != b'\\'))
            .count();
        assert_eq!(unescaped, 2, "quoted string was {quoted}");
    }

    // ---------- validate_mailbox ----------

    #[test]
    fn validate_mailbox_accepts_normal_names() {
        assert!(validate_mailbox("INBOX").is_ok());
        assert!(validate_mailbox("INBOX/Sent Items").is_ok());
        assert!(validate_mailbox("Entwürfe").is_ok());
    }

    #[test]
    fn validate_mailbox_rejects_framing_and_quote_breakers() {
        for hostile in ["", "a\r\nb", "a\0b", r#"x" (\Deleted) ""#, r"back\slash"] {
            assert!(
                validate_mailbox(hostile).is_err(),
                "should reject {hostile:?}"
            );
        }
    }

    // ---------- validate_uid_set ----------

    #[test]
    fn validate_uid_set_accepts_sequence_sets() {
        for ok in ["1", "1,5,9", "1:*", "2:4,7", "*"] {
            assert!(validate_uid_set(ok).is_ok(), "should accept {ok:?}");
        }
    }

    #[test]
    fn validate_uid_set_rejects_anything_else() {
        for hostile in [
            "",
            "1 BODY[]",
            "1:*\r\na9 LOGOUT",
            "1;2",
            "abc",
            "1, 2",
            "\"1\"",
        ] {
            assert!(
                validate_uid_set(hostile).is_err(),
                "should reject {hostile:?}"
            );
        }
    }

    #[test]
    fn validate_uid_set_rejects_overlong_input() {
        let long = "1,".repeat(MAX_UID_SET_LEN);
        assert!(validate_uid_set(&long).is_err());
    }

    // ---------- build_flag_list ----------

    #[test]
    fn build_flag_list_renders_system_flags() {
        let flags = vec!["Seen".to_string(), "\\Flagged".to_string()];
        assert_eq!(build_flag_list(&flags).unwrap(), r"(\Seen \Flagged)");
    }

    #[test]
    fn build_flag_list_normalises_case() {
        let flags = vec!["seen".to_string(), "DELETED".to_string()];
        assert_eq!(build_flag_list(&flags).unwrap(), r"(\Seen \Deleted)");
    }

    #[test]
    fn build_flag_list_allows_keywords_without_backslash() {
        let flags = vec!["$Forwarded".to_string()];
        assert_eq!(build_flag_list(&flags).unwrap(), "($Forwarded)");
    }

    #[test]
    fn build_flag_list_rejects_injection() {
        // The pre-fix code prefixed a backslash and interpolated verbatim, so this
        // produced: UID STORE 1 +FLAGS (\Seen)\r\na9 LOGOUT)
        let hostile = vec!["Seen)\r\na9 LOGOUT".to_string()];
        assert!(build_flag_list(&hostile).is_err());
    }

    #[test]
    fn build_flag_list_rejects_atom_specials_and_empty() {
        for hostile in [
            "a b", "a(b", "a)b", "a\"b", r"a\\b", "a]b", "a%b", "a*b", "a{b",
        ] {
            assert!(
                build_flag_list(&[hostile.to_string()]).is_err(),
                "should reject {hostile:?}"
            );
        }
        assert!(build_flag_list(&[]).is_err());
        assert!(build_flag_list(&["\\".to_string()]).is_err());
    }

    // ---------- validate_search_date ----------

    #[test]
    fn validate_search_date_accepts_rfc3501_dates() {
        for ok in ["1-Jan-2020", "01-Jan-2020", "28-Feb-2026", "31-Dec-1999"] {
            assert!(validate_search_date(ok).is_ok(), "should accept {ok:?}");
        }
    }

    #[test]
    fn validate_search_date_rejects_search_key_injection() {
        for hostile in [
            "1-Jan-2020 OR ALL",
            "1-Jan-2020\r\na9 LOGOUT",
            "2020-01-01",
            "1-Foo-2020",
            "32-Jan-2020",
            "0-Jan-2020",
            "1-Jan-20",
            "1-Jan-2020-extra",
            "",
            "ALL",
        ] {
            assert!(
                validate_search_date(hostile).is_err(),
                "should reject {hostile:?}"
            );
        }
    }

    // ---------- validate_sasl_username ----------

    #[test]
    fn validate_sasl_username_rejects_control_bytes() {
        assert!(validate_sasl_username("user@example.com").is_ok());
        assert!(validate_sasl_username("user\x01auth=Bearer stolen").is_err());
        assert!(validate_sasl_username("").is_err());
    }
}
