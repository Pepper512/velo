use crate::imap;
use crate::imap::client as imap_client;
use crate::imap::client::ImapSession;
use crate::imap::pool::{AccountIdent, AccountKey, SessionPool};
use crate::imap::types::{
    DeltaCheckRequest, DeltaCheckResult, ImapConfig, ImapFetchResult, ImapFolder,
    ImapFolderSearchResult, ImapFolderStatus, ImapFolderSyncResult, ImapMessage,
    RemovalResult,
};
use crate::smtp::client as smtp_client;
use crate::smtp::types::{SmtpConfig, SmtpSendResult};

// ---------- IMAP commands ----------

#[tauri::command]
pub async fn imap_test_connection(config: ImapConfig) -> Result<String, String> {
    imap_client::test_connection(&config).await
}

// ---------- Pooled session lifecycle (brief E2/P15) ----------

/// The pool's alias for the concrete session type.
pub type ImapPool = SessionPool<ImapSession>;

/// 128 unguessable bits (Decision 2), hex-encoded.
///
/// Defense in depth, explicitly **not** the mitigation: the id is a plain
/// `invoke` argument and lives in the module map of any window doing mail work,
/// so a same-realm sanitizer bypass can steal it however long it is. What
/// actually helps is the per-window binding; see the brief's threat model.
fn new_session_id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| format!("Failed to generate session id: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn account_key(config: &ImapConfig, credential_version: u64) -> AccountKey {
    AccountKey {
        ident: AccountIdent {
            username: config.username.clone(),
            host: config.host.clone(),
        },
        port: config.port,
        security: config.security.clone(),
        auth_mechanism: config.auth_method.clone(),
        credential_version,
    }
}

