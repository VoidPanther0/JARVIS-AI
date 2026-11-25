use crate::credentials;
use crate::providers::AiProvider;
use anyhow::Result;
use slint::ComponentHandle;

slint::slint! {
    import { Button, LineEdit, VerticalBox, HorizontalBox } from "std-widgets.slint";
    export component MainWindow inherits Window {
        title: "JARVIS AI";
        width: 560px;
        height: 420px;
        in-out property <string> status: "Ready. Enter an API key and save.";
        callback save_nvidia(string);
        callback save_gemini(string);
        callback test_nvidia();
        VerticalBox {
            padding: 16px;
            spacing: 10px;
            Text { text: "JARVIS AI"; font-size: 24px; }
            Text { text: "Rust-native Windows assistant. Secrets live in Windows Credential Manager."; }
            HorizontalBox {
                Text { text: "NVIDIA API key"; width: 130px; }
                nvidia := LineEdit { placeholder-text: "nvapi-..."; }
            }
            HorizontalBox {
                Button { text: "Save NVIDIA key"; clicked => { root.save_nvidia(nvidia.text); } }
                Button { text: "Test NVIDIA"; clicked => { root.test_nvidia(); } }
            }
            HorizontalBox {
                Text { text: "Gemini API key"; width: 130px; }
                gemini := LineEdit { placeholder-text: "AIza..."; }
            }
            HorizontalBox {
                Button { text: "Save Gemini key"; clicked => { root.save_gemini(gemini.text); } }
            }
            Text { text: status; wrap: word-wrap; }
        }
    }
}

pub fn run() -> Result<()> {
    let ui = MainWindow::new()?;
    let weak = ui.as_weak();

    ui.on_save_nvidia(move |key| {
        let weak = weak.clone();
        let key = key.to_string();
        std::thread::spawn(move || {
            let res = credentials::set_api_key("nvidia", &key);
            let msg = match res {
                Ok(()) => "NVIDIA API key saved to Windows Credential Manager.".to_string(),
                Err(e) => format!("Failed to save NVIDIA key: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    let weak = ui.as_weak();
    ui.on_save_gemini(move |key| {
        let weak = weak.clone();
        let key = key.to_string();
        std::thread::spawn(move || {
            let res = credentials::set_api_key("gemini", &key);
            let msg = match res {
                Ok(()) => "Gemini API key saved to Windows Credential Manager.".to_string(),
                Err(e) => format!("Failed to save Gemini key: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    let weak = ui.as_weak();
    ui.on_test_nvidia(move || {
        let weak = weak.clone();
        std::thread::spawn(move || {
            let key = match credentials::get_api_key("nvidia") {
                Ok(Some(k)) => k,
                Ok(None) => {
                    if let Some(ui) = weak.upgrade() {
                        ui.set_status("No NVIDIA key stored.".into());
                    }
                    return;
                }
                Err(e) => {
                    if let Some(ui) = weak.upgrade() {
                        ui.set_status(format!("Credential read failed: {e:#}").into());
                    }
                    return;
                }
            };
            let provider = crate::providers::NvidiaProvider {
                api_key: key,
                model: "meta/llama-3.1-8b-instruct".to_string(),
                base_url: "https://integrate.api.nvidia.com/v1".to_string(),
            };
            let msg = match provider.chat("You are JARVIS.", "Reply with: ready") {
                Ok(text) => format!("NVIDIA OK: {}", text.trim()),
                Err(e) => format!("NVIDIA test failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    ui.run()?;
    Ok(())
}
