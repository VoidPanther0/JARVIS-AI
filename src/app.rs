use crate::config;
use crate::credentials;
use crate::paths;
use crate::providers::AiProvider;
use crate::storage::Storage;
use anyhow::Result;
use slint::ComponentHandle;
use std::sync::{Arc, Mutex};
use std::time::Duration;

slint::slint! {
    import { Button, LineEdit, ComboBox, CheckBox, Slider, TabWidget, VerticalBox, HorizontalBox } from "std-widgets.slint";
    export component MainWindow inherits Window {
        title: "JARVIS AI";
        width: 920px;
        height: 680px;

        in-out property <string> status: "Ready.";
        in-out property <[string]> model-options: [];
        in-out property <int> model-index: 0;
        in-out property <int> animation-state: 0;
        in-out property <float> reactor-angle: 0;
        in-out property <bool> reduced-motion: false;
        in-out property <float> animation-speed: 1.0;
        in-out property <[float]> waveform: [4,4,4,4,4,4,4,4,4,4,4,4];
        in-out property <string> diagnostics: "";
        in-out property <string> db-path: "";

        in-out property <string> provider-name: "nvidia";
        in-out property <string> ai-model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
        in-out property <string> nvidia-base-url: "https://integrate.api.nvidia.com/v1";
        in-out property <string> nvidia-default-model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
        in-out property <string> theme-name: "dark";
        in-out property <string> ui-language: "en-US";
        in-out property <string> voice-name: "default";
        in-out property <bool> voice-enabled: false;
        in-out property <bool> tts-enabled: false;
        in-out property <bool> stt-enabled: false;
        in-out property <string> app-name: "JARVIS";
        in-out property <string> plugin-name: "";

        callback save-nvidia(string);
        callback save-gemini(string);
        callback test-nvidia();
        callback category-changed(int);
        callback save-route(int, int);
        callback save-ai(string, string);
        callback save-nvidia-config(string, string);
        callback save-appearance(string, bool, float);
        callback save-voice(string, bool, bool, bool, string);
        callback save-general(string, string);
        callback run-diagnostics();
        callback open-data-folder();
        callback open-config-file();
        callback open-logs-folder();
        callback open-plugins-folder();
        callback open-memory-folder();
        callback export-config();
        callback import-config();
        callback create-backup();
        callback restore-backup();
        callback reset-config();
        callback refresh-memory();

        HorizontalBox {
            padding: 12px;
            spacing: 12px;

            // Left: animated reactor
            VerticalBox {
                width: 260px;
                spacing: 8px;
                alignment: center;

                Rectangle {
                    width: 230px;
                    height: 230px;
                    border-radius: 115px;
                    background: #050b18;
                    border-width: 1px;
                    border-color: #0a2a4a;

                    // Outer rotating ring
                    Image {
                        x: 15px; y: 15px;
                        width: 200px; height: 200px;
                        source: @image-url("../assets/jarvis.svg");
                        transform-rotation: root.reactor-angle * 1deg;
                        opacity: 0.9;
                    }
                    // Middle rotating ring
                    Image {
                        x: 45px; y: 45px;
                        width: 140px; height: 140px;
                        source: @image-url("../assets/jarvis.svg");
                        transform-rotation: (root.reactor-angle * -1.7) * 1deg;
                        opacity: 0.6;
                    }
                    // Inner core
                    Rectangle {
                        x: 80px; y: 80px;
                        width: 70px; height: 70px;
                        border-radius: 35px;
                        background: #00e5ff33;
                        border-width: 2px;
                        border-color: #00e5ff;
                    }
                    // Particles
                    for i in 16 : Rectangle {
                        x: 115px + 95px * cos(i * 22.5 * 1deg) - 3px;
                        y: 115px + 95px * sin(i * 22.5 * 1deg) - 3px;
                        width: 6px; height: 6px;
                        border-radius: 3px;
                        background: #00e5ff;
                        opacity: 0.5;
                    }
                }

                // Waveform
                HorizontalBox {
                    spacing: 3px;
                    alignment: center;
                    for h in root.waveform : Rectangle {
                        width: 6px;
                        height: h * 1px;
                        border-radius: 3px;
                        background: #00e5ff;
                    }
                }

                Text { text: "JARVIS"; font-size: 20px; horizontal-alignment: center; }
                Text { text: "state: " + root.animation-state; horizontal-alignment: center; }
            }

            // Right: settings
            VerticalBox {
                spacing: 8px;
                Text { text: "Settings"; font-size: 18px; }

                TabWidget {
                    Tab {
                        title: "General";
                        VerticalBox {
                            spacing: 8px;
                            HorizontalBox {
                                Text { text: "App name"; width: 140px; }
                                LineEdit { text <=> root.app-name; }
                            }
                            HorizontalBox {
                                Text { text: "UI language"; width: 140px; }
                                LineEdit { text <=> root.ui-language; }
                            }
                            HorizontalBox {
                                Text { text: "Theme"; width: 140px; }
                                ComboBox {
                                    model: ["dark", "light", "system"];
                                    current-value <=> root.theme-name;
                                }
                            }
                            Button { text: "Save general"; clicked => { root.save-general(root.app-name, root.ui-language); } }
                        }
                    }
                    Tab {
                        title: "AI Provider";
                        VerticalBox {
                            spacing: 8px;
                            HorizontalBox {
                                Text { text: "Provider"; width: 140px; }
                                ComboBox {
                                    model: ["nvidia", "gemini", "openai-compatible"];
                                    current-value <=> root.provider-name;
                                }
                            }
                            HorizontalBox {
                                Text { text: "Model"; width: 140px; }
                                LineEdit { text <=> root.ai-model; }
                            }
                            Button { text: "Save AI"; clicked => { root.save-ai(root.provider-name, root.ai-model); } }
                        }
                    }
                    Tab {
                        title: "NVIDIA API";
                        VerticalBox {
                            spacing: 8px;
                            HorizontalBox {
                                Text { text: "API key"; width: 140px; }
                                nvidia-key := LineEdit { placeholder-text: "nvapi-..."; }
                            }
                            HorizontalBox {
                                Button { text: "Save NVIDIA key"; clicked => { root.save-nvidia(nvidia-key.text); } }
                                Button { text: "Test NVIDIA"; clicked => { root.test-nvidia(); } }
                            }
                            HorizontalBox {
                                Text { text: "Base URL"; width: 140px; }
                                LineEdit { text <=> root.nvidia-base-url; }
                            }
                            HorizontalBox {
                                Text { text: "Default model"; width: 140px; }
                                LineEdit { text <=> root.nvidia-default-model; }
                            }
                            Button { text: "Save NVIDIA config"; clicked => { root.save-nvidia-config(root.nvidia-base-url, root.nvidia-default-model); } }
                        }
                    }
                    Tab {
                        title: "Models";
                        VerticalBox {
                            spacing: 8px;
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
                            Button { text: "Save route"; clicked => { root.save-route(category-box.current-index, model-box.current-index); } }
                        }
                    }
                    Tab {
                        title: "Voice";
                        VerticalBox {
                            spacing: 8px;
                            CheckBox { text: "Voice enabled"; checked <=> root.voice-enabled; toggled => { } }
                            CheckBox { text: "TTS enabled"; checked <=> root.tts-enabled; toggled => { } }
                            CheckBox { text: "STT enabled"; checked <=> root.stt-enabled; toggled => { } }
                            HorizontalBox {
                                Text { text: "Voice"; width: 140px; }
                                LineEdit { text <=> root.voice-name; }
                            }
                            Button { text: "Save voice"; clicked => { root.save-voice(root.voice-name, root.voice-enabled, root.tts-enabled, root.stt-enabled, root.ui-language); } }
                        }
                    }
                    Tab {
                        title: "Memory";
                        VerticalBox {
                            spacing: 8px;
                            Text { text: "Database:"; }
                            Text { text: root.db-path; wrap: word-wrap; }
                            Button { text: "Refresh count"; clicked => { root.refresh-memory(); } }
                            Button { text: "Open memory folder"; clicked => { root.open-memory-folder(); } }
                        }
                    }
                    Tab {
                        title: "Appearance";
                        VerticalBox {
                            spacing: 8px;
                            CheckBox { text: "Reduced motion"; checked <=> root.reduced-motion; toggled => { root.save-appearance(root.theme-name, root.reduced-motion, root.animation-speed); } }
                            HorizontalBox {
                                Text { text: "Animation speed"; width: 140px; }
                                Slider { minimum: 0.25; maximum: 4.0; value <=> root.animation-speed; changed => { root.save-appearance(root.theme-name, root.reduced-motion, root.animation-speed); } }
                            }
                            Button { text: "Save appearance"; clicked => { root.save-appearance(root.theme-name, root.reduced-motion, root.animation-speed); } }
                        }
                    }
                    Tab {
                        title: "Animation";
                        VerticalBox {
                            spacing: 8px;
                            Text { text: "States: 0 idle, 1 listening, 2 thinking, 3 speaking, 4 error"; wrap: word-wrap; }
                            CheckBox { text: "Reduced motion"; checked <=> root.reduced-motion; }
                        }
                    }
                    Tab {
                        title: "Plugins";
                        VerticalBox {
                            spacing: 8px;
                            HorizontalBox {
                                Text { text: "Plugin name"; width: 140px; }
                                LineEdit { text <=> root.plugin-name; }
                            }
                            Button { text: "Open plugins folder"; clicked => { root.open-plugins-folder(); } }
                        }
                    }
                    Tab {
                        title: "Storage";
                        VerticalBox {
                            spacing: 8px;
                            Button { text: "Open .jarvis Folder"; clicked => { root.open-data-folder(); } }
                            Button { text: "Open Configuration File"; clicked => { root.open-config-file(); } }
                            Button { text: "Open Logs Folder"; clicked => { root.open-logs-folder(); } }
                            Button { text: "Export Configuration"; clicked => { root.export-config(); } }
                            Button { text: "Import Configuration"; clicked => { root.import-config(); } }
                            Button { text: "Create Backup"; clicked => { root.create-backup(); } }
                            Button { text: "Restore Backup"; clicked => { root.restore-backup(); } }
                            Button { text: "Reset Configuration"; clicked => { root.reset-config(); } }
                        }
                    }
                    Tab {
                        title: "Diagnostics";
                        VerticalBox {
                            spacing: 8px;
                            Button { text: "Run diagnostics"; clicked => { root.run-diagnostics(); } }
                            Text { text: root.diagnostics; wrap: word-wrap; }
                        }
                    }
                }

                Text { text: root.status; wrap: word-wrap; }
            }
        }
    }
}