/// Open an authenticated session and keep it.
///
/// **The only command that receives a password**, together with Decision 4(a)'s
/// raw-fetch fallback. Every other operation takes a `session_id`.
#[tauri::command]
pub async fn imap_session_open(
    pool: tauri::State<'_, ImapPool>,
    config: ImapConfig,
) -> Result<String, String> {
    let ident = AccountIdent {
        username: config.username.clone(),
        host: config.host.clone(),
    };
    let version = pool.credential_version(&ident);

    let session = imap_client::connect(&config).await?;
    let id = new_session_id()?;

    pool.insert(id.clone(), account_key(&config, version), session)
        .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Close a session. Idempotent: an unknown id is not an error.
#[tauri::command]
pub async fn imap_session_close(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
) -> Result<(), String> {
    if let Some(session) = pool.remove(&session_id) {
        logout_arc(session).await;
    }
    Ok(())
}

/// Invalidate every session for an account after a credential change.
///
/// Called on password change (`clearConfigCache`) and on OAuth refresh failure,
/// so a rotated credential is never served from the pool.
#[tauri::command]
pub async fn imap_sessions_invalidate(
    pool: tauri::State<'_, ImapPool>,
    username: String,
    host: String,
) -> Result<(), String> {
    for session in pool.bump_credential_version(&AccountIdent { username, host }) {
        logout_arc(session).await;
    }
    Ok(())
}

/// Best-effort LOGOUT of a session nothing else holds.
///
/// Never fails the caller: the connection is being discarded either way, and a
/// server that will not answer LOGOUT must not stall app exit.
pub async fn logout_arc(session: std::sync::Arc<tokio::sync::Mutex<ImapSession>>) {
    if let Ok(mutex) = std::sync::Arc::try_unwrap(session) {
        let mut session = mutex.into_inner();
        let _ = session.logout().await;
    }
}

#[tauri::command]
pub async fn imap_list_folders(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
) -> Result<Vec<ImapFolder>, String> {
    let guard = pool.acquire(&session_id).map_err(|e| e.to_string())?;

    // Checkout has already removed the entry from the map. If this future is
    // dropped, or the operation panics, the guard's `Drop` leaves it removed and
    // the connection closes — no `Err` has to reach anyone for that to happen.
    let result = {
        let session = guard.session().clone();
        let mut session = session.lock().await;
        imap_client::list_folders(&mut session).await
    };

    match result {
        Ok(folders) => {
            guard.release_ok();
            Ok(folders)
        }
        Err(e) => {
            // Eviction-on-error (Blocker 1): any Err leaves the session out.
            guard.release_err();
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn imap_fetch_messages(
    config: ImapConfig,
    folder: String,
    uids: Vec<u32>,
) -> Result<ImapFetchResult, String> {
    if uids.is_empty() {
        return Err("No UIDs provided".to_string());
    }

    // Build a UID set string like "1,5,10,20"
    let uid_set: String = uids
        .iter()
        .map(|u| u.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let mut session = imap_client::connect(&config).await?;
    let result = imap_client::fetch_messages(&mut session, &folder, &uid_set).await;
    let _ = session.logout().await;

    match result {
        Ok(r) => Ok(r),
        // Typed, not a string prefix (audit P15): the compiler now enforces that
        // this arm and the value `fetch_messages` returns stay in agreement.
        Err(imap_client::FetchError::AsyncImapEmpty { folder: f }) => {
            log::info!("Falling back to raw TCP fetch for folder {f}");
            imap_client::raw_fetch_messages(&config, &folder, &uid_set).await
        }
        Err(imap_client::FetchError::Other(msg)) => Err(msg),
    }
}

#[tauri::command]
pub async fn imap_fetch_new_uids(
    config: ImapConfig,
    folder: String,
    since_uid: u32,
) -> Result<Vec<u32>, String> {
    let mut session = imap_client::connect(&config).await?;
    let uids = imap_client::fetch_new_uids(&mut session, &folder, since_uid).await?;
    let _ = session.logout().await;
    Ok(uids)
}

#[tauri::command]
pub async fn imap_search_all_uids(
    config: ImapConfig,
    folder: String,
) -> Result<Vec<u32>, String> {
    let mut session = imap_client::connect(&config).await?;
    let uids = imap_client::search_all_uids(&mut session, &folder).await?;
    let _ = session.logout().await;
    Ok(uids)
}

#[tauri::command]
pub async fn imap_fetch_message_body(
    config: ImapConfig,
    folder: String,
    uid: u32,
) -> Result<ImapMessage, String> {
    let mut session = imap_client::connect(&config).await?;
    let message = imap_client::fetch_message_body(&mut session, &folder, uid).await?;
    let _ = session.logout().await;
    Ok(message)
}

#[tauri::command]
pub async fn imap_fetch_raw_message(
    config: ImapConfig,
    folder: String,
    uid: u32,
) -> Result<String, String> {
    let mut session = imap_client::connect(&config).await?;
    let raw = imap_client::fetch_raw_message(&mut session, &folder, uid).await?;
    let _ = session.logout().await;
    Ok(raw)
}

#[tauri::command]
pub async fn imap_set_flags(
    config: ImapConfig,
    folder: String,
    uids: Vec<u32>,
    flags: Vec<String>,
    add: bool,
) -> Result<(), String> {
    if uids.is_empty() {
        return Ok(());
    }

    // Validate before connecting: a rejected flag should not cost a TCP+TLS session.
    // Rendering happens inside `set_flags`, against an allowlist — previously this
    // built the flag list by string concatenation, so a flag containing CRLF became
    // a second IMAP command running in the user's authenticated session (audit P1).
    crate::imap::wire::build_flag_list(&flags)?;

    let mut session = imap_client::connect(&config).await?;

    let uid_set: String = uids
        .iter()
        .map(|u| u.to_string())
        .collect::<Vec<_>>()
        .join(",");

    imap_client::set_flags(&mut session, &folder, &uid_set, add, &flags).await?;
    let _ = session.logout().await;
    Ok(())
}

#[tauri::command]
pub async fn imap_move_messages(
    config: ImapConfig,
    folder: String,
    uids: Vec<u32>,
    destination: String,
) -> Result<RemovalResult, String> {
    if uids.is_empty() {
        // Nothing was flagged, so nothing is pending removal.
        return Ok(RemovalResult { expunged: true });
    }

    let mut session = imap_client::connect(&config).await?;

    let uid_set: String = uids
        .iter()
        .map(|u| u.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let result = imap_client::move_messages(&mut session, &folder, &uid_set, &destination).await?;
    let _ = session.logout().await;

    if !result.expunged {
        imap::caps::warn_uidplus_missing_once(&config.username, &config.host);
    }

    Ok(result)
}

#[tauri::command]
pub async fn imap_delete_messages(
    config: ImapConfig,
    folder: String,
    uids: Vec<u32>,
) -> Result<RemovalResult, String> {
    if uids.is_empty() {
        // Nothing was flagged, so nothing is pending removal.
        return Ok(RemovalResult { expunged: true });
    }

    let mut session = imap_client::connect(&config).await?;

    let uid_set: String = uids
        .iter()
        .map(|u| u.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let result = imap_client::delete_messages(&mut session, &folder, &uid_set).await?;
    let _ = session.logout().await;

    if !result.expunged {
        imap::caps::warn_uidplus_missing_once(&config.username, &config.host);
    }

    Ok(result)
}

#[tauri::command]
pub async fn imap_get_folder_status(
    config: ImapConfig,
    folder: String,
) -> Result<ImapFolderStatus, String> {
    let mut session = imap_client::connect(&config).await?;
    let status = imap_client::get_folder_status(&mut session, &folder).await?;
    let _ = session.logout().await;
    Ok(status)
}

#[tauri::command]
pub async fn imap_fetch_attachment(
    config: ImapConfig,
    folder: String,
    uid: u32,
    part_id: String,
) -> Result<String, String> {
    let mut session = imap_client::connect(&config).await?;
    let data = imap_client::fetch_attachment(&mut session, &folder, uid, &part_id).await?;
    let _ = session.logout().await;
    Ok(data)
}

#[tauri::command]
pub async fn imap_append_message(
    config: ImapConfig,
    folder: String,
    flags: Option<Vec<String>>,
    raw_message: String,
) -> Result<(), String> {
    // Unrendered flag names (`["Seen"]`), not a pre-built `"(\\Seen)"` string: the
    // rendering is what has to be trusted, so it happens in `imap::wire` where it can
    // be validated. `async-imap`'s `append` validates neither the mailbox nor the
    // flags it is handed (audit P1, extended).
    crate::imap::wire::validate_mailbox(&folder)?;
    if let Some(f) = flags.as_deref() {
        if !f.is_empty() {
            crate::imap::wire::build_flag_list(f)?;
        }
    }

    // raw_message is base64url-encoded; decode it
    let raw_bytes = base64url_decode(&raw_message)?;

    let mut session = imap_client::connect(&config).await?;

    imap_client::append_message(&mut session, &folder, flags.as_deref(), &raw_bytes).await?;
    let _ = session.logout().await;
    Ok(())
}

fn base64url_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    engine
        .decode(input)
        .map_err(|e| format!("base64url decode failed: {e}"))
}

#[tauri::command]
pub async fn imap_search_folder(
    config: ImapConfig,
    folder: String,
    since_date: Option<String>,
) -> Result<ImapFolderSearchResult, String> {
    let mut session = imap_client::connect(&config).await?;
    let result = imap_client::search_folder(&mut session, &folder, since_date).await;
    let _ = session.logout().await;
    result
}

#[tauri::command]
pub async fn imap_sync_folder(
    config: ImapConfig,
    folder: String,
    batch_size: u32,
    since_date: Option<String>,
) -> Result<ImapFolderSyncResult, String> {
    let mut session = imap_client::connect(&config).await?;
    let result = imap_client::sync_folder(&mut session, &folder, batch_size, since_date).await;
    let _ = session.logout().await;
    result
}

/// Developer-only IMAP session transcript. **Not compiled into release builds**
/// (audit P3) — it returns a live authenticated transcript that can contain
/// credential material echoed back by the server.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn imap_raw_fetch_diagnostic(
    config: ImapConfig,
    folder: String,
    uid_range: String,
) -> Result<String, String> {
    imap_client::raw_fetch_diagnostic(&config, &folder, &uid_range).await
}

#[tauri::command]
pub async fn imap_delta_check(
    config: ImapConfig,
    folders: Vec<DeltaCheckRequest>,
) -> Result<Vec<DeltaCheckResult>, String> {
    let mut session = imap_client::connect(&config).await?;
    let results = imap_client::delta_check_folders(&mut session, &folders).await?;
    let _ = session.logout().await;
    Ok(results)
}

// ---------- SMTP commands ----------

#[tauri::command]
pub async fn smtp_send_email(
    config: SmtpConfig,
    raw_email: String,
) -> Result<SmtpSendResult, String> {
    smtp_client::send_raw_email(&config, &raw_email).await
}

#[tauri::command]
pub async fn smtp_test_connection(config: SmtpConfig) -> Result<SmtpSendResult, String> {
    smtp_client::test_connection(&config).await
}
