# JARVIS AI — Roadmap

Milestones are complete only when acceptance criteria are implemented
and verified. Planned work is clearly separated from verified work.

## Phase 1 — Desktop foundation (in progress)

Scope: Tauri 2 desktop shell, Rust communication, lightweight UI,
stability.

Status: Foundation implemented and verified (2026-11-25). SQLite not yet
added. CI workflow added (2026-11-25).

Acceptance criteria:
- [x] Tauri 2 app builds and launches on Windows 11 x64.
- [x] Rust command get_system_status works and is displayed in UI.
- [x] Frontend builds (npm run build) and typechecks.
- [x] cargo fmt --check, cargo check, cargo test pass.
- [x] Production bundles (MSI + NSIS) generated.
- [x] CI workflow (GitHub Actions) for fmt/check/test/build.
- [ ] SQLite foundation (rusqlite bundled) + migrations.
- [ ] Code signing decision.

## Proposed: Rust-native UI migration (Task 005, not yet approved)

Status: Proposed. See `docs/ARCHITECTURE_DECISION.md` and
`docs/rust-architecture-pack/`. This is an architecture change that
conflicts with the current Tauri 2 commitment and requires explicit
project-owner approval before implementation.

- Task 005A: Native UI proof of concept (Slint vs egui), no WebView2.
- Task 005B: Benchmark and select UI on the target PC.
- Task 005C: Native foundation migration, preserving Tauri app until parity.

## Phase 2 — NVIDIA AI provider (planned)

- Provider trait + NVIDIA NIM adapter.
- Streaming chat completions, timeouts, retries, rate-limit handling,
  cancellation, token usage.
- Honest disconnected/error states.

## Phase 3 — Voice engine (planned)

- STT/TTS behind interfaces; language support verified by testing.

## Phase 4 — Memory engine (planned)

- User-controlled short/long-term memory over SQLite.

## Phase 5 — OpenCode integration (planned)

- External coding engine orchestration with approval gates.

## Phase 6 — Integrations (planned)

- Gmail, Google Calendar, GitHub.

## Phase 7 — Automation engine (planned)

## Phase 8 — Windows integrations (planned)

## Phase 9 — Plugin/skill ecosystem (planned)

- Permission-based skill registry and execution.

## Phase 10 — Installer and production release (planned)

- Signed installers, updater, release automation.