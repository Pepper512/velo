import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

import {
  imapTestConnection,
  cancelConnectionTest,
  imapListFolders,
  imapFetchMessages,
  imapFetchNewUids,
  imapFetchMessageBody,
  imapSetFlags,
  imapMoveMessages,
  imapDeleteMessages,
  imapSearchAllUids,
  imapCountNotDeleted,
  imapSearchUidsPresent,
  imapGetFolderStatus,
  imapFetchAttachment,
  smtpSendEmail,
  smtpTestConnection,
  type ImapConfig,
  type SmtpConfig,
} from './tauriCommands';

const testImapConfig: ImapConfig = {
  host: 'imap.example.com',
  port: 993,
  security: 'tls',
  username: 'user@example.com',
  password: 'password123',
  auth_method: 'password',
};

const testSmtpConfig: SmtpConfig = {
  host: 'smtp.example.com',
  port: 465,
  security: 'tls',
  username: 'user@example.com',
  password: 'password123',
  auth_method: 'password',
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('IMAP Tauri commands', () => {
  // SPEC-204: a test that carries an id is cancellable through connection_test_cancel.
  it('imapTestConnection passes the testId through, and cancelConnectionTest names it', async () => {
    mockInvoke.mockResolvedValueOnce('ok').mockResolvedValueOnce(true);

    await imapTestConnection(testImapConfig, 12345);
    const cancelled = await cancelConnectionTest(12345);

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'imap_test_connection', { config: testImapConfig, testId: 12345 });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'connection_test_cancel', { testId: 12345 });
    expect(cancelled).toBe(true);
  });

  it('imapTestConnection invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue('Connected successfully. Found 5 folder(s).');

    const result = await imapTestConnection(testImapConfig);

    // Still a config, deliberately: account setup runs before a session exists.
    // No id: the test runs inline, as before SPEC-204.
    expect(mockInvoke).toHaveBeenCalledWith('imap_test_connection', {
      config: testImapConfig,
      testId: null,
    });
    expect(result).toBe('Connected successfully. Found 5 folder(s).');
  });

  it('imapListFolders invokes with correct command and params', async () => {
    const folders = [
      {
        path: 'INBOX',
        name: 'INBOX',
        delimiter: '/',
        special_use: null,
        exists: 42,
        unseen: 3,
      },
    ];
    mockInvoke.mockResolvedValue(folders);

    const result = await imapListFolders('session-abc');

    // E2/P15: no password crosses this boundary any more — the session id
    // stands in for the credential, which is the point of the pool.
    expect(mockInvoke).toHaveBeenCalledWith('imap_list_folders', {
      sessionId: 'session-abc',
    });
    expect(result).toEqual(folders);
  });

  it('imapFetchMessages invokes with correct command and params', async () => {
    const fetchResult = {
      messages: [],
      folder_status: {
        uidvalidity: 1,
        uidnext: 100,
        exists: 50,
        unseen: 5,
        highest_modseq: null,
      },
    };
    mockInvoke.mockResolvedValue(fetchResult);

    const result = await imapFetchMessages('session-abc', 'INBOX', [1, 2, 3]);

    expect(mockInvoke).toHaveBeenCalledWith('imap_fetch_messages', {
      sessionId: 'session-abc',
      folder: 'INBOX',
      uids: [1, 2, 3],
    });
    expect(result).toEqual(fetchResult);
  });

  it('imapFetchNewUids invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue([101, 102, 103]);

    const result = await imapFetchNewUids('session-abc', 'INBOX', 100);

    expect(mockInvoke).toHaveBeenCalledWith('imap_fetch_new_uids', {
      sessionId: 'session-abc',
      folder: 'INBOX',
      sinceUid: 100,
    });
    expect(result).toEqual([101, 102, 103]);
  });

  it('imapFetchMessageBody invokes with correct command and params', async () => {
    const message = {
      uid: 42,
      folder: 'INBOX',
      message_id: '<msg@example.com>',
      in_reply_to: null,
      references: null,
      from_address: 'sender@example.com',
      from_name: 'Sender',
      to_addresses: 'user@example.com',
      cc_addresses: null,
      bcc_addresses: null,
      reply_to: null,
      subject: 'Test Subject',
      date: 1700000000,
      is_read: false,
      is_starred: false,
      is_draft: false,
      body_html: '<p>Hello</p>',
      body_text: 'Hello',
      snippet: 'Hello',
      raw_size: 1024,
      list_unsubscribe: null,
      list_unsubscribe_post: null,
      auth_results: null,
      attachments: [],
    };
    mockInvoke.mockResolvedValue(message);

    const result = await imapFetchMessageBody('session-abc', 'INBOX', 42);

    expect(mockInvoke).toHaveBeenCalledWith('imap_fetch_message_body', {
      sessionId: 'session-abc',
      folder: 'INBOX',
      uid: 42,
    });
    expect(result).toEqual(message);
  });

  it('imapSetFlags invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await imapSetFlags('session-abc', 'INBOX', [1, 2], ['Seen'], true);

    expect(mockInvoke).toHaveBeenCalledWith('imap_set_flags', {
      sessionId: 'session-abc',
      folder: 'INBOX',
      uids: [1, 2],
      flags: ['Seen'],
      add: true,
    });
  });

  it('imapMoveMessages invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await imapMoveMessages('session-abc', 'INBOX', [1, 2], 'Trash');

    expect(mockInvoke).toHaveBeenCalledWith('imap_move_messages', {
      sessionId: 'session-abc',
      folder: 'INBOX',
      uids: [1, 2],
      destination: 'Trash',
    });
  });

  it('imapDeleteMessages invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await imapDeleteMessages('session-abc', 'INBOX', [1, 2]);

    expect(mockInvoke).toHaveBeenCalledWith('imap_delete_messages', {
      sessionId: 'session-abc',
      folder: 'INBOX',
      uids: [1, 2],
    });
  });

  it('imapGetFolderStatus invokes with correct command and params', async () => {
    const status = {
      uidvalidity: 1,
      uidnext: 100,
      exists: 50,
      unseen: 5,
      highest_modseq: 12345,
    };
    mockInvoke.mockResolvedValue(status);

    const result = await imapGetFolderStatus('session-abc', 'INBOX');

    expect(mockInvoke).toHaveBeenCalledWith('imap_get_folder_status', {
      sessionId: 'session-abc',
      folder: 'INBOX',
    });
    expect(result).toEqual(status);
  });

  it('imapFetchAttachment invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue('base64encodeddata==');

    const result = await imapFetchAttachment('session-abc', 'INBOX', 42, '1.2');

    expect(mockInvoke).toHaveBeenCalledWith('imap_fetch_attachment', {
      sessionId: 'session-abc',
      folder: 'INBOX',
      uid: 42,
      partId: '1.2',
    });
    expect(result).toBe('base64encodeddata==');
  });
});

