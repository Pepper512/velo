import { useMatches } from "@tanstack/react-router";
import { routeIdToLabel } from "@/router/routeIdToLabel";

/**
 * Safely call useMatches — returns [] when no router context is available
 * (e.g. in pop-out ThreadWindow which has no RouterProvider).
 */
function useMatchesSafe() {
  try {
    return useMatches();
  } catch {
    return [];
  }
}

/**
 * Derive the active label from the current route.
 *
 * Shares `routeIdToLabel` with the non-React `getActiveLabel` (audit P16(6)).
 * This copy was missing the `/attachments` and `/tasks` branches, so the sidebar
 * highlighted "Inbox" on those pages.
 */
export function useActiveLabel(): string {
  return routeIdToLabel(useMatchesSafe());
}

/**
 * Get the selected thread ID from route params, or null if no thread is selected.
 */
export function useSelectedThreadId(): string | null {
  const matches = useMatchesSafe();
  for (const match of matches) {
    const params = match.params as Record<string, string>;
    if (params["threadId"]) {
      return params["threadId"];
    }
  }
  return null;
}

/**
 * Get the active category from search params (only relevant on inbox in split mode).
 */
export function useActiveCategory(): string {
  const matches = useMatchesSafe();
  for (const match of matches) {
    const search = (match as { search?: Record<string, unknown> }).search;
    if (search && typeof search["category"] === "string") {
      return search["category"];
    }
  }
  return "Primary";
}

/**
 * Get the search query from search params.
 */
export function useSearchQuery(): string {
  const matches = useMatchesSafe();
  for (const match of matches) {
    const search = (match as { search?: Record<string, unknown> }).search;
    if (search && typeof search["q"] === "string") {
      return search["q"];
    }
  }
  return "";
}
