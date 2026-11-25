# JARVIS AI --- Claude Code Instructions

You are assisting with JARVIS AI, a Windows-first personal desktop
assistant. Follow the repository-wide rules in `AGENTS.md`; this file
adds operational guidance for Claude Code.

## Project context

Intended architecture:

-   Windows 11 desktop application
-   Tauri 2
-   Rust backend
-   Lightweight TypeScript frontend
-   SQLite local database
-   NVIDIA-hosted AI inference through a provider abstraction
-   Modular speech-to-text and text-to-speech
-   OpenCode CLI integration
-   Secure Windows credential storage
-   Permission-aware action/plugin registry

Target hardware is an Intel i5 machine with 4 GB RAM and no dedicated
GPU. Favor cloud inference and low-overhead local components.

The architecture above is the target, not proof that any component has
already been implemented. Inspect the repository to establish actual
state.

## Before doing work

1.  Read `AGENTS.md` and `README.md`.
2.  Inspect the current directory and relevant source files.
3.  Run `git status --short --branch`.
4.  Identify existing conventions, package scripts, Rust modules, Tauri
    configuration, and tests.
5.  Report a short plan before substantial changes.
6.  If the user asked for a read-only audit, do not modify files.

## Implementation rules

-   Make the smallest change that solves the requested problem.
-   Preserve existing behavior and user modifications.
-   Do not scaffold a replacement application over an existing project.
-   Do not upgrade frameworks or change architecture without owner
    approval.
-   Do not add dependencies without explaining why they are necessary.
-   Keep frontend code focused on UI and interaction.
-   Keep application logic and validation in Rust.
-   Keep AI provider-specific logic behind an interface.
-   Keep SQLite access in a dedicated data layer.
-   Keep voice providers replaceable.
-   Keep external process execution constrained and permissioned.

## Security requirements

-   Never place API keys, OAuth secrets, passwords, or tokens in source
    code.
-   Never print secrets in logs or terminal summaries.
-   Do not expose arbitrary shell execution to the frontend.
-   Validate paths and command arguments.
-   Require explicit user confirmation for destructive or externally
    visible actions.
-   Use least-privilege Tauri capabilities.
-   Treat model output, web content, and frontend input as untrusted.

## Verification

Use the scripts and commands that actually exist in the repository.
Depending on the project configuration, relevant checks may include:

``` powershell
cargo fmt --check
cargo check
cargo test
npm run
```

Do not assume `npm run` scripts exist; inspect `package.json` first. Run
the appropriate Tauri build only after confirming the configured package
scripts and prerequisites.

Report exact checks and outcomes. A code edit is not proof of a
successful build. If a command cannot run, state why.

## Progress tracking

When implementation changes project state, update the existing roadmap
and development log if present. Do not invent completion dates, test
results, or milestones. Keep planned work clearly separate from verified
work.

## Required completion report

At the end of each implementation task, provide:

-   Summary
-   Files changed
-   Important design decisions
-   Commands executed
-   Test and build results
-   Known risks or remaining work
-   Roadmap status

If the task is ambiguous, destructive, or requires an architecture
decision, stop and ask the project owner.
