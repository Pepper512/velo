import { describe, it, expect, vi } from "vitest";
import { resolveReduceEffects, readPlatform } from "./reduceEffects";

/**
 * SPEC-SB REQ-1.3: "Reduce effects" defaults on for Linux when nothing is
 * stored, off everywhere else; a stored value always wins and is the only
 * thing that persists.
 */
describe("resolveReduceEffects", () => {
  it("honours a stored true on any platform", () => {
    expect(resolveReduceEffects({ stored: "true", platform: "macos" })).toEqual({ value: true, persisted: true });
  });

  it("honours a stored false on Linux — the user turned it off", () => {
    expect(resolveReduceEffects({ stored: "false", platform: "linux" })).toEqual({ value: false, persisted: true });
  });

  it("defaults on for Linux when nothing is stored, without persisting", () => {
    expect(resolveReduceEffects({ stored: null, platform: "linux" })).toEqual({ value: true, persisted: false });
  });

  it("defaults off elsewhere and when the platform is unknown", () => {
    expect(resolveReduceEffects({ stored: null, platform: "macos" })).toEqual({ value: false, persisted: false });
    expect(resolveReduceEffects({ stored: null, platform: "windows" })).toEqual({ value: false, persisted: false });
    expect(resolveReduceEffects({ stored: null, platform: "unknown" })).toEqual({ value: false, persisted: false });
  });

  it("treats an unrecognised stored value as absent", () => {
    expect(resolveReduceEffects({ stored: "maybe", platform: "linux" })).toEqual({ value: true, persisted: false });
  });
});

describe("readPlatform", () => {
  it("maps the OS plugin's answer and falls back to unknown when the plugin is unavailable (pop-outs have no os grant)", async () => {
    expect(await readPlatform(async () => ({ platform: () => "linux" }))).toBe("linux");
    expect(await readPlatform(async () => ({ platform: () => "macos" }))).toBe("macos");
    expect(await readPlatform(async () => ({ platform: () => "windows" }))).toBe("windows");
    expect(await readPlatform(async () => ({ platform: () => "ios" }))).toBe("unknown");
    const failing = vi.fn(async () => { throw new Error("plugin not allowed"); });
    expect(await readPlatform(failing)).toBe("unknown");
  });
});
