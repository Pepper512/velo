# SPEC-E2-3 — IMAP session pool: the carry list from PR #39

- **Task:** Close the five code items PR #39 (E2 part 2) carried to "part 3": the redundant
  `Arc<Mutex>` around a pooled session together with `logout_arc`'s `try_unwrap` (which
  silently skips LOGOUT when a second clone exists), evictions that drop a connection without
  LOGOUT, `bump_credential_version` evicting by identity regardless of version, the
  cross-window invalidation race, and the unvalidated session-id wrapper. Done-when 9 and
  the live halves of 2 and 10 need the Dovecot harness and stay recorded as manual.
- **Tier:** **2** — `src-tauri/src/imap/pool.rs` and `commands.rs` are the Rust IMAP client
  path (a named Tier-2 area). Plan, threat pass and rollback in the PR before code; two
  review legs. No dependency, no capability, no schema.
- **Base:** `main` @ the F-3 merge (code pin advances with it). Citations grepped at `c03082a`.
- **Status:** draft — branch `e2-part3-pool-carry` after F-3 lands.
- **Source:** PR #39's "Scope — what this does NOT close" (quoted below), ADR-003, the E2 brief
  `docs/briefs/2026-09-01-e2-p15-session-pooling.md`, and HANDOFF's carry list. Jim's
  2026-09-03 instruction: *"Then E2 part 3 … Tier 2 (Rust IMAP pool) — plan with threat pass
  and rollback before code."*
- **Effort:** M · 1 day.

## The carry list, verbatim from #39

> - The redundant `Arc<tokio::Mutex>` — **and it should be removed together with `logout_arc`'s
>   `try_unwrap`**, which silently skips the LOGOUT when a second clone exists. That is closer
>   to a defect than a nit.
> - Evictions dropped without a LOGOUT.
> - `bump_credential_version` evicts by ident regardless of version, so under fire-and-forget
>   invalidation a session opened on the *new* credential can be evicted by the bump that
>   preceded it. Self-healing, one wasted login.
> - The unvalidated session-id wrapper.
> - **Done-when 9** (folder isolation) and the live-server halves of 2 and 10 — those need
>   the Dovecot harness, not another unit test.
>
> A *narrower* race is real: another window's module cache still holds an id whose eviction
> is in flight. It self-heals into `NoSuchSession` and a reopen. Noted for part 3.

## What exists, verified in the fork

1. **The `Arc<Mutex>` is redundant by construction.** `Entry.session:
   Option<Arc<tokio::sync::Mutex<S>>>` (`pool.rs:117`); `acquire` *takes* the session out of
   the entry (`:242`), so exactly one operation can hold it — the mutex never contends.
   `with_pooled_session` clones the `Arc` (`commands.rs:131`), moves the clone into `op`, and
   the guard keeps the original; `release_ok` puts it back (`pool.rs:384-393`).
2. **`logout_arc` skips LOGOUT whenever it is not the sole owner.** `commands.rs:112-117`:
   `if let Ok(mutex) = Arc::try_unwrap(session) { … logout() }` — a second clone means a
   silent drop. Today the clone count is one on every path that reaches it (`remove`, `reap`,
   `drain`, `bump_credential_version` all return sessions that were *not* checked out), so
   the skip is latent; it is the design that is wrong, and any future path