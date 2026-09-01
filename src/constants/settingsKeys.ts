/**
 * Every key in the `settings` table, in one place (audit P17).
 *
 * # Why this exists
 *
 * `getSetting`/`setSetting` took a bare `string`, with **41 distinct key
 * literals across 23 files and no centralisation**. `theme`, `font_size` and
 * `color_theme` each appeared in four separate files.
 *
 * That makes a rename a *silent* break: the write goes to the new key, the read
 * still asks for the old one, and the setting appears to reset itself. Nothing
 * fails loudly — not the compiler, not a test, not the UI. It just quietly stops
 * remembering.
 *
 * With a union type, `tsc` rejects a key that is not in this list, and renaming
 * one is a compile error at every site that uses it.
 */

/** Keys holding ordinary, non-sensitive values. */
export const SETTING_KEYS = [
  "active_account_id",
  "ai_auto_categorize",
  "ai_auto_draft_enabled",
  "ai_auto_summarize",
  "ai_enabled",
  "ai_provider",
  "ai_writing_style_enabled",
  "attachment_cache_max_mb",
  "auto_archive_categories",
  "block_remote_images",
  "claude_model",
  "color_theme",
  "contact_sidebar_visible",
  "copilot_model",
  // Found by the compiler, not by grep: written via a variable, so the
  // string-literal search that produced this list missed it.
  "custom_shortcuts",
  "default_reply_mode",
  "email_density",
  "email_list_width",
  "font_size",
  "gemini_model",
  "global_compose_shortcut",
  "google_client_id",
  "imap_attachment_repair_v1",
  "inbox_view_mode",
  "mark_as_read_behavior",
  "notifications_enabled",
  "notify_categories",
  "ollama_model",
  "ollama_server_url",
  "openai_model",
  "phishing_detection_enabled",
  "phishing_sensitivity",
  "read_filter",
  "reading_pane_position",
  "reduce_motion",
  "send_and_archive",
  "sidebar_collapsed",
  "sidebar_nav_config",
  "smart_notifications",
  "sync_period_days",
  "task_sidebar_visible",
  "theme",
  "undo_send_delay_seconds",
  "xai_model",
] as const;

/**
 * Keys holding credentials, stored AES-encrypted via
 * `getSecureSetting`/`setSecureSetting`.
 *
 * Kept as a separate union so the type system distinguishes them: reading one of
 * these with plain `getSetting` returns ciphertext, which is exactly the class
 * of bug audit P5 was about.
 */
export const SECURE_SETTING_KEYS = [
  "claude_api_key",
  "copilot_api_key",
  "gemini_api_key",
  "google_client_secret",
  "openai_api_key",
  "xai_api_key",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
export type SecureSettingKey = (typeof SECURE_SETTING_KEYS)[number];

/** Runtime membership check, for values arriving from outside TypeScript. */
export function isSettingKey(value: string): value is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(value);
}

export function isSecureSettingKey(value: string): value is SecureSettingKey {
  return (SECURE_SETTING_KEYS as readonly string[]).includes(value);
}
