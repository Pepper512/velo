//! PR E REQ-2.3 — the wire truth of `async-imap`'s quoting, without a server.
//!
//! `async-imap` 0.11 routes every mailbox argument through `validate_str`,
//! which quotes once (`"…"`, with `\` and `"` escaped) and refuses CR/LF; 0.10
//! did that for SELECT/COPY/MOVE/STATUS/LOGIN but built SUBSCRIBE, LIST and
//! CREATE with a bare `quote!`. Velo's `wire.rs` documents what it relies on;
//! this test pins the bytes so a future bump that changes them fails in CI,
//! not on a user's server (SPEC §7: the "quoted once, escaped once, never
//! twice" invariant).
//!
//! The client talks to a scripted server over `tokio::io::duplex`: the server
//! records every command line and answers each with a tagged OK, so the test
//! runs without Docker and in CI.

#[cfg(test)]
mod tests {
    use async_imap::Client;
    use futures::StreamExt;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    /// A scripted IMAP server end: greets, records each command line, answers
    /// `<tag> OK`, and stops after LOGOUT. Returns the recorded lines.
    fn scripted_server(
        server: tokio::io::DuplexStream,
    ) -> (Arc<Mutex<Vec<String>>>, tokio::task::JoinHandle<()>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_task = Arc::clone(&seen);
        let task = tokio::spawn(async move {
            let (read_half, mut write_half) = tokio::io::split(server);
            let mut lines = BufReader::new(read_half).lines();
            write_half
                .write_all(b"* OK IMAP4rev1 scripted server ready\r\n")
                .await
                .unwrap();
            while let Ok(Some(line)) = lines.next_line().await {
                seen_task.lock().unwrap().push(line.clone());
                let tag = line.split(' ').next().unwrap_or("*").to_string();
                // The command token, not a substring: a mailbox named
                // "Test LOGOUT" must not end the script (Gemini L1 on #84).
                let is_logout = line.split_whitespace().nth(1) == Some("LOGOUT");
                if is_logout {
                    write_half.write_all(b"* BYE\r\n").await.unwrap();
                }
                write_half
                    .write_all(format!("{tag} OK done\r\n").as_bytes())
                    .await
                    .unwrap();
                if is_logout {
                    break;
                }
            }
        });
        (seen, task)
    }

    #[tokio::test]
    async fn mailbox_names_are_quoted_once_and_escaped_once_on_the_wire() {
        let (client_end, server_end) = tokio::io::duplex(64 * 1024);
        let (seen, server) = scripted_server(server_end);

        let client = Client::new(client_end);
        let mut session = client
            .login("velo", "velo-test-only")
            .await
            .map_err(|(e, _)| e)
            .expect("LOGIN");

        // A name with a space, the Gmail-shaped one, one with a quote and a
        // backslash, and a modified-UTF-7 one — the four shapes §7 names.
        session.select("Sent Mail").await.expect("SELECT");
        session
            .uid_copy("1", "[Gmail]/Sent Mail")
            .await
            .expect("UID COPY");
        session.uid_mv("1", "a\"b\\c").await.expect("UID MOVE");
        session.create("&AOQ-").await.expect("CREATE");
        {
            let names = session.list(Some(""), Some("*")).await.expect("LIST");
            let _: Vec<_> = names.collect().await;
        }
        session.logout().await.expect("LOGOUT");
        server.await.expect("server task");

        let seen = seen.lock().unwrap().clone();
        assert_eq!(
            seen,
            vec![
                "A0001 LOGIN \"velo\" \"velo-test-only\"".to_string(),
                "A0002 SELECT \"Sent Mail\"".to_string(),
                "A0003 UID COPY 1 \"[Gmail]/Sent Mail\"".to_string(),
                "A0004 UID MOVE 1 \"a\\\"b\\\\c\"".to_string(),
                "A0005 CREATE \"&AOQ-\"".to_string(),
                // Measured: the LIST reference is quoted, the wildcard pattern
                // is sent bare — `*` is not a mailbox name.
                "A0006 LIST \"\" *".to_string(),
                "A0007 LOGOUT".to_string(),
            ],
            "every mailbox name is quoted exactly once and escaped exactly once"
        );
    }

    #[tokio::test]
    async fn a_name_carrying_a_line_break_never_reaches_the_wire() {
        // The library's own belt: CR/LF inside a name is refused before any
        // byte is written, so a second command cannot ride in on a folder name.
        let (client_end, server_end) = tokio::io::duplex(64 * 1024);
        let (seen, server) = scripted_server(server_end);

        let client = Client::new(client_end);
        let mut session = client
            .login("velo", "velo-test-only")
            .await
            .map_err(|(e, _)| e)
            .expect("LOGIN");
        let refused = session.create("Inbox\r\nA9999 DELETE INBOX").await;
        assert!(refused.is_err(), "a CR/LF name is refused: {refused:?}");
        session.logout().await.expect("LOGOUT");
        server.await.expect("server task");

        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen.len(), 2, "only LOGIN and LOGOUT were sent: {seen:?}");
        assert!(!seen.iter().any(|l| l.contains("DELETE")));
    }
}
