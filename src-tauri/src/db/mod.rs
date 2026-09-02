//! Rust-owned pieces of the local SQLite database. The plugin (`tauri-plugin-sql`)
//! keeps owning the file and the pool; this module adds what the plugin cannot
//! offer over IPC — a transaction that stays on one connection (SPEC-240).

pub mod tx;

#[cfg(test)]
mod tx_tests;
