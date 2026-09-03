use crate::imap;
use crate::imap::client as imap_client;
use crate::imap::client::ImapSession;
use crate::imap::pool::{AccountIdent, AccountKey, SessionPool};
use futures::future::BoxFuture;
use futures::FutureExt;
use tauri::Emitter;
use crate::imap::types::{
    DeltaCheckRequest, DeltaCheckResult, ImapConfig, ImapFetchResult, ImapFolder,
    ImapFolderSearchResult, ImapFolderStatus, ImapFolderSyncResult, ImapMessage,
    MoveResult, RemovalResult,
};
use crate::connection_tests::{run_cancellable, ConnectionTests};
use crate::smtp::client as smtp_client;
use crate::smtp::types::{SmtpConfig, SmtpSendResult};

// ---------- IMAP commands ----------

/// `test_id` (SPEC-204) makes the test cancellable through
/// `connection_test_cancel`; without it the test runs inline as before.
#[tauri::command]
pub async fn imap_test_connection(
    config: ImapConfig,
    test_id: Option<u64>,
    tests: tauri::State<'_, ConnectionTests>,
) -> Result<String, String> {
    run_cancellable(&tests, test_id, async move { imap_client::test_connection(&config).await }).await
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

    match pool.insert(id.clone(), account_key(&config, version), session) {
        Ok(None) => Ok(id),
        Ok(Some(victim)) => {
            // The cap evicted the account's idlest idle session. It is in
            // protocol sync and deserves a LOGOUT, but not on this command's
            // clock: a stranger's slow server must not delay the open.
            spawn_logout(victim);
            Ok(id)
        }
        Err((err, session)) => {
            // `StaleCredential`: a credential bump landed during the round trip
            // above, so this session may be authenticated with the revoked
            // credential and must not enter the map (SPEC-E2-3 REQ-2.1). The
            // frontend reopens once against the new generation.
            // `TooManySessions`: every session for the account is in flight.
            // Either way the fresh session is ours to LOGOUT — on a background
            // task, because the frontend is waiting on this error to reopen
            // (review, Gemini L3).
            spawn_logout(session);
            Err(err.to_string())
        }
    }
}

/// Close a session. Idempotent: an unknown id is not an error.
#[tauri::command]
pub async fn imap_session_close(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
) -> Result<(), String> {
    if let Some(session) = pool.remove(&session_id) {
        logout(session).await;
    }
    Ok(())
}

/// Window event fired after a credential invalidation has evicted (SPEC-E2-3
/// REQ-3.1). Every window's session manager forgets the matching cached ids on
/// receipt, so a pop-out does not have to fail one call to learn its id is gone.
pub const SESSIONS_INVALIDATED_EVENT: &str = "velo-imap-sessions-invalidated";

/// Payload of [`SESSIONS_INVALIDATED_EVENT`]: the account identity and the
/// caller's nonce — never a session id and never a credential. The window
/// that asked for the invalidation already forgot its ids; the echoed nonce
/// lets it recognise and ignore its own broadcast (review, Grok 1).
#[derive(Clone, serde::Serialize)]
pub struct SessionsInvalidated {
    pub username: String,
    pub host: String,
    pub nonce: String,
}

/// Longest nonce accepted: a UUID is 36 characters; the payload goes to every
/// window, so a caller cannot inflate it.
const MAX_INVALIDATION_NONCE_LEN: usize = 64;

