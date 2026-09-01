use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Serialize)]
pub struct OAuthResult {
    pub code: String,
    pub state: String,
}

/// Ports the OAuth callback server may bind, in order.
///
/// Hard-coded in Rust rather than taken as an IPC argument (audit P2): the webview
/// should not be able to make the app bind an arbitrary TCP port. Fixing the range
/// here also removes the `port + 3` overflow that a caller could reach by passing
/// a port near `u16::MAX`.
///
/// These must stay in sync with `OAUTH_CALLBACK_PORT` in
/// `src/services/oauth/oauthFlow.ts` and `src/services/gmail/auth.ts`.
const OAUTH_CALLBACK_PORTS: [u16; 4] = [17248, 17249, 17250, 17251];

/// How long to wait for the browser's redirect request body after it connects.
///
/// The 300 s timeout below covers `accept()` only. Without this second timeout, a
/// local process that connects and then sends nothing holds the command open for
/// the lifetime of the process (audit P2).
const OAUTH_READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Binds to a loopback port for the OAuth callback. Tries each port in
/// `OAUTH_CALLBACK_PORTS` in order.
#[tauri::command]
pub async fn start_oauth_server(state: String) -> Result<OAuthResult, String> {
    let mut listener = None;
    for p in OAUTH_CALLBACK_PORTS {
        match TcpListener::bind(format!("127.0.0.1:{}", p)).await {
            Ok(l) => {
                listener = Some(l);
                break;
            }
            Err(_) => continue,
        }
    }

    let listener = listener.ok_or("Failed to bind to any port")?;
    let actual_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get addr: {}", e))?
        .port();

    log::info!("OAuth callback server listening on port {}", actual_port);

    // Wait for exactly one connection (the redirect from Google) with 5-minute timeout
    let (mut stream, _) = tokio::time::timeout(
        Duration::from_secs(300),
        listener.accept(),
    )
    .await
    .map_err(|_| "OAuth timed out — please try again".to_string())?
    .map_err(|e| format!("Failed to accept: {}", e))?;

    // Read the HTTP request. The accept timeout above does not cover this read, so
    // a connection that opens and stays silent would otherwise hang the command
    // forever (audit P2).
    let mut buf = vec![0u8; 4096];
    let n = tokio::time::timeout(OAUTH_READ_TIMEOUT, stream.read(&mut buf))
        .await
        .map_err(|_| {
            format!(
                "OAuth callback connected but sent nothing within {}s — please try again",
                OAUTH_READ_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("Failed to read: {}", e))?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Extract query string from GET request line
    let (code, returned_state) = parse_auth_code_and_state(&request)?;

    // Validate state parameter (CSRF protection)
    if returned_state != state {
        return Err("OAuth state mismatch — possible CSRF attack".to_string());
    }

    // Send a success response to the browser
    let html = r#"<!DOCTYPE html>
<html>
<head><title>Velo</title></head>
<body style="font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0;">
<div style="text-align: center;">
<h1 style="margin-bottom: 8px;">Account Connected!</h1>
<p style="opacity: 0.7;">You can close this tab and return to Velo.</p>
</div>
</body>
</html>"#;

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );

    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;

    drop(listener);

    Ok(OAuthResult { code, state: returned_state })
}

fn parse_auth_code_and_state(request: &str) -> Result<(String, String), String> {
    let first_line = request.lines().next().ok_or("Empty request")?;

    let path = first_line
        .split_whitespace()
        .nth(1)
        .ok_or("No path in request")?;

    if path.contains("error=") {
        let params = parse_query_string(path);
        let error = params.get("error").cloned().unwrap_or_default();
        return Err(format!("OAuth error: {}", error));
    }

    let params = parse_query_string(path);
    let code = params
        .get("code")
        .cloned()
        .ok_or_else(|| "No auth code in redirect".to_string())?;
    let state = params
        .get("state")
        .cloned()
        .ok_or_else(|| "No state in redirect".to_string())?;
    Ok((code, state))
}

fn parse_query_string(path: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();
    if let Some(query) = path.split('?').nth(1) {
        for pair in query.split('&') {
            let mut kv = pair.splitn(2, '=');
            if let (Some(key), Some(value)) = (kv.next(), kv.next()) {
                params.insert(key.to_string(), urlencoding_decode(value));
            }
        }
    }
    params
}

/// Value of a single ASCII hex digit, or `None` if it is not one.
fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Percent-decode a query-string value.
///
/// Works entirely on bytes. The previous implementation sliced the `&str` as
/// `&s[i + 1..i + 3]`, which panics whenever those indices are not UTF-8 character
/// boundaries — `?code=%€x` was enough to crash the command mid-sign-in, *before*
/// the CSRF `state` comparison could run (audit P2). Malformed escapes are now left
/// as literal text, which is what every lenient decoder does.
fn urlencoding_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_value(bytes[i + 1]), hex_value(bytes[i + 2])) {
                result.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            result.push(b' ');
        } else {
            result.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8(result).unwrap_or_else(|_| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- urlencoding_decode (audit P2: reachable panic) ----------

    #[test]
    fn decode_handles_valid_escapes() {
        assert_eq!(urlencoding_decode("%2F"), "/");
        assert_eq!(urlencoding_decode("%2f"), "/");
        assert_eq!(urlencoding_decode("a%20b"), "a b");
        assert_eq!(urlencoding_decode("a+b"), "a b");
        assert_eq!(urlencoding_decode("4%2F0AY0e-g7"), "4/0AY0e-g7");
    }

    #[test]
    fn decode_does_not_panic_on_non_char_boundary() {
        // The regression this test exists for. `€` occupies bytes 1..=3, so the old
        // `&s[i + 1..i + 3]` split it and panicked, taking down the OAuth command
        // before the CSRF state check at the call site could run.
        assert_eq!(urlencoding_decode("%€x"), "%€x");
    }

    #[test]
    fn decode_leaves_malformed_escapes_alone() {
        for input in ["%", "%2", "%zz", "%g0", "abc%", "%%", "100%"] {
            // The contract is only "returns without panicking"; assert the lenient
            // behaviour too so a future rewrite has to be deliberate.
            assert_eq!(urlencoding_decode(input), input, "input {input:?}");
        }
    }

    #[test]
    fn decode_survives_invalid_utf8_result() {
        // %FF is not valid UTF-8 on its own; we fall back to the original text
        // rather than panicking or silently producing replacement characters.
        assert_eq!(urlencoding_decode("%FF"), "%FF");
    }

    // ---------- parse_auth_code_and_state ----------

    #[test]
    fn parses_code_and_state_from_a_real_request_line() {
        let request = "GET /?code=4%2F0AY0e-g7&state=xyz123 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let (code, state) = parse_auth_code_and_state(request).unwrap();
        assert_eq!(code, "4/0AY0e-g7");
        assert_eq!(state, "xyz123");
    }

    #[test]
    fn surfaces_provider_errors() {
        let request = "GET /?error=access_denied HTTP/1.1\r\n\r\n";
        let err = parse_auth_code_and_state(request).unwrap_err();
        assert!(err.contains("access_denied"), "got {err}");
    }

    #[test]
    fn rejects_requests_without_code_or_state() {
        for request in [
            "GET /?state=xyz HTTP/1.1\r\n\r\n",
            "GET /?code=abc HTTP/1.1\r\n\r\n",
            "GET / HTTP/1.1\r\n\r\n",
            "",
        ] {
            assert!(
                parse_auth_code_and_state(request).is_err(),
                "should reject {request:?}"
            );
        }
    }

    #[test]
    fn malformed_escape_in_a_redirect_does_not_panic() {
        // End-to-end version of the panic case, through the real parse path.
        let request = "GET /?code=%€x&state=%E0 HTTP/1.1\r\n\r\n";
        let parsed = parse_auth_code_and_state(request);
        assert!(parsed.is_ok(), "should parse without panicking");
    }

    // ---------- read timeout ----------

    /// A client that connects and then says nothing must not hold the reader open
    /// forever. Exercises the same `timeout(OAUTH_READ_TIMEOUT, read)` shape as
    /// `start_oauth_server`, against a real loopback socket, with a short deadline
    /// so the test finishes quickly.
    #[tokio::test]
    async fn stalled_connection_times_out_instead_of_hanging() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        // Connect, then hold the socket open without writing anything.
        let client = tokio::spawn(async move {
            let stream = tokio::net::TcpStream::connect(addr).await.unwrap();
            tokio::time::sleep(Duration::from_secs(30)).await;
            drop(stream);
        });

        let (mut stream, _) = listener.accept().await.unwrap();
        let mut buf = vec![0u8; 4096];
        let result = tokio::time::timeout(Duration::from_millis(250), stream.read(&mut buf)).await;

        assert!(
            result.is_err(),
            "a silent client should hit the read timeout, got {result:?}"
        );
        client.abort();
    }

    // ---------- port range ----------

    #[test]
    fn callback_ports_are_contiguous_and_cannot_overflow() {
        assert_eq!(OAUTH_CALLBACK_PORTS[0], 17248);
        for pair in OAUTH_CALLBACK_PORTS.windows(2) {
            assert_eq!(pair[1], pair[0] + 1);
        }
        // The old code computed `port + 3` on a caller-supplied u16.
        assert!(OAUTH_CALLBACK_PORTS.iter().all(|p| *p < u16::MAX - 3));
    }
}

