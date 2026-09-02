//! #241 — the FETCH attribute-list guard (SPEC-241 REQ-1.3).
//!
//! RFC 3501 §6.4.5: one fetch attribute may stand alone; two or more MUST be
//! parenthesised. `async-imap` sends the query verbatim and Stalwart answers a
//! bare list without the body, so the rule has to hold at every call site —
//! including the ones written after this. This module scans `client.rs` as
//! text: every `.uid_fetch(` / `.fetch(` call (arguments may span lines,
//! literals may contain commas and parentheses, `//` comments are ignored)
//! and every command string that spells out `… FETCH <set> <attributes>`,
//! resolves the attribute list it sends — a literal or one of the `FETCH_*`
//! constants — and fails on a bare multi-attribute list. Unknown identifiers
//! fail closed. The scanner is unit-tested on fixtures here (Gemini M1/L2/L3,
//! Grok M1/M2/L3/L4/N6 on #57), which is why it lives in its own file: the
//! fixtures must not be part of the source it scans.

use super::client::{FETCH_BODY, FETCH_UID_FLAGS_BODY, FETCH_UID_FLAGS_INTERNALDATE_BODY};

/// The client's production source: everything before its own `#[cfg(test)]`
/// module, whose fixtures are server responses and sample commands, not
/// commands the client sends.
fn client_source() -> &'static str {
    let full: &'static str = include_str!("client.rs");
    full.split("#[cfg(test)]").next().unwrap_or(full)
}

/// The attribute-list constants a call site may name.
fn constant(name: &str) -> Option<&'static str> {
    match name {
        "FETCH_UID_FLAGS_INTERNALDATE_BODY" => Some(FETCH_UID_FLAGS_INTERNALDATE_BODY),
        "FETCH_UID_FLAGS_BODY" => Some(FETCH_UID_FLAGS_BODY),
        "FETCH_BODY" => Some(FETCH_BODY),
        _ => None,
    }
}

const CONSTANT_NAMES: [&str; 3] = [
    "FETCH_UID_FLAGS_INTERNALDATE_BODY",
    "FETCH_UID_FLAGS_BODY",
    "FETCH_BODY",
];

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct FetchSite {
    pub line: usize,
    pub attributes: String,
}

