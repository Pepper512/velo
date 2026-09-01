import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/services/db/settings", () => ({
  setSetting: vi.fn(() => Promise.resolve()),
}));

import { useUIStore } from "./uiStore";

/** SPEC-F-2 design §3b — the `notices` slice that backs `NoticeToast`. */
describe("uiStore notices", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUIStore.setState({ notices: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a notice with a generated id and returns the id", () => {
    const id = useUIStore.getState().addNotice({ text: "hello" });
    const notices = useUIStore.getState().notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]?.id).toBe(id);
    expect(notices[0]?.text).toBe("hello");
  });

  it("dismisses a notice by id", () => {
    const a = useUIStore.getState().addNotice({ text: "a" });
    useUIStore.getState().addNotice({ text: "b" });
    useUIStore.getState().dismissNotice(a);
    expect(useUIStore.getState().notices.map((n) => n.text)).toEqual(["b"]);
  });

  it("auto-dismisses a notice after 6 seconds", () => {
    useUIStore.getState().addNotice({ text: "gone soon" });
    expect(useUIStore.getState().notices).toHaveLength(1);
    vi.advanceTimersByTime(5999);
    expect(useUIStore.getState().notices).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useUIStore.getState().notices).toHaveLength(0);
  });
});
