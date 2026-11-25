# JARVIS AI --- Claude Code Instructions

You are assisting with JARVIS AI, a Windows-first personal desktop
assistant. Follow the repository-wide rules in `AGENTS.md`.

## Project context

Intended architecture:
- Windows 11 desktop application
- Rust backend and native UI
- Slint software rendering
- SQLite local database
- NVIDIA-hosted AI inference through a provider abstraction
- Modular speech-to-text and text-to-speech
- Secure Windows credential storage
- Permission-aware action/plugin registry

Target hardware is an Intel i5 machine with 4 GB RAM and no dedicated
GPU. Favor cloud inference and low-overhead local components.

## Before doing work

1. Read `AGENTS.md` and `README.md`.
2. Inspect the current directory and relevant source files.
3. Identify existing conventions, Rust modules, and tests.
4. Report a short plan before substantial changes.

## Implementation rules

- Make the smallest change that solves the requested problem.
- Preserve existing behavior and user modifications.
- Do not add Tauri, WebView2, or a TypeScript frontend.
- Do not add dependencies without explaining why they are necessary.
- Keep UI focused on interaction.
- Keep application logic and validation in Rust.
- Keep AI provider-specific logic behind an interface.
- Keep SQLite access in a dedicated data layer.
- Keep voice providers replaceable.
- Keep external process execution constrained and permissioned.

## Security requirements

- Never place API keys, OAuth secrets, passwords, or tokens in source code.
- Never print secrets in logs or terminal summaries.
- Do not expose arbitrary shell execution to the frontend.
- Validate paths and command arguments.
- Require explicit user confirmation for destructive or externally visible actions.
- Treat model output, web content, and UI input as untrusted.

## Verification

Use the commands that actually exist in the repository:

```powershell
cargo fmt --check
cargo check
cargo test
cargo build --release
```

Report exact checks and outcomes. A code edit is not proof of a successful build.

## Required completion report

At the end of each implementation task, provide:
- Summary
- Files changed
- Important design decisions
- Commands executed
- Test and build results
- Known risks or remaining work