describe('SMTP Tauri commands', () => {
  it('smtpSendEmail invokes with correct command and params', async () => {
    const sendResult = { success: true, message: 'Email sent successfully' };
    mockInvoke.mockResolvedValue(sendResult);

    const result = await smtpSendEmail(testSmtpConfig, 'base64urlEncodedEmail');

    expect(mockInvoke).toHaveBeenCalledWith('smtp_send_email', {
      config: testSmtpConfig,
      rawEmail: 'base64urlEncodedEmail',
    });
    expect(result).toEqual(sendResult);
  });

  it('smtpTestConnection passes the testId through (SPEC-204)', async () => {
    mockInvoke.mockResolvedValue({ success: true, message: 'Connection successful' });

    await smtpTestConnection(testSmtpConfig, 777);

    expect(mockInvoke).toHaveBeenCalledWith('smtp_test_connection', { config: testSmtpConfig, testId: 777 });
  });

  it('smtpTestConnection invokes with correct command and params', async () => {
    const testResult = { success: true, message: 'Connection successful' };
    mockInvoke.mockResolvedValue(testResult);

    const result = await smtpTestConnection(testSmtpConfig);

    expect(mockInvoke).toHaveBeenCalledWith('smtp_test_connection', {
      config: testSmtpConfig,
      testId: null,
    });
    expect(result).toEqual(testResult);
  });

  it('smtpSendEmail propagates errors', async () => {
    mockInvoke.mockRejectedValue('SMTP send error: Connection refused');

    await expect(smtpSendEmail(testSmtpConfig, 'data')).rejects.toBe(
      'SMTP send error: Connection refused'
    );
  });

  it('imapTestConnection propagates errors', async () => {
    mockInvoke.mockRejectedValue('Login failed: Invalid credentials');

    await expect(imapTestConnection(testImapConfig)).rejects.toBe(
      'Login failed: Invalid credentials'
    );
  });
});

