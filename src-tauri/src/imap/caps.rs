//! Server capabilities (brief REQ-1.1).
//!
//! Velo never read `CAPABILITY` before this: `move_messages` inferred "the
//! server has no MOVE extension" from *any* failure of `UID MOVE`, which is
//! the guess that produced the duplication bug. Asking the server is
//! deterministic, and it shrinks error classification to the residual.
//!
//! **Scope.** Only the capabilities something acts on belong here. `MOVE` is
//! REQ-1; `UIDPLUS` arrives with the expunge slice (REQ-2), which is a
//! separate PR gated on live Dovecot transcripts.
//!
//! **One fetch per session.** Today every command opens its own session
//! (`connect` → operation → `logout`), so "per session" and "per operation"
//! coincide. When E2/P15 pooling lands, this belongs in the pool entry beside
//! the session so a pooled connection is not re-interrogated per command; and
//! when the `async-imap` 0.11 bump lands, `login_with_capabilities()` supplies
//! it from the LOGIN response *when the server volunteers one* — it returns
//! `Option<Capabilities>`, so this explicit fetch stays as the fallback.

use async_imap::types::{Capabilities, Capability};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use super::client::ImapSession;
use super::move_outcome::OUTCOME_UNKNOWN_PREFIX;
use super::net;

/// What the server says it supports, narrowed to what Velo acts on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Caps {
    /// RFC 6851 `MOVE` / `UID MOVE`.
    pub has_move: bool,
    /// RFC 4315 `UIDPLUS`, which is what makes `UID EXPUNGE` available.
    ///
    /// Without it there is no way to expunge a *specific* UID set, and Velo
    /// declines to expunge at all rather than removing messages the operation
    /// was never given (REQ-2.2, Decision 1(a)).
    pub has_uidplus: bool,
}

impl Caps {
    /// What to assume when the server answers, but not usefully.
    ///
    /// Both flags fail toward doing less: absent MOVE, `move_messages` uses the
    /// COPY fallback — the path that worked before this change existed; absent
    /// UIDPLUS, nothing is expunged. Guessing "supported" would send commands
    /// we have no reason to believe in and then classify their failure, which
    /// is the behaviour being removed.
    pub const fn unknown() -> Self {
        Self {
            has_move: false,
            has_uidplus: false,
        }
    }
}

/// Warn once per account that the server cannot target an expunge (REQ-4.4).
///
/// Delta sync runs every 60 seconds and archive/trash are among the most
/// frequent actions in the app, so logging this per operation would bury the
/// log. The set is process-wide and never pruned: it holds one short string per
/// account seen, which is bounded by the number of configured accounts.
pub fn warn_uidplus_missing_once(account: &str, host: &str) {
    static SEEN: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let seen = SEEN.get_or_init(|| Mutex::new(HashSet::new()));

    // A poisoned lock here must not take down a mail operation; the worst case
    // of ignoring it is a duplicate log line.
    let Ok(mut seen) = seen.lock() else { return };

    if seen.insert(format!("{account}@{host}")) {
        log::warn!(
            "{account}@{host} does not advertise UIDPLUS: messages will be flagged \
             \\Deleted but not removed from the server, because there is no way to \
             expunge only the messages you selected."
        );
    }
}

/// Case-insensitive match for a capability atom.
///
/// `Capabilities::has_str` falls through to a `HashSet` lookup on
/// `Capability::Atom(String)` (async-imap 0.10.4 `types/capabilities.rs:74`),
/// which is exact-match — but IMAP atoms are case-insensitive per RFC 3501
/// §9. A server advertising `Move` would read as "no MOVE" and silently take
/// the COPY path.
fn has_atom(caps: &Capabilities, name: &str) -> bool {
    caps.iter().any(|c| atom_eq(c, name))
}

fn atom_eq(cap: &Capability, name: &str) -> bool {
    match cap {
        Capability::Atom(s) => s.eq_ignore_ascii_case(name),
        _ => false,
    }
}

/// Ask the server what it supports.
///
/// **A timeout aborts.** `with_timeout` drops the `CAPABILITY` future
/// mid-protocol, leaving unread response bytes in the TLS buffer; any command
/// issued afterwards reads the tail of the aborted CAPABILITY as its own
/// response. That is the same desynchronisation
/// [`super::move_outcome`] documents for `UID MOVE` — and here it would land
/// one command *earlier*, on the path that still ends in an untargeted
/// `EXPUNGE`. So the caller gets the outcome-unknown error and issues nothing
/// further on this session.
///
/// **A clean protocol failure degrades.** A `NO`/`BAD`/parse failure means the
/// server answered and we could not use the answer; the session is still in a
/// known state. Degrading to [`Caps::unknown`] reproduces exactly the
/// behaviour that shipped before this change, so a non-standard server that
/// cannot answer `CAPABILITY` keeps working. Failing closed here instead would
/// trade a defect that already exists (and is fixed in REQ-2) for a new
/// functional regression on the servers Velo bends furthest to support.
pub async fn fetch(session: &mut ImapSession, timeout: Duration) -> Result<Caps, String> {
    let caps = match net::with_timeout(timeout, "CAPABILITY", session.capabilities()).await {
        Ok(Ok(caps)) => caps,
        Ok(Err(e)) => {
            log::warn!("CAPABILITY failed ({e}); assuming no optional extensions");
            return Ok(Caps::unknown());
        }
        Err(timeout_msg) => {
            return Err(format!(
                "{OUTCOME_UNKNOWN_PREFIX}{timeout_msg}. \
                 The connection was left mid-protocol, so no further command was sent."
            ))
        }
    };

    Ok(Caps {
        has_move: has_atom(&caps, "MOVE"),
        has_uidplus: has_atom(&caps, "UIDPLUS"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_assumes_the_fallback_path() {
        // Failing closed here means "use COPY", not "try MOVE and guess from
        // the error" — the behaviour REQ-1 exists to delete.
        assert!(!Caps::unknown().has_move);
        assert!(!Caps::unknown().has_uidplus);
    }

    #[test]
    fn atom_match_is_case_insensitive() {
        // RFC 3501 §9: atoms are case-insensitive. The crate's own has_str
        // would miss the lowercase spellings below.
        for spelling in ["MOVE", "move", "Move", "mOvE"] {
            assert!(
                atom_eq(&Capability::Atom(spelling.into()), "MOVE"),
                "should match {spelling:?}"
            );
        }
    }

    #[test]
    fn atom_match_does_not_match_other_capabilities() {
        assert!(!atom_eq(&Capability::Atom("MOVED".into()), "MOVE"));
        assert!(!atom_eq(&Capability::Atom("UIDPLUS".into()), "MOVE"));
        assert!(!atom_eq(&Capability::Imap4rev1, "MOVE"));
        assert!(!atom_eq(&Capability::Auth("PLAIN".into()), "MOVE"));
    }
}