pub fn run() -> Result<()> {
    let cfg = config::load_or_create().unwrap_or_default();
    let _paths = paths::ensure_data_dirs().unwrap_or_else(|_| paths::default_paths().unwrap());
    let storage = Storage::open().ok();
    let config_state = Arc::new(Mutex::new(cfg.clone()));

    let ui = MainWindow::new()?;
    let weak = ui.as_weak();

    // Initialize properties from config.
    if let Some(ui) = weak.upgrade() {
        ui.set_status("Ready.".into());
        ui.set_reduced_motion(cfg.animation.reduced_motion);
        ui.set_animation_speed(cfg.animation.speed);
        ui.set_app_name(cfg.general.app_name.clone().into());
        ui.set_theme_name(cfg.general.theme.clone().into());
        ui.set_provider_name(cfg.ai.provider.clone().into());
        ui.set_ai_model(cfg.ai.model.clone().into());
        ui.set_nvidia_base_url(cfg.nvidia.base_url.clone().into());
        ui.set_nvidia_default_model(cfg.nvidia.default_model.clone().into());
        ui.set_ui_language(cfg.language.ui_language.clone().into());
        ui.set_voice_name(cfg.voice.voice.clone().into());
        ui.set_voice_enabled(cfg.voice.enabled);
        ui.set_tts_enabled(cfg.voice.tts_enabled);
        ui.set_stt_enabled(cfg.voice.stt_enabled);
        if let Some(s) = storage.as_ref() {
            ui.set_db_path(s.db_path().display().to_string().into());
        }
        let models = models_for_category(0);
        let opts: Vec<slint::SharedString> = models.into_iter().map(Into::into).collect();
        ui.set_model_options(slint::ModelRc::from(opts.as_slice()));
    }

    // Helper macro-like closures
    let weak_cb = weak.clone();
    ui.on_save_nvidia(move |key| {
        let weak = weak_cb.clone();
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

    let weak_cb = weak.clone();
    ui.on_save_gemini(move |key| {
        let weak = weak_cb.clone();
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

    let weak_cb = weak.clone();
    let config_state_cb = std::sync::Arc::clone(&config_state);
    ui.on_test_nvidia(move || {
        let weak = weak_cb.clone();
        let config_state = std::sync::Arc::clone(&config_state_cb);
        if let Some(ui) = weak.upgrade() {
            ui.set_animation_state(2);
            ui.set_status("Testing NVIDIA...".into());
        }
        std::thread::spawn(move || {
            let key = match credentials::get_api_key("nvidia") {
                Ok(Some(k)) => k,
                Ok(None) => {
                    if let Some(ui) = weak.upgrade() {
                        ui.set_animation_state(4);
                        ui.set_status("No NVIDIA key stored.".into());
                    }
                    return;
                }
                Err(e) => {
                    if let Some(ui) = weak.upgrade() {
                        ui.set_animation_state(4);
                        ui.set_status(format!("Credential read failed: {e:#}").into());
                    }
                    return;
                }
            };
            let (model, base_url) = {
                let c = config_state.lock().unwrap();
                (c.nvidia.default_model.clone(), c.nvidia.base_url.clone())
            };
            let provider = crate::providers::NvidiaProvider {
                api_key: key,
                model,
                base_url,
            };
            let msg = match provider.chat("You are JARVIS.", "Reply with: ready") {
                Ok(text) => {
                    if let Some(ui) = weak.upgrade() {
                        ui.set_animation_state(3);
                    }
                    format!("NVIDIA OK: {}", text.trim())
                }
                Err(e) => {
                    if let Some(ui) = weak.upgrade() {
                        ui.set_animation_state(4);
                    }
                    format!("NVIDIA test failed: {e:#}")
                }
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
            // Return to idle after a short delay by setting state 0 on next frame is omitted;
            // leave speaking state; timer could reset. We'll reset to idle immediately for honesty.
            if let Some(ui) = weak.upgrade() {
                ui.set_animation_state(0);
            }
        });
    });

    let weak_cb = weak.clone();
    ui.on_category_changed(move |idx| {
        let models = models_for_category(idx as usize);
        let opts: Vec<slint::SharedString> = models.into_iter().map(Into::into).collect();
        if let Some(ui) = weak_cb.upgrade() {
            ui.set_model_options(slint::ModelRc::from(opts.as_slice()));
            ui.set_model_index(0);
        }
    });

    let weak_cb = weak.clone();
    ui.on_save_route(move |cat_idx, model_idx| {
        let weak = weak_cb.clone();
        let models = models_for_category(cat_idx as usize);
        let Some(model) = models.get(model_idx as usize).cloned() else {
            if let Some(ui) = weak.upgrade() {
                ui.set_status("Invalid model selection.".into());
            }
            return;
        };
        let category = category_name(cat_idx as usize);
        let key = format!("route.{}", category);
        let msg = match Storage::open() {
            Ok(storage) => match storage.set_setting(&key, &model) {
                Ok(()) => {
                    // Persist to config too.
                    if let Ok(mut cfg) = config::load_or_create() {
                        cfg.models
                            .routes
                            .insert(category.to_string(), model.clone());
                        let _ = config::save_default(&cfg);
                    }
                    format!("Saved {} -> {}", category, model)
                }
                Err(e) => format!("Save failed: {e:#}"),
            },
            Err(e) => format!("Storage open failed: {e:#}"),
        };
        if let Some(ui) = weak.upgrade() {
            ui.set_status(msg.into());
        }
    });

    // Config-backed settings callbacks.
    let config_state_cb = std::sync::Arc::clone(&config_state);
    let weak_cb = weak.clone();
    ui.on_save_ai(move |provider, model| {
        let weak = weak_cb.clone();
        let config_state = std::sync::Arc::clone(&config_state_cb);
        let provider = provider.to_string();
        let model = model.to_string();
        std::thread::spawn(move || {
            let mut cfg = config_state.lock().unwrap();
            cfg.ai.provider = provider.clone();
            cfg.ai.model = model.clone();
            let res = config::save_default(&cfg);
            drop(cfg);
            let msg = match res {
                Ok(()) => format!("Saved AI provider: {}", provider),
                Err(e) => format!("Save failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    let config_state_cb = std::sync::Arc::clone(&config_state);
    let weak_cb = weak.clone();
    ui.on_save_nvidia_config(move |base_url, default_model| {
        let weak = weak_cb.clone();
        let config_state = std::sync::Arc::clone(&config_state_cb);
        let base_url = base_url.to_string();
        let default_model = default_model.to_string();
        std::thread::spawn(move || {
            let mut cfg = config_state.lock().unwrap();
            cfg.nvidia.base_url = base_url.clone();
            cfg.nvidia.default_model = default_model.clone();
            let res = config::save_default(&cfg);
            drop(cfg);
            let msg = match res {
                Ok(()) => "NVIDIA config saved.".to_string(),
                Err(e) => format!("Save failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    let config_state_cb = std::sync::Arc::clone(&config_state);
    let weak_cb = weak.clone();
    ui.on_save_appearance(move |theme, reduced, speed| {
        let weak = weak_cb.clone();
        let config_state = std::sync::Arc::clone(&config_state_cb);
        let theme = theme.to_string();
        std::thread::spawn(move || {
            let mut cfg = config_state.lock().unwrap();
            cfg.general.theme = theme;
            cfg.animation.reduced_motion = reduced;
            cfg.animation.speed = speed;
            let res = config::save_default(&cfg);
            drop(cfg);
            let msg = match res {
                Ok(()) => "Appearance saved.".to_string(),
                Err(e) => format!("Save failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_reduced_motion(reduced);
                ui.set_animation_speed(speed);
                ui.set_status(msg.into());
            }
        });
    });

    let config_state_cb = std::sync::Arc::clone(&config_state);
    let weak_cb = weak.clone();
    ui.on_save_voice(move |voice, enabled, tts, stt, language| {
        let weak = weak_cb.clone();
        let config_state = std::sync::Arc::clone(&config_state_cb);
        let voice = voice.to_string();
        let language = language.to_string();
        std::thread::spawn(move || {
            let mut cfg = config_state.lock().unwrap();
            cfg.voice.voice = voice;
            cfg.voice.enabled = enabled;
            cfg.voice.tts_enabled = tts;
            cfg.voice.stt_enabled = stt;
            cfg.language.speech_language = language;
            let res = config::save_default(&cfg);
            drop(cfg);
            let msg = match res {
                Ok(()) => "Voice settings saved.".to_string(),
                Err(e) => format!("Save failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    let config_state_cb = std::sync::Arc::clone(&config_state);
    let weak_cb = weak.clone();
    ui.on_save_general(move |app_name, ui_language| {
        let weak = weak_cb.clone();
        let config_state = std::sync::Arc::clone(&config_state_cb);
        let app_name = app_name.to_string();
        let ui_language = ui_language.to_string();
        std::thread::spawn(move || {
            let mut cfg = config_state.lock().unwrap();
            cfg.general.app_name = app_name;
            cfg.language.ui_language = ui_language;
            let res = config::save_default(&cfg);
            drop(cfg);
            let msg = match res {
                Ok(()) => "General settings saved.".to_string(),
                Err(e) => format!("Save failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    let weak_cb = weak.clone();
    ui.on_run_diagnostics(move || {
        let weak = weak_cb.clone();
        std::thread::spawn(move || {
            let mut out = String::new();
            match paths::ensure_data_dirs() {
                Ok(p) => out.push_str(&format!("Data dir OK: {}\n", p.root.display())),
                Err(e) => out.push_str(&format!("Data dir ERROR: {e:#}\n")),
            }
            match config::load_or_create() {
                Ok(cfg) => out.push_str(&format!("Config OK (v{})\n", cfg.version)),
                Err(e) => out.push_str(&format!("Config ERROR: {e:#}\n")),
            }
            match Storage::open() {
                Ok(s) => out.push_str(&format!("SQLite OK: {}\n", s.db_path().display())),
                Err(e) => out.push_str(&format!("SQLite ERROR: {e:#}\n")),
            }
            match credentials::get_api_key("nvidia") {
                Ok(Some(_)) => out.push_str("NVIDIA credential: present\n"),
                Ok(None) => out.push_str("NVIDIA credential: not set\n"),
                Err(e) => out.push_str(&format!("NVIDIA credential ERROR: {e:#}\n")),
            }
            let log_path = paths::default_paths()
                .map(|p| p.logs.join("jarvis.log"))
                .ok();
            if let Some(p) = log_path {
                out.push_str(&format!("Log file: {}\n", p.display()));
            }
            if let Some(ui) = weak.upgrade() {
                ui.set_diagnostics(out.into());
                ui.set_status("Diagnostics complete.".into());
            }
        });
    });

    let weak_cb = weak.clone();
    ui.on_open_data_folder(move || {
        open_path(paths::data_root().ok().map(|p| p.display().to_string()))
    });
    let weak_cb = weak.clone();
    ui.on_open_config_file(move || {
        if let Ok(p) = paths::default_paths() {
            open_path(Some(p.config.display().to_string()));
        }
    });
    let weak_cb = weak.clone();
    ui.on_open_logs_folder(move || {
        if let Ok(p) = paths::default_paths() {
            open_path(Some(p.logs.display().to_string()));
        }
    });
    let weak_cb = weak.clone();
    ui.on_open_plugins_folder(move || {
        if let Ok(p) = paths::default_paths() {
            open_path(Some(p.plugins.display().to_string()));
        }
    });
    let weak_cb = weak.clone();
    ui.on_open_memory_folder(move || {
        if let Ok(p) = paths::default_paths() {
            open_path(Some(p.memory.display().to_string()));
        }
    });

    let weak_cb = weak.clone();
    ui.on_export_config(move || {
        let weak = weak_cb.clone();
        std::thread::spawn(move || {
            let dest = dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("Desktop")
                .join("jarvis-config.toml");
            let msg = match config::export_config(&dest) {
                Ok(()) => format!("Exported config to {}", dest.display()),
                Err(e) => format!("Export failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    let weak_cb = weak.clone();
    ui.on_import_config(move || {
        let weak = weak_cb.clone();
        std::thread::spawn(move || {
            let src = dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("Desktop")
                .join("jarvis-config.toml");
            let msg = match config::import_config(&src) {
                Ok(_) => format!("Imported config from {}", src.display()),
                Err(e) => format!("Import failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    let weak_cb = weak.clone();
    ui.on_create_backup(move || {
        let weak = weak_cb.clone();
        std::thread::spawn(move || {
            let msg = match config::backup_config() {
                Ok(p) => format!("Backup created: {}", p.display()),
                Err(e) => format!("Backup failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    let weak_cb = weak.clone();
    ui.on_restore_backup(move || {
        let weak = weak_cb.clone();
        std::thread::spawn(move || {
            let msg = match config::restore_latest_backup() {
                Ok(_) => "Configuration restored from latest backup.".to_string(),
                Err(e) => format!("Restore failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    let weak_cb = weak.clone();
    ui.on_reset_config(move || {
        let weak = weak_cb.clone();
        std::thread::spawn(move || {
            let msg = match config::reset_config() {
                Ok(_) => "Configuration reset to defaults.".to_string(),
                Err(e) => format!("Reset failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    let weak_cb = weak.clone();
    ui.on_refresh_memory(move || {
        let weak = weak_cb.clone();
        std::thread::spawn(move || {
            let msg = match Storage::open() {
                Ok(s) => match s.memory_count() {
                    Ok(n) => format!("Memory records: {}", n),
                    Err(e) => format!("Count failed: {e:#}"),
                },
                Err(e) => format!("Storage open failed: {e:#}"),
            };
            if let Some(ui) = weak.upgrade() {
                ui.set_status(msg.into());
            }
        });
    });

    // Initialize model options.
    if let Some(ui) = ui.as_weak().upgrade() {
        let models = models_for_category(0);
        let opts: Vec<slint::SharedString> = models.into_iter().map(Into::into).collect();
        ui.set_model_options(slint::ModelRc::from(opts.as_slice()));
    }

    // Animation timer.
    let timer = slint::Timer::default();
    let weak_timer = weak.clone();
    let config_state_timer = config_state.clone();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(33),
        move || {
            let Some(ui) = weak_timer.upgrade() else {
                return;
            };
            if !ui.window().is_visible() {
                return;
            }
            let reduced = ui.get_reduced_motion();
            let speed = ui.get_animation_speed();
            let state = ui.get_animation_state();
            let cfg_speed = config_state_timer
                .lock()
                .map(|c| c.animation.speed)
                .unwrap_or(1.0);
            let effective_speed = if reduced {
                speed * 0.1
            } else {
                speed * cfg_speed
            };

            let base_delta = match state {
                1 => 4.0,
                2 => 9.0,
                3 => 6.0,
                4 => 0.5,
                _ => 1.0,
            } * effective_speed;

            let new_angle = ui.get_reactor_angle() + base_delta;
            ui.set_reactor_angle(new_angle);

            // Waveform update.
            let mut bars = vec![4.0f32; 12];
            if state == 1 || state == 3 {
                for (i, b) in bars.iter_mut().enumerate() {
                    let t = new_angle + i as f32 * 30.0;
                    *b = 4.0 + (t.sin().abs() * 18.0);
                }
            } else if state == 2 {
                for (i, b) in bars.iter_mut().enumerate() {
                    let t = new_angle * 2.0 + i as f32 * 45.0;
                    *b = 6.0 + (t.sin().abs() * 14.0);
                }
            }
            ui.set_waveform(slint::ModelRc::from(bars.as_slice()));
        },
    );

    // Keep timer alive for duration of app by leaking? Timer must persist. Store in a static?
    // slint::Timer stops when dropped. We need keep it alive. Use Box::leak to keep.
    Box::leak(Box::new(timer));

    ui.run()?;
    Ok(())
}

fn open_path(path: Option<String>) {
    if let Some(p) = path {
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("explorer").arg(&p).spawn();
        }
        #[cfg(not(windows))]
        {
            let _ = std::process::Command::new("xdg-open").arg(&p).spawn();
        }
    }
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
        4 => vec!["nvidia/nemotron-transcribe", "nvidia/parakeet-tdt-0.6b"],
        5 => vec!["fastino/gliner2-pii", "nvidia/nemotron-3.5-embed-8b"],
        _ => vec!["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"],
    }
    .into_iter()
    .map(String::from)
    .collect()
}
