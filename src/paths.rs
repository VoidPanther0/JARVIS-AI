use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

pub const APP_NAME: &str = "JARVIS";
pub const DATA_DIR_NAME: &str = ".jarvis";

#[derive(Debug, Clone)]
pub struct DataPaths {
    pub root: PathBuf,
    pub config: PathBuf,
    pub memory: PathBuf,
    pub database: PathBuf,
    pub logs: PathBuf,
    pub plugins: PathBuf,
    pub cache: PathBuf,
    pub backups: PathBuf,
}

pub fn local_app_data() -> Result<PathBuf> {
    dirs::data_local_dir().context("resolve %LOCALAPPDATA%")
}

pub fn data_root() -> Result<PathBuf> {
    Ok(local_app_data()?.join(DATA_DIR_NAME))
}

pub fn default_paths() -> Result<DataPaths> {
    let root = data_root()?;
    Ok(DataPaths {
        config: root.join("config.toml"),
        memory: root.join("memory"),
        database: root.join("memory").join("jarvis.db"),
        logs: root.join("logs"),
        plugins: root.join("plugins"),
        cache: root.join("cache"),
        backups: root.join("backups"),
        root,
    })
}

pub fn ensure_data_dirs() -> Result<DataPaths> {
    let paths = default_paths()?;
    for dir in [
        &paths.root,
        &paths.memory,
        &paths.logs,
        &paths.plugins,
        &paths.cache,
        &paths.backups,
    ] {
        std::fs::create_dir_all(dir)
            .with_context(|| format!("create directory {}", dir.display()))?;
    }
    Ok(paths)
}

pub fn backup_path(dir: &Path, prefix: &str) -> PathBuf {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    dir.join(format!("{}-{}.bak", prefix, ts))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_root_ends_with_dot_jarvis() {
        let root = data_root().unwrap();
        assert!(root.ends_with(".jarvis"));
    }
}