describe("RemovalResult boundary validation", () => {
  // CLAUDE.md requires invoke() results to validate their own input. The
  // degraded direction is deliberate: claiming mail still needs removing is
  // harmless, claiming it is gone when it is not is the bug this brief fixes.
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("passes a well-formed result through", async () => {
    vi.mocked(invoke).mockResolvedValue({ expunged: true });
    await expect(
      imapDeleteMessages('session-abc', "INBOX", [1]),
    ).resolves.toMatchObject({ expunged: true });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a non-object", "ok"],
    ["an object without the field", {}],
    ["a non-boolean field", { expunged: "yes" }],
  ])("degrades to not-expunged for %s", async (_label, value) => {
    vi.mocked(invoke).mockResolvedValue(value);
    await expect(
      imapDeleteMessages('session-abc', "INBOX", [1]),
    ).resolves.toMatchObject({ expunged: false });
  });

  it("does not throw on a null result", async () => {
    // Property access on null would throw, turning a successful delete into an
    // error the caller might classify and retry.
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(
      imapMoveMessages('session-abc', "INBOX", [1], "Archive"),
    ).resolves.toMatchObject({ expunged: false, mapping: null });
  });
});

describe("imapSearchAllUids boundary validation (F-4)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("returns a well-formed UID list", async () => {
    vi.mocked(invoke).mockResolvedValue([1, 5, 9]);
    await expect(imapSearchAllUids("s", "INBOX")).resolves.toEqual([1, 5, 9]);
    expect(invoke).toHaveBeenCalledWith("imap_search_all_uids", { sessionId: "s", folder: "INBOX" });
  });

  it("accepts an empty folder", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await expect(imapSearchAllUids("s", "INBOX")).resolves.toEqual([]);
  });

  it.each([
    ["null", null],
    ["a non-array", "1,2"],
    ["a zero UID", [0]],
    ["a non-integer", [1.5]],
    ["a string entry", ["5"]],
  ])("throws rather than returning an empty list for %s (an empty list would read as everything vanished)", async (_label, value) => {
    vi.mocked(invoke).mockResolvedValue(value);
    await expect(imapSearchAllUids("s", "INBOX")).rejects.toThrow(/Malformed UID list/);
  });
});

