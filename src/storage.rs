use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use std::path::PathBuf;

use crate::paths;

pub struct Storage {
    conn: Connection,
    db_path: PathBuf,
}

impl Storage {
    pub fn open() -> Result<Self> {
        let paths = paths::ensure_data_dirs()?;
        migrate_legacy_data(&paths)?;
        let path = paths.database;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).context("create memory dir")?;
        }
        let conn = Connection::open(&path).context("open sqlite")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL
            );",
        )
        .context("init schema")?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap_or(0);
        if count == 0 {
            conn.execute("INSERT INTO schema_version(version) VALUES (1)", [])
                .context("set schema version")?;
        }
        Ok(Self {
            conn,
            db_path: path,
        })
    }

    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO settings(key,value) VALUES(?1,?2)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, value],
            )
            .context("set setting")?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = ?1")
            .context("prepare")?;
        let mut rows = stmt.query(params![key]).context("query")?;
        if let Some(row) = rows.next().context("next")? {
            Ok(Some(row.get(0).context("get")?))
        } else {
            Ok(None)
        }
    }

    #[allow(dead_code)]
    pub fn insert_memory(&self, category: &str, key: &str, value: &str) -> Result<i64> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "0".to_string());
        self.conn
            .execute(
                "INSERT INTO memory(category,key,value,created_at) VALUES(?1,?2,?3,?4)",
                params![category, key, value, now],
            )
            .context("insert memory")?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn memory_count(&self) -> Result<i64> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM memory", [], |r| r.get(0))
            .context("count memory")?)
    }
}

fn migrate_legacy_data(paths: &paths::DataPaths) -> Result<()> {
    // Preserve any data from the old "%LOCALAPPDATA%\JARVIS AI" directory by copying
    // the SQLite database if the new location does not yet have one.
    if paths.database.exists() {
        return Ok(());
    }
    let legacy = paths::local_app_data()?.join("JARVIS AI").join("jarvis.db");
    if legacy.exists() {
        if let Some(parent) = paths.database.parent() {
            std::fs::create_dir_all(parent).context("create new memory dir")?;
        }
        std::fs::copy(&legacy, &paths.database).context("migrate legacy database")?;
    }
    Ok(())
}