/// Invalidate every session for an account after a credential change.
///
/// Called on password change (`clearConfigCache`) and on OAuth refresh failure,
/// so a rotated credential is never served from the pool. Emits
/// [`SESSIONS_INVALIDATED_EVENT`] to every window as soon as the map is clear,
/// *before* the evicted sessions are logged out.
#[tauri::command]
pub async fn imap_sessions_invalidate(
    app: tauri::AppHandle,
    pool: tauri::State<'_, ImapPool>,
    username: String,
    host: String,
    nonce: String,
) -> Result<(), String> {
    if nonce.len() > MAX_INVALIDATION_NONCE_LEN {
        return Err("invalidation nonce too long".to_string());
    }
    let ident = AccountIdent { username, host };
    let evicted = pool.bump_credential_version(&ident);

    // The map is already clear, so tell the other windows *now*: their cached
    // ids are dead from this point, and waiting for the LOGOUTs would only
    // cost them `NoSuchSession` round trips for the whole budget (review,
    // Grok 4). A failed broadcast is worth a line: no window forgets.
    if let Err(err) = app.emit(
        SESSIONS_INVALIDATED_EVENT,
        SessionsInvalidated {
            username: ident.username.clone(),
            host: ident.host.clone(),
            nonce,
        },
    ) {
        log::warn!("Could not broadcast the session invalidation: {err}");
    }

    // Concurrently, as at exit: two slow servers must not cost two budgets
    // (review, Gemini L4).
    futures::future::join_all(evicted.into_iter().map(logout)).await;
    Ok(())
}

/// Budget for one LOGOUT. Bounded so that neither a close nor an invalidate
/// IPC call, nor the reaper, can hang on a server that will not answer.
pub const LOGOUT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// Best-effort LOGOUT of a session the caller owns.
///
/// Takes the session by value: the pool hands out owned sessions on every path
/// that removes a clean one from the map, so there is no second handle that
/// could make the LOGOUT conditional (SPEC-E2-3 REQ-1.4 — the conditional
/// unwrap that used to skip it silently is gone). Never fails the caller: the
/// connection is being discarded either way.
pub async fn logout(mut session: ImapSession) {
    let _ = tokio::time::timeout(LOGOUT_TIMEOUT, session.logout()).await;
}

/// LOGOUT on a background task, for callers that must not wait on it.
///
/// Best-effort by construction: the session is already out of the map, so the
/// exit hook's drain cannot see it, and a task still running when the runtime
/// shuts down is dropped with its socket. Bounded by `LOGOUT_TIMEOUT` either
/// way. Used only where the alternative is a caller stalled on a stranger's
/// server (recorded as a residual in SPEC-E2-3; review, Grok 5).
fn spawn_logout(session: ImapSession) {
    tauri::async_runtime::spawn(logout(session));
}

