//! Pinned SQLite transactions (SPEC-240).
//!
//! `tauri-plugin-sql` serves every `execute`/`select` from a pool of up to ten
//! connections, so a transaction sent as `BEGIN` … statements … `COMMIT` over
//! separate IPC calls is not guaranteed to stay on one connection — the moment
//! a UI read runs concurrently, the statements interleave across two and the
//! transaction is a fiction. This module holds **one** connection from the
//! plugin's own pool for the length of a transaction and routes every
//! statement of that transaction through it.
//!
//! Shape: at most one open transaction at a time (the TypeScript side already
//! serialises callers; the refusal here is a backstop), `BEGIN IMMEDIATE` so
//! the write lock is taken up front, and an idle watchdog so a stuck caller
//! can never hold the writer forever. Binding and decoding mirror the plugin's
//! exactly, so a query moved onto the handle keeps its meaning.

use serde_json::{Map, Value};
use sqlx::pool::PoolConnection;
use sqlx::sqlite::{SqliteArguments, SqliteRow, SqliteValueRef};
use sqlx::{Column, Connection, Pool, Row, Sqlite, TypeInfo, Value as _, ValueRef};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool};
use tokio::sync::Mutex;

/// REQ-1.3: a transaction that has issued no statement for this long is rolled
/// back by the watchdog. Idle, not total — a long batch that keeps issuing
/// statements is never cut. Approved by Jim (2026-09-02).
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
/// How often the watchdog looks.
pub const WATCHDOG_INTERVAL: Duration = Duration::from_secs(5);
/// The key `Database.load()` uses on the TypeScript side (`connection.ts`).
pub const DB_KEY: &str = "sqlite:velo.db";

/// Error prefixes the TypeScript side matches on. Stable strings, not free text.
pub const TX_BUSY: &str = "VELO_TX_BUSY";
pub const TX_EXPIRED: &str = "VELO_TX_EXPIRED";
pub const TX_UNKNOWN: &str = "VELO_TX_UNKNOWN";
pub const TX_NO_DB: &str = "VELO_TX_NO_DB";

struct OpenTx {
    id: String,
    conn: PoolConnection<Sqlite>,
    last_used: Instant,
}

#[derive(Default)]
struct Inner {
    current: Option<OpenTx>,
    /// The id of the last transaction the watchdog reaped, so its owner gets
    /// `VELO_TX_EXPIRED` rather than a generic unknown-id error.
    expired: Option<String>,
}

pub struct TxManager {
    inner: Mutex<Inner>,
    next: AtomicU64,
    epoch: u128,
}

impl Default for TxManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TxManager {
    pub fn new() -> Self {
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        Self {
            inner: Mutex::new(Inner::default()),
            next: AtomicU64::new(0),
            epoch,
        }
    }

    /// Ids are compared for equality by the same process that minted them;
    /// they need to be unique, not unguessable.
    fn fresh_id(&self) -> String {
        format!("tx-{}-{}", self.epoch, self.next.fetch_add(1, Ordering::Relaxed))
    }

    #[cfg(test)]
    pub async fn is_open(&self) -> bool {
        self.inner.lock().await.current.is_some()
    }

    /// Take a connection from the pool and open the transaction on it
    /// (REQ-1.1, REQ-1.5). Refuses if one is already open (REQ-1.4).
    pub async fn begin(&self, pool: &Pool<Sqlite>) -> Result<String, String> {
        let mut inner = self.inner.lock().await;
        if inner.current.is_some() {
            return Err(format!("{TX_BUSY}: a transaction is already open"));
        }
        let mut conn = pool
            .acquire()
            .await
            .map_err(|e| format!("Could not take a connection for the transaction: {e}"))?;
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut *conn)
            .await
            .map_err(|e| format!("BEGIN IMMEDIATE failed: {e}"))?;
        let id = self.fresh_id();
        inner.current = Some(OpenTx {
            id: id.clone(),
            conn,
            last_used: Instant::now(),
        });
        Ok(id)
    }

    fn check<'a>(inner: &'a mut Inner, id: &str) -> Result<&'a mut OpenTx, String> {
        match inner.current.as_mut() {
            Some(tx) if tx.id == id => {
                tx.last_used = Instant::now();
                Ok(tx)
            }
            _ => {
                if inner.expired.as_deref() == Some(id) {
                    Err(format!(
                        "{TX_EXPIRED}: the transaction was idle for more than {}s and was rolled back",
                        IDLE_TIMEOUT.as_secs()
                    ))
                } else {
                    Err(format!("{TX_UNKNOWN}: no open transaction with this id"))
                }
            }
        }
    }

    pub async fn execute(&self, id: &str, sql: &str, values: Vec<Value>) -> Result<(u64, i64), String> {
        let mut inner = self.inner.lock().await;
        let tx = Self::check(&mut inner, id)?;
        let result = bind_all(sqlx::query(sql), values)
            .execute(&mut *tx.conn)
            .await
            .map_err(|e| e.to_string())?;
        Ok((result.rows_affected(), result.last_insert_rowid()))
    }

    pub async fn select(&self, id: &str, sql: &str, values: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
        let mut inner = self.inner.lock().await;
        let tx = Self::check(&mut inner, id)?;
        let rows = bind_all(sqlx::query(sql), values)
            .fetch_all(&mut *tx.conn)
            .await
            .map_err(|e| e.to_string())?;
        rows.iter().map(row_to_json).collect()
    }

    pub async fn commit(&self, id: &str) -> Result<(), String> {
        self.finish(id, "COMMIT").await
    }

    pub async fn rollback(&self, id: &str) -> Result<(), String> {
        self.finish(id, "ROLLBACK").await
    }

    async fn finish(&self, id: &str, statement: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        Self::check(&mut inner, id)?;
        let tx = inner.current.take().expect("checked just above");
        release(tx, statement).await
    }

    /// REQ-1.3: roll back and release a transaction idle for at least `idle`.
    /// Returns the id it reaped, which then answers `VELO_TX_EXPIRED`.
    pub async fn reap_idle(&self, idle: Duration) -> Option<String> {
        let mut inner = self.inner.lock().await;
        let stale = matches!(&inner.current, Some(tx) if tx.last_used.elapsed() >= idle);
        if !stale {
            return None;
        }
        let tx = inner.current.take()?;
        let id = tx.id.clone();
        let _ = release(tx, "ROLLBACK").await;
        inner.expired = Some(id.clone());
        Some(id)
    }
}

