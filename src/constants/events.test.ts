import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchVeloEvent, onVeloEvent } from "./events";

describe("typed event bus (audit P17)", () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    vi.clearAllMocks();
  });

  function listen(name: Parameters<typeof onVeloEvent>[0], handler: (d: never) => void) {
    const off = onVeloEvent(name, handler as never);
    cleanups.push(off);
    return off;
  }

  it("delivers a payload-free event to its listener", () => {
    const handler = vi.fn();
    listen("velo-sync-done", handler);

    dispatchVeloEvent("velo-sync-done");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("delivers the detail of an event that carries one", () => {
    const handler = vi.fn();
    listen("velo-inline-reply", handler);

    dispatchVeloEvent("velo-inline-reply", { messageId: "m1" });

    expect(handler).toHaveBeenCalledWith({ messageId: "m1" });
  });

  it("delivers to every listener — velo-sync-done has several consumers", () => {
    const a = vi.fn();
    const b = vi.fn();
    listen("velo-sync-done", a);
    listen("velo-sync-done", b);

    dispatchVeloEvent("velo-sync-done");

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after the returned unsubscribe is called", () => {
    const handler = vi.fn();
    const off = onVeloEvent("velo-sync-done", handler);

    dispatchVeloEvent("velo-sync-done");
    off();
    dispatchVeloEvent("velo-sync-done");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not cross the streams between event names", () => {
    const sync = vi.fn();
    const palette = vi.fn();
    listen("velo-sync-done", sync);
    listen("velo-toggle-command-palette", palette);

    dispatchVeloEvent("velo-toggle-command-palette");

    expect(palette).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();
  });

  it("interoperates with a raw addEventListener, so migration can be gradual", () => {
    // Existing call sites still use `window.addEventListener("velo-sync-done", …)`.
    // Both forms must see the same event while they coexist.
    const raw = vi.fn();
    window.addEventListener("velo-sync-done", raw);
    cleanups.push(() => window.removeEventListener("velo-sync-done", raw));

    dispatchVeloEvent("velo-sync-done");

    expect(raw).toHaveBeenCalledTimes(1);
  });
});
