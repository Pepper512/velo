/**
 * Reduce effects (SPEC-SB, SB-1): the "Reduce motion" toggle, widened to
 * cover blur and transitions, defaults on for Linux — upstream #232 measured
 * WebKitGTK at full CPU under the blobs and backdrop filters.
 *
 * Pure, so the boot-time decision is testable without Tauri.
 */

export type Platform = "linux" | "macos" | "windows" | "unknown";

export interface ReduceEffectsResolution {
  /** Whether the `.reduce-motion` class should be on for this session. */
  value: boolean;
  /** True when the value came from the stored setting (the only thing ever persisted). */
  persisted: boolean;
}

/**
 * REQ-1.3: a stored "true"/"false" wins; with nothing stored, Linux gets the
 * toggle on for the session (not persisted — the user's first touch persists),
 * everything else stays off as before.
 */
export function resolveReduceEffects(input: { stored: string | null; platform: Platform }): ReduceEffectsResolution {
  if (input.stored === "true") return { value: true, persisted: true };
  if (input.stored === "false") return { value: false, persisted: true };
  return { value: input.platform === "linux", persisted: false };
}

/** `platform()` is synchronous in plugin-os 2.x; awaiting it costs nothing and survives a change. */
type OsPlugin = { platform: () => string | Promise<string> };

/**
 * The OS as the Tauri os plugin reports it, or "unknown" when the plugin
 * cannot be loaded or answers something else — a pop-out window has no `os`
 * grant (P11), and that must not throw at boot.
 */
export async function readPlatform(
  load: () => Promise<OsPlugin> = () => import("@tauri-apps/plugin-os"),
): Promise<Platform> {
  try {
    const p = await (await load()).platform();
    return p === "linux" || p === "macos" || p === "windows" ? p : "unknown";
  } catch {
    return "unknown";
  }
}
