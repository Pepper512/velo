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
committed in the harness. That combination is safe **only** because it is
loopback-bound and disposable. Do not bind it to another interface, do not point
it at a real mailbox, and do not reuse the credentials anywhere.

## Which harness to use

There are two, and they are **not** equally trustworthy:

| File | Status |
|---|---|
| `compose-arm64.yml` + `Dockerfile.arm64` | **Use this.** Dovecot 2.3.21 on Alpine 3.20 with an explicit passwd-file. This is what produced the transcripts on PR #26. `alpine:3.20` is multi-arch, so despite the name it runs on amd64 too. |
| `docker-compose.yml` | **Unverified.** Uses the official `dovecot/dovecot:2.3.21` image, which is **amd64-only** and crash-loops under Rosetta on Apple Silicon (`rosetta error: unable to mmap ExecutableHeap: 12`). Its `DOVECOT_USER`/`DOVECOT_PASS` variables are also **decorative** — that image does not honour them, which is why the Alpine variant carries an explicit passdb. Kept only as a starting point for a native-amd64 host. |

Both mount the same per-variant conf, so the UIDPLUS/no-UIDPLUS distinction is
identical between them.

## Run it

```bash
cd docs/testing/dovecot
docker compose -f compose-arm64.yml up -d --build

# Seed: two messages in INBOX for the account under test.
# X = the bystander, Y = the message Velo will act on.
```

> **If the build fails**, `DOCKER_BUILDKIT=0` may be needed on machines with a
> broken buildx or credential-helper setup. The PR #26 run hit exactly that and
> worked around it by building the image directly
> (`docker build -f Dockerfile.arm64 -t velo-dovecot-arm64 .`) and running the
> containers from it. So the `build:` stanza above is the portable form, not the
> literal command that produced the transcripts — noted so nobody reports it as
> verified when it has not been exercised end to end here.

Then, with a **second IMAP client** (so the flag genuinely comes from elsewhere
— `openssl s_client`, `telnet`, or any mail client):

```
a1 LOGIN velo velo-test-only
a2 CAPABILITY              # check UIDPLUS *here*, not in the greeting
a3 SELECT INBOX
a4 UID STORE <X> +FLAGS (\Deleted)
a5 UID SEARCH ALL          # record the UIDs present, before
```

> **Check capabilities after login, not before.** Dovecot's pre-login greeting
> advertises a reduced set and omits `UIDPLUS` even on the server that supports
> it. Reading the greeting and concluding the harness is misconfigured is the
> easy false alarm here — Velo itself reads `CAPABILITY` post-login, which is
> what `caps::fetch` does and what these ports differ on.

In Velo, configured against `127.0.0.1:11143` (no TLS):

1. Permanently delete message **Y**.
2. Back in the second client: `a6 UID SEARCH ALL`.

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
docker compose -f compose-arm64.yml down -v   # -v so maildirs do not persist
```

## Evidence already on the record

PR #26 carries a passing run of all three scenarios, produced with the Alpine
variant by a second session. Scenario 1 is the sharpest: the bystander **X
survived with its `\Deleted` flag still set** — precisely the message the old
untargeted `EXPUNGE` would have destroyed. Re-run this harness when the removal
path changes again; do not treat that transcript as covering future edits.
