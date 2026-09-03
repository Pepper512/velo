import { describe, it, expect, afterEach } from "vitest";
import { windowKindFromSearch, isPopoutWindow } from "./windowKind";

/**
 * SPEC-P11 REQ-2.3: one rule for "which window am I", shared by `main.tsx`'s
 * routing and by the components that hide "Open in new window" inside a
 * pop-out. If the two disagreed, a button could appear in a window whose
 * grant cannot honour it.
 */
describe("windowKindFromSearch", () => {
  it("is the main window with no parameters", () => {
    expect(windowKindFromSearch("")).toBe("main");
    expect(windowKindFromSearch("?")).toBe("main");
    expect(windowKindFromSearch("?foo=bar")).toBe("main");
  });

  it("is a thread window only with both thread and account", () => {
    expect(windowKindFromSearch("?thread=t1&account=a1")).toBe("thread");
    expect(windowKindFromSearch("?thread=t1")).toBe("main");
    expect(windowKindFromSearch("?account=a1")).toBe("main");
  });

  it("is a compose window with the compose parameter", () => {
    expect(windowKindFromSearch("?compose=1")).toBe("compose");
    expect(windowKindFromSearch("?compose=1&mode=reply&to=x")).toBe("compose");
  });

  it("prefers thread over compose when both are present, as main.tsx does", () => {
    expect(windowKindFromSearch("?compose=1&thread=t1&account=a1")).toBe("thread");
  });
});

describe("isPopoutWindow", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("is false in the main window", () => {
    expect(isPopoutWindow()).toBe(false);
  });

  it("is true in a thread window and in a compose window", () => {
    window.history.replaceState({}, "", "/?thread=t1&account=a1");
    expect(isPopoutWindow()).toBe(true);
    window.history.replaceState({}, "", "/?compose=1");
    expect(isPopoutWindow()).toBe(true);
  });
});
