//! SPEC-240 — a transaction stays on one connection. Written before `tx.rs`.
//!
//! The pool is file-backed on purpose: an in-memory SQLite database is private
//! to its connection, so "visible from another pool connection" could not be
//! proved on one. Each test gets its own file and removes it.

use super::tx::*;
use serde_json::{json, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Sqlite};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

static FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

struct TempDb {
    pool: Pool<Sqlite>,
    path: PathBuf,
}

impl Drop for TempDb {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let mut p = self.path.clone().into_os_string();
            p.push(suffix);
            let _ = std::fs::remove_file(p);
        }
    }
}

async fn temp_db(busy_timeout: Duration) -> TempDb {
    let n = FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("velo-tx-{}-{n}.db", std::process::id()));
    let opts = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .busy_timeout(busy_timeout);
    let pool = SqlitePoolOptions::new()
        .max_connections(3)
        .connect_with(opts)
        .await
        .expect("open temp db");
    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT, n INTEGER, r REAL, j TEXT)")
        .execute(&pool)
        .await
        .expect("create table");
    TempDb { pool, path }
}

async fn count_via_pool(pool: &Pool<Sqlite>) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM t")
        .fetch_one(pool)
        .await
        .expect("count")
}

#[tokio::test]
async fn a_committed_transaction_is_visible_from_another_pool_connection() {
    let db = temp_db(Duration::from_secs(1)).await;
    let tx = TxManager::new();

    let id = tx.begin(&db.pool).await.unwrap();
    let (affected, rowid) = tx
        .execute(&id, "INSERT INTO t (v) VALUES ($1)", vec![json!("one")])
        .await
        .unwrap();
    assert_eq!((affected, rowid), (1, 1));
    // Not yet committed: a reader on another connection sees nothing.
    assert_eq!(count_via_pool(&db.pool).await, 0);
    // The transaction itself sees its own write.
    let rows = tx.select(&id, "SELECT v FROM t", vec![]).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("v"), Some(&json!("one")));

    tx.commit(&id).await.unwrap();
    assert_eq!(count_via_pool(&db.pool).await, 1);
    assert!(!tx.is_open().await);
}

#[tokio::test]
async fn a_rolled_back_transaction_leaves_nothing() {
    let db = temp_db(Duration::from_secs(1)).await;
    let tx = TxManager::new();

    let id = tx.begin(&db.pool).await.unwrap();
    tx.execute(&id, "INSERT INTO t (v) VALUES ($1)", vec![json!("gone")])
        .await
        .unwrap();
    tx.rollback(&id).await.unwrap();

    assert_eq!(count_via_pool(&db.pool).await, 0);
    assert!(!tx.is_open().await);
}

#[tokio::test]
async fn the_lock_is_taken_up_front_begin_immediate() {
    // A short busy timeout on the pool: with the write lock already held by the
    // open transaction, another connection's BEGIN IMMEDIATE must fail fast. A
    // deferred BEGIN would not have taken the lock yet and this would succeed.
    let db = temp_db(Duration::from_millis(100)).await;
    let tx = TxManager::new();

    let id = tx.begin(&db.pool).await.unwrap();
    let other = sqlx::query("BEGIN IMMEDIATE").execute(&db.pool).await;
    assert!(other.is_err(), "another writer got the lock while a transaction was open");
    tx.rollback(&id).await.unwrap();

    // Released: the same statement now succeeds.
    let mut conn = db.pool.acquire().await.unwrap();
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.unwrap();
    sqlx::query("ROLLBACK").execute(&mut *conn).await.unwrap();
}

#[tokio::test]
async fn ids_are_checked_and_a_second_begin_is_refused() {
    let db = temp_db(Duration::from_secs(1)).await;
    let tx = TxManager::new();

    let err = tx.execute("nope", "SELECT 1", vec![]).await.unwrap_err();
    assert!(err.starts_with(TX_UNKNOWN), "{err}");

    let id = tx.begin(&db.pool).await.unwrap();
    let busy = tx.begin(&db.pool).await.unwrap_err();
    assert!(busy.starts_with(TX_BUSY), "{busy}");

    let wrong = tx.select("other-id", "SELECT 1", vec![]).await.unwrap_err();
    assert!(wrong.starts_with(TX_UNKNOWN), "{wrong}");
    let wrong_commit = tx.commit("other-id").await.unwrap_err();
    assert!(wrong_commit.starts_with(TX_UNKNOWN), "{wrong_commit}");
    assert!(tx.is_open().await, "a wrong-id commit must not close the real transaction");

    tx.commit(&id).await.unwrap();
    // After commit the id is dead and a new transaction may begin.
    let dead = tx.execute(&id, "SELECT 1", vec![]).await.unwrap_err();
    assert!(dead.starts_with(TX_UNKNOWN), "{dead}");
    let id2 = tx.begin(&db.pool).await.unwrap();
    assert_ne!(id, id2);
    tx.rollback(&id2).await.unwrap();
}

