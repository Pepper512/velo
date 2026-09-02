/**
 * One run of the add-account connection tests, cancellable (SPEC-204).
 *
 * The form used to `await invoke(...)` twice with no way to stop either: a
 * silent host held "Testing..." for up to ~90 s. A run now mints an id per
 * test so the Rust side can abort it, keeps a generation so a result that
 * arrives after Cancel or a re-test is dropped, and cancels only the ids that
 * are still in flight. No React in here — the form calls `start`/`cancel`.
 */
import {
  cancelConnectionTest,
  imapTestConnection,
  smtpTestConnection,
  type ImapConfig,
  type SmtpConfig,
} from "@/services/imap/tauriCommands";

export interface ConnectionTestOutcome {
  ok: boolean;
  message: string;
}

export interface ConnectionTestHandlers {
  onImap: (outcome: ConnectionTestOutcome) => void;
  onSmtp: (outcome: ConnectionTestOutcome) => void;
}

export interface ConnectionTestRun {
  /** Start both tests; resolves when both have reported (or been dropped). */
  start(imap: ImapConfig, smtp: SmtpConfig, handlers: ConnectionTestHandlers): Promise<void>;
  /** Stop delivering results and abort every test still in flight. */
  cancel(): Promise<void>;
  isRunning(): boolean;
}

/** A random id in the safe-integer range; the Rust side takes a `u64`. */
export function newTestId(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  // 21 high bits + 32 low bits = 53 bits, always ≥ 1.
  return ((words[0]! & 0x1fffff) * 0x100000000 + words[1]!) || 1;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createConnectionTestRun(): ConnectionTestRun {
  let generation = 0;
  let inFlight = new Set<number>();

  async function start(imap: ImapConfig, smtp: SmtpConfig, handlers: ConnectionTestHandlers): Promise<void> {
    // A run started over one still in flight aborts it first; otherwise the old
    // Rust tasks would hold their sockets to the timeout (#68 review, Gemini L1).
    if (inFlight.size > 0) await cancel();
    generation += 1;
    const mine = generation;
    const imapId = newTestId();
    const smtpId = newTestId();
    inFlight = new Set([imapId, smtpId]);

    const settle = (id: number, deliver: () => void) => {
      if (mine !== generation) return; // cancelled or superseded: drop it
      inFlight.delete(id);
      deliver();
    };

    await Promise.all([
      imapTestConnection(imap, imapId).then(
        (message) => settle(imapId, () => handlers.onImap({ ok: true, message })),
        (err: unknown) => settle(imapId, () => handlers.onImap({ ok: false, message: describe(err) })),
      ),
      smtpTestConnection(smtp, smtpId).then(
        (result) => settle(smtpId, () => handlers.onSmtp({ ok: result.success, message: result.message })),
        (err: unknown) => settle(smtpId, () => handlers.onSmtp({ ok: false, message: describe(err) })),
      ),
    ]);
  }

  async function cancel(): Promise<void> {
    generation += 1;
    const ids = [...inFlight];
    inFlight = new Set();
    await Promise.all(
      ids.map((id) =>
        cancelConnectionTest(id).catch((err: unknown) => {
          // Best effort: the result is dropped by the generation either way.
          console.warn("[connectionTestRun] cancel failed:", describe(err));
          return false;
        }),
      ),
    );
  }

  return { start, cancel, isRunning: () => inFlight.size > 0 };
}
