use serde::Serialize;

/// Honest snapshot of the running application. No fabricated connectivity.
#[derive(Serialize)]
pub struct SystemStatus {
    pub app_name: String,
    pub app_version: String,
    pub platform: String,
    pub backend_status: String,
}

#[tauri::command]
fn get_system_status() -> SystemStatus {
    SystemStatus {
        app_name: "JARVIS".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        backend_status: "operational".to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_system_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
