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

/// Run one IMAP operation against a pooled session.
///
/// The guard is held across the `await`, deliberately: if this future is
/// dropped mid-operation — cancellation — the guard's `Drop` runs and the entry
/// stays out of the map. That is the whole point of checkout-removes-entry, and
/// it only works while the guard and the await share a scope.
///
/// `Ok` puts the session back. Anything else leaves it evicted: an `Err` by way
/// of `release_err`, a panic or a cancellation by way of `Drop`.
async fn with_pooled_session<T, F, Fut>(
    pool: &ImapPool,
    session_id: &str,
    op: F,
) -> Result<T, String>
where
    F: FnOnce(std::sync::Arc<tokio::sync::Mutex<ImapSession>>) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let guard = pool.acquire(session_id).map_err(|e| e.to_string())?;
    let session = guard.session().clone();

    match op(session).await {
        Ok(value) => {
            guard.release_ok();
            Ok(value)
        }
        Err(err) => {
            // Eviction-on-error (Blocker 1): the connection may be mid-protocol.
            guard.release_err();
            Err(err)
        }
    }
}

/// `with_pooled_session`, plus the account identity the operation needs.
///
/// Only the removal commands want this — they warn once per account when the
/// server has no UIDPLUS — and they used to read it off the `ImapConfig` they no
/// longer receive.
async fn with_pooled_session_for<T, F, Fut>(
    pool: &ImapPool,
    session_id: &str,
    op: F,
) -> Result<T, String>
where
    F: FnOnce(std::sync::Arc<tokio::sync::Mutex<ImapSession>>, AccountIdent) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let guard = pool.acquire(session_id).map_err(|e| e.to_string())?;
    let session = guard.session().clone();
    let account = guard.account().clone();

    match op(session, account).await {
        Ok(value) => {
            guard.release_ok();
            Ok(value)
        }
        Err(err) => {
            guard.release_err();
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn imap_list_folders(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
) -> Result<Vec<ImapFolder>, String> {
    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::list_folders(&mut session).await
    })
    .await
}

#[tauri::command]
pub async fn imap_fetch_messages(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
    uids: Vec<u32>,
) -> Result<ImapFetchResult, String> {
    if uids.is_empty() {
        return Err("No UIDs provided".to_string());
    }

    let uid_set = uid_set(&uids);

    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        match imap_client::fetch_messages(&mut session, &folder, &uid_set).await {
            Ok(r) => Ok(r),
            // Decision 4(a): the raw fallback needs a credential, and the pool
            // deliberately holds none. Rather than keep a password on this
            // command just for the fallback, tell the frontend to re-issue the
            // fetch through `imap_raw_fetch_messages`, which carries a config.
            //
            // Returned as an `Err` so the pooled session is evicted: the
            // fallback exists precisely because `async-imap` returned an empty
            // result where the server sent data, and that session's protocol
            // state is not worth trusting afterwards.
            Err(imap_client::FetchError::AsyncImapEmpty { folder: f }) => {
                log::info!("Raw-fetch fallback needed for folder {f}");
                Err(NEED_RAW_FALLBACK.to_string())
            }
            Err(imap_client::FetchError::Other(msg)) => Err(msg),
        }
    })
    .await
}

/// `[1, 5, 10]` -> `"1,5,10"`.
///
/// Was written out five times; the pooled rewrite touched every one of them, so
/// it is one function now.
fn uid_set(uids: &[u32]) -> String {
    uids.iter()
        .map(|u| u.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

/// Sentinel the frontend matches to re-issue a fetch outside the pool.
///
/// Namespaced, and the frontend matches it **exactly**, because this shares a
/// `Result<T, String>` channel with `FetchError::Other(msg)` — where `msg` is
/// server-supplied. A loose `includes()` would let a server holding a mailbox
/// named after the sentinel (or emitting it in a `NO` response) push the
/// frontend down the credential-carrying fallback path. Cross-vendor review
/// finding 1 on PR #39.
pub const NEED_RAW_FALLBACK: &str = "velo:fetch:NeedRawFallback";

/// Decision 4(a)'s escape hatch: a raw-TCP fetch that carries its own
/// credential because the pooled session cannot.
///
/// One of only two commands that receives a password, and named explicitly in
/// Done-when 5's exemption list so the "no credential crosses this boundary"
/// test stays honest rather than being quietly weakened.
#[tauri::command]
pub async fn imap_raw_fetch_messages(
    config: ImapConfig,
    folder: String,
    uids: Vec<u32>,
) -> Result<ImapFetchResult, String> {
    if uids.is_empty() {
        return Err("No UIDs provided".to_string());
    }
    imap_client::raw_fetch_messages(&config, &folder, &uid_set(&uids)).await
}

#[tauri::command]
pub async fn imap_fetch_new_uids(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
    since_uid: u32,
) -> Result<Vec<u32>, String> {
    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::fetch_new_uids(&mut session, &folder, since_uid).await
    })
    .await
}

