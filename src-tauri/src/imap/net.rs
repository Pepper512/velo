//! Connection setup and timeout plumbing shared by every IMAP path (audit P15).
//!
//! # What this replaces
//!
//! Before this module, `client.rs` opened a socket in three places with three
//! near-identical bodies:
//!
//! - `connect_stream` — TLS and plain, for the `async-imap` path
//! - `raw_connect_starttls` — STARTTLS, returning a bare stream
//! - `connect_starttls` — STARTTLS again, returning an authenticated session
//!
//! The two STARTTLS sequences differed only in variable names, log wording, and
//! whether the greeting was checked. `build_tls_connector` was called from three
//! sites. The audit measured 44 copies of the same timeout-message suffix and 53
//! hand-rolled `tokio::time::timeout` wrappers.
//!
//! Duplication of a *connection* routine is worse than most: it is the code that
//! is hardest to exercise in tests, so divergence between copies is invisible
//! until a specific server hits the stale one. `raw_connect_starttls` had already
//! drifted — it discarded the server greeting without checking it, where
//! `connect_starttls` verified `OK` first.

use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::types::ImapConfig;

/// The suffix every timeout message carried, written once.
///
/// The audit counted 44 copies. `grep -c "check your server settings"` is the
/// acceptance check, and it should find this line and no other.
const TIMEOUT_HINT: &str = "check your server settings or network connection";

/// Run `future` under a timeout, describing the operation if it expires.
///
/// Collapses the `tokio::time::timeout(...).await.map_err(|_| format!(...))?`
/// triple that appeared 53 times.
pub async fn with_timeout<T, F>(
    duration: Duration,
    operation: &str,
    future: F,
) -> Result<T, String>
where
    F: std::future::Future<Output = T>,
{
    tokio::time::timeout(duration, future).await.map_err(|_| {
        format!(
            "{operation} timed out after {}s — {TIMEOUT_HINT}",
            duration.as_secs()
        )
    })
}

/// Open a TCP connection and apply the socket options every path wants.
pub async fn connect_tcp(
    config: &ImapConfig,
    connect_timeout: Duration,
) -> Result<TcpStream, String> {
    let addr = (&*config.host, config.port);
    let tcp = with_timeout(
        connect_timeout,
        &format!("TCP connect to {}:{}", config.host, config.port),
        TcpStream::connect(addr),
    )
    .await?
    .map_err(|e| format!("TCP connect to {}:{} failed: {e}", config.host, config.port))?;

    configure_tcp_socket(&tcp);
    Ok(tcp)
}

/// Configure TCP keepalive and nodelay on a connected socket.
///
/// Moved verbatim from `client.rs` (audit P15). Keepalive matters here: an IMAP
/// connection can sit idle mid-session, and without it a NAT or firewall can
/// drop the mapping silently, so the next command hangs until a timeout rather
/// than failing fast.
pub fn configure_tcp_socket(stream: &TcpStream) {
    if let Err(e) = stream.set_nodelay(true) {
        log::warn!("Failed to set TCP_NODELAY: {e}");
    }

    let sock_ref = socket2::SockRef::from(stream);
    let keepalive = socket2::TcpKeepalive::new()
        .with_time(Duration::from_secs(60))
        .with_interval(Duration::from_secs(60));
    if let Err(e) = sock_ref.set_tcp_keepalive(&keepalive) {
        log::warn!("Failed to set TCP keepalive: {e}");
    }
}

/// Perform the STARTTLS handshake on an already-connected plain socket.
///
/// The greeting **is** checked here. `raw_connect_starttls` used to skip that,
/// which meant a server that opened with `* BYE` was treated as healthy and the
/// failure surfaced later as an unrelated protocol error.
pub async fn upgrade_starttls(
    config: &ImapConfig,
    mut tcp: TcpStream,
    cmd_timeout: Duration,
    handshake_timeout: Duration,
    tls_connector: tokio_native_tls::TlsConnector,
) -> Result<tokio_native_tls::TlsStream<TcpStream>, String> {
    let mut buf = vec![0u8; 4096];

    let n = with_timeout(cmd_timeout, "Reading server greeting", tcp.read(&mut buf))
        .await?
        .map_err(|e| format!("Failed to read server greeting: {e}"))?;
    let greeting = String::from_utf8_lossy(&buf[..n]);
    if !greeting.contains("OK") {
        return Err(format!("Unexpected server greeting: {greeting}"));
    }

    tcp.write_all(b"a001 STARTTLS\r\n")
        .await
        .map_err(|e| format!("Failed to send STARTTLS: {e}"))?;

    let n = with_timeout(cmd_timeout, "STARTTLS response", tcp.read(&mut buf))
        .await?
        .map_err(|e| format!("Failed to read STARTTLS response: {e}"))?;
    let response = String::from_utf8_lossy(&buf[..n]);
    if !response.contains("OK") {
        return Err(format!("STARTTLS rejected: {response}"));
    }

    with_timeout(
        handshake_timeout,
        "TLS upgrade after STARTTLS",
        tls_connector.connect(&config.host, tcp),
    )
    .await?
    .map_err(|e| format!("TLS upgrade after STARTTLS failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn with_timeout_names_the_operation_and_the_deadline() {
        let err = with_timeout(
            Duration::from_millis(10),
            "Fetching the thing",
            tokio::time::sleep(Duration::from_secs(30)),
        )
        .await
        .unwrap_err();

        assert!(err.starts_with("Fetching the thing timed out after 0s"), "got {err}");
        assert!(err.contains(TIMEOUT_HINT), "got {err}");
    }

    #[tokio::test]
    async fn with_timeout_passes_through_a_value_that_arrives_in_time() {
        let value = with_timeout(Duration::from_secs(5), "Instant", async { 42 })
            .await
            .unwrap();
        assert_eq!(value, 42);
    }
}