/// Remove `//` comments that are outside string literals; newlines are kept
/// so line numbers stay true.
fn strip_line_comments(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut chars = source.chars().peekable();
    let mut in_str = false;
    while let Some(c) = chars.next() {
        if in_str {
            out.push(c);
            if c == '\\' {
                if let Some(n) = chars.next() {
                    out.push(n);
                }
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        if c == '"' {
            in_str = true;
            out.push(c);
        } else if c == '/' && chars.peek() == Some(&'/') {
            while let Some(&n) = chars.peek() {
                if n == '\n' {
                    break;
                }
                chars.next();
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn line_of(src: &str, index: usize) -> usize {
    src[..index].matches('\n').count() + 1
}

/// The text between the `(` at `open` and its matching `)`, honouring string
/// literals; returns the text and the index just past the `)`.
fn balanced_args(src: &str, open: usize) -> Result<(&str, usize), String> {
    let bytes = src.as_bytes();
    let mut depth = 1usize;
    let mut in_str = false;
    let mut i = open + 1;
    while i < bytes.len() {
        let c = bytes[i];
        if in_str {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == b'"' {
                in_str = false;
            }
        } else if c == b'"' {
            in_str = true;
        } else if c == b'(' {
            depth += 1;
        } else if c == b')' {
            depth -= 1;
            if depth == 0 {
                return Ok((&src[open + 1..i], i + 1));
            }
        }
        i += 1;
    }
    Err(format!(
        "line {}: unbalanced parentheses in a fetch call",
        line_of(src, open)
    ))
}

/// Split call arguments on top-level commas (outside strings and brackets).
fn top_level_args(args: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut in_str = false;
    let mut chars = args.chars();
    while let Some(c) = chars.next() {
        if in_str {
            current.push(c);
            if c == '\\' {
                if let Some(n) = chars.next() {
                    current.push(n);
                }
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        match c {
            '"' => {
                in_str = true;
                current.push(c);
            }
            '(' | '[' | '{' => {
                depth += 1;
                current.push(c);
            }
            ')' | ']' | '}' => {
                depth -= 1;
                current.push(c);
            }
            ',' if depth == 0 => out.push(std::mem::take(&mut current)),
            _ => current.push(c),
        }
    }
    if !current.trim().is_empty() {
        out.push(current);
    }
    out
}

/// A call's attribute argument: a string literal's text, or a constant's value.
fn resolve_argument(arg: &str, line: usize) -> Result<String, String> {
    let arg = arg.trim();
    if let Some(rest) = arg.strip_prefix('"') {
        let end = rest
            .find('"')
            .ok_or_else(|| format!("line {line}: unterminated string literal"))?;
        return Ok(rest[..end].to_string());
    }
    constant(arg)
        .map(str::to_string)
        .ok_or_else(|| format!("line {line}: unknown fetch attribute argument {arg:?} — name a FETCH_* constant or a literal"))
}

/// Every `.uid_fetch(` / `.fetch(` call outside string literals.
pub(crate) fn method_sites(source: &str) -> Result<Vec<FetchSite>, String> {
    let src = strip_line_comments(source);
    let bytes = src.as_bytes();
    let mut sites = Vec::new();
    let mut in_str = false;
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if in_str {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == b'"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        if c == b'"' {
            in_str = true;
            i += 1;
            continue;
        }
        let rest = &src[i..];
        let matched = [".uid_fetch(", ".fetch("]
            .iter()
            .find(|p| rest.starts_with(*p))
            .copied();
        if let Some(pattern) = matched {
            let line = line_of(&src, i);
            let open = i + pattern.len() - 1;
            let (args, end) = balanced_args(&src, open)?;
            let parts = top_level_args(args);
            let second = parts
                .get(1)
                .ok_or_else(|| format!("line {line}: fetch call without an attribute argument"))?;
            sites.push(FetchSite {
                line,
                attributes: resolve_argument(second, line)?,
            });
            i = end;
            continue;
        }
        i += 1;
    }
    Ok(sites)
}

/// Every string literal that spells a `FETCH` command (`… FETCH <set> <attrs>`),
/// with `{CONSTANT}` placeholders resolved; `{}` is the sequence set.
pub(crate) fn raw_command_sites(source: &str) -> Result<Vec<FetchSite>, String> {
    let src = strip_line_comments(source);
    let bytes = src.as_bytes();
    let mut sites = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'"' {
            i += 1;
            continue;
        }
        let start = i + 1;
        let mut j = start;
        while j < bytes.len() {
            if bytes[j] == b'\\' {
                j += 2;
                continue;
            }
            if bytes[j] == b'"' {
                break;
            }
            j += 1;
        }
        let literal = &src[start..j.min(bytes.len())];
        i = j + 1;
        // A command line is `<tag> [UID ]FETCH …\r\n`. Log labels such as
        // "UID FETCH {folder}" have no tag and no terminator; server responses
        // in test fixtures (`* 1 FETCH (…)`) start with `*`. Neither is a
        // command this client sends.
        let Some((tag, rest)) = literal.split_once(' ') else {
            continue;
        };
        let is_command = !tag.is_empty()
            && tag.chars().all(|c| c.is_ascii_alphanumeric())
            && (rest.starts_with("UID FETCH ") || rest.starts_with("FETCH "))
            && literal.ends_with("\\r\\n");
        if !is_command {
            continue;
        }
        let line = line_of(&src, start);
        let mut text = literal.to_string();
        for name in CONSTANT_NAMES {
            text = text.replace(
                &format!("{{{name}}}"),
                constant(name).expect("known constant"),
            );
        }
        // `{}` is the sequence set; any other placeholder left is an
        // attribute list this guard cannot see, so it fails closed.
        if text.replace("{}", "").contains('{') {
            {
                return Err(format!(
                    "line {line}: unknown placeholder in a FETCH command string: {literal:?}"
                ));
            }
        }
        let after = &text[text.rfind("FETCH ").expect("checked above") + "FETCH ".len()..];
        let attrs = after
            .split_once(' ')
            .map(|(_set, attrs)| attrs)
            .unwrap_or("")
            .trim_end_matches("\\r\\n")
            .trim();
        sites.push(FetchSite {
            line,
            attributes: attrs.to_string(),
        });
    }
    Ok(sites)
}

/// How many top-level attributes a list has: tokens separated by spaces that
/// are outside `[]` and `()`. `(A B)` is one token; `BODY.PEEK[HEADER.FIELDS
/// (FROM TO)]` is one token; `UID FLAGS BODY.PEEK[]` is three.
pub(crate) fn top_level_tokens(attrs: &str) -> usize {
    let mut depth = 0i32;
    let mut tokens = 0;
    let mut in_token = false;
    for c in attrs.chars() {
        match c {
            '(' | '[' => {
                if !in_token {
                    tokens += 1;
                    in_token = true;
                }
                depth += 1;
            }
            ')' | ']' => depth -= 1,
            ' ' if depth == 0 => in_token = false,
            _ => {
                if !in_token {
                    tokens += 1;
                    in_token = true;
                }
            }
        }
    }
    tokens
}

/// Sites that send a bare multi-attribute list — the defect of #241.
pub(crate) fn violations(source: &str) -> Result<Vec<FetchSite>, String> {
    let mut all = method_sites(source)?;
    all.extend(raw_command_sites(source)?);
    Ok(all
        .into_iter()
        .filter(|s| top_level_tokens(&s.attributes) >= 2)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The five `uid_fetch` sites and the two raw diagnostic commands
    /// (`raw_fetch_messages`, and the UID-list probe) in `client.rs` today.
    /// Bump deliberately when a site is added or removed; the exact count is
    /// what keeps the scan from passing by omission.
    const METHOD_SITES: usize = 5;
    const RAW_SITES: usize = 2;

    #[test]
    fn the_client_sends_no_bare_multi_attribute_fetch_list() {
        assert_eq!(
            violations(client_source()).unwrap(),
            Vec::<FetchSite>::new()
        );
        assert_eq!(method_sites(client_source()).unwrap().len(), METHOD_SITES);
        assert_eq!(raw_command_sites(client_source()).unwrap().len(), RAW_SITES);
        // Every site resolved to one of the constants — no stray literal.
        for site in method_sites(client_source()).unwrap() {
            assert!(
                CONSTANT_NAMES
                    .iter()
                    .any(|n| constant(n) == Some(site.attributes.as_str())),
                "line {}: fetch attributes {:?} are not one of the FETCH_* constants",
                site.line,
                site.attributes
            );
        }
    }

    #[test]
    fn the_fetch_constants_are_the_rfc_form_and_keep_their_attributes() {
        assert_eq!(
            FETCH_UID_FLAGS_INTERNALDATE_BODY,
            "(UID FLAGS INTERNALDATE BODY.PEEK[])"
        );
        assert_eq!(FETCH_UID_FLAGS_BODY, "(UID FLAGS BODY.PEEK[])");
        assert_eq!(FETCH_BODY, "BODY.PEEK[]");
        assert_eq!(top_level_tokens(FETCH_UID_FLAGS_INTERNALDATE_BODY), 1);
        assert_eq!(top_level_tokens("UID FLAGS INTERNALDATE BODY.PEEK[]"), 4);
    }

    // ---------- scanner fixtures (Gemini/Grok on #57) ----------

    #[test]
    fn a_call_wrapped_over_several_lines_is_still_seen_and_still_fails() {
        let src = "let s = session\n    .uid_fetch(\n        &uid_set,\n        \"UID FLAGS INTERNALDATE BODY.PEEK[]\",\n    )\n    .await;\n";
        let v = violations(src).unwrap();
        assert_eq!(v.len(), 1, "{v:?}");
        assert_eq!(v[0].line, 2);
    }

    #[test]
    fn a_chained_await_trailing_comma_or_comment_on_the_same_line_is_fine() {
        let src = "session.uid_fetch(&uid_str, FETCH_BODY).await; // fetch\nsession.uid_fetch(&x, FETCH_UID_FLAGS_BODY),\n";
        let sites = method_sites(src).unwrap();
        assert_eq!(sites.len(), 2);
        assert_eq!(sites[0].attributes, FETCH_BODY);
        assert!(violations(src).unwrap().is_empty());
    }

    #[test]
    fn a_single_compound_attribute_with_spaces_inside_brackets_is_one_attribute() {
        let src = "session.uid_fetch(&uid, \"BODY.PEEK[HEADER.FIELDS (FROM TO)]\")";
        assert!(violations(src).unwrap().is_empty());
        assert_eq!(top_level_tokens("BODY.PEEK[HEADER.FIELDS (FROM TO)]"), 1);
    }

    #[test]
    fn a_commented_out_call_is_ignored_and_a_string_containing_the_text_is_not_a_call() {
        let src = "// session.uid_fetch(set, \"UID FLAGS\")\nlet note = \"call .uid_fetch(x, y) later\";\n";
        assert!(method_sites(src).unwrap().is_empty());
    }

    #[test]
    fn an_unknown_identifier_fails_closed() {
        let err = method_sites("session.uid_fetch(&uid, q)").unwrap_err();
        assert!(err.contains("unknown fetch attribute argument"), "{err}");
    }

    #[test]
    fn a_plain_fetch_call_and_a_raw_command_string_are_checked_too() {
        let src = "session.fetch(\"1:*\", \"FLAGS UID\").await;\nlet cmd = format!(\"a1 UID FETCH {} UID FLAGS BODY.PEEK[]\\r\\n\", set);\n";
        let v = violations(src).unwrap();
        assert_eq!(v.len(), 2, "{v:?}");
        assert_eq!(v[0].attributes, "FLAGS UID");
        assert_eq!(v[1].attributes, "UID FLAGS BODY.PEEK[]");
    }

    #[test]
    fn a_raw_command_using_the_constant_placeholder_resolves_and_passes() {
        let src = "let cmd = format!(\"a3 UID FETCH {} {FETCH_UID_FLAGS_INTERNALDATE_BODY}\\r\\n\", set);";
        let sites = raw_command_sites(src).unwrap();
        assert_eq!(sites.len(), 1);
        assert_eq!(sites[0].attributes, FETCH_UID_FLAGS_INTERNALDATE_BODY);
        assert!(violations(src).unwrap().is_empty());
        let err = raw_command_sites("let c = \"a3 UID FETCH {} {NOPE}\\r\\n\";").unwrap_err();
        assert!(err.contains("unknown placeholder"), "{err}");
        // A log label is not a command: no wire terminator, no check.
        assert!(
            raw_command_sites("let l = format!(\"UID FETCH {folder}\");")
                .unwrap()
                .is_empty()
        );
        let err = raw_command_sites("let c = \"a3 UID FETCH {} {NOPE}\\r\\n\";").unwrap_err();
        assert!(err.contains("unknown placeholder"), "{err}");
    }
}
