use crate::credentials;
use crate::providers::AiProvider;
use anyhow::Result;
use slint::ComponentHandle;

slint::slint! {
    import { Button, LineEdit, ComboBox, VerticalBox, HorizontalBox } from "std-widgets.slint";
    export component MainWindow inherits Window {
        title: "JARVIS AI";
        width: 560px;
        height: 500px;
        in-out property <string> status: "Ready. Enter an API key and save.";
        in-out property <[string]> model-options: [];
        in-out property <int> model-index: 0;
        callback save_nvidia(string);
        callback save_gemini(string);
        callback test_nvidia();
        callback category-changed(int);
        callback save-route(int, int);
        VerticalBox {
            padding: 16px;
            spacing: 10px;
            HorizontalBox {
                Image { source: @image-url("../assets/jarvis.svg"); width: 96px; height: 96px; }
                VerticalBox {
                    Text { text: "JARVIS AI"; font-size: 24px; }
                    Text { text: "Rust-native Windows assistant"; }
                    Text { text: "Secrets are stored in Windows Credential Manager."; }
                }
            }
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
            Text { text: "AI model routing (NVIDIA)"; font-size: 16px; }
            HorizontalBox {
                Text { text: "Task"; width: 130px; }
                category-box := ComboBox {
                    model: ["Coding", "Editing", "Reasoning & Chat", "Vision & Docs", "Speech & Audio", "Privacy & Embeddings"];
                    changed current-index => { root.category-changed(self.current-index); }
                }
            }
            HorizontalBox {
                Text { text: "Model"; width: 130px; }
                model-box := ComboBox {
                    model: root.model-options;
                    current-index <=> root.model-index;
                }
            }
            HorizontalBox {
                Button { text: "Save route"; clicked => { root.save-route(category-box.current-index, model-box.current-index); } }
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
                model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning".to_string(),
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

    let weak = ui.as_weak();
    ui.on_category_changed(move |idx| {
        let models = models_for_category(idx as usize);
        let opts: Vec<slint::SharedString> = models.into_iter().map(Into::into).collect();
        if let Some(ui) = weak.upgrade() {
            ui.set_model_options(slint::ModelRc::from(opts.as_slice()));
            ui.set_model_index(0);
        }
    });

    let weak = ui.as_weak();
    ui.on_save_route(move |cat_idx, model_idx| {
        let models = models_for_category(cat_idx as usize);
        let Some(model) = models.get(model_idx as usize).cloned() else {
            if let Some(ui) = weak.upgrade() {
                ui.set_status("Invalid model selection.".into());
            }
            return;
        };
        let category = category_name(cat_idx as usize);
        let key = format!("route.{}", category);
        let msg = match crate::storage::Storage::open() {
            Ok(storage) => match storage.set_setting(&key, &model) {
                Ok(()) => format!("Saved {} -> {}", category, model),
                Err(e) => format!("Save failed: {e:#}"),
            },
            Err(e) => format!("Storage open failed: {e:#}"),
        };
        if let Some(ui) = weak.upgrade() {
            ui.set_status(msg.into());
        }
    });

    // Initialize model options for the first category.
    if let Some(ui) = ui.as_weak().upgrade() {
        let models = models_for_category(0);
        let opts: Vec<slint::SharedString> = models.into_iter().map(Into::into).collect();
        ui.set_model_options(slint::ModelRc::from(opts.as_slice()));
    }

    ui.run()?;
    Ok(())
}

fn category_name(idx: usize) -> &'static str {
    match idx {
        0 => "coding",
        1 => "editing",
        2 => "reasoning",
        3 => "vision",
        4 => "speech",
        5 => "privacy",
        _ => "coding",
    }
}

fn models_for_category(idx: usize) -> Vec<String> {
    match idx {
        0 => vec![
            "moonshotai/kimi-k3.1-pro",
            "qwen/qwen3-coder-480b",
            "nvidia/nemotron-3-ultra-550b-a55b",
            "deepseek-ai/deepseek-v4-pro",
            "deepseek-ai/deepseek-v4.1-flash",
            "mistralai/codestral-22b-instruct-v0.1",
            "meta/codellama-70b",
            "google/codegemma-1.1-7b",
            "ibm/granite-34b-code-instruct",
        ],
        1 => vec![
            "mistralai/mistral-large-4-1t-a52b",
            "mistralai/mistral-medium-3.5-128b",
            "z-ai/glm-5.2",
            "qwen/qwen-image-edit",
            "qwen/qwen-image",
            "google/gemma-3-12b-it",
            "nvidia/nemotron-3.5-lightning-30b-a3b",
        ],
        2 => vec![
            "minimaxai/minimax-m3.1-flash",
            "openai/gpt-oss-120b",
            "meta/llama-4-maverick",
            "microsoft/phi-4-multimodal-instruct",
            "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        ],
        3 => vec![
            "nvidia/nemotron-3.5-super-vl-120b-a12b",
            "nvidia/nemotron-3.5-parse",
            "google/paligemma",
        ],
        4 => vec![
            "nvidia/nemotron-transcribe",
            "nvidia/parakeet-tdt-0.6b",
        ],
        5 => vec![
            "fastino/gliner2-pii",
            "nvidia/nemotron-3.5-embed-8b",
        ],
        _ => vec!["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"],
    }
    .into_iter()
    .map(String::from)
    .collect()
}
