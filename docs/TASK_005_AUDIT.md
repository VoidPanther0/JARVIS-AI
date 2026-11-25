# TASK_005 Audit — JARVIS AI

Date: 2026-11-25 (workspace)
Repository: C:\Users\This PC\Desktop\JARVIS AI
Branch: main (clean)

## Existing architecture

- Rust-only Windows desktop application (`#![windows_subsystem = "windows"]`).
- Native UI via Slint 1.16.1 with software rendering (`backend-default`, `renderer-software`).
- No Tauri, WebView2, TypeScript frontend, Python runtime, or Node runtime in the current tree.
- AI provider abstraction in `src/providers.rs` (`AiProvider`, `NvidiaProvider`, `GeminiProvider`).
- Secure credential storage via `keyring` (Windows Credential Manager) in `src/credentials.rs`.
- SQLite storage via `rusqlite` in `src/storage.rs`.
- Configuration currently stored as key/value rows in SQLite (`settings` table), not TOML.
- Installer: Inno Setup (`installer.iss`), installing only `jarvis.exe`.
- CI: `.github/workflows/build-windows.yml` builds release and installer.

## Current working functionality

- `cargo check` passes (warnings only).
- `cargo test` passes: 1 test (`credentials::tests::roundtrip`).
- Slint window builds and runs with API key entry, model routing UI, and NVIDIA test.
- SQLite settings table persists model routes.
- Windows Credential Manager round-trip works on this machine.

## Confirmed errors / issues

1. `cargo fmt --check` fails:
   - `src/app.rs` formatting of model vectors.
   - `src/credentials.rs` long `assert_eq!`.
2. Dead-code warnings:
   - `credentials::delete_api_key`
   - `AiProvider::name`
   - `ProviderKind`
   - `GeminiProvider`
   - `Storage::get_setting`
3. User data location mismatch:
   - Storage uses `%LOCALAPPDATA%\JARVIS AI\jarvis.db`, not the requested `%LOCALAPPDATA%\.jarvis\`.
   - No `.jarvis/config.toml`, `logs`, `plugins`, `cache`, or `backups` directories.
4. No typed TOML configuration, validation, migration, or backup system.
5. No animation state model or visual states in the UI.
6. No settings/configuration management UI beyond basic controls.
7. Logging uses default stdout/stderr only; no persistent log file.
8. Installer installs only the executable and does not create `.jarvis`, preserve/upgrade data explicitly, or provide premium branding.
9. No performance measurements recorded yet.
10. No release binary verified in this audit (only dev profile checked).

## Missing functionality

- Persistent `.jarvis` directory structure.
- TOML configuration with versioning and migrations.
- Configuration management UI (open folder/file, export/import, backup/restore/reset).
- Animated JARVIS reactor and five visual states.
- Reduced-motion and hidden-window animation pausing.
- Diagnostics view and meaningful error logging.
- Installer branding and data preservation guarantees.

## Installer problems

- `installer.iss` has no `SourceExe` default definition in the file (relies on `/DSourceExe=...`).
- Installs only `jarvis.exe`; no explicit resource bundle (currently acceptable because Slint UI is compiled in, but resources such as assets are embedded by Slint at build time).
- No `.jarvis` directory creation.
- No uninstall data-preservation policy documented.
- No premium visual theme.

## Proposed changes

- Add `src/config.rs`, `src/paths.rs`, and logging initialization.
- Migrate storage to `%LOCALAPPDATA%\.jarvis\memory\jarvis.db`.
- Add TOML config load/save/validate/migrate/backup.
- Expand Slint UI with animated reactor, states, settings tabs, and diagnostics.
- Update installer and CI.
- Add tests for config and paths.
- Add documentation files.

## Risks and compatibility concerns

- Slint software rendering must remain lightweight on 4 GB RAM targets.
- Configuration migration must not delete existing SQLite data.
- Credential secrets must never be logged.
- Inno Setup is not installed in this environment, so installer compilation cannot be verified here.
- No GPU available assumption; keep all rendering CPU-light.
- Existing `JARVIS AI` data directory may contain user data; migration should copy rather than delete.
