/**
 * Map a matched route to the sidebar label it should highlight (audit P16(6)).
 *
 * # The bug this fixes
 *
 * This logic existed twice — `router/navigate.ts`'s `getActiveLabel` (the
 * non-React reader) and `hooks/useRouteNavigation.ts`'s `useActiveLabel` (the
 * React one). The copies had drifted: **`useActiveLabel` was missing the
 * `/attachments` and `/tasks` branches**, so on those two pages it fell through
 * to the default and the sidebar highlighted **Inbox** instead.
 *
 * The audit found this by looking for duplication, not by looking for bugs —
 * which is the argument for the extraction. One list, both callers.
 */

/** A single route match, narrowed to what label derivation needs. */
export interface RouteMatchLike {
  routeId: string;
  params: unknown;
}

/** The label shown when no route matches — the app's home view. */
export const DEFAULT_LABEL = "inbox";

/**
 * Derive the active sidebar label from a list of route matches.
 *
 * Returns `DEFAULT_LABEL` when nothing matches, which is what both callers did.
 */
export function routeIdToLabel(matches: readonly RouteMatchLike[]): string {
  for (const match of matches) {
    const params = match.params as Record<string, string>;

    switch (match.routeId) {
      case "/mail/$label":
      case "/mail/$label/thread/$threadId":
        return params["label"] ?? DEFAULT_LABEL;

      case "/label/$labelId":
      case "/label/$labelId/thread/$threadId":
        return params["labelId"] ?? DEFAULT_LABEL;

      case "/smart-folder/$folderId":
      case "/smart-folder/$folderId/thread/$threadId":
        return `smart-folder:${params["folderId"] ?? ""}`;

      case "/settings/$tab":
      case "/settings":
        return "settings";

      // These two were present in `getActiveLabel` and missing from
      // `useActiveLabel`. That asymmetry was the bug.
      case "/attachments":
        return "attachments";

      case "/tasks":
        return "tasks";

      case "/calendar":
        return "calendar";

      case "/help/$topic":
      case "/help":
        return "help";
    }
  }

  return DEFAULT_LABEL;
}
