#![windows_subsystem = "windows"]

mod app;
mod config;
mod credentials;
mod logging;
mod paths;
mod providers;
mod storage;

use app::run;

fn main() {
    if let Err(err) = logging::init() {
        eprintln!("JARVIS logging init failed: {err:#}");
    }
    tracing::info!("JARVIS starting");

    if let Err(err) = run() {
        tracing::error!("JARVIS failed to start: {err:#}");
        eprintln!("JARVIS failed to start: {err:#}");
        std::process::exit(1);
    }
}
