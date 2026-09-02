//! `COPYUID` — the server's own answer to "where did the moved message go?"
//!
//! RFC 4315 (UIDPLUS) makes a `UID COPY` / `UID MOVE` report the new UIDs in a
//! `COPYUID <uidvalidity> <source-set> <dest-set>` response code, and RFC 6851
//! §3.3 has a MOVE send it as an **untagged** `* OK [COPYUID …]` before the
//! `EXPUNGE`s. `async-imap` 0.10.4 discards nothing on that path: any untagged
//! response it does not special-case is forwarded to the session's
//! `unsolicited_responses` channel as `UnsolicitedResponse::Other`, with the
//! code already parsed by `imap-proto` (`parse.rs:460`, `handle_unilateral`).
//! Velo therefore owns **no parser** here — only the drain and the validation.
//!
//! Two properties shape everything below (brief F-5 rev 2, defect item 3):
//!
//! - **The forward is best-effort.** The channel is `bounded(100)` and the send
//!   is `try_send(..).ok()`: a full channel drops the response silently. Nothing
//!   in Velo ever read that channel before, so it fills up over the life of a
//!   session and the `COPYUID` would be the one to fall off. [`discard_pending`]
//!   runs *before* the command to make room; a mapping that still fails to
//!   arrive is a supported outcome — the same one a non-UIDPLUS server gives.
//! - **The mapping is untrusted input.** It drives local identity, so it is
//!   validated as a total function over whatever the server sent: set lengths
//!   must agree, the expansion is capped, and a malformed mapping degrades to
//!   `None` — never a panic, never a partial mapping.

use async_imap::imap_proto::{Response, ResponseCode, Status, UidSetMember};
use async_imap::types::UnsolicitedResponse;

use super::types::UidMapping;

/// Upper bound on the number of UIDs a single `COPYUID` may expand to.
///
/// A hostile or broken server can send `1:4294967295`; expanding that is a
/// multi-gigabyte allocation on the way to a `Vec` the frontend then has to
/// carry across IPC. No Velo move command sends more than a few thousand UIDs,
/// so anything above this is treated as no mapping at all.
pub const MAX_COPYUID_MEMBERS: usize = 10_000;

/// Discard everything currently queued on the unsolicited channel.
///
/// Returns how many responses were dropped, for the log line. This is not a
/// loss: Velo has never consumed that channel, so every entry on it was already
/// being ignored — the only thing that changes is that the next `COPYUID` has
/// somewhere to land.
pub fn discard_pending<I: Iterator<Item = UnsolicitedResponse>>(pending: I) -> usize {
    pending.count()
}

/// Drain the unsolicited channel after a successful `UID MOVE` and return the
/// `COPYUID` mapping if exactly one usable mapping arrived.
///
/// Everything that is not a `COPYUID` is dropped, as before. If more than one
/// `COPYUID` arrives (a server that reports per-message, or a stale one that
/// survived [`discard_pending`] because it landed between the discard and the
/// command), the result is `None`: two mappings cannot be reconciled to the one
/// command that was issued, and the safe reading is "no mapping".
pub fn drain_copyuid<I: Iterator<Item = UnsolicitedResponse>>(
    responses: I,
) -> Option<Vec<UidMapping>> {
    let mut found: Option<Vec<UidMapping>> = None;
    let mut count = 0usize;

    for response in responses {
        if let UnsolicitedResponse::Other(data) = response {
            if let Some(mapping) = mapping_from_response(data.parsed()) {
                count += 1;
                found = Some(mapping);
            }
        }
    }

    if count == 1 {
        found
    } else {
        None
    }
}

/// Extract and validate a `COPYUID` mapping from one parsed response.
///
/// Returns `None` unless the response is an `OK` carrying `COPYUID` whose two
/// UID sets expand to the same non-empty length within
/// [`MAX_COPYUID_MEMBERS`], with no source UID repeated. RFC 4315 §3 defines
/// the sets as positionally corresponding, which is the only reading under
/// which a mapping exists at all.
pub fn mapping_from_response(response: &Response<'_>) -> Option<Vec<UidMapping>> {
    let Response::Data {
        status: Status::Ok,
        code: Some(ResponseCode::CopyUid(_uidvalidity, source, dest)),
        ..
    } = response
    else {
        return None;
    };

    let source = expand(source)?;
    let dest = expand(dest)?;

    if source.is_empty() || source.len() != dest.len() {
        return None;
    }

    // Both sides must be sets: a repeated source has two destinations, and a
    // repeated destination would re-key two rows to one id — the second would
    // then collide with the first inside the same transaction (Gemini M2).
    let mut seen = std::collections::HashSet::with_capacity(source.len());
    if !source.iter().all(|uid| seen.insert(*uid)) {
        return None;
    }
    seen.clear();
    if !dest.iter().all(|uid| seen.insert(*uid)) {
        return None;
    }

    Some(
        source
            .into_iter()
            .zip(dest)
            .map(|(source_uid, dest_uid)| UidMapping {
                source_uid,
                dest_uid,
            })
            .collect(),
    )
}

