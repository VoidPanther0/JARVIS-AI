use anyhow::{Context, Result};
use std::fs::OpenOptions;

use crate::paths;

pub fn init() -> Result<()> {
    let paths = paths::ensure_data_dirs()?;
    let log_path = paths.logs.join("jarvis.log");
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .context("open log file")?;

    tracing_subscriber::fmt()
        .with_ansi(false)
        .with_target(true)
        .with_writer(move || file.try_clone().expect("clone log file"))
        .init();
    Ok(())
}