describe("part 3 boundary validation (F-4)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("imapCountNotDeleted accepts a non-negative integer and rejects anything else", async () => {
    vi.mocked(invoke).mockResolvedValue(42);
    await expect(imapCountNotDeleted("s", "INBOX")).resolves.toBe(42);
    vi.mocked(invoke).mockResolvedValue(0);
    await expect(imapCountNotDeleted("s", "INBOX")).resolves.toBe(0);
    for (const bad of ["42", -1, 1.5, null, undefined]) {
      vi.mocked(invoke).mockResolvedValue(bad);
      await expect(imapCountNotDeleted("s", "INBOX")).rejects.toThrow(/Malformed/);
    }
  });

  it("imapSearchUidsPresent accepts only a subset of what was asked, and skips the wire for an empty set", async () => {
    vi.mocked(invoke).mockResolvedValue([5, 7]);
    await expect(imapSearchUidsPresent("s", "INBOX", [5, 6, 7])).resolves.toEqual([5, 7]);
    expect(invoke).toHaveBeenCalledWith("imap_search_uids_present", { sessionId: "s", folder: "INBOX", uids: [5, 6, 7] });

    vi.mocked(invoke).mockResolvedValue([5, 99]); // 99 was never asked
    await expect(imapSearchUidsPresent("s", "INBOX", [5, 6])).rejects.toThrow(/Malformed/);

    vi.mocked(invoke).mockClear();
    await expect(imapSearchUidsPresent("s", "INBOX", [])).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("MoveResult boundary validation (F-5)", () => {
  // The COPYUID mapping drives local identity, so any defect degrades the whole
  // mapping to null — rows are then hidden until sync, never mis-keyed.
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("passes a well-formed mapping through", async () => {
    vi.mocked(invoke).mockResolvedValue({
      expunged: true,
      mapping: [
        { source_uid: 5, dest_uid: 3 },
        { source_uid: 6, dest_uid: 4 },
      ],
    });
    await expect(imapMoveMessages("s", "INBOX", [5, 6], "Archive")).resolves.toMatchObject({
      expunged: true,
      mapping: [
        { source_uid: 5, dest_uid: 3 },
        { source_uid: 6, dest_uid: 4 },
      ],
    });
  });

  it("keeps an explicit null mapping and an empty mapping distinct", async () => {
    vi.mocked(invoke).mockResolvedValue({ expunged: true, mapping: null });
    await expect(imapMoveMessages("s", "INBOX", [5], "Archive")).resolves.toMatchObject({
      expunged: true,
      mapping: null,
    });

    vi.mocked(invoke).mockResolvedValue({ expunged: true, mapping: [] });
    await expect(imapMoveMessages("s", "INBOX", [], "Archive")).resolves.toMatchObject({
      expunged: true,
      mapping: [],
    });
  });

  it.each([
    ["a non-array mapping", "5:3"],
    ["a non-object entry", [5]],
    ["a null entry", [null]],
    ["a missing field", [{ source_uid: 5 }]],
    ["a non-integer UID", [{ source_uid: 5.5, dest_uid: 3 }]],
    ["a zero UID", [{ source_uid: 0, dest_uid: 3 }]],
    ["a UID above u32", [{ source_uid: 5, dest_uid: 4_294_967_296 }]],
    ["a string UID", [{ source_uid: "5", dest_uid: 3 }]],
    ["a repeated source UID", [{ source_uid: 5, dest_uid: 3 }, { source_uid: 5, dest_uid: 4 }]],
    ["a repeated destination UID", [{ source_uid: 5, dest_uid: 3 }, { source_uid: 6, dest_uid: 3 }]],
  ])("degrades the whole mapping to null for %s", async (_label, mapping) => {
    vi.mocked(invoke).mockResolvedValue({ expunged: true, mapping });
    await expect(imapMoveMessages("s", "INBOX", [5], "Archive")).resolves.toMatchObject({
      expunged: true,
      mapping: null,
    });
  });

  it("carries the destination UIDVALIDITY only alongside a valid mapping", async () => {
    vi.mocked(invoke).mockResolvedValue({
      expunged: true,
      mapping: [{ source_uid: 5, dest_uid: 3 }],
      dest_uidvalidity: 4242,
    });
    await expect(imapMoveMessages("s", "INBOX", [5], "Archive")).resolves.toEqual({
      expunged: true,
      mapping: [{ source_uid: 5, dest_uid: 3 }],
      dest_uidvalidity: 4242,
    });

    // Malformed generation → unknown; the caller then refuses the mapping.
    vi.mocked(invoke).mockResolvedValue({
      expunged: true,
      mapping: [{ source_uid: 5, dest_uid: 3 }],
      dest_uidvalidity: "4242",
    });
    await expect(imapMoveMessages("s", "INBOX", [5], "Archive")).resolves.toEqual({
      expunged: true,
      mapping: [{ source_uid: 5, dest_uid: 3 }],
      dest_uidvalidity: null,
    });

    // No mapping → no generation, whatever Rust sent.
    vi.mocked(invoke).mockResolvedValue({ expunged: true, mapping: null, dest_uidvalidity: 4242 });
    await expect(imapMoveMessages("s", "INBOX", [5], "Archive")).resolves.toEqual({
      expunged: true,
      mapping: null,
      dest_uidvalidity: null,
    });
  });

  it("does not let a malformed mapping disturb the expunged flag", async () => {
    vi.mocked(invoke).mockResolvedValue({ expunged: false, mapping: "bad" });
    await expect(imapMoveMessages("s", "INBOX", [5], "Archive")).resolves.toMatchObject({
      expunged: false,
      mapping: null,
    });
  });

  it("strips unknown fields from mapping entries", async () => {
    vi.mocked(invoke).mockResolvedValue({
      expunged: true,
      mapping: [{ source_uid: 5, dest_uid: 3, extra: "ignored" }],
    });
    await expect(imapMoveMessages("s", "INBOX", [5], "Archive")).resolves.toMatchObject({
      expunged: true,
      mapping: [{ source_uid: 5, dest_uid: 3 }],
    });
  });
});