/// Run one IMAP operation against a pooled session.
///
/// The guard is held across the `await`, deliberately: if this future is
/// dropped mid-operation — cancellation — the guard's `Drop` runs and the entry
/// stays out of the map. That is the whole point of checkout-removes-entry, and
/// it only works while the guard and the await share a scope.
///
/// The operation borrows the session exclusively through the guard — the pool
/// owns it, nothing is cloned. The borrow is why `op` returns a boxed future:
/// the future's lifetime is the borrow's, and a closure cannot spell that
/// without the `for<'a>` on the bound.
///
/// `Ok` puts the session back — or, if its entry vanished while checked out,
/// LOGOUTs the orphan on a background task (REQ-1.2). Anything else leaves it
/// evicted: an `Err` by way of `release_err`, a panic or a cancellation by way
/// of `Drop`.
async fn with_pooled_session<T, F>(pool: &ImapPool, session_id: &str, op: F) -> Result<T, String>
where
    F: for<'a> FnOnce(&'a mut ImapSession) -> BoxFuture<'a, Result<T, String>>,
{
    let mut guard = pool.acquire(session_id).map_err(|e| e.to_string())?;

    match op(guard.session_mut()).await {
        Ok(value) => {
            if let Some(orphan) = guard.release_ok() {
                spawn_logout(orphan);
            }
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
async fn with_pooled_session_for<T, F>(
    pool: &ImapPool,
    session_id: &str,
    op: F,
) -> Result<T, String>
where
    F: for<'a> FnOnce(&'a mut ImapSession, AccountIdent) -> BoxFuture<'a, Result<T, String>>,
{
    let mut guard = pool.acquire(session_id).map_err(|e| e.to_string())?;
    let account = guard.account().clone();

    match op(guard.session_mut(), account).await {
        Ok(value) => {
            if let Some(orphan) = guard.release_ok() {
                spawn_logout(orphan);
            }
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
    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::list_folders(session).await }.boxed()
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

    with_pooled_session(&pool, &session_id, |session| {
        async move { match imap_client::fetch_messages(session, &folder, &uid_set).await {
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
        } }.boxed()
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
    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::fetch_new_uids(session, &folder, since_uid).await }.boxed()
    })
    .await
}

#[tauri::command]
pub async fn imap_search_all_uids(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
) -> Result<Vec<u32>, String> {
    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::search_all_uids(session, &folder).await }.boxed()
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
    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::fetch_message_body(session, &folder, uid).await }.boxed()
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
    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::fetch_raw_message(session, &folder, uid).await }.boxed()
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

    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::set_flags(session, &folder, &uid_set, add, &flags).await }.boxed()
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
) -> Result<MoveResult, String> {
    if uids.is_empty() {
        // Nothing was flagged, so nothing is pending removal — and nothing moved,
        // so the (empty) mapping is complete rather than absent.
        return Ok(MoveResult { expunged: true, mapping: Some(Vec::new()), dest_uidvalidity: None });
    }

    let uid_set = uid_set(&uids);

    with_pooled_session_for(&pool, &session_id, |session, account| {
        async move {
            let result = imap_client::move_messages(session, &folder, &uid_set, &destination).await?;

            // The identity comes off the guard now: this command no longer receives
            // an `ImapConfig` to read it from.
            if !result.expunged {
                imap::caps::warn_uidplus_missing_once(&account.username, &account.host);
            }

            Ok(result)
        }
        .boxed()
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

    with_pooled_session_for(&pool, &session_id, |session, account| {
        async move {
            let result = imap_client::delete_messages(session, &folder, &uid_set).await?;

            if !result.expunged {
                imap::caps::warn_uidplus_missing_once(&account.username, &account.host);
            }

            Ok(result)
        }
        .boxed()
    })
    .await
}

#[tauri::command]
pub async fn imap_get_folder_status(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
) -> Result<ImapFolderStatus, String> {
    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::get_folder_status(session, &folder).await }.boxed()
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
    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::fetch_attachment(session, &folder, uid, &part_id).await }.boxed()
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

    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::append_message(session, &folder, flags.as_deref(), &raw_bytes).await }.boxed()
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
    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::search_folder(session, &folder, since_date).await }.boxed()
    })
    .await
}

/// F-4 REQ-2.3: the cheap belt for no-UIDPLUS accounts — how many messages
/// are not `\Deleted`.
#[tauri::command]
pub async fn imap_count_not_deleted(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
) -> Result<u32, String> {
    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::count_not_deleted(session, &folder).await }.boxed()
    })
    .await
}

