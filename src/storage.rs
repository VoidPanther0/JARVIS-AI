use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use std::path::PathBuf;

pub struct Storage {
    conn: Connection,
}

impl Storage {
    pub fn open() -> Result<Self> {
        let base = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("JARVIS AI");
        std::fs::create_dir_all(&base).context("create data dir")?;
        let path = base.join("jarvis.db");
        let conn = Connection::open(path).context("open sqlite")?;
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
            );",
        )
        .context("init schema")?;
        Ok(Self { conn })
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
}
