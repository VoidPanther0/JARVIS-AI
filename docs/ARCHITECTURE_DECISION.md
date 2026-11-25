# JARVIS Rust-Native Architecture Decision

**Status:** Proposed, not yet implemented  
**Scope:** Desktop foundation and UI direction  
**Hardware target:** Windows 11, Intel i5, 4 GB RAM, no dedicated GPU

## Decision proposal

Move the final desktop application away from the Tauri/WebView2 UI toward a Rust-native desktop UI. Keep the existing Tauri application intact until a replacement prototype is built and tested.

Leading candidate: Slint with software rendering. Compare it with egui using a small, identical proof of concept before choosing permanently.

## Why not Python as the production foundation?

Python is productive and useful for experiments, but a Python desktop assistant with a large GUI, audio, computer-vision, browser automation and integration dependency tree is not the best fit for a 4 GB RAM target. Mark-LVII itself uses PyQt6 and a broad dependency set. Rebuilding the runtime in Rust gives us tighter control over startup, memory ownership, concurrency and deployment.

Rust does not guarantee low memory use by itself. Dependency selection, UI rendering, background work and model/audio choices still determine resource consumption.

## Why not copy Mark-LVII?

Mark-LVII is a useful reference for:
- action/plugin boundaries
- provider abstraction
- memory retrieval
- checkpointed background tasks
- routines
- confirmation gates
- outcome verification
- lazy imports

It is not a ready-made Rust base. The repository declares CC BY-NC 4.0. JARVIS should independently implement the architecture unless the licensing position is explicitly resolved.

## Proposed layers

1. **Desktop shell and UI:** Rust-native Slint or egui; no WebView in the final app.
2. **Application core:** Rust modules with explicit interfaces and bounded task execution.
3. **AI provider layer:** NVIDIA API first; other providers behind the same interface.
4. **Audio layer:** native capture/playback; hosted speech processing initially to avoid large local models.
5. **Action registry:** typed, permission-aware actions with input schemas and result verification.
6. **Memory:** SQLite after the desktop foundation is stable; separate conversation history, user-approved long-term facts, tasks and preferences.
7. **Windows integration:** narrow wrappers around Windows APIs, with approval for risky operations.
8. **Credentials:** Windows Credential Manager.

## Migration order

### Task 005A: Native UI proof of concept
- Inspect current repo and working tree.
- Add a separate Rust-native prototype without deleting Tauri.
- Render a basic JARVIS window, status, transcript area and input control.
- Build and launch on Windows.
- Confirm no WebView2 dependency is present in the prototype.

### Task 005B: Benchmark and select UI
Measure on the target machine:
- cold startup time
- idle RAM after settling
- idle CPU
- responsiveness during resize and interaction
- behavior with integrated graphics/software rendering

Choose Slint or egui based on measurements, not assumptions.

### Task 005C: Native foundation migration
- Move the minimal application shell and status interface.
- Preserve existing behavior until parity is verified.
- Remove the old Tauri frontend only after successful acceptance tests.

### Next milestone: SQLite foundation
Only after the native desktop foundation is stable, add SQLite and migrations.

## Non-goals for this migration

- No local LLM.
- No full Mark-LVII feature port.
- No wake word or offline Whisper/Piper model yet.
- No 10,000-plugin implementation.
- No Gmail/Calendar or broad Windows automation until the foundation is stable.

## Acceptance criteria

- Windows build succeeds.
- App launches and remains responsive on the target PC.
- Final UI path has no embedded WebView2.
- No Python runtime is required.
- Idle RAM and startup time are measured and recorded.
- Existing Tauri app remains recoverable until the replacement passes.
- Tests and build results are reported honestly.
"""