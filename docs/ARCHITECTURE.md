# JARVIS AI — Architecture

This document records verified architecture decisions for the current
repository state. It is updated only when a decision has been implemented
or explicitly approved.

## Current state (Phase 1 foundation)

- Desktop application shell: Tauri 2 (Windows 11 x64 target only).
- Backend: Rust (edition 2024), Tauri 2.12.7, tauri-build 2.7.6.
- Frontend: Vite 8 + Vanilla TypeScript (no framework), HTML, CSS.
- Local database: not yet implemented (planned: SQLite via rusqlite).
- AI provider: not yet implemented (planned: NVIDIA NIM behind a trait).
- Voice: not yet implemented.
- Cloud backend: not yet implemented.
- OpenCode integration: not yet implemented.

## Module boundaries

- src/ — presentation only (HTML/CSS/TypeScript). No business logic, no secrets.
- src-tauri/src/lib.rs — Tauri command registration and app bootstrap.
- src-tauri/src/main.rs — Windows entry point (subsystem attribute).
- src-tauri/capabilities/default.json — minimal capability set.
- Tauri commands are the only bridge from frontend to backend; all inputs validated in Rust.

## Current Rust backend

- One command: get_system_status() -> SystemStatus returning
  { app_name, app_version (CARGO_PKG_VERSION), platform
  (std::env::consts::OS), backend_status }.
- No unrestricted filesystem or shell access.
- No API keys or credentials.

## Security (current)

- Capabilities: core:default only. No opener, no FS, no shell, no process plugins.
- CSP: default-src 'self'; img-src 'self' data:; style-src 'self'
  'unsafe-inline'; script-src 'self'.
- withGlobalTauri: false.
- No secrets stored.

## Frontend

- Lightweight Vite + TypeScript; CSS/SVG animations only.
- Honest status display: AI = DISCONNECTED, Memory = NOT INITIALIZED,
  module states shown as off/not configured. No fake operational claims.
- Microphone button is visual only.

## Cross-platform notes

- Phase 1 targets Windows 11 x64 only.
- Shared Rust core and platform adapters are planned; mobile builds are not
  part of Phase 1.

## Dependencies (current)

Frontend (npm): @tauri-apps/api ^2, vite ^8, typescript ~6.
Rust (Cargo): tauri 2, serde 1, serde_json 1, tauri-build 2.
No SQLite, NVIDIA, Cloudflare, or voice dependencies yet.