/// F-4 REQ-4.1: after a move or delete whose outcome was unknown, which of
/// these UIDs are still in the source folder. Validated before checkout so a
/// bad set costs nothing.
#[tauri::command]
pub async fn imap_search_uids_present(
    pool: tauri::State<'_, ImapPool>,
    session_id: String,
    folder: String,
    uids: Vec<u32>,
) -> Result<Vec<u32>, String> {
    if uids.is_empty() {
        return Ok(Vec::new());
    }
    let uid_set = uid_set(&uids);
    crate::imap::wire::validate_uid_set(&uid_set)?;

    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::search_uids_present(session, &folder, &uid_set).await }.boxed()
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
    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::sync_folder(session, &folder, batch_size, since_date).await }.boxed()
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
    with_pooled_session(&pool, &session_id, |session| {
        async move { imap_client::delta_check_folders(session, &folders).await }.boxed()
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
pub async fn smtp_test_connection(
    config: SmtpConfig,
    test_id: Option<u64>,
    tests: tauri::State<'_, ConnectionTests>,
) -> Result<SmtpSendResult, String> {
    run_cancellable(&tests, test_id, async move { smtp_client::test_connection(&config).await }).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issued_session_ids_pass_the_pools_shape_check() {
        // SPEC-E2-3 REQ-4.2: the validator in `acquire` must accept what
        // `imap_session_open` hands out, or every session would be
        // `NoSuchSession` on its first use.
        for _ in 0..16 {
            let id = new_session_id().expect("getrandom");
            assert!(crate::imap::pool::is_well_formed_id(&id), "{id}");
        }
    }

    #[test]
    fn the_stale_credential_sentinel_matches_the_frontend() {
        assert_eq!(
            crate::imap::pool::PoolError::StaleCredential.to_string(),
            "velo:pool:StaleCredential"
        );
    }
}

/// The live halves of E2's Done-when 9 and 10 (SPEC-E2-3 REQ-5), against the
/// Dovecot harness (`docs/testing/dovecot`) — `cargo test --locked -- --ignored
/// live_dovecot`. Unit tests prove the map's rules; these prove the two things
/// only a real server can: that one pooled session serves two folders without
/// bleeding data between them, and that a reaped session's LOGOUT is answered
/// inside the budget.
#[cfg(test)]
mod live_tests {
    use super::*;
    use crate::imap::pool::IDLE_TIMEOUT;

    fn harness_config() -> ImapConfig {
        ImapConfig {
            host: "127.0.0.1".to_string(),
            port: 11143,
            security: "none".to_string(),
            username: "velo".to_string(),
            password: "velo-test-only".to_string(),
            auth_method: "password".to_string(),
            accept_invalid_certs: false,
        }
    }

    /// Done-when 9: operations on folder A then folder B over one pooled
    /// session return B's data — the every-op-re-SELECTs invariant, on a real
    /// server, through the real guard.
    #[tokio::test]
    #[ignore = "needs the Dovecot harness on 127.0.0.1:11143"]
    async fn live_dovecot_one_pooled_session_isolates_folders() {
        let config = harness_config();
        let pool = ImapPool::new();
        let version = pool.credential_version(&AccountIdent {
            username: config.username.clone(),
            host: config.host.clone(),
        });
        let session = imap_client::connect(&config).await.expect("connect");
        let id = new_session_id().unwrap();
        let inserted = pool.insert(id.clone(), account_key(&config, version), session);
        assert!(matches!(inserted, Ok(None)), "first insert is under the cap");

        let folder_b = format!("E2Iso{}", std::process::id());
        let marker_a = format!("<e2-iso-a-{}@example.com>", std::process::id());
        let marker_b = format!("<e2-iso-b-{}@example.com>", std::process::id());

        // A (INBOX), then B, then A again, on the same checked-out session:
        // the read *back* on A is the half a one-way test misses (review,
        // Grok 10).
        let (inbox_before, inbox_after, a_body, b_body) =
            with_pooled_session(&pool, &id, |session| {
                let folder_b = folder_b.clone();
                let marker_a = marker_a.clone();
                let marker_b = marker_b.clone();
                async move {
                    let raw_a = format!(
                        "From: a@example.com\r\nTo: b@example.com\r\nSubject: E2 isolation A\r\n\
                         Message-ID: {marker_a}\r\n\r\nINBOX only\r\n"
                    );
                    imap_client::append_message(session, "INBOX", None, raw_a.as_bytes()).await?;
                    let inbox_before = imap_client::search_all_uids(session, "INBOX").await?;
                    let a_uid = *inbox_before.iter().max().expect("the INBOX marker is there");

                    let _ = session.create(&folder_b).await; // may exist from a prior run
                    let raw_b = format!(
                        "From: a@example.com\r\nTo: b@example.com\r\nSubject: E2 isolation B\r\n\
                         Message-ID: {marker_b}\r\n\r\nfolder B only\r\n"
                    );
                    imap_client::append_message(session, &folder_b, None, raw_b.as_bytes()).await?;
                    let b = imap_client::search_all_uids(session, &folder_b).await?;
                    let b_uid = *b.iter().max().expect("the appended message is in B");
                    let b_body = imap_client::fetch_raw_message(session, &folder_b, b_uid).await?;

                    // Back to A: the same UID must still name A's message.
                    let inbox_after = imap_client::search_all_uids(session, "INBOX").await?;
                    let a_body = imap_client::fetch_raw_message(session, "INBOX", a_uid).await?;
                    Ok((inbox_before, inbox_after, a_body, b_body))
                }
                .boxed()
            })
            .await
            .expect("operations over one session");

        assert!(b_body.contains(&marker_b), "the fetch after switching to B returns B's data");
        assert!(a_body.contains(&marker_a), "the fetch after switching back returns A's data");
        assert!(!a_body.contains(&marker_b), "nothing of B leaked into A");
        assert_eq!(inbox_before, inbox_after, "touching B changed nothing in A");
        eprintln!("INBOX uids={inbox_after:?}");

        for session in pool.drain() {
            logout(session).await;
        }
    }

    /// Done-when 10, live half: a reaped session is handed out for LOGOUT, and
    /// the server answers the LOGOUT inside `LOGOUT_TIMEOUT`.
    #[tokio::test]
    #[ignore = "needs the Dovecot harness on 127.0.0.1:11143"]
    async fn live_dovecot_reaped_session_is_logged_out_within_budget() {
        let config = harness_config();
        let pool = ImapPool::new();
        let session = imap_client::connect(&config).await.expect("connect");
        let id = new_session_id().unwrap();
        pool.insert(id.clone(), account_key(&config, 0), session)
            .map_err(|(e, _)| e)
            .expect("insert");

        // Not idle yet.
        assert!(pool.reap(IDLE_TIMEOUT).is_empty());

        // Idle "long enough": a zero timeout reaps everything not in flight.
        let mut reaped = pool.reap(std::time::Duration::ZERO);
        assert_eq!(reaped.len(), 1, "the idle session is handed out, not dropped");
        let mut session = reaped.pop().unwrap();

        let started = std::time::Instant::now();
        let answered = tokio::time::timeout(LOGOUT_TIMEOUT, session.logout()).await;
        assert!(
            matches!(answered, Ok(Ok(()))),
            "the server answered LOGOUT inside the budget: {answered:?}"
        );
        assert!(started.elapsed() < LOGOUT_TIMEOUT);
        assert_eq!(pool.acquire(&id).unwrap_err(), crate::imap::pool::PoolError::NoSuchSession);
    }

    /// PR E REQ-2.5: a folder whose name has a space, created, selected and
    /// copied into through the pooled path. The duplex test in
    /// `imap/wire_bytes.rs` predicts the bytes (`CREATE "PR E Space"`, `UID
    /// COPY 1 "PR E Space"`); this proves a real server accepts them.
    #[tokio::test]
    #[ignore = "needs the Dovecot harness on 127.0.0.1:11143"]
    async fn live_dovecot_folder_with_a_space_round_trips_through_the_pool() {
        let config = harness_config();
        let pool = ImapPool::new();
        let session = imap_client::connect(&config).await.expect("connect");
        let id = new_session_id().unwrap();
        pool.insert(id.clone(), account_key(&config, 0), session)
            .map_err(|(e, _)| e)
            .expect("insert");

        let folder = format!("PR E Space {}", std::process::id());
        let marker = format!("<pr-e-space-{}@example.com>", std::process::id());

        let copied = with_pooled_session(&pool, &id, |session| {
            let folder = folder.clone();
            let marker = marker.clone();
            async move {
                let raw = format!(
                    "From: a@example.com\r\nTo: b@example.com\r\nSubject: PR E space\r\n\
                     Message-ID: {marker}\r\n\r\nspace folder\r\n"
                );
                imap_client::append_message(session, "INBOX", None, raw.as_bytes()).await?;
                let inbox = imap_client::search_all_uids(session, "INBOX").await?;
                let uid = *inbox.iter().max().expect("the marker is in INBOX");

                let _ = session.create(&folder).await; // may exist from a prior run
                session
                    .select("INBOX")
                    .await
                    .map_err(|e| format!("SELECT INBOX: {e}"))?;
                session
                    .uid_copy(uid.to_string(), &folder)
                    .await
                    .map_err(|e| format!("UID COPY into {folder:?}: {e}"))?;
                let in_folder = imap_client::search_all_uids(session, &folder).await?;
                let copy_uid = *in_folder.iter().max().expect("the copy is in the folder");
                imap_client::fetch_raw_message(session, &folder, copy_uid).await
            }
            .boxed()
        })
        .await
        .expect("create, select and copy into a folder with a space");

        assert!(copied.contains(&marker), "the copy in the spaced folder is the marker message");

        for session in pool.drain() {
            logout(session).await;
        }
    }
}
