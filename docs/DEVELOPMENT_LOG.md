# JARVIS AI — Development Log

## 2026-11-25 — Task 003: Initial Tauri 2 desktop foundation

### Environment
- OS: Windows 11 Pro 10.0.26300 (x64)
- Rust: 1.99.1 (stable, x86_64-pc-windows-msvc)
- Cargo: 1.99.1
- Node: v26.12.1
- npm: 11.20.0
- Tauri: 2.12.7 (tauri), tauri-build 2.7.6, tauri-cli 2.12.x
- Vite: 8.3.8
- TypeScript: 6.0.3

### Commands executed
1. git status --short --branch — clean, branch main.
2. npm create tauri-app@latest (vanilla-ts, npm, identifier com.voidpanther.jarvis) into .jarvis-scaffold-temp/jarvis.
3. Merged scaffold into repository root; preserved README.md, AGENTS.md, CLAUDE.md. Removed scaffold temp dir.
4. npm install — added 19 packages, 0 vulnerabilities.
5. npm run build — passed (tsc + vite build, 7 modules, ~389ms).
6. cargo fmt --check — passed (after cargo fmt).
7. cargo check --manifest-path src-tauri/Cargo.toml — passed (5m 24s).
8. cargo test --manifest-path src-tauri/Cargo.toml — passed (0 tests, 0 failures).
9. npm run tauri dev — Vite ready in 1163ms; cargo compiled; jarvis.exe ran; no runtime errors observed; terminated manually.
10. npm run tauri build — passed (9m 33s). Bundles:
    - MSI: src-tauri/target/release/bundle/msi/JARVIS_0.1.0_x64_en-US.msi (1.93 MiB)
    - NSIS: src-tauri/target/release/bundle/nsis/JARVIS_0.1.0_x64-setup.exe (1.29 MiB)

### Files created
- .gitignore (merged Node/Rust/Tauri ignores)
- index.html
- package.json, package-lock.json
- vite.config.ts, tsconfig.json
- src/main.ts, src/styles.css
- src-tauri/Cargo.toml, src-tauri/build.rs
- src-tauri/tauri.conf.json
- src-tauri/capabilities/default.json
- src-tauri/src/lib.rs, src-tauri/src/main.rs
- src-tauri/icons/*
- docs/ARCHITECTURE.md, docs/ROADMAP.md, docs/DEVELOPMENT_LOG.md

### Files modified
- README.md — Phase 1 status note updated.
- src-tauri/Cargo.toml — removed tauri-plugin-opener.
- src-tauri/capabilities/default.json — removed opener:default.
- src-tauri/tauri.conf.json — productName/title/size/CSP/withGlobalTauri.
- package.json — removed @tauri-apps/plugin-opener.

### Rust backend
- Command get_system_status() returns app_name, app_version (CARGO_PKG_VERSION), platform (std::env::consts::OS), backend_status ("operational"). No fake connectivity claims.

### Known limitations
- No SQLite, AI provider, voice, memory, OpenCode, or cloud integration.
- Microphone button is visual only.
- AI/Memory status honestly shown as DISCONNECTED / NOT INITIALIZED.
- No tests beyond cargo's default (0 tests).
- CSP set but not yet validated against all future assets.
- Code signing not configured.

### Next milestone
Phase 1 continuation: SQLite foundation (rusqlite bundled) + migrations, then CI workflow (GitHub Actions).