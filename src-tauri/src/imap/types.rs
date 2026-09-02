use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct ImapConfig {
    pub host: String,
    pub port: u16,
    pub security: String, // "tls", "starttls", "none"
    pub username: String,
    pub password: String,    // plaintext password or OAuth2 access token
    pub auth_method: String, // "password" or "oauth2"
    #[serde(default)]
    pub accept_invalid_certs: bool,
}

/// Manual, so `{:?}` can never print the password.
///
/// Nothing `{:?}`-logs an `ImapConfig` today — that was checked — but session
/// pooling (brief E2/P15) adds credential-handling code paths, and a derived
/// `Debug` on a struct holding a plaintext password or an OAuth access token is
/// one stray `tracing::debug!` away from putting it in a log file. Cheaper to
/// remove the possibility than to keep re-checking that nobody used it.
impl std::fmt::Debug for ImapConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ImapConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("security", &self.security)
            .field("username", &self.username)
            .field("password", &"[redacted]")
            .field("auth_method", &self.auth_method)
            .field("accept_invalid_certs", &self.accept_invalid_certs)
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapFolder {
    pub path: String,     // decoded UTF-8 display name
    pub raw_path: String, // original modified UTF-7 path for IMAP commands
    pub name: String,     // decoded display name (last segment)
    pub delimiter: String,
    pub special_use: Option<String>, // "\Sent", "\Trash", "\Drafts", "\Junk", "\Archive", "\All"
    pub exists: u32,
    pub unseen: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapMessage {
    pub uid: u32,
    pub folder: String,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub from_address: Option<String>,
    pub from_name: Option<String>,
    pub to_addresses: Option<String>,
    pub cc_addresses: Option<String>,
    pub bcc_addresses: Option<String>,
    pub reply_to: Option<String>,
    pub subject: Option<String>,
    pub date: i64,
    pub is_read: bool,
    pub is_starred: bool,
    pub is_draft: bool,
    pub body_html: Option<String>,
    pub body_text: Option<String>,
    pub snippet: Option<String>,
    pub raw_size: u32,
    pub list_unsubscribe: Option<String>,
    pub list_unsubscribe_post: Option<String>,
    pub auth_results: Option<String>,
    pub attachments: Vec<ImapAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapAttachment {
    pub part_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size: u32,
    pub content_id: Option<String>,
    pub is_inline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapFolderStatus {
    pub uidvalidity: u32,
    pub uidnext: u32,
    pub exists: u32,
    pub unseen: u32,
    pub highest_modseq: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapFetchResult {
    pub messages: Vec<ImapMessage>,
    pub folder_status: ImapFolderStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapFolderSyncResult {
    pub uids: Vec<u32>,
    pub messages: Vec<ImapMessage>,
    pub folder_status: ImapFolderStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapFolderSearchResult {
    pub uids: Vec<u32>,
    pub folder_status: ImapFolderStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaCheckRequest {
    pub folder: String,
    pub last_uid: u32,
    pub uidvalidity: u32,
}

/// One folder's answer from `delta_check_folders`.
///
/// F-4 REQ-1.2b: **every requested folder gets a row.** A folder the check
/// could not complete comes back with `checked: false` and the reason in
/// `error`, instead of being silently omitted — a pass that is missing N
/// folders used to look identical to a clean one, and "no folder reported an
/// error" is not the same proposition as "every folder was checked". Only the
/// second is safe to delete on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaCheckResult {
    pub folder: String,
    pub uidvalidity: u32,
    pub new_uids: Vec<u32>,
    pub uidvalidity_changed: bool,
    /// The server's `EXISTS` at SELECT — F-4's gate compares it with the local
    /// count to decide whether a full UID list is worth fetching (REQ-2.1).
    pub exists: u32,
    /// `true` only if SELECT and the UID SEARCH both completed for this folder.
    pub checked: bool,
    /// Why `checked` is `false`, for the log and the pass report.
    pub error: Option<String>,
}

impl DeltaCheckResult {
    /// The row for a folder this pass could not check. Carries nothing the
    /// caller could mistake for an observation: no UIDs, no UIDVALIDITY claim.
    pub fn unchecked(folder: &str, uidvalidity: u32, reason: String) -> Self {
        Self {
            folder: folder.to_string(),
            uidvalidity,
            new_uids: Vec::new(),
            uidvalidity_changed: false,
            exists: 0,
            checked: false,
            error: Some(reason),
        }
    }
}

/// What a move or delete actually did to the source folder (brief REQ-4.1).
///
/// `expunged: false` means the messages were flagged `\Deleted` but are still
/// on the server, because it does not advertise `UIDPLUS` and there is no way
/// to expunge only the messages the user selected. The UI must say so rather
/// than reporting a completed deletion — "permanently" may degrade to
/// "eventually" only when the app says so out loud (Decision 1(a)).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct RemovalResult {
    pub expunged: bool,
}

/// One entry of a `COPYUID` mapping: the UID a message had in the source
/// folder and the UID the server gave it in the destination (RFC 4315 §3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct UidMapping {
    pub source_uid: u32,
    pub dest_uid: u32,
}

/// What a move did to the source folder, plus where the messages went (F-5).
///
/// `expunged` carries the same meaning as [`RemovalResult`]. `mapping` is the
/// server's `COPYUID` answer, validated in `imap::copyuid`, or `None` when no
/// usable mapping arrived — a non-UIDPLUS server, the COPY fallback (whose
/// `COPYUID` rides the tagged OK that `async-imap` consumes), or a response the
/// best-effort unsolicited channel dropped. The frontend treats `None` as
/// "the row cannot be re-keyed" and falls back to hiding it until the
/// destination folder syncs. **Wire contract with `parseMoveResult`.**
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveResult {
    pub expunged: bool,
    pub mapping: Option<Vec<UidMapping>>,
    /// The destination mailbox's UIDVALIDITY as reported in the same `COPYUID`.
    /// Destination UIDs mean nothing outside that generation, so the frontend
    /// refuses the mapping when this disagrees with the UIDVALIDITY it last
    /// synced for the folder (Grok L9). `None` whenever `mapping` is.
    pub dest_uidvalidity: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ImapConfig {
        ImapConfig {
            host: "imap.example.com".to_string(),
            port: 993,
            security: "ssl".to_string(),
            username: "user@example.com".to_string(),
            password: "hunter2-not-in-any-log".to_string(),
            auth_method: "password".to_string(),
            accept_invalid_certs: false,
        }
    }

    #[test]
    fn debug_never_renders_the_password() {
        let rendered = format!("{:?}", config());

        assert!(
            !rendered.contains("hunter2-not-in-any-log"),
            "ImapConfig's Debug leaked the credential: {rendered}"
        );
        assert!(rendered.contains("[redacted]"));
    }

    #[test]
    fn debug_still_renders_the_fields_worth_debugging() {
        // Redaction is only worth having if the type stays useful in a log.
        let rendered = format!("{:?}", config());

        assert!(rendered.contains("imap.example.com"));
        assert!(rendered.contains("993"));
        assert!(rendered.contains("user@example.com"));
        assert!(rendered.contains("password"), "the field name survives");
    }

    #[test]
    fn serialization_is_unaffected_by_the_manual_debug() {
        // The redaction must not reach the wire format: the config still has to
        // round-trip to Rust from the frontend with a usable credential.
        let json = serde_json::to_string(&config()).expect("serialize");
        let back: ImapConfig = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(back.password, "hunter2-not-in-any-log");
        assert_eq!(back.host, "imap.example.com");
    }
}