#[tauri::command]
pub async fn imap_search_all_uids(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
) -> Result<Vec<u32>, String> {
    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::search_all_uids(&mut session, &folder).await
    })
    .await
}

#[tauri::command]
pub async fn imap_fetch_message_body(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
    uid: u32,
) -> Result<ImapMessage, String> {
    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::fetch_message_body(&mut session, &folder, uid).await
    })
    .await
}

#[tauri::command]
pub async fn imap_fetch_raw_message(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
    uid: u32,
) -> Result<String, String> {
    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::fetch_raw_message(&mut session, &folder, uid).await
    })
    .await
}

#[tauri::command]
pub async fn imap_set_flags(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
    uids: Vec<u32>,
    flags: Vec<String>,
    add: bool,
) -> Result<(), String> {
    if uids.is_empty() {
        return Ok(());
    }

    // Validate BEFORE checkout, which is where it was before pooling too: a
    // rejected flag should not take a session out of the map, and rendering
    // happens inside `set_flags` against an allowlist — this once built the flag
    // list by concatenation, so a flag containing CRLF became a second IMAP
    // command in the user's authenticated session (audit P1).
    crate::imap::wire::build_flag_list(&flags)?;

    let uid_set = uid_set(&uids);

    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::set_flags(&mut session, &folder, &uid_set, add, &flags).await
    })
    .await
}

#[tauri::command]
pub async fn imap_move_messages(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
    uids: Vec<u32>,
    destination: String,
) -> Result<RemovalResult, String> {
    if uids.is_empty() {
        // Nothing was flagged, so nothing is pending removal.
        return Ok(RemovalResult { expunged: true });
    }

    let uid_set = uid_set(&uids);

    with_pooled_session_for(&pool, &session_id, |session, account| async move {
        let result = {
            let mut session = session.lock().await;
            imap_client::move_messages(&mut session, &folder, &uid_set, &destination).await?
        };

        // The identity comes off the guard now: this command no longer receives
        // an `ImapConfig` to read it from.
        if !result.expunged {
            imap::caps::warn_uidplus_missing_once(&account.username, &account.host);
        }

        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn imap_delete_messages(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
    uids: Vec<u32>,
) -> Result<RemovalResult, String> {
    if uids.is_empty() {
        // Nothing was flagged, so nothing is pending removal.
        return Ok(RemovalResult { expunged: true });
    }

    let uid_set = uid_set(&uids);

    with_pooled_session_for(&pool, &session_id, |session, account| async move {
        let result = {
            let mut session = session.lock().await;
            imap_client::delete_messages(&mut session, &folder, &uid_set).await?
        };

        if !result.expunged {
            imap::caps::warn_uidplus_missing_once(&account.username, &account.host);
        }

        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn imap_get_folder_status(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
) -> Result<ImapFolderStatus, String> {
    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::get_folder_status(&mut session, &folder).await
    })
    .await
}

#[tauri::command]
pub async fn imap_fetch_attachment(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
    uid: u32,
    part_id: String,
) -> Result<String, String> {
    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::fetch_attachment(&mut session, &folder, uid, &part_id).await
    })
    .await
}

#[tauri::command]
pub async fn imap_append_message(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
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

    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::append_message(&mut session, &folder, flags.as_deref(), &raw_bytes).await
    })
    .await
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
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
    since_date: Option<String>,
) -> Result<ImapFolderSearchResult, String> {
    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::search_folder(&mut session, &folder, since_date).await
    })
    .await
}

#[tauri::command]
pub async fn imap_sync_folder(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
    batch_size: u32,
    since_date: Option<String>,
) -> Result<ImapFolderSyncResult, String> {
    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::sync_folder(&mut session, &folder, batch_size, since_date).await
    })
    .await
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
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folders: Vec<DeltaCheckRequest>,
) -> Result<Vec<DeltaCheckResult>, String> {
    with_pooled_session(&pool, &session_id, |session| async move {
        let mut session = session.lock().await;
        imap_client::delta_check_folders(&mut session, &folders).await
    })
    .await
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
