mod app;
mod credentials;
mod providers;
mod storage;

use app::run;

fn main() {
    tracing_subscriber::fmt().init();

    if let Err(err) = run() {
        eprintln!("JARVIS failed to start: {err:#}");
        std::process::exit(1);
    }
}
