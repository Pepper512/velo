//! A validated HTTP fetch for user-configured AI endpoints (SPEC-209).
//!
//! The webview's own `fetch` is gated by the static CSP `connect-src`, so a
//! base URL the user types can never be reached that way; the http plugin's
//! scope would allow it but enforces nothing about scheme or host and follows
//! redirects. This command is the one door for those requests, and it holds
//! the rule the decision named: **`https` to any host, or `http` to loopback
//! only; no redirect is ever followed.**
//!
//! Everything else is deliberately narrow: two methods, four request headers
//! forwarded, three response headers returned, a body cap and a timeout. The
//! URL's query and the headers never appear in an error or a log line — the
//! API key travels in `authorization` and the reason for a failure is shown on
//! screen.

use reqwest::{redirect::Policy, Method, Url};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::sync::OnceLock;
use std::time::Duration;

/// Longest response body accepted. A chat completion is kilobytes; a page of
/// HTML from a misconfigured proxy is not something the SDK should parse.
pub const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

/// End-to-end request timeout.
pub const TIMEOUT: Duration = Duration::from_secs(120);

/// Request headers that reach the endpoint; everything else is dropped.
const REQUEST_HEADERS: [&str; 4] = ["authorization", "content-type", "accept", "user-agent"];

/// Response headers handed back; the SDK reads `retry-after` and `x-request-id`.
const RESPONSE_HEADERS: [&str; 3] = ["content-type", "retry-after", "x-request-id"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiFetchRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct AiFetchResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// Is this host name (as `Url::host_str` renders it) the local machine?
///
/// `localhost` by name, any `127.0.0.0/8` address, or `::1`. IPv6 literals
/// arrive bracketed (`[::1]`).
fn is_loopback_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    let bare = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(host);
    bare.parse::<IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false)
}

/// The rule (SPEC-209 REQ-2.1): `https` anywhere, `http` to loopback only, no
/// user-info, a host present. Everything else is refused with a reason that
/// carries none of the URL's query.
pub fn validate_ai_url(raw: &str) -> Result<Url, String> {
    let raw = raw.trim();
    // An `@` anywhere in the authority is user-info, including the empty
    // `https://:@host/` form the parser normalises away (#65 review, Grok 8).
    // Checked on the text, before parsing, so nothing can be normalised past it.
    if authority_of(raw).contains('@') {
        return Err("credentials inside the URL are not allowed".to_string());
    }
    let url = Url::parse(raw).map_err(|e| format!("not a valid URL: {e}"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("credentials inside the URL are not allowed".to_string());
    }
    let host = url.host_str().ok_or_else(|| "the URL has no host".to_string())?;
    match url.scheme() {
        "https" => Ok(url),
        "http" if is_loopback_host(host) => Ok(url),
        "http" => Err("http is allowed to localhost only; use https for a remote endpoint".to_string()),
        other => Err(format!("the {other}: scheme is not allowed")),
    }
}

/// The text between `://` and the first `/`, `?` or `#` — the authority as
/// written, before any normalisation.
fn authority_of(raw: &str) -> &str {
    let rest = match raw.find("://") {
        Some(i) => &raw[i + 3..],
        None => return "",
    };
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    &rest[..end]
}

/// Longest single header value accepted (#65 review, Grok 5).
const MAX_HEADER_VALUE_BYTES: usize = 8 * 1024;

fn parse_method(raw: &str) -> Result<Method, String> {
    match raw.to_ascii_uppercase().as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        other => Err(format!("method {other} is not allowed")),
    }
}

/// `reqwest::Error`'s text includes the URL it was built for; strip it before
/// the message can reach a log or the screen.
fn describe(err: reqwest::Error) -> String {
    err.without_url().to_string()
}

/// One client for the process, so consecutive completions reuse connections
/// and TLS sessions (#65 review, Gemini L2). The redirect policy lives here —
/// it is the property no request may override; the timeout is per request.
fn shared_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = reqwest::Client::builder()
        .redirect(Policy::none())
        .build()
        .map_err(describe)?;
    Ok(CLIENT.get_or_init(|| built))
}