/// Expand a UID set to its members, in order, or `None` if it would exceed the
/// cap or contains a zero (UIDs are `nz-number`, RFC 3501 §9).
fn expand(set: &[UidSetMember]) -> Option<Vec<u32>> {
    let mut out = Vec::new();
    for member in set {
        match member {
            UidSetMember::Uid(uid) => push_checked(&mut out, *uid)?,
            UidSetMember::UidRange(range) => {
                // A reversed range (`5:3`) is legal on the wire — RFC 3501 says
                // the order is irrelevant — but `RangeInclusive` iterates it as
                // empty, which would silently shorten the set. Normalise first.
                let (lo, hi) = (
                    *range.start().min(range.end()),
                    *range.start().max(range.end()),
                );
                // Bound the loop before iterating, not after: `1:4294967295` must
                // fail without touching 4 billion values.
                if (hi - lo) as usize >= MAX_COPYUID_MEMBERS {
                    return None;
                }
                for uid in lo..=hi {
                    push_checked(&mut out, uid)?;
                }
            }
        }
    }
    Some(out)
}

fn push_checked(out: &mut Vec<u32>, uid: u32) -> Option<()> {
    if uid == 0 || out.len() >= MAX_COPYUID_MEMBERS {
        return None;
    }
    out.push(uid);
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok_with_code(code: Option<ResponseCode<'static>>) -> Response<'static> {
        Response::Data {
            status: Status::Ok,
            code,
            information: Some("Moved.".into()),
        }
    }

    fn copyuid(source: Vec<UidSetMember>, dest: Vec<UidSetMember>) -> Response<'static> {
        ok_with_code(Some(ResponseCode::CopyUid(1, source, dest)))
    }

    fn pairs(mapping: &[UidMapping]) -> Vec<(u32, u32)> {
        mapping.iter().map(|m| (m.source_uid, m.dest_uid)).collect()
    }

    // ---------- Done-when 3, case 1: mapping present ----------

    #[test]
    fn a_single_uid_maps_to_a_single_uid() {
        let response = copyuid(vec![UidSetMember::Uid(5)], vec![UidSetMember::Uid(3)]);
        assert_eq!(
            pairs(&mapping_from_response(&response).unwrap()),
            vec![(5, 3)]
        );
    }

    #[test]
    fn a_range_maps_positionally_as_rfc_4315_defines() {
        // `COPYUID 1 304,319:320 3956:3958` — the RFC's own example shape.
        let response = copyuid(
            vec![UidSetMember::Uid(304), UidSetMember::UidRange(319..=320)],
            vec![UidSetMember::UidRange(3956..=3958)],
        );
        assert_eq!(
            pairs(&mapping_from_response(&response).unwrap()),
            vec![(304, 3956), (319, 3957), (320, 3958)]
        );
    }

    #[test]
    fn a_reversed_range_is_the_same_set() {
        // Built explicitly: the literal `7..=5` trips clippy's
        // reversed_empty_ranges, which is exactly the property under test.
        let response = copyuid(
            vec![UidSetMember::UidRange(std::ops::RangeInclusive::new(7, 5))],
            vec![UidSetMember::UidRange(10..=12)],
        );
        assert_eq!(
            pairs(&mapping_from_response(&response).unwrap()),
            vec![(5, 10), (6, 11), (7, 12)]
        );
    }

    // ---------- Done-when 3, case 2: mapping absent ----------

    #[test]
    fn an_ok_without_copyuid_is_no_mapping() {
        assert!(mapping_from_response(&ok_with_code(None)).is_none());
        assert!(mapping_from_response(&ok_with_code(Some(ResponseCode::ReadWrite))).is_none());
    }

    #[test]
    fn a_no_or_bad_carrying_copyuid_is_ignored() {
        // Only an OK reports a completed copy; a NO with a code is a refusal.
        for status in [Status::No, Status::Bad] {
            let response = Response::Data {
                status,
                code: Some(ResponseCode::CopyUid(
                    1,
                    vec![UidSetMember::Uid(5)],
                    vec![UidSetMember::Uid(3)],
                )),
                information: None,
            };
            assert!(mapping_from_response(&response).is_none());
        }
    }

    #[test]
    fn an_empty_channel_yields_none() {
        assert!(drain_copyuid(std::iter::empty()).is_none());
    }

    #[test]
    fn other_unsolicited_traffic_is_dropped_without_a_mapping() {
        let traffic = vec![
            UnsolicitedResponse::Exists(3),
            UnsolicitedResponse::Recent(1),
            UnsolicitedResponse::Expunge(2),
        ];
        assert!(drain_copyuid(traffic.into_iter()).is_none());
    }

    #[test]
    fn discarding_counts_what_it_drops() {
        let traffic = vec![
            UnsolicitedResponse::Exists(3),
            UnsolicitedResponse::Recent(1),
        ];
        assert_eq!(discard_pending(traffic.into_iter()), 2);
        assert_eq!(discard_pending(std::iter::empty()), 0);
    }

    // ---------- Done-when 3, case 3: present but unusable ----------

    #[test]
    fn mismatched_set_lengths_are_no_mapping() {
        let response = copyuid(
            vec![UidSetMember::UidRange(1..=3)],
            vec![UidSetMember::UidRange(10..=11)],
        );
        assert!(mapping_from_response(&response).is_none());
    }

    #[test]
    fn empty_sets_are_no_mapping() {
        assert!(mapping_from_response(&copyuid(vec![], vec![])).is_none());
    }

    #[test]
    fn a_repeated_source_uid_is_no_mapping() {
        // Two destinations for one source cannot be re-keyed to one row.
        let response = copyuid(
            vec![UidSetMember::Uid(5), UidSetMember::Uid(5)],
            vec![UidSetMember::Uid(3), UidSetMember::Uid(4)],
        );
        assert!(mapping_from_response(&response).is_none());
    }

    #[test]
    fn a_repeated_destination_uid_is_no_mapping() {
        // `COPYUID 1 5,6 10,10` — two rows re-keyed to one id would collide.
        let response = copyuid(
            vec![UidSetMember::Uid(5), UidSetMember::Uid(6)],
            vec![UidSetMember::Uid(10), UidSetMember::Uid(10)],
        );
        assert!(mapping_from_response(&response).is_none());
    }

    #[test]
    fn a_zero_uid_is_no_mapping() {
        let response = copyuid(vec![UidSetMember::Uid(0)], vec![UidSetMember::Uid(3)]);
        assert!(mapping_from_response(&response).is_none());
    }

    #[test]
    fn a_hostile_range_fails_without_expanding() {
        // `1:4294967295` — must return None promptly, never allocate 16 GiB.
        let response = copyuid(
            vec![UidSetMember::UidRange(1..=u32::MAX)],
            vec![UidSetMember::UidRange(1..=u32::MAX)],
        );
        assert!(mapping_from_response(&response).is_none());
    }

    #[test]
    fn the_cap_is_exact() {
        let at_cap = MAX_COPYUID_MEMBERS as u32;
        let response = copyuid(
            vec![UidSetMember::UidRange(1..=at_cap)],
            vec![UidSetMember::UidRange(1..=at_cap)],
        );
        assert_eq!(
            mapping_from_response(&response).unwrap().len(),
            MAX_COPYUID_MEMBERS
        );

        let response = copyuid(
            vec![UidSetMember::UidRange(1..=at_cap + 1)],
            vec![UidSetMember::UidRange(1..=at_cap + 1)],
        );
        assert!(mapping_from_response(&response).is_none());
    }

    // ---------- Done-when 4: the live server ----------

    /// Runs against the Dovecot harness (`docs/testing/dovecot`, Alpine
    /// variant) — `cargo test --locked -- --ignored live_dovecot`. This is the
    /// one thing the unit tests cannot settle: whether the `COPYUID` really
    /// arrives on the unsolicited channel on the same command turn as the
    /// tagged OK to `UID MOVE`, on a real server, through the real
    /// `move_messages`. Port 11143 advertises UIDPLUS; 11144 hides it.
    #[tokio::test]
    #[ignore = "needs the Dovecot harness on 127.0.0.1:11143 and :11144"]
    async fn live_dovecot_uid_move_reports_copyuid() {
        use super::super::client;
        use super::super::types::ImapConfig;

        for (port, uidplus_advertised) in [(11143u16, true), (11144u16, false)] {
            let config = ImapConfig {
                host: "127.0.0.1".to_string(),
                port,
                security: "none".to_string(),
                username: "velo".to_string(),
                password: "velo-test-only".to_string(),
                auth_method: "password".to_string(),
                accept_invalid_certs: false,
            };
            let mut session = client::connect(&config)
                .await
                .unwrap_or_else(|e| panic!("connect to :{port}: {e}"));

            let dest = format!("F5Dest{}", std::process::id());
            let _ = session.create(&dest).await; // may already exist from a previous run

            // Two appends, so the source UID is never 1 and a mapping that
            // confused source with destination (both start at 1 in fresh
            // mailboxes) could not pass by coincidence.
            for n in 0..2 {
                let raw = format!(
                    "From: a@example.com\r\nTo: b@example.com\r\nSubject: F-5 live {port} {n}\r\n\
                     Message-ID: <f5-{port}-{n}-{}@example.com>\r\n\r\nbody\r\n",
                    std::process::id()
                );
                client::append_message(&mut session, "INBOX", None, raw.as_bytes())
                    .await
                    .expect("APPEND");
            }

            let source_uid = *client::search_all_uids(&mut session, "INBOX")
                .await
                .expect("UID SEARCH ALL")
                .iter()
                .max()
                .expect("the appended message is in INBOX");
            assert!(source_uid >= 2);
            let dest_before = client::search_all_uids(&mut session, &dest).await.expect("dest list");

            let result =
                client::move_messages(&mut session, "INBOX", &source_uid.to_string(), &dest)
                    .await
                    .expect("move_messages");
            eprintln!(":{port} UIDPLUS advertised={uidplus_advertised} -> {result:?}");

            let inbox_after = client::search_all_uids(&mut session, "INBOX").await.unwrap();
            let dest_after = client::search_all_uids(&mut session, &dest).await.unwrap();
            let arrived: Vec<u32> = dest_after
                .iter()
                .copied()
                .filter(|u| !dest_before.contains(u))
                .collect();
            assert_eq!(arrived.len(), 1, ":{port}: exactly one message arrived in {dest}");

            if uidplus_advertised {
                // MOVE path: source removed by the server, COPYUID on the channel.
                assert!(result.expunged, ":{port}: MOVE reports the source copy removed");
                assert!(!inbox_after.contains(&source_uid), ":{port}: gone from INBOX");
                let mapping = result.mapping.expect(":11143 must yield a COPYUID mapping");
                assert_eq!(mapping.len(), 1);
                assert_eq!(mapping[0].source_uid, source_uid);
                assert_eq!(
                    mapping[0].dest_uid, arrived[0],
                    "the mapped destination UID is the one the server actually assigned"
                );
            } else {
                // The harness hides MOVE along with UIDPLUS, so this is the COPY
                // fallback: copied, flagged \Deleted, not expunged (Decision
                // 1(a)), and — RFC 4315 puts a COPY's COPYUID on the tagged OK
                // that async-imap consumes — no mapping. The frontend hides the
                // row until the destination syncs.
                assert!(!result.expunged, ":{port}: nothing expunged without UIDPLUS");
                assert!(inbox_after.contains(&source_uid), ":{port}: still in INBOX, flagged");
                assert!(result.mapping.is_none(), ":{port}: no mapping on the COPY path");
            }

            let _ = session.delete(&dest).await;
            let _ = session.logout().await;
        }
    }

    #[test]
    fn u32_max_as_a_single_uid_is_fine() {
        // The cap is about count, not magnitude: a UID near the top of the
        // range is legal and must not trip the arithmetic.
        let response = copyuid(
            vec![UidSetMember::Uid(u32::MAX)],
            vec![UidSetMember::Uid(u32::MAX - 1)],
        );
        assert_eq!(
            pairs(&mapping_from_response(&response).unwrap()),
            vec![(u32::MAX, u32::MAX - 1)]
        );
    }
}
