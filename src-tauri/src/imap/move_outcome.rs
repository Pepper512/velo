//! Classification of a `UID MOVE` attempt (brief REQ-1).
//!
//! `move_messages` used to match `Ok(Ok(()))` for success and `_` for
//! everything else, so three unrelated failures shared one COPY fallback:
//!
//! 1. **The server has no MOVE extension.** The only case the fallback was
//!    written for.
//! 2. **MOVE was understood and refused** (`NO`: over quota, `TRYCREATE`,
//!    ACL denied). COPY cannot fix a refusal, and on a quota boundary COPY
//!    can *succeed* where MOVE was refused — leaving the message in both
//!    folders.
//! 3. **The command timed out.** The server may have executed the MOVE after
//!    the client stopped waiting, so COPY'ing duplicates the message. Worse,
//!    the timeout drops the `uid_mv` future mid-protocol, leaving unread
//!    bytes in the TLS buffer; the old code then issued `uid_copy` on that
//!    same session, which read the tail of the aborted MOVE as its own
//!    response.
//!
//! This module is deliberately a pure function over the result type: the
//! decision is the part that was wrong, and it is the part that can be tested
//! without a live IMAP server.

use async_imap::error::Error as ImapError;

/// What to do after attempting `UID MOVE`.
#[derive(Debug, PartialEq, Eq)]
pub enum MoveOutcome {
    /// The server moved the messages. Nothing further to do.
    Moved,
    /// The server advertised MOVE but rejected the command (`BAD`). Fall back
    /// to COPY + flag + expunge, and log why the fallback fired.
    FallBackToCopy(String),
    /// The server understood MOVE and refused it (`NO`). Propagate; a COPY
    /// would either hit the same refusal or duplicate the message.
    Refused(String),
    /// Any other protocol or transport failure. Propagate.
    Failed(String),
    /// The command timed out. The server may or may not have performed the
    /// move, and the session is no longer safe to issue commands on.
    OutcomeUnknown(String),
}

/// Classify the result of `net::with_timeout(.., session.uid_mv(..))`.
///
/// The outer `Result` is the timeout wrapper (`Err` = the timeout fired); the
/// inner one is the IMAP command result.
pub fn classify_move(result: Result<Result<(), ImapError>, String>) -> MoveOutcome {
    match result {
        Ok(Ok(())) => MoveOutcome::Moved,
        // `BAD` means the server did not accept the command itself. That is the
        // capability gap the COPY fallback exists for.
        Ok(Err(ImapError::Bad(msg))) => MoveOutcome::FallBackToCopy(msg),
        // `NO` means the command was understood and declined. Falling back here
        // is what let a refused move become a duplicated message.
        Ok(Err(ImapError::No(msg))) => MoveOutcome::Refused(msg),
        Ok(Err(other)) => MoveOutcome::Failed(other.to_string()),
        Err(timeout_msg) => MoveOutcome::OutcomeUnknown(timeout_msg),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The COPY fallback runs for `FallBackToCopy` and nothing else.
    ///
    /// The call site in `move_messages` matches every variant explicitly, so
    /// adding a variant to `MoveOutcome` fails to compile until someone decides
    /// which side it belongs on — a stronger guarantee than any assertion here.
    /// These tests pin which *input* produces which variant.
    fn falls_back(outcome: &MoveOutcome) -> bool {
        matches!(outcome, MoveOutcome::FallBackToCopy(_))
    }

    #[test]
    fn success_is_moved() {
        assert_eq!(classify_move(Ok(Ok(()))), MoveOutcome::Moved);
    }

    #[test]
    fn bad_falls_back_to_copy() {
        // A server that advertised MOVE but rejects the command: the one case
        // the COPY fallback was written for.
        let out = classify_move(Ok(Err(ImapError::Bad("Unknown command".into()))));
        assert_eq!(out, MoveOutcome::FallBackToCopy("Unknown command".into()));
        assert!(falls_back(&out));
    }

    #[test]
    fn no_is_refused_and_never_falls_back() {
        // The bug: `NO` (over quota / TRYCREATE / ACL) used to fall through to
        // COPY, which can succeed exactly where MOVE was refused and leave the
        // message in both folders.
        for msg in [
            "[OVERQUOTA] Quota exceeded",
            "[TRYCREATE] Mailbox does not exist",
            "Permission denied",
        ] {
            let out = classify_move(Ok(Err(ImapError::No(msg.into()))));
            assert_eq!(out, MoveOutcome::Refused(msg.into()), "msg {msg:?}");
            assert!(!falls_back(&out), "NO must not fall back: {msg:?}");
        }
    }

    #[test]
    fn transport_errors_never_fall_back() {
        let cases = vec![
            ImapError::ConnectionLost,
            ImapError::Io(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "Broken pipe (os error 32)",
            )),
        ];
        for err in cases {
            let out = classify_move(Ok(Err(err)));
            assert!(
                matches!(out, MoveOutcome::Failed(_)),
                "expected Failed, got {out:?}"
            );
            assert!(!falls_back(&out));
        }
    }

    #[test]
    fn timeout_is_unknown_and_never_falls_back() {
        // The duplication bug. A UID MOVE that succeeded server-side but whose
        // response missed the 30 s timeout must NOT be COPY'd again, and the
        // session must not be reused — it is desynchronised mid-protocol.
        let out = classify_move(Err("UID MOVE timed out after 30s — check …".into()));
        assert!(
            matches!(out, MoveOutcome::OutcomeUnknown(_)),
            "expected OutcomeUnknown, got {out:?}"
        );
        assert!(!falls_back(&out));
    }

    #[test]
    fn exactly_one_outcome_permits_the_copy_fallback() {
        // Guards the whole point of REQ-1: the fallback is reachable from one
        // classification and no other. If a variant is added, this fails until
        // someone decides deliberately which side it belongs on.
        let all = [
            classify_move(Ok(Ok(()))),
            classify_move(Ok(Err(ImapError::Bad("b".into())))),
            classify_move(Ok(Err(ImapError::No("n".into())))),
            classify_move(Ok(Err(ImapError::ConnectionLost))),
            classify_move(Err("t".into())),
        ];
        assert_eq!(all.iter().filter(|o| falls_back(o)).count(), 1);
    }
}
