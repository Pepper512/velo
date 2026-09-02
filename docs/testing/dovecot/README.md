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

## F-5: does the `COPYUID` really arrive? (automated against this harness)

F-5 re-keys a moved message's local row from the server's `COPYUID`, which
`async-imap` forwards on the session's unsolicited channel. Whether that
response lands on the same command turn as the tagged `OK` to `UID MOVE` is
exactly what no unit test can prove, so there is an ignored Rust test that
drives the real `move_messages` against both servers:

```bash
cd docs/testing/dovecot && docker compose -f compose-arm64.yml up -d --build
cd ../../../src-tauri && cargo test --locked -- --ignored live_dovecot --nocapture
```

**Pass:** `:11143` prints `mapping: Some([UidMapping { source_uid: N, dest_uid: M }])`
where `M` is the UID the destination folder actually lists; `:11144` prints
`expunged: false, mapping: None` with the source still in INBOX — the harness
hides MOVE along with UIDPLUS, so that server takes the COPY fallback, whose
`COPYUID` rides the tagged OK `async-imap` does not forward. The test appends
its own messages and deletes its own destination folder; the `\Deleted` copy
it leaves in INBOX on `:11144` is harmless in a disposable server.

## F-4: vanished-UID reconciliation, end to end (manual, needs the running app)

The reconciliation logic is proved on the SQLite harness (`reconcilePass.test.ts`,
`reconcileOp.test.ts`), but the Done-when in `docs/briefs/2026-09-02-f4-part2-plan.md` asks for the
real pipeline — server → Rust → sync → SQLite → UI — which only the running app exercises. Run the
containers, add an IMAP account in Velo against `127.0.0.1:11143` (user `velo`, password
`velo-test-only`, no TLS), let the initial sync finish, then:

**Scenario 1 — a message moved elsewhere disappears after two passes, never one.**
1. In the second client: `a1 LOGIN velo velo-test-only` · `a2 SELECT INBOX` · note a UID `Y` ·
   `a3 UID MOVE Y Archive` (create `Archive` first with `a0 CREATE Archive` if needed).
2. In Velo: trigger a sync. **Pass 1:** the message is still shown (it is a *suspect*; check
   `reconcile_suspects` has one row with `status = 'suspect'`). Trigger a second sync. **Pass 2:**
   the message is gone from INBOX locally; the log carries
   `[reconcile] deleted INBOX/<Y> (<Message-ID>): confirmed absent on the server`.
3. Fail condition: gone after pass 1.

**Scenario 2 — an archive done in Velo is never deleted prematurely.**
1. In Velo, archive a message while the second client holds `Archive` open. Do **not** let Velo
   sync `Archive` (temporarily rename the folder on the server after the move, or pause the sync
   timer). Trigger two INBOX syncs.
2. The INBOX row is either re-keyed (`:11143` reports COPYUID) or tombstoned (`moved_to = 'Archive'`);
   in neither case does a reconciliation deletion appear in the log. Fail condition: a
   `[reconcile] deleted` line for that UID.

**Scenario 3 — the no-UIDPLUS server idles with no extra searches.**
1. Repeat the account against `:11144`. Permanently delete one message in Velo (it stays on the
   server flagged `\Deleted`; `folder_sync_state.flagged_not_expunged` for INBOX becomes 1).
2. Trigger five syncs with nothing else happening. The log shows **no** `UID SEARCH ALL` for INBOX
   after the first recompute — the gate agrees (`EXISTS = live + flagged`). On the 10th pass the
   belt runs `UID SEARCH NOT DELETED` once instead. Fail condition: a full list on every pass.

**Scenario 4 — the reconcile op after an unknown outcome (part 3).**
1. Make a move time out after it completes: in the second client, `a4 UID MOVE Z Archive` while
   Velo is archiving the same message, or point Velo at a deliberately slow proxy. Velo shows the
   *"may already have completed"* notice; `pending_operations` gains a row with
   `operation_type = 'reconcile'`, `resource_id = 'reconcile:INBOX'`, `max_retries = 3`.
2. Let the queue drain (30 s). The op runs `UID SEARCH UID <Z>`; `reconcile_suspects` gains `Z` as
   a `suspect`. Two attested syncs later the row is gone. Fail condition: the row deleted before
   the second pass, or the op retrying the MOVE.

**Scenario 5 — a folder deleted on the server (part 3).**
1. In the second client: `a5 DELETE Projects` (a folder Velo has synced). Trigger a sync: nothing
   is deleted, `folder_sync_state.missing_passes = 1` for `Projects`. Trigger another: the sync
   state row is gone, the notice says the folder no longer exists and its messages are kept, and
   the label still lists them. Fail condition: the messages disappear.

Attach to the PR: the `UID SEARCH` / `MOVE` transcript from the second client, the relevant
`[reconcile]` log lines, and `SELECT * FROM reconcile_suspects` before and after each pass.

## Evidence already on the record

PR #26 carries a passing run of all three scenarios, produced with the Alpine
variant by a second session. Scenario 1 is the sharpest: the bystander **X
survived with its `\Deleted` flag still set** — precisely the message the old
untargeted `EXPUNGE` would have destroyed. Re-run this harness when the removal
path changes again; do not treat that transcript as covering future edits.
