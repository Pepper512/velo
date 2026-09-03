pub mod caps;
pub mod client;
pub mod copyuid;
pub mod move_outcome;
pub mod net;
pub mod pool;
pub mod types;
pub mod wire;

/// #241: the FETCH attribute-list guard — test-only, scans `client.rs` as text.
#[cfg(test)]
mod fetch_guard;

/// PR E REQ-2.3: `async-imap`'s quoting on the wire, over a duplex stream.
#[cfg(test)]
mod wire_bytes;
