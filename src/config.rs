use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::paths;

pub const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub version: u32,
    pub general: GeneralConfig,
    pub ai: AiConfig,
    pub nvidia: NvidiaConfig,
    pub models: ModelsConfig,
    pub voice: VoiceConfig,
    pub language: LanguageConfig,
    pub animation: AnimationConfig,
    pub startup: StartupConfig,
    pub logging: LoggingConfig,
    pub plugins: PluginsConfig,
    pub storage: StorageConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            general: GeneralConfig::default(),
            ai: AiConfig::default(),
            nvidia: NvidiaConfig::default(),
            models: ModelsConfig::default(),
            voice: VoiceConfig::default(),
            language: LanguageConfig::default(),
            animation: AnimationConfig::default(),
            startup: StartupConfig::default(),
            logging: LoggingConfig::default(),
            plugins: PluginsConfig::default(),
            storage: StorageConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GeneralConfig {
    pub app_name: String,
    pub theme: String,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            app_name: "JARVIS".to_string(),
            theme: "dark".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AiConfig {
    pub provider: String,
    pub model: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: "nvidia".to_string(),
            model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct NvidiaConfig {
    pub base_url: String,
    pub default_model: String,
}

impl Default for NvidiaConfig {
    fn default() -> Self {
        Self {
            base_url: "https://integrate.api.nvidia.com/v1".to_string(),
            default_model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ModelsConfig {
    pub routes: std::collections::BTreeMap<String, String>,
}

impl Default for ModelsConfig {
    fn default() -> Self {
        Self {
            routes: std::collections::BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct VoiceConfig {
    pub enabled: bool,
    pub tts_enabled: bool,
    pub stt_enabled: bool,
    pub voice: String,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            tts_enabled: false,
            stt_enabled: false,
            voice: "default".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LanguageConfig {
    pub ui_language: String,
    pub speech_language: String,
}

impl Default for LanguageConfig {
    fn default() -> Self {
        Self {
            ui_language: "en-US".to_string(),
            speech_language: "en-US".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AnimationConfig {
    pub enabled: bool,
    pub reduced_motion: bool,
    pub speed: f32,
}

impl Default for AnimationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            reduced_motion: false,
            speed: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct StartupConfig {
    pub launch_on_startup: bool,
    pub start_minimized: bool,
}

impl Default for StartupConfig {
    fn default() -> Self {
        Self {
            launch_on_startup: false,
            start_minimized: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LoggingConfig {
    pub level: String,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: "info".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PluginsConfig {
    pub enabled: Vec<String>,
}

impl Default for PluginsConfig {
    fn default() -> Self {
        Self {
            enabled: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct StorageConfig {
    pub data_dir: Option<PathBuf>,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self { data_dir: None }
    }
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if self.general.app_name.trim().is_empty() {
            return Err("general.app_name must not be empty".to_string());
        }
        if !matches!(self.general.theme.as_str(), "dark" | "light" | "system") {
            return Err("general.theme must be dark, light, or system".to_string());
        }
        if self.ai.provider.trim().is_empty() {
            return Err("ai.provider must not be empty".to_string());
        }
        if !matches!(
            self.logging.level.as_str(),
            "error" | "warn" | "info" | "debug" | "trace"
        ) {
            return Err("logging.level must be error, warn, info, debug, or trace".to_string());
        }
        if !self.animation.speed.is_finite()
            || self.animation.speed <= 0.0
            || self.animation.speed > 4.0
        {
            return Err("animation.speed must be between 0 and 4".to_string());
        }
        if self.language.ui_language.trim().is_empty() {
            return Err("language.ui_language must not be empty".to_string());
        }
        Ok(())
    }

    pub fn to_toml(&self) -> Result<String> {
        toml::to_string_pretty(self).context("serialize config to TOML")
    }

    pub fn from_toml(s: &str) -> Result<Self> {
        toml::from_str(s).context("parse config TOML")
    }
}

pub fn load_or_create() -> Result<Config> {
    let paths = paths::ensure_data_dirs()?;
    if !paths.config.exists() {
        let cfg = Config::default();
        save(&paths.config, &cfg)?;
        return Ok(cfg);
    }

    let raw = fs::read_to_string(&paths.config).context("read config.toml")?;
    let parsed = match Config::from_toml(&raw) {
        Ok(cfg) => cfg,
        Err(err) => {
            let backup = paths::backup_path(&paths.backups, "config-corrupt");
            let _ = fs::copy(&paths.config, &backup);
            tracing::warn!("config parse failed ({err:#}); restored defaults");
            let cfg = Config::default();
            save(&paths.config, &cfg)?;
            return Ok(cfg);
        }
    };

    let mut cfg = parsed;
    if cfg.version < CONFIG_VERSION {
        let backup = paths::backup_path(&paths.backups, "config-pre-migration");
        let _ = fs::copy(&paths.config, &backup);
        cfg.version = CONFIG_VERSION;
    }

    if let Err(err) = cfg.validate() {
        let backup = paths::backup_path(&paths.backups, "config-invalid");
        let _ = fs::copy(&paths.config, &backup);
        tracing::warn!("config validation failed ({err}); restored defaults");
        let cfg = Config::default();
        save(&paths.config, &cfg)?;
        return Ok(cfg);
    }

    // Persist any migration/normalization.
    save(&paths.config, &cfg)?;
    Ok(cfg)
}

pub fn save(path: &Path, cfg: &Config) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).context("create config parent")?;
    }
    let tmp = path.with_extension("toml.tmp");
    fs::write(&tmp, cfg.to_toml()?).context("write temp config")?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp, path).context("commit config")?;
    Ok(())
}

pub fn save_default(cfg: &Config) -> Result<()> {
    let paths = paths::default_paths()?;
    save(&paths.config, cfg)
}

pub fn backup_config() -> Result<PathBuf> {
    let paths = paths::ensure_data_dirs()?;
    let backup = paths::backup_path(&paths.backups, "config");
    fs::copy(&paths.config, &backup).context("backup config")?;
    Ok(backup)
}

pub fn restore_latest_backup() -> Result<Config> {
    let paths = paths::ensure_data_dirs()?;
    let mut entries: Vec<_> = fs::read_dir(&paths.backups)
        .context("read backups")?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name().to_string_lossy().starts_with("config")
                && e.file_name().to_string_lossy().ends_with(".bak")
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());
    let latest = entries.last().context("no config backup found")?;
    let raw = fs::read_to_string(latest.path()).context("read backup")?;
    let cfg = Config::from_toml(&raw)?;
    cfg.validate().map_err(|e| anyhow::anyhow!(e))?;
    save(&paths.config, &cfg)?;
    Ok(cfg)
}

pub fn export_config(dest: &Path) -> Result<()> {
    let paths = paths::default_paths()?;
    fs::copy(&paths.config, dest).context("export config")?;
    Ok(())
}

pub fn import_config(src: &Path) -> Result<Config> {
    let raw = fs::read_to_string(src).context("read imported config")?;
    let cfg = Config::from_toml(&raw)?;
    cfg.validate().map_err(|e| anyhow::anyhow!(e))?;
    let paths = paths::ensure_data_dirs()?;
    let backup = paths::backup_path(&paths.backups, "config-pre-import");
    if paths.config.exists() {
        let _ = fs::copy(&paths.config, &backup);
    }
    save(&paths.config, &cfg)?;
    Ok(cfg)
}

pub fn reset_config() -> Result<Config> {
    let paths = paths::ensure_data_dirs()?;
    if paths.config.exists() {
        let backup = paths::backup_path(&paths.backups, "config-pre-reset");
        let _ = fs::copy(&paths.config, &backup);
    }
    let cfg = Config::default();
    save(&paths.config, &cfg)?;
    Ok(cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_validates() {
        Config::default().validate().unwrap();
    }

    #[test]
    fn toml_roundtrip() {
        let cfg = Config::default();
        let s = cfg.to_toml().unwrap();
        let parsed = Config::from_toml(&s).unwrap();
        assert_eq!(parsed.version, CONFIG_VERSION);
        assert_eq!(parsed.animation.speed, 1.0);
    }
}
