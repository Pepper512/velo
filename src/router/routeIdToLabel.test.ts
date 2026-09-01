/**
 * Audit P16(6) — the sidebar-highlight bug found via duplication analysis.
 *
 * `getActiveLabel` (non-React) and `useActiveLabel` (React) were separate copies
 * of the same mapping, and had drifted: the React one was missing `/attachments`
 * and `/tasks`, so on those pages the sidebar highlighted **Inbox**.
 *
 * The audit's acceptance names those two routes specifically, so they are the
 * first cases here.
 */
import { describe, it, expect } from "vitest";
import { routeIdToLabel, DEFAULT_LABEL } from "./routeIdToLabel";

const match = (routeId: string, params: Record<string, string> = {}) => ({
  routeId,
  params,
});

describe("routeIdToLabel — the routes that were missing", () => {
  it("highlights Attachments on /attachments", () => {
    expect(routeIdToLabel([match("/attachments")])).toBe("attachments");
  });

  it("highlights Tasks on /tasks", () => {
    expect(routeIdToLabel([match("/tasks")])).toBe("tasks");
  });
});

describe("routeIdToLabel — mail routes", () => {
  it("uses the label param", () => {
    expect(routeIdToLabel([match("/mail/$label", { label: "starred" })])).toBe("starred");
  });

  it("uses the label param on a thread sub-route", () => {
    expect(
      routeIdToLabel([
        match("/mail/$label/thread/$threadId", { label: "sent", threadId: "t1" }),
      ]),
    ).toBe("sent");
  });

  it("uses the labelId for custom labels", () => {
    expect(routeIdToLabel([match("/label/$labelId", { labelId: "Work" })])).toBe("Work");
  });

  it("prefixes smart folders", () => {
    expect(
      routeIdToLabel([match("/smart-folder/$folderId", { folderId: "sf1" })]),
    ).toBe("smart-folder:sf1");
  });
});

describe("routeIdToLabel — standalone pages", () => {
  it.each([
    ["/settings", "settings"],
    ["/settings/$tab", "settings"],
    ["/calendar", "calendar"],
    ["/help", "help"],
    ["/help/$topic", "help"],
  ])("%s -> %s", (routeId, expected) => {
    expect(routeIdToLabel([match(routeId, { tab: "general", topic: "x" })])).toBe(expected);
  });
});

describe("routeIdToLabel — fallbacks", () => {
  it("returns the default for no matches", () => {
    expect(routeIdToLabel([])).toBe(DEFAULT_LABEL);
  });

  it("returns the default for an unknown route", () => {
    expect(routeIdToLabel([match("/some/future/route")])).toBe(DEFAULT_LABEL);
  });

  it("takes the first recognised match, ignoring layout routes above it", () => {
    expect(
      routeIdToLabel([
        match("__root__"),
        match("/tasks"),
      ]),
    ).toBe("tasks");
  });
});
