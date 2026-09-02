#[cfg(not(target_os = "linux"))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconId},
};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::MacosLauncher;

mod commands;
mod imap;
mod oauth;
mod smtp;

#[tauri::command]
fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("splashscreen") {
        let _ = w.close();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn set_tray_tooltip(app: tauri::AppHandle, tooltip: String) -> Result<(), String> {
    #[cfg(not(target_os = "linux"))]
    {
        let tray = app
            .tray_by_id(&TrayIconId::new("main-tray"))
            .ok_or_else(|| "Tray icon not found".to_string())?;
        tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        let _ = tooltip;
        let _ = app;
        log::debug!("set_tray_tooltip is not supported on Linux (KSNI tray)");
        Ok(())
    }
}

/// Open the WebView inspector. **Debug builds only** (audit P3).
///
/// The main window renders untrusted email HTML; a DevTools hook reachable from a
/// release build hands a debugger to anything that reaches the IPC bridge. Tauri
/// enables DevTools automatically in debug builds, so gating the command here and
/// dropping the `devtools` Cargo feature (which exists only to force them *on in
/// release*) leaves developer ergonomics untouched.
#[cfg(debug_assertions)]
#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        w.open_devtools();
    }
}

/// Total budget for the best-effort LOGOUT sweep at exit.
///
/// Short on purpose, and a *total* rather than a per-session budget: this runs
/// on the main thread while the app is trying to quit.
const EXIT_LOGOUT_TOTAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// How often the reaper looks for idle sessions.
const REAPER_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);

