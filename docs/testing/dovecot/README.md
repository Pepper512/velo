# Dovecot harness — REQ-2 expunge transcripts

Reproducible evidence for the one thing the test suite cannot prove: that a
move or delete removes **only** the messages it was given.

`EXPUNGE` cannot be driven from the tree — there is no IMAP mock, and building
one is its own project. So Done-when 5 and 6 of
`docs/briefs/2026-09-01-move-expunge-data-loss.md` are run by hand against a
disposable server, and the transcript is attached to the PR. **Without those
transcripts the expunge change is verified by reading only and must not merge.**

## What is being proved

The defect: `session.expunge()` is untargeted. It permanently removes *every*
message in the selected folder flagged `\Deleted` — including flags set by
another client, by another session, or left by an earlier partial failure.

So the test needs a **bystander**: a message flagged `\Deleted` by someone else
that must still be there afterwards.

| Server | Port | Expected |
|---|---|---|
| `dovecot-uidplus` | 11143 | Velo issues `UID EXPUNGE <uids>`; **Y is removed, X survives**; `expunged: true`, no notice |
| `dovecot-no-uidplus` | 11144 | Velo issues **no** expunge; **X and Y both survive**; `expunged: false`, notice shown, one log line per account |

## Safety

Plaintext IMAP, no TLS, bound to `127.0.0.1` only, with throwaway credentials
committed in the compose file. That combination is safe **only** because it is
loopback-bound and disposable. Do not bind it to another interface, do not point
it at a real mailbox, and do not reuse the credentials anywhere.

## Run it

```bash
cd docs/testing/dovecot
docker compose up -d

# Seed: two messages in INBOX for the account under test.
# X = the bystander, Y = the message Velo will act on.
```

Then, with a **second IMAP client** (so the flag genuinely comes from elsewhere
— `openssl s_client`, `telnet`, or any mail client):

```
a1 LOGIN velo velo-test-only
a2 SELECT INBOX
a3 UID STORE <X> +FLAGS (\Deleted)
a4 UID SEARCH ALL          # record the UIDs present, before
```

In Velo, configured against `127.0.0.1:11143` (no TLS):

1. Permanently delete message **Y**.
2. Back in the second client: `a5 UID SEARCH ALL`.

**Pass:** X is still listed. **Fail:** X is gone — that is the bug.

Repeat against port **11144** (no UIDPLUS). There, *both* X and Y must still be
listed, Velo must show "Marked for deletion in INBOX — the server will remove it
later", and the log must carry exactly one `does not advertise UIDPLUS` line for
that account no matter how many operations you run.

Also repeat the 11143 case for a **draft delete** (Done-when 6): `deleteDraft`
reaches `delete_messages` independently of any MOVE, and carried the same
defect.

## What to attach to the PR

The `UID SEARCH ALL` output from before and after, on both servers, plus the
Velo-side log lines. Enough for a reader to see which UIDs existed, which
command Velo issued, and which UIDs survived — not a screenshot of a mailbox.

```bash
docker compose down -v   # -v so the maildirs do not persist between runs
```
