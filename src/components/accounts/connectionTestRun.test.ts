import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { createConnectionTestRun, newTestId } from "./connectionTestRun";
import type { ImapConfig, SmtpConfig } from "@/services/imap/tauriCommands";

const mockInvoke = vi.mocked(invoke);

const imap: ImapConfig = {
  host: "imap.example.com",
  port: 993,
  security: "tls",
  username: "u",
  password: "not-a-real-secret",
  auth_method: "password",
};
const smtp: SmtpConfig = { ...imap, port: 465 };

/** A controllable promise per command name. */
function deferredInvoke() {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; args: Record<string, unknown> }>();
  mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "connection_test_cancel") return Promise.resolve(true);
    return new Promise((resolve, reject) => pending.set(cmd, { resolve, reject, args: args ?? {} }));
  });
  return pending;
}

const calls = (cmd: string) => mockInvoke.mock.calls.filter((c) => c[0] === cmd).map((c) => c[1] as Record<string, unknown>);

describe("newTestId (SPEC-204)", () => {
  it("is a positive safe integer and practically unique", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newTestId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(Number.isSafeInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
    }
  });
});

describe("connectionTestRun (SPEC-204)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts both tests with distinct ids and delivers their results (REQ-1.2 shape)", async () => {
    const pending = deferredInvoke();
    const onImap = vi.fn();
    const onSmtp = vi.fn();
    const run = createConnectionTestRun();

    const started = run.start(imap, smtp, { onImap, onSmtp });
    const imapArgs = calls("imap_test_connection")[0]!;
    const smtpArgs = calls("smtp_test_connection")[0]!;
    expect(imapArgs.config).toEqual(imap);
    expect(typeof imapArgs.testId).toBe("number");
    expect(typeof smtpArgs.testId).toBe("number");
    expect(imapArgs.testId).not.toBe(smtpArgs.testId);
    expect(run.isRunning()).toBe(true);

    pending.get("imap_test_connection")!.resolve("Connected successfully. Found 3 folder(s).");
    pending.get("smtp_test_connection")!.resolve({ success: false, message: "Connection failed" });
    await started;

    expect(onImap).toHaveBeenCalledWith({ ok: true, message: "Connected successfully. Found 3 folder(s)." });
    expect(onSmtp).toHaveBeenCalledWith({ ok: false, message: "Connection failed" });
    expect(run.isRunning()).toBe(false);
  });

  it("a rejected test is delivered as a failure with its reason", async () => {
    const pending = deferredInvoke();
    const onImap = vi.fn();
    const onSmtp = vi.fn();
    const run = createConnectionTestRun();

    const started = run.start(imap, smtp, { onImap, onSmtp });
    pending.get("imap_test_connection")!.reject("IMAP authentication timed out after 30s");
    pending.get("smtp_test_connection")!.resolve({ success: true, message: "Connection successful" });
    await started;

    expect(onImap).toHaveBeenCalledWith({ ok: false, message: "IMAP authentication timed out after 30s" });
  });

  it("cancel aborts every in-flight id and drops the results that arrive afterwards (REQ-1.2, REQ-1.3)", async () => {
    const pending = deferredInvoke();
    const onImap = vi.fn();
    const onSmtp = vi.fn();
    const run = createConnectionTestRun();

    const started = run.start(imap, smtp, { onImap, onSmtp });
    const imapId = calls("imap_test_connection")[0]!.testId;
    const smtpId = calls("smtp_test_connection")[0]!.testId;

    await run.cancel();

    expect(calls("connection_test_cancel").map((a) => a.testId).sort()).toEqual([imapId, smtpId].sort());
    expect(run.isRunning()).toBe(false);

    // Rust answers the aborted tests with "cancelled" (or a late success): dropped.
    pending.get("imap_test_connection")!.reject("cancelled");
    pending.get("smtp_test_connection")!.resolve({ success: true, message: "Connection successful" });
    await started;
    expect(onImap).not.toHaveBeenCalled();
    expect(onSmtp).not.toHaveBeenCalled();
  });

  it("cancels only what is still in flight: a finished test is not cancelled", async () => {
    const pending = deferredInvoke();
    const run = createConnectionTestRun();
    const started = run.start(imap, smtp, { onImap: vi.fn(), onSmtp: vi.fn() });
    const smtpId = calls("smtp_test_connection")[0]!.testId;

    pending.get("imap_test_connection")!.resolve("ok");
    await new Promise((r) => setTimeout(r, 0)); // let the wrapper's promise chain settle
    await run.cancel();

    expect(calls("connection_test_cancel").map((a) => a.testId)).toEqual([smtpId]);
    pending.get("smtp_test_connection")!.reject("cancelled");
    await started;
  });

  it("a re-test supersedes the previous run: the old run's late result is dropped, the new one delivered", async () => {
    const pending = deferredInvoke();
    const onImap = vi.fn();
    const run = createConnectionTestRun();

    const first = run.start(imap, smtp, { onImap, onSmtp: vi.fn() });
    const firstImap = pending.get("imap_test_connection")!;
    const firstSmtp = pending.get("smtp_test_connection")!;
    pending.delete("imap_test_connection");
    pending.delete("smtp_test_connection");

    const second = run.start(imap, smtp, { onImap, onSmtp: vi.fn() });
    firstImap.resolve("stale");
    firstSmtp.resolve({ success: true, message: "stale" });
    await first;
    expect(onImap).not.toHaveBeenCalled();

    // The second start cancels the first run before it invokes its own tests.
    await new Promise((r) => setTimeout(r, 0));
    pending.get("imap_test_connection")!.resolve("fresh");
    pending.get("smtp_test_connection")!.resolve({ success: true, message: "fresh" });
    await second;
    expect(onImap).toHaveBeenCalledTimes(1);
    expect(onImap).toHaveBeenCalledWith({ ok: true, message: "fresh" });
  });

  it("a start over a run still in flight cancels the old ids first (#68 L1)", async () => {
    const pending = deferredInvoke();
    const run = createConnectionTestRun();
    const first = run.start(imap, smtp, { onImap: vi.fn(), onSmtp: vi.fn() });
    const oldIds = [calls("imap_test_connection")[0]!.testId, calls("smtp_test_connection")[0]!.testId];
    const firstImap = pending.get("imap_test_connection")!;
    const firstSmtp = pending.get("smtp_test_connection")!;
    pending.delete("imap_test_connection");
    pending.delete("smtp_test_connection");

    const second = run.start(imap, smtp, { onImap: vi.fn(), onSmtp: vi.fn() });
    await new Promise((r) => setTimeout(r, 0));

    expect(calls("connection_test_cancel").map((a) => a.testId).sort()).toEqual([...oldIds].sort());
    firstImap.reject("cancelled");
    firstSmtp.reject("cancelled");
    await first;
    pending.get("imap_test_connection")!.resolve("ok");
    pending.get("smtp_test_connection")!.resolve({ success: true, message: "ok" });
    await second;
  });

  it("a cancel whose IPC fails still resolves and still drops the late results", async () => {
    const pending = deferredInvoke();
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "connection_test_cancel") return Promise.reject(new Error("ipc down"));
      return new Promise((resolve, reject) => pending.set(cmd, { resolve, reject, args: args ?? {} }));
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onImap = vi.fn();
    const run = createConnectionTestRun();
    const started = run.start(imap, smtp, { onImap, onSmtp: vi.fn() });

    await expect(run.cancel()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();

    pending.get("imap_test_connection")!.resolve("late");
    pending.get("smtp_test_connection")!.resolve({ success: true, message: "late" });
    await started;
    expect(onImap).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a cancel with nothing in flight invokes nothing", async () => {
    deferredInvoke();
    const run = createConnectionTestRun();
    await run.cancel();
    expect(calls("connection_test_cancel")).toEqual([]);
  });
});
