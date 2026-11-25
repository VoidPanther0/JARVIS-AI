# JARVIS AI

JARVIS is a Windows 11 desktop assistant designed for low-resource computers.

## Direction

The intended application architecture is Rust-first:

- Rust application core and Windows integrations
- Native desktop UI, with Slint software rendering evaluated as the leading candidate
- SQLite local storage
- Cloud-hosted AI inference (NVIDIA provider first)
- Modular provider and action interfaces
- Secure credential storage using Windows Credential Manager

Python is not a required runtime dependency. It may be used for temporary experiments or one-off development scripts, but production application features should be implemented in Rust.

## Reference project

Mark-LVII (https://github.com/FatihMakes/Mark-LVII) is an architectural and UX reference, not a codebase to copy wholesale.

Useful design ideas to study and independently implement:
- typed actions and plugins
- separated short-term and long-term memory
- resumable background tasks
- routines and scheduled work
- confirmation gates for risky operations
- verified action outcomes
- lazy loading of optional capabilities
- interchangeable AI and speech providers

Its repository declares CC BY-NC 4.0. Do not copy or adapt its code into JARVIS without resolving the licensing implications, especially if JARVIS may ever be commercial. Review the current license and obtain legal advice where necessary.

## Hardware target

Initial target: Windows 11, Intel i5, 4 GB RAM, no dedicated GPU.

Design rules:
- Do not run a local LLM by default.
- Avoid bundled local speech models on the initial low-memory configuration.
- Do not keep continuous polling loops when event-driven APIs are available.
- Load optional integrations only when used.
- Keep background concurrency bounded.
- Measure idle RAM, startup time, CPU use and voice latency on the target machine.

## Migration safety

The existing Tauri application must remain buildable until the Rust-native replacement has passed its acceptance tests. Do not delete the current frontend or Tauri shell during the prototype stage.
"""