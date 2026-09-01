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

use std::time::Duration;

use super::net;
use super::client::ImapSession;

/// What the server says it supports, narrowed to what Velo acts on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Caps {
    /// RFC 6851 `MOVE` / `UID MOVE`.
    pub has_move: bool,
}

impl Caps {
    /// What to assume when the server will not tell us.
    ///
    /// Absent MOVE, `move_messages` uses the COPY fallback — the path that
    /// worked before this change existed. Guessing "supported" would send a
    /// command we have no reason to believe in and then classify its failure,
    /// which is the behaviour being removed.
    pub const fn unknown() -> Self {
        Self { has_move: false }
    }
}

/// Ask the server what it supports.
///
/// A failed `CAPABILITY` is not fatal: it degrades to [`Caps::unknown`], which
/// is the conservative path, rather than failing an operation the user asked
/// for over a diagnostic query.
pub async fn fetch(session: &mut ImapSession, timeout: Duration) -> Caps {
    let caps = match net::with_timeout(timeout, "CAPABILITY", session.capabilities()).await {
        Ok(Ok(caps)) => caps,
        Ok(Err(e)) => {
            log::warn!("CAPABILITY failed ({e}); assuming no optional extensions");
            return Caps::unknown();
        }
        Err(timeout_msg) => {
            log::warn!("{timeout_msg}; assuming no optional extensions");
            return Caps::unknown();
        }
    };

    Caps {
        has_move: caps.has_str("MOVE"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_assumes_the_fallback_path() {
        // Failing closed here means "use COPY", not "try MOVE and guess from
        // the error" — the behaviour REQ-1 exists to delete.
        assert!(!Caps::unknown().has_move);
    }
}
