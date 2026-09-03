import { describe, it, expect } from "vitest";
import { prefetchOrder } from "./neighbours";

/** SPEC-SB REQ-2.3: the next three and the previous one, in visible order. */
describe("prefetchOrder", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];

  it("returns next three then previous one", () => {
    expect(prefetchOrder(ids, "b")).toEqual(["c", "d", "e", "a"]);
  });

  it("clips at the ends of the list", () => {
    expect(prefetchOrder(ids, "a")).toEqual(["b", "c", "d"]);
    expect(prefetchOrder(ids, "e")).toEqual(["f", "d"]);
    expect(prefetchOrder(ids, "f")).toEqual(["e"]);
  });

  it("is empty when the selection is not in the visible list or there is no selection", () => {
    expect(prefetchOrder(ids, "zz")).toEqual([]);
    expect(prefetchOrder(ids, null)).toEqual([]);
    expect(prefetchOrder([], "a")).toEqual([]);
  });
});