/// End the transaction with `statement` and hand the connection back. A
/// connection whose COMMIT or ROLLBACK failed is **closed, not returned**: sqlx
/// does not know about a transaction we opened by hand, so returning it would
/// put a connection still inside a transaction back into the pool.
async fn release(mut tx: OpenTx, statement: &str) -> Result<(), String> {
    match sqlx::query(statement).execute(&mut *tx.conn).await {
        Ok(_) => Ok(()),
        Err(e) => {
            let raw = tx.conn.detach();
            let _ = raw.close().await;
            Err(format!("{statement} failed: {e}"))
        }
    }
}

/// Bind exactly as the plugin does (`tauri-plugin-sql` `wrapper.rs`): null →
/// NULL, string → TEXT, **number → f64**, anything else → JSON. The f64 quirk is
/// the plugin's; it is kept so a query keeps its meaning when it moves here.
fn bind_all<'q>(
    mut query: sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>,
    values: Vec<Value>,
) -> sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>> {
    for value in values {
        query = if value.is_null() {
            query.bind(None::<Value>)
        } else if let Some(s) = value.as_str() {
            query.bind(s.to_owned())
        } else if let Some(n) = value.as_f64() {
            query.bind(n)
        } else {
            query.bind(value)
        };
    }
    query
}

fn row_to_json(row: &SqliteRow) -> Result<Map<String, Value>, String> {
    let mut out = Map::new();
    for (i, column) in row.columns().iter().enumerate() {
        let raw = row.try_get_raw(i).map_err(|e| e.to_string())?;
        out.insert(column.name().to_string(), decode(raw)?);
    }
    Ok(out)
}

/// Decode as the plugin does (`decode/sqlite.rs`). Velo declares no DATE/TIME
/// columns; those affinities decode as the text SQLite stores.
fn decode(v: SqliteValueRef<'_>) -> Result<Value, String> {
    if v.is_null() {
        return Ok(Value::Null);
    }
    Ok(match v.type_info().name() {
        "TEXT" | "DATE" | "TIME" | "DATETIME" => v
            .to_owned()
            .try_decode::<String>()
            .map(Value::String)
            .unwrap_or(Value::Null),
        "REAL" => v
            .to_owned()
            .try_decode::<f64>()
            .map(Value::from)
            .unwrap_or(Value::Null),
        "INTEGER" | "NUMERIC" => v
            .to_owned()
            .try_decode::<i64>()
            .map(|n| Value::Number(n.into()))
            .unwrap_or(Value::Null),
        "BOOLEAN" => v
            .to_owned()
            .try_decode::<bool>()
            .map(Value::Bool)
            .unwrap_or(Value::Null),
        "BLOB" => v
            .to_owned()
            .try_decode::<Vec<u8>>()
            .map(|bytes| Value::Array(bytes.into_iter().map(|b| Value::Number(b.into())).collect()))
            .unwrap_or(Value::Null),
        "NULL" => Value::Null,
        other => return Err(format!("Unsupported SQLite datatype in a transaction result: {other}")),
    })
}

// ---------- Tauri commands ----------

async fn plugin_pool(app: &AppHandle) -> Result<Pool<Sqlite>, String> {
    let instances = app.state::<DbInstances>();
    let guard = instances.0.read().await;
    if let Some(DbPool::Sqlite(pool)) = guard.get(DB_KEY) {
        Ok(pool.clone())
    } else {
        Err(format!("{TX_NO_DB}: {DB_KEY} is not loaded"))
    }
}

#[tauri::command]
pub async fn db_tx_begin(app: AppHandle, tx: State<'_, TxManager>) -> Result<String, String> {
    let pool = plugin_pool(&app).await?;
    tx.begin(&pool).await
}

#[tauri::command]
pub async fn db_tx_execute(
    tx: State<'_, TxManager>,
    id: String,
    sql: String,
    values: Vec<Value>,
) -> Result<(u64, i64), String> {
    tx.execute(&id, &sql, values).await
}

#[tauri::command]
pub async fn db_tx_select(
    tx: State<'_, TxManager>,
    id: String,
    sql: String,
    values: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    tx.select(&id, &sql, values).await
}

#[tauri::command]
pub async fn db_tx_commit(tx: State<'_, TxManager>, id: String) -> Result<(), String> {
    tx.commit(&id).await
}

#[tauri::command]
pub async fn db_tx_rollback(tx: State<'_, TxManager>, id: String) -> Result<(), String> {
    tx.rollback(&id).await
}

/// The idle watchdog (REQ-1.3). Spawned once from `setup`.
pub fn spawn_watchdog(handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(WATCHDOG_INTERVAL);
        loop {
            ticker.tick().await;
            if let Some(id) = handle.state::<TxManager>().reap_idle(IDLE_TIMEOUT).await {
                log::warn!(
                    "[db] transaction {id} issued nothing for more than {}s; rolled back and released",
                    IDLE_TIMEOUT.as_secs()
                );
            }
        }
    });
}