/// The command's body, with the limits as parameters so a test can lower them.
pub async fn fetch_with_limits(
    request: AiFetchRequest,
    max_body: usize,
    timeout: Duration,
) -> Result<AiFetchResponse, String> {
    let url = validate_ai_url(&request.url)?;
    let method = parse_method(&request.method)?;
    let host = url.host_str().unwrap_or("?").to_string();

    // The caps apply to what goes out too (#65 review, Grok 5): this is a
    // POST primitive reachable from the webview, so it must not become a way
    // to push tens of megabytes at an allowed host.
    if let Some(body) = &request.body {
        if body.len() > max_body {
            return Err(format!("the request body is larger than {max_body} bytes"));
        }
    }

    let client = shared_client()?;
    let mut builder = client.request(method.clone(), url).timeout(timeout);
    for (name, value) in &request.headers {
        if REQUEST_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
            if value.len() > MAX_HEADER_VALUE_BYTES {
                return Err(format!("a request header is longer than {MAX_HEADER_VALUE_BYTES} bytes"));
            }
            builder = builder.header(name.as_str(), value.as_str());
        }
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let mut response = builder.send().await.map_err(describe)?;
    let status = response.status();
    // Never followed, and the target is not disclosed: a friendly host must
    // not be able to point the app at a loopback or link-local address by
    // answering 3xx. A 304 is not a redirect (#65 review, Grok 3) and passes
    // with its empty body.
    if status.is_redirection() && status.as_u16() != 304 {
        return Err(format!(
            "the endpoint answered {} — redirects are not followed",
            status.as_u16()
        ));
    }

    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .filter(|(name, _)| RESPONSE_HEADERS.contains(&name.as_str()))
        .filter_map(|(name, value)| value.to_str().ok().map(|v| (name.to_string(), v.to_string())))
        .collect();

    if let Some(len) = response.content_length() {
        if len > max_body as u64 {
            return Err(format!("the response is larger than {max_body} bytes"));
        }
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(describe)? {
        if buf.len() + chunk.len() > max_body {
            return Err(format!("the response is larger than {max_body} bytes"));
        }
        buf.extend_from_slice(&chunk);
    }

    log::info!("ai_fetch {method} {host} -> {}", status.as_u16());
    Ok(AiFetchResponse {
        status: status.as_u16(),
        headers,
        body: String::from_utf8_lossy(&buf).into_owned(),
    })
}

/// The IPC command: `fetch_with_limits` at the production limits.
#[tauri::command]
pub async fn ai_fetch(request: AiFetchRequest) -> Result<AiFetchResponse, String> {
    fetch_with_limits(request, MAX_BODY_BYTES, TIMEOUT).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    // ---------- REQ-2.1: the URL rule ----------

    #[test]
    fn accepts_https_to_any_host() {
        for raw in [
            "https://api.deepseek.com/v1",
            "https://openrouter.ai/api/v1",
            "HTTPS://Host.Example/v1/",
            "https://10.0.0.5:8443/v1",
            "  https://gateway.internal/v1  ",
        ] {
            assert!(validate_ai_url(raw).is_ok(), "{raw} should be accepted");
        }
    }

    #[test]
    fn accepts_http_to_loopback_only() {
        for raw in [
            "http://localhost:1234/v1",
            "http://LOCALHOST/v1",
            "http://127.0.0.1:8080",
            "http://127.9.9.9/v1",
            "http://[::1]:11434/v1",
        ] {
            assert!(validate_ai_url(raw).is_ok(), "{raw} should be accepted");
        }
        for raw in [
            "http://api.example.com/v1",
            "http://10.0.0.5/v1",
            "http://192.168.1.2:1234/v1",
            "http://169.254.169.254/latest/meta-data",
            "http://localhost.example.com/v1",
            "http://127.0.0.1.example.com/v1",
            "http://0.0.0.0/v1",
            "http://[::]/v1",
            "http://localhost./v1",
            "http://[::ffff:127.0.0.1]/v1",
            "http://[::ffff:10.0.0.1]/v1",
            "http://[::ffff:169.254.169.254]/v1",
            "http://[fe80::1]/v1",
            "http://[fd00::1]/v1",
            "http://127/v1",       // = 0.0.0.127, not loopback
            "http://0127.0.0.1/v1", // octal 0127 = 87
            "http://localhost%2eexample.com/v1",
        ] {
            let err = validate_ai_url(raw).unwrap_err();
            assert!(err.contains("localhost only"), "{raw}: {err}");
        }
        // Not even a URL: refused on parse, whichever branch.
        assert!(validate_ai_url("http://127.0.0.1%0d%0a/v1").is_err());
    }

    #[test]
    fn any_user_info_is_refused_even_when_empty_and_an_at_sign_elsewhere_is_fine() {
        for raw in ["https://:@host.example/v1", "https://@host.example/v1", "https://a:b@127.0.0.1/v1"] {
            assert!(validate_ai_url(raw).unwrap_err().contains("credentials"), "{raw}");
        }
        assert!(validate_ai_url("https://host.example/v1/a@b").is_ok());
        assert!(validate_ai_url("https://host.example/v1?next=a@b").is_ok());
    }

    #[test]
    fn ipv4_short_and_numeric_forms_are_normalised_before_the_rule() {
        // The `url` crate turns these into dotted quads, so they are judged as
        // the address they denote — 127.0.0.1 here, and a remote one below.
        for raw in ["http://127.1/v1", "http://0177.0.0.1/v1", "http://2130706433/v1", "http://0x7f.1/v1"] {
            let url = validate_ai_url(raw).unwrap_or_else(|e| panic!("{raw}: {e}"));
            assert_eq!(url.host_str(), Some("127.0.0.1"), "{raw}");
        }
        for raw in ["http://10.1/v1", "http://167772161/v1", "http://0x0a000001/v1"] {
            let err = validate_ai_url(raw).unwrap_err();
            assert!(err.contains("localhost only"), "{raw}: {err}");
        }
    }

    #[test]
    fn whitespace_inside_the_url_does_not_smuggle_a_host() {
        assert!(validate_ai_url("http://localhost\n.example.com/v1").is_err());
        assert!(validate_ai_url("http://local host/v1").is_err());
        assert!(validate_ai_url("https://api.example.com/v1?x=1#frag").is_ok());
    }

    #[test]
    fn refuses_other_schemes_credentials_and_hostless_urls() {
        assert!(validate_ai_url("ftp://files.example.com/").unwrap_err().contains("scheme"));
        assert!(validate_ai_url("javascript:alert(1)").unwrap_err().contains("host"));
        assert!(validate_ai_url("file:///etc/passwd").unwrap_err().contains("host"));
        assert!(validate_ai_url("https://user:pw@host.example/v1").unwrap_err().contains("credentials"));
        assert!(validate_ai_url("https://user@host.example/v1").unwrap_err().contains("credentials"));
        assert!(validate_ai_url("https://").is_err());
        assert!(validate_ai_url("not a url").is_err());
        assert!(validate_ai_url("").is_err());
    }

    #[test]
    fn a_refusal_never_echoes_the_query() {
        let err = validate_ai_url("http://api.example.com/v1?key=SECRETVALUE").unwrap_err();
        assert!(!err.contains("SECRETVALUE"));
    }

    // ---------- REQ-2.2 / 2.3 / 2.4: the fetch, against a real socket ----------

    /// Serve exactly one HTTP/1.1 request on 127.0.0.1 with `response`
    /// (status line + headers + body, already framed). Returns the base URL and
    /// a receiver that yields the raw request text the server saw.
    fn serve_once(response: String) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let n = stream.read(&mut chunk).unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
                if let Some(end) = find_headers_end(&buf) {
                    let head = String::from_utf8_lossy(&buf[..end]).to_ascii_lowercase();
                    let wanted = head
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length:"))
                        .and_then(|v| v.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if buf.len() >= end + 4 + wanted {
                        break;
                    }
                }
            }
            tx.send(String::from_utf8_lossy(&buf).into_owned()).unwrap();
            stream.write_all(response.as_bytes()).unwrap();
            stream.flush().unwrap();
        });
        (format!("http://127.0.0.1:{}", addr.port()), rx)
    }

    fn find_headers_end(buf: &[u8]) -> Option<usize> {
        buf.windows(4).position(|w| w == b"\r\n\r\n")
    }

    fn framed(status_line: &str, extra_headers: &[(&str, &str)], body: &str) -> String {
        let mut out = format!("{status_line}\r\ncontent-length: {}\r\nconnection: close\r\n", body.len());
        for (k, v) in extra_headers {
            out.push_str(&format!("{k}: {v}\r\n"));
        }
        out.push_str("\r\n");
        out.push_str(body);
        out
    }

    fn post(url: String, headers: Vec<(String, String)>, body: &str) -> AiFetchRequest {
        AiFetchRequest {
            url,
            method: "POST".to_string(),
            headers,
            body: Some(body.to_string()),
        }
    }

    #[tokio::test]
    async fn a_redirect_is_refused_and_its_target_is_not_disclosed() {
        let (base, _rx) = serve_once(framed(
            "HTTP/1.1 302 Found",
            &[("location", "http://169.254.169.254/latest/meta-data")],
            "",
        ));
        let err = fetch_with_limits(post(format!("{base}/v1/chat/completions"), vec![], "{}"), 1024, TIMEOUT)
            .await
            .unwrap_err();
        assert!(err.contains("302"), "{err}");
        assert!(err.contains("redirects are not followed"), "{err}");
        assert!(!err.contains("169.254"), "{err}");
    }

    #[tokio::test]
    async fn only_allow_listed_headers_travel_in_either_direction() {
        let (base, rx) = serve_once(framed(
            "HTTP/1.1 200 OK",
            &[
                ("content-type", "application/json"),
                ("x-request-id", "req-1"),
                ("retry-after", "120"),
                ("set-cookie", "session=abc"),
                ("x-internal", "leak"),
            ],
            r#"{"choices":[]}"#,
        ));
        let headers = vec![
            ("Authorization".to_string(), "Bearer test-token".to_string()),
            ("Content-Type".to_string(), "application/json".to_string()),
            ("X-Stainless-Lang".to_string(), "js".to_string()),
            ("Cookie".to_string(), "a=b".to_string()),
            ("Host".to_string(), "evil.example".to_string()),
        ];
        let out = fetch_with_limits(post(format!("{base}/v1/chat/completions"), headers, r#"{"model":"m"}"#), 1024, TIMEOUT)
            .await
            .unwrap();
        let seen = rx.recv().unwrap().to_ascii_lowercase();

        assert!(seen.starts_with("post /v1/chat/completions http/1.1"), "{seen}");
        assert!(seen.contains("authorization: bearer test-token"), "{seen}");
        assert!(seen.contains("content-type: application/json"), "{seen}");
        assert!(!seen.contains("x-stainless-lang"), "{seen}");
        assert!(!seen.contains("cookie:"), "{seen}");
        assert!(!seen.contains("evil.example"), "{seen}");
        assert!(seen.ends_with(r#"{"model":"m"}"#), "{seen}");

        assert_eq!(out.status, 200);
        assert_eq!(out.body, r#"{"choices":[]}"#);
        assert!(out.headers.contains(&("content-type".to_string(), "application/json".to_string())));
        assert!(out.headers.contains(&("x-request-id".to_string(), "req-1".to_string())));
        assert!(out.headers.contains(&("retry-after".to_string(), "120".to_string())));
        assert!(!out.headers.iter().any(|(k, _)| k == "set-cookie" || k == "x-internal"));
    }

    #[tokio::test]
    async fn a_body_over_the_cap_is_refused() {
        let big = "x".repeat(2048);
        let (base, _rx) = serve_once(framed("HTTP/1.1 200 OK", &[("content-type", "text/plain")], &big));
        let err = fetch_with_limits(post(format!("{base}/v1"), vec![], "{}"), 1024, TIMEOUT)
            .await
            .unwrap_err();
        assert!(err.contains("larger than 1024 bytes"), "{err}");
    }

    #[tokio::test]
    async fn a_body_over_the_cap_without_content_length_is_refused_while_streaming() {
        // No content-length: the pre-check cannot fire, so the cap must hold in
        // the chunk loop (#65 review, Gemini L1). The server closes to end the body.
        let big = "y".repeat(2048);
        let response = format!("HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\n{big}");
        let (base, _rx) = serve_once(response);
        let err = fetch_with_limits(post(format!("{base}/v1"), vec![], "{}"), 1024, TIMEOUT)
            .await
            .unwrap_err();
        assert!(err.contains("larger than 1024 bytes"), "{err}");
    }

    #[tokio::test]
    async fn a_304_is_not_a_redirect_and_passes_with_an_empty_body() {
        let (base, _rx) = serve_once(framed("HTTP/1.1 304 Not Modified", &[], ""));
        let req = AiFetchRequest {
            url: format!("{base}/v1/models"),
            method: "GET".to_string(),
            headers: vec![],
            body: None,
        };
        let out = fetch_with_limits(req, 1024, TIMEOUT).await.unwrap();
        assert_eq!(out.status, 304);
        assert_eq!(out.body, "");
    }

    #[tokio::test]
    async fn a_request_body_or_header_over_the_cap_is_refused_before_any_connection() {
        let big = post("https://example.invalid/v1".to_string(), vec![], &"z".repeat(2048));
        let err = fetch_with_limits(big, 1024, TIMEOUT).await.unwrap_err();
        assert!(err.contains("request body is larger than 1024"), "{err}");

        let long_header = post(
            "https://example.invalid/v1".to_string(),
            vec![("Authorization".to_string(), "Bearer ".to_string() + &"k".repeat(9 * 1024))],
            "{}",
        );
        let err = fetch_with_limits(long_header, 1024, TIMEOUT).await.unwrap_err();
        assert!(err.contains("header is longer"), "{err}");
    }

    #[tokio::test]
    async fn a_body_under_the_cap_passes_and_status_is_relayed() {
        let (base, _rx) = serve_once(framed(
            "HTTP/1.1 401 Unauthorized",
            &[("content-type", "application/json")],
            r#"{"error":{"message":"bad key"}}"#,
        ));
        let out = fetch_with_limits(post(format!("{base}/v1"), vec![], "{}"), 1024, TIMEOUT)
            .await
            .unwrap();
        assert_eq!(out.status, 401);
        assert!(out.body.contains("bad key"));
    }

    #[tokio::test]
    async fn a_disallowed_method_or_url_is_refused_before_any_connection() {
        let put = AiFetchRequest {
            url: "https://example.invalid/v1".to_string(),
            method: "PUT".to_string(),
            headers: vec![],
            body: None,
        };
        assert!(fetch_with_limits(put, 1024, TIMEOUT).await.unwrap_err().contains("method PUT"));

        let off_loopback = AiFetchRequest {
            url: "http://example.invalid/v1".to_string(),
            method: "POST".to_string(),
            headers: vec![],
            body: None,
        };
        assert!(fetch_with_limits(off_loopback, 1024, TIMEOUT).await.unwrap_err().contains("localhost only"));
    }

    #[tokio::test]
    async fn a_connection_error_does_not_echo_the_url() {
        // Port 1 on loopback: refused immediately.
        let req = post("http://127.0.0.1:1/v1?key=SECRETVALUE".to_string(), vec![], "{}");
        let err = fetch_with_limits(req, 1024, Duration::from_secs(5)).await.unwrap_err();
        assert!(!err.contains("SECRETVALUE"), "{err}");
    }
}
