import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { isAllowedAiUrl, rustFetch } from "./rustFetch";

const mockInvoke = vi.mocked(invoke);

// SPEC-209 REQ-2.5 — the settings page's pre-check mirrors `validate_ai_url`
// in `ai_fetch.rs` (same table, both sides).
describe("isAllowedAiUrl", () => {
  it.each([
    "https://api.deepseek.com/v1",
    "https://openrouter.ai/api/v1",
    "HTTPS://Host.Example/v1/",
    "https://10.0.0.5:8443/v1",
    "  https://gateway.internal/v1  ",
    "http://localhost:1234/v1",
    "http://LOCALHOST/v1",
    "http://127.0.0.1:8080",
    "http://127.9.9.9/v1",
    "http://[::1]:11434/v1",
    // Short and numeric IPv4 forms: the URL parser normalises them to 127.0.0.1.
    "http://127.1/v1",
    "http://0177.0.0.1/v1",
    "http://2130706433/v1",
  ])("accepts %s", (raw) => {
    expect(isAllowedAiUrl(raw)).toBe(true);
  });

  it.each([
    "http://api.example.com/v1",
    "http://10.0.0.5/v1",
    "http://192.168.1.2:1234/v1",
    "http://169.254.169.254/latest/meta-data",
    "http://localhost.example.com/v1",
    "http://127.0.0.1.example.com/v1",
    "http://0.0.0.0/v1",
    "http://localhost./v1",
    "http://[::ffff:127.0.0.1]/v1",
    "http://[::ffff:10.0.0.1]/v1",
    "http://10.1/v1",
    "http://167772161/v1",
    "ftp://files.example.com/",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:pw@host.example/v1",
    "https://user@host.example/v1",
    "https://",
    "not a url",
    "",
  ])("refuses %s", (raw) => {
    expect(isAllowedAiUrl(raw)).toBe(false);
  });
});

describe("rustFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands the SDK's request to the command and rebuilds a Response (REQ-3.2)", async () => {
    mockInvoke.mockResolvedValue({
      status: 200,
      headers: [["content-type", "application/json"], ["x-request-id", "r1"]],
      body: '{"choices":[{"message":{"content":"hi"}}]}',
    });

    const res = await rustFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer k", "Content-Type": "application/json" },
      body: '{"model":"m"}',
    });

    expect(mockInvoke).toHaveBeenCalledWith("ai_fetch", {
      request: {
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
        headers: [["Authorization", "Bearer k"], ["Content-Type", "application/json"]],
        body: '{"model":"m"}',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("r1");
    await expect(res.json()).resolves.toEqual({ choices: [{ message: { content: "hi" } }] });
  });

  it("accepts a Headers object and a URL object", async () => {
    mockInvoke.mockResolvedValue({ status: 204, headers: [], body: "" });
    const headers = new Headers({ accept: "application/json" });

    await rustFetch(new URL("http://localhost:1234/v1/models"), { headers });

    const call = mockInvoke.mock.calls[0]![1] as { request: { url: string; method: string; headers: [string, string][] } };
    expect(call.request.url).toBe("http://localhost:1234/v1/models");
    expect(call.request.method).toBe("GET");
    expect(call.request.headers).toEqual([["accept", "application/json"]]);
  });

  it("relays a non-2xx status so the SDK can classify it", async () => {
    mockInvoke.mockResolvedValue({ status: 401, headers: [["content-type", "application/json"]], body: '{"error":"bad key"}' });

    const res = await rustFetch("https://api.deepseek.com/v1/chat/completions", { method: "POST", body: "{}" });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });

  it("refuses a non-string body rather than guessing an encoding", async () => {
    await expect(
      rustFetch("https://api.deepseek.com/v1", { method: "POST", body: new Blob(["x"]) }),
    ).rejects.toThrow(/string bodies/);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("refuses a malformed result from the command (an invoke() result is a boundary)", async () => {
    mockInvoke.mockResolvedValue({ status: "200", body: 42 });

    await expect(rustFetch("https://api.deepseek.com/v1")).rejects.toThrow(/malformed/);
  });

  it("turns the command's string rejection into an Error the SDK can wrap", async () => {
    mockInvoke.mockRejectedValue("http is allowed to localhost only; use https for a remote endpoint");

    await expect(rustFetch("http://api.example.com/v1")).rejects.toThrow(/localhost only/);
  });

  it("rejects at once when the signal aborts while the command is in flight (#65 N4)", async () => {
    let finishRust: (v: unknown) => void = () => {};
    mockInvoke.mockImplementation(() => new Promise((r) => { finishRust = r; }));
    const controller = new AbortController();

    const pending = rustFetch("https://api.deepseek.com/v1", { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow(/aborted/);
    finishRust({ status: 200, headers: [], body: "{}" }); // the late result is dropped
  });

  it("does not call the command when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(rustFetch("https://api.deepseek.com/v1", { signal: controller.signal })).rejects.toThrow(/aborted/);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
