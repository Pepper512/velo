import { describe, it, expect, afterEach } from "vitest";
import { windowKindFromSearch, windowKindFromLabel, isPopoutWindow } from "./windowKind";

/** What `@tauri-apps/api` reads the current label from, when the page runs inside Tauri. */
function setTauriLabel(label: string | null): void {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (label === null) {
    delete w.__TAURI_INTERNALS__;
  } else {
    w.__TAURI_INTERNALS__ = { metadata: { currentWebview: { label } } };
  }
}

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

describe("windowKindFromLabel", () => {
  it("matches the globs the content grant is keyed by", () => {
    expect(windowKindFromLabel("main")).toBe("main");
    expect(windowKindFromLabel("splashscreen")).toBe("main");
    expect(windowKindFromLabel("thread-abc_123")).toBe("thread");
    expect(windowKindFromLabel("compose-1725000000000")).toBe("compose");
  });
});

describe("isPopoutWindow", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    setTauriLabel(null);
  });

  it("is false in the main window", () => {
    expect(isPopoutWindow()).toBe(false);
  });

  it("falls back to the URL rule outside Tauri (Vite dev server)", () => {
    window.history.replaceState({}, "", "/?thread=t1&account=a1");
    expect(isPopoutWindow()).toBe(true);
    window.history.replaceState({}, "", "/?compose=1");
    expect(isPopoutWindow()).toBe(true);
  });

  it("trusts the window label over the query string inside Tauri (Gemini 3.8 M3 on #75)", () => {
    // A pop-out whose query string was stripped is still a pop-out: the grant
    // is keyed by the label, so the gate must be too.
    setTauriLabel("thread-t1");
    expect(isPopoutWindow()).toBe(true);
    setTauriLabel("compose-1");
    expect(isPopoutWindow()).toBe(true);
    // And a main window with pop-out-looking parameters is still main.
    setTauriLabel("main");
    window.history.replaceState({}, "", "/?thread=t1&account=a1");
    expect(isPopoutWindow()).toBe(false);
  });
});