#[derive(Serialize, Deserialize)]
pub struct TokenExchangeResult {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
    pub scope: Option<String>,
    pub id_token: Option<String>,
}

/// Exchange an OAuth authorization code for tokens via Rust HTTP client (avoids CORS).
#[tauri::command]
pub async fn oauth_exchange_token(
    token_url: String,
    code: String,
    client_id: String,
    redirect_uri: String,
    code_verifier: Option<String>,
    client_secret: Option<String>,
    scope: Option<String>,
) -> Result<TokenExchangeResult, String> {
    let mut params = vec![
        ("code", code),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code".to_string()),
    ];
    if let Some(verifier) = code_verifier {
        params.push(("code_verifier", verifier));
    }
    if let Some(secret) = client_secret {
        if !secret.is_empty() {
            params.push(("client_secret", secret));
        }
    }
    if let Some(s) = scope {
        params.push(("scope", s));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !response.status().is_success() {
        let error = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Token exchange failed: {}", error));
    }

    response
        .json::<TokenExchangeResult>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))
}

/// Refresh an OAuth token via Rust HTTP client (avoids CORS).
#[tauri::command]
pub async fn oauth_refresh_token(
    token_url: String,
    refresh_token: String,
    client_id: String,
    client_secret: Option<String>,
    scope: Option<String>,
) -> Result<TokenExchangeResult, String> {
    let mut params = vec![
        ("refresh_token", refresh_token),
        ("client_id", client_id),
        ("grant_type", "refresh_token".to_string()),
    ];
    if let Some(secret) = client_secret {
        if !secret.is_empty() {
            params.push(("client_secret", secret));
        }
    }
    if let Some(s) = scope {
        params.push(("scope", s));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {}", e))?;

    if !response.status().is_success() {
        let error = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Token refresh failed: {}", error));
    }

    response
        .json::<TokenExchangeResult>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))
}