#[tokio::test]
async fn an_idle_transaction_is_reaped_and_its_id_reports_expired() {
    let db = temp_db(Duration::from_secs(1)).await;
    let tx = TxManager::new();

    let id = tx.begin(&db.pool).await.unwrap();
    tx.execute(&id, "INSERT INTO t (v) VALUES ($1)", vec![json!("stale")])
        .await
        .unwrap();

    // Not idle yet: nothing reaped.
    assert_eq!(tx.reap_idle(Duration::from_secs(30)).await, None);
    // Idle for longer than zero: reaped, rolled back, connection released.
    assert_eq!(tx.reap_idle(Duration::ZERO).await, Some(id.clone()));
    assert!(!tx.is_open().await);
    assert_eq!(count_via_pool(&db.pool).await, 0);

    let err = tx.execute(&id, "SELECT 1", vec![]).await.unwrap_err();
    assert!(err.starts_with(TX_EXPIRED), "{err}");
    let err = tx.commit(&id).await.unwrap_err();
    assert!(err.starts_with(TX_EXPIRED), "{err}");

    // The manager is usable again.
    let id2 = tx.begin(&db.pool).await.unwrap();
    tx.commit(&id2).await.unwrap();
}

#[tokio::test]
async fn binding_and_decoding_match_the_plugin() {
    // The plugin binds null → NULL, string → TEXT, number → f64, anything else →
    // JSON text; it decodes INTEGER → number, REAL → number, TEXT → string,
    // NULL → null. Parity is what lets a query move onto the handle unchanged.
    let db = temp_db(Duration::from_secs(1)).await;
    let tx = TxManager::new();

    let id = tx.begin(&db.pool).await.unwrap();
    tx.execute(
        &id,
        "INSERT INTO t (v, n, r, j) VALUES ($1, $2, $3, $4)",
        vec![Value::Null, json!(5), json!(1.5), json!({"a": 1})],
    )
    .await
    .unwrap();
    let rows = tx
        .select(&id, "SELECT v, n, r, j FROM t WHERE n = $1", vec![json!(5)])
        .await
        .unwrap();
    tx.commit(&id).await.unwrap();

    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.get("v"), Some(&Value::Null));
    assert_eq!(row.get("n"), Some(&json!(5)));
    assert_eq!(row.get("r"), Some(&json!(1.5)));
    assert_eq!(row.get("j"), Some(&json!("{\"a\":1}")));
}

#[tokio::test]
async fn booleans_bind_as_integers_and_round_trip_through_an_integer_filter() {
    // Gemini H1 on #54: the plugin would store the JSON text "true".
    let db = temp_db(Duration::from_secs(1)).await;
    let tx = TxManager::new();

    let id = tx.begin(&db.pool).await.unwrap();
    tx.execute(&id, "INSERT INTO t (v, n) VALUES ($1, $2)", vec![json!("yes"), json!(true)])
        .await
        .unwrap();
    tx.execute(&id, "INSERT INTO t (v, n) VALUES ($1, $2)", vec![json!("no"), json!(false)])
        .await
        .unwrap();
    let rows = tx
        .select(&id, "SELECT v, n FROM t WHERE n = 1", vec![])
        .await
        .unwrap();
    tx.commit(&id).await.unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("v"), Some(&json!("yes")));
    assert_eq!(rows[0].get("n"), Some(&json!(1)));
}

#[tokio::test]
async fn a_new_transaction_forgets_the_previously_reaped_id() {
    let db = temp_db(Duration::from_secs(1)).await;
    let tx = TxManager::new();

    let old = tx.begin(&db.pool).await.unwrap();
    assert_eq!(tx.reap_idle(Duration::ZERO).await, Some(old.clone()));
    let fresh = tx.begin(&db.pool).await.unwrap();
    let err = tx.execute(&old, "SELECT 1", vec![]).await.unwrap_err();
    assert!(err.starts_with(TX_UNKNOWN), "{err}");
    tx.rollback(&fresh).await.unwrap();
}

#[tokio::test]
async fn a_failing_statement_reports_the_error_and_keeps_the_transaction_open() {
    let db = temp_db(Duration::from_secs(1)).await;
    let tx = TxManager::new();

    let id = tx.begin(&db.pool).await.unwrap();
    let err = tx
        .execute(&id, "INSERT INTO nope (v) VALUES ($1)", vec![json!("x")])
        .await
        .unwrap_err();
    assert!(err.contains("no such table"), "{err}");
    // The caller decides: it can still roll back on the same connection.
    assert!(tx.is_open().await);
    tx.rollback(&id).await.unwrap();
    assert!(!tx.is_open().await);
}