/// Per-session budget for the reaper's LOGOUT.
///
/// Per-session here, unlike at exit: this runs on a background task with
/// nothing waiting on it, so a slow server delays only its own cleanup.
const REAPER_LOGOUT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Set explicit AUMID on Windows so toast notifications show "Velo"
    // instead of "Windows PowerShell"
    #[cfg(windows)]
    {
        use windows::core::w;
        use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
        unsafe {
            let _ = SetCurrentProcessExplicitAppUserModelID(w!("com.velomail.app"));
        }
    }

    // Two handler lists rather than `#[cfg]` inside `generate_handler!`, which the
    // macro does not accept on its entries. `open_devtools` and
    // `imap_raw_fetch_diagnostic` are developer tools that must not be reachable
    // over IPC in a shipped binary (audit P3); only one arm is ever compiled, so a
    // release build has no registration for either name and Tauri answers an
    // invoke with "command not found".
    #[cfg(debug_assertions)]
    let invoke_handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
        oauth::start_oauth_server,
        oauth::oauth_exchange_token,
        oauth::oauth_refresh_token,
        set_tray_tooltip,
        close_splashscreen,
        open_devtools,
        commands::imap_test_connection,
        commands::imap_session_open,
        commands::imap_session_close,
        commands::imap_sessions_invalidate,
        commands::imap_list_folders,
        commands::imap_raw_fetch_messages,
        commands::imap_fetch_messages,
        commands::imap_fetch_new_uids,
        commands::imap_search_all_uids,
        commands::imap_fetch_message_body,
        commands::imap_fetch_raw_message,
        commands::imap_set_flags,
        commands::imap_move_messages,
        commands::imap_delete_messages,
        commands::imap_get_folder_status,
        commands::imap_fetch_attachment,
        commands::imap_append_message,
        commands::imap_search_folder,
        commands::imap_sync_folder,
        commands::imap_raw_fetch_diagnostic,
        commands::imap_delta_check,
        commands::smtp_send_email,
        commands::smtp_test_connection,
    ];

    #[cfg(not(debug_assertions))]
    let invoke_handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
        oauth::start_oauth_server,
        oauth::oauth_exchange_token,
        oauth::oauth_refresh_token,
        set_tray_tooltip,
        close_splashscreen,
        commands::imap_test_connection,
        commands::imap_session_open,
        commands::imap_session_close,
        commands::imap_sessions_invalidate,
        commands::imap_list_folders,
        commands::imap_raw_fetch_messages,
        commands::imap_fetch_messages,
        commands::imap_fetch_new_uids,
        commands::imap_search_all_uids,
        commands::imap_fetch_message_body,
        commands::imap_fetch_raw_message,
        commands::imap_set_flags,
        commands::imap_move_messages,
        commands::imap_delete_messages,
        commands::imap_get_folder_status,
        commands::imap_fetch_attachment,
        commands::imap_append_message,
        commands::imap_search_folder,
        commands::imap_sync_folder,
        commands::imap_delta_check,
        commands::smtp_send_email,
        commands::smtp_test_connection,
    ];

    tauri::Builder::default()
        // Single instance MUST be first
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
            // Forward args for deep linking
            let _ = app.emit("single-instance-args", argv);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .manage(commands::ImapPool::new())
        .invoke_handler(invoke_handler)
        .setup(|app| {
            {
                // Reaper (brief E2/P15). Snapshots expired entries under the map
                // lock, drops the lock, then LOGOUTs — never awaits a session
                // while holding the map, or a 120 s fetch would stall every
                // lookup in the app. In-flight sessions are skipped by the pool
                // itself, so a long operation is never reaped mid-command.
                use tauri::Manager;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut ticker = tokio::time::interval(REAPER_INTERVAL);
                    loop {
                        ticker.tick().await;
                        let expired = handle
                            .state::<commands::ImapPool>()
                            .reap(crate::imap::pool::IDLE_TIMEOUT);
                        for session in expired {
                            let _ = tokio::time::timeout(
                                REAPER_LOGOUT_TIMEOUT,
                                commands::logout_arc(session),
                            )
                            .await;
                        }
                    }
                });
            }

            {
                let level = if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                };
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(level)
                        .level_for("sqlx::query", log::LevelFilter::Warn)
                        .build(),
                )?;
            }

            #[cfg(not(target_os = "linux"))]
            {
                // Build system tray menu
                let show = MenuItem::with_id(app, "show", "Show Velo", true, None::<&str>)?;
                let check_mail =
                    MenuItem::with_id(app, "check_mail", "Check for Mail", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &check_mail, &quit])?;

                let icon = app
                    .default_window_icon()
                    .cloned()
                    .expect("app should have a default icon configured in tauri.conf.json bundle");

                TrayIconBuilder::with_id("main-tray")
                    .icon(icon)
                    .tooltip("Velo")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "check_mail" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("tray-check-mail", ());
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }

            #[cfg(target_os = "linux")]
            {
                use tray_item::{IconSource, TrayItem};

                let app_handle = app.handle().clone();

                std::thread::spawn(move || {
                    let mut tray = match TrayItem::new("Velo", IconSource::Resource("mail-read")) {
                        Ok(t) => t,
                        Err(e) => {
                            log::warn!("Failed to create system tray: {e}");
                            return;
                        }
                    };

                    let app_handle_show = app_handle.clone();
                    if let Err(e) = tray.add_menu_item("Show Velo", move || {
                        if let Some(window) = app_handle_show.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }) {
                        log::warn!("Failed to add tray menu item 'Show Velo': {e}");
                    }

                    let app_handle_check = app_handle.clone();
                    if let Err(e) = tray.add_menu_item("Check for Mail", move || {
                        if let Some(window) = app_handle_check.get_webview_window("main") {
                            let _ = window.emit("tray-check-mail", ());
                        }
                    }) {
                        log::warn!("Failed to add tray menu item 'Check for Mail': {e}");
                    }

                    let app_handle_quit = app_handle.clone();
                    if let Err(e) = tray.add_menu_item("Quit", move || {
                        app_handle_quit.exit(0);
                    }) {
                        log::warn!("Failed to add tray menu item 'Quit': {e}");
                    }

                    loop {
                        std::thread::park();
                    }
                });
            }

            // On Windows/Linux, remove decorations for custom titlebar.
            // macOS uses titleBarStyle: "overlay" from config instead, which
            // preserves native event routing in WKWebView.
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            // Start hidden in tray if launched with --hidden (autostart)
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
                // Also close splash screen when starting hidden
                if let Some(splash) = app.get_webview_window("splashscreen") {
                    let _ = splash.close();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray on close instead of quitting (main window only)
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Exit hook (brief E2/P15). `.run()` alone had no `RunEvent` arm, so
            // pooled sessions would have died with the process and left the
            // server to time them out. Best-effort: a server that will not
            // answer LOGOUT must not stall the quit, so each one is bounded.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                use tauri::Manager;
                let sessions = app.state::<commands::ImapPool>().drain();
                if sessions.is_empty() {
                    return;
                }
                log::info!("Logging out {} pooled IMAP session(s)", sessions.len());
                // One budget for the whole sweep, not one per session: this runs
                // inside `block_on` on the main thread, so N unresponsive
                // servers must not cost N timeouts before the app can quit.
                // The LOGOUTs run concurrently for the same reason.
                tauri::async_runtime::block_on(async {
                    let logouts = sessions.into_iter().map(commands::logout_arc);
                    let _ = tokio::time::timeout(
                        EXIT_LOGOUT_TOTAL_TIMEOUT,
                        futures::future::join_all(logouts),
                    )
                    .await;
                });
            }
        });

    log::info!("Tauri application exited normally");
}
