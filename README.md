# JARVIS AI

A lightweight, Windows-first personal AI assistant built with Rust and
Tauri 2.

> **Project status:** Phase 1 / Day 1 --- project foundation and
> repository audit. This repository documentation describes the intended
> architecture and development rules. It does not claim that planned
> features have already been implemented.

## Vision

JARVIS aims to provide a natural, voice-capable desktop assistant for
Windows 11, with conversational AI, user-controlled memory, productivity
integrations, and carefully permissioned desktop automation.

The project prioritizes reliability, security, low resource consumption,
and incremental delivery over feature count.

## Primary goals

-   Lightweight Windows 11 desktop application.
-   Premium, Iron Man-inspired visual direction without copying
    protected film assets.
-   Rust backend with Tauri 2.
-   Lightweight TypeScript frontend.
-   NVIDIA-hosted AI inference, behind a provider abstraction.
-   SQLite for local, user-controlled memory and application data.
-   Modular speech-to-text and text-to-speech foundations.
-   OpenCode CLI integration as an external coding agent.
-   Extensible, permission-aware action/plugin registry.
-   Secure credential storage using appropriate Windows facilities.
-   Production Windows installer.

## Planned technology

  -----------------------------------------------------------------------
  Area                                Intended technology
  ----------------------------------- -----------------------------------
  Desktop shell                       Tauri 2

  Backend                             Rust

  Frontend                            TypeScript and lightweight UI

  Styling                             CSS

  Local database                      SQLite

  Primary hosted AI provider          NVIDIA API / NVIDIA NIM, subject to
                                      endpoint and model verification

  Additional AI providers             Modular adapters, added when needed

  Voice                               Pluggable STT and TTS

  Coding agent                        OpenCode CLI

  Credentials                         Windows Credential Manager or an
                                      appropriate secure OS-backed store

  Source control                      Git and GitHub
  -----------------------------------------------------------------------

Technology choices should not be changed without explaining the reason
and obtaining project-owner approval.

## Architecture principles

1.  Keep the desktop process lightweight. Prefer cloud inference over
    local LLM inference on the target 4 GB RAM machine.
2.  Keep provider-specific details behind interfaces.
3.  Keep secrets out of frontend code, source control, logs, and
    plain-text configuration.
4.  Require explicit permission for consequential or destructive
    actions.
5.  Store only useful memory with user control over search, editing,
    deletion, and export.
6.  Use small, testable modules and avoid speculative abstractions.
7.  Preserve working functionality. Do not rewrite modules without
    evidence and approval.
8.  Treat generated code as unverified until tests and builds pass.

## Development phases

  -----------------------------------------------------------------------
  Phase                   Scope                   Status
  ----------------------- ----------------------- -----------------------
  1                       Desktop foundation, UI, In progress / not yet
                          Rust communication,     verified
                          SQLite foundation,      
                          stability               

  2                       NVIDIA AI provider and  Planned
                          conversational AI       

  3                       Voice engine            Planned

  4                       Memory engine           Planned

  5                       OpenCode integration    Planned

  6                       Gmail and Google        Planned
                          Calendar                

  7                       Automation engine       Planned

  8                       Windows integrations    Planned

  9                       Plugin/action ecosystem Planned

  10                      Windows installer and   Planned
                          production release      
  -----------------------------------------------------------------------

A phase is complete only when its acceptance criteria are implemented
and verified.

## Target development environment

-   Windows 11
-   Intel i5-class machine
-   4 GB RAM
-   No dedicated GPU
-   Cloud-hosted AI inference
-   Rust toolchain
-   Node.js and npm
-   Git
-   Tauri 2 Windows prerequisites, including Microsoft C++ Build Tools
    and WebView2

Exact installed versions must be recorded in `docs/DEVELOPMENT_LOG.md`
after environment inspection. Do not assume a tool is installed merely
because it is listed here.

## Repository structure

The actual repository structure must be established by inspecting the
current checkout. The following is a target organization, not a claim
that all directories already exist:

``` text
.
├── src/                 # Frontend application
├── src-tauri/           # Tauri and Rust backend
├── docs/                # Architecture, roadmap, development log
├── scripts/             # Repeatable development scripts
├── tests/               # Integration and end-to-end tests
├── README.md
├── AGENTS.md
└── CLAUDE.md
```

Create directories only when there is a concrete implementation need.

## Getting started

1.  Clone the repository.
2.  Read `AGENTS.md` and `CLAUDE.md`.
3.  Inspect the existing repository before changing anything.
4.  Verify the Windows development prerequisites.
5.  Follow the approved Day 1 environment and repository audit.
6.  Do not scaffold over an existing project until its structure and Git
    status are understood.

Build and run commands will be documented here after the actual Tauri
project structure and package scripts have been inspected and verified.
Do not copy generic commands blindly into an existing repository.

## Security

-   Never commit API keys, OAuth tokens, passwords, private keys, or
    credential exports.
-   Provide `.env.example` only with placeholder names and no real
    secrets.
-   Validate all frontend-to-backend inputs.
-   Apply least privilege to Tauri capabilities.
-   Do not expose arbitrary shell execution to the frontend.
-   Require confirmation for destructive, irreversible, financial, or
    externally visible actions.
-   Log operational events without logging secrets or unnecessary
    personal content.
-   Make memory retention and deletion behavior explicit.

## Development workflow

For every task:

1.  Inspect relevant files and current Git status.
2.  Read applicable project instructions.
3.  Identify affected modules and compatibility constraints.
4.  Propose a small implementation plan.
5.  Implement only the approved scope.
6.  Run focused tests, then relevant full checks.
7.  Verify the application builds.
8.  Document changes, limitations, and test results.
9.  Update the roadmap and development log.

Never report tests, builds, or integrations as successful unless they
were actually run and passed.

## Project governance

-   `AGENTS.md` contains repository-wide instructions for coding agents.
-   `CLAUDE.md` contains additional instructions for Claude Code.
-   If instructions conflict, stop and ask the project owner rather than
    silently choosing a destructive interpretation.
-   The project owner approves architecture changes, new external
    services, and consequential automation permissions.

## License

No license has been selected yet. All rights reserved by default until
the project owner chooses and adds an explicit license.
