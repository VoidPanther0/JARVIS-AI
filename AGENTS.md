# JARVIS AI --- Agent Instructions

These instructions apply to every coding agent working in this
repository. Read this file before inspecting or modifying code.

## 1. Mission

Build JARVIS as a reliable, lightweight, Windows-first personal AI
assistant. Prioritize working functionality, security, maintainability,
and low resource consumption over feature count.

The intended stack is:

-   Windows 11
-   Rust backend
-   Tauri 2 desktop shell
-   Lightweight TypeScript frontend
-   SQLite local storage
-   NVIDIA-hosted inference as the initial primary AI provider
-   Modular STT/TTS
-   OpenCode CLI as an external coding engine
-   Secure Windows credential storage

Do not change this stack without explaining the trade-offs and obtaining
explicit project-owner approval.

## 2. Target machine constraints

The target development machine has an Intel i5, 4 GB RAM, and no
dedicated GPU.

Therefore:

-   Prefer cloud inference over local LLM execution.
-   Avoid heavyweight frontend frameworks and unnecessary dependencies.
-   Avoid unnecessary background processes and polling.
-   Keep startup time and idle memory use low.
-   Do not add a local model runtime unless the owner explicitly
    approves it after a resource analysis.

## 3. Mandatory workflow

For every task, follow this sequence:

1.  Inspect the repository, relevant files, and `git status`.
2.  Read `README.md`, this file, and relevant architecture or
    development notes.
3.  Identify existing behavior and affected modules.
4.  State assumptions, risks, and a concise implementation plan.
5.  Wait for approval when the task requests a plan, is ambiguous,
    changes architecture, or has destructive consequences.
6.  Implement the smallest coherent change.
7.  Add or update tests.
8.  Run formatting, linting, tests, and build checks that are available
    and relevant.
9.  Report exact commands and actual outcomes.
10. Update documentation and the development log when project state
    changes.

Do not skip repository inspection. Do not assume a feature exists
because it is described in documentation.

## 4. Preserve existing work

-   Never replace the project wholesale.
-   Never delete or rename files without explicit approval.
-   Never overwrite user changes.
-   Check `git status` before editing.
-   Do not reset, clean, force-push, or rewrite Git history.
-   Do not run destructive database migrations against user data.
-   Prefer backward-compatible, incremental changes.
-   If the repository differs from the documented target, report the
    difference before making structural changes.

## 5. Architecture boundaries

Keep responsibilities separated:

-   Frontend: presentation and user interaction.
-   Tauri commands: narrow, validated bridge between frontend and
    backend.
-   Rust core: application logic and orchestration.
-   AI provider adapters: provider-specific request/response handling.
-   Database layer: SQLite access, schema and migrations.
-   Voice layer: independent STT/TTS interfaces and implementations.
-   Security layer: credentials, permissions and policy checks.
-   Action registry: explicit, discoverable, permission-aware
    capabilities.

Do not place provider secrets or business logic in frontend code. Do not
expose unrestricted filesystem, process, or shell access through Tauri
commands.

## 6. AI provider rules

-   Use a provider abstraction so NVIDIA is not hard-wired throughout
    the application.
-   Verify the current NVIDIA endpoint, model identifier, authentication
    method, request format, and rate limits from authoritative provider
    documentation before implementation.
-   Do not invent model names, API endpoints, or environment variable
    values.
-   Keep API keys out of source code, frontend bundles, logs,
    screenshots, and Git.
-   Handle timeouts, rate limits, network failures, malformed responses,
    and cancellation.
-   Never claim an AI request succeeded unless the provider returned a
    successful response and the application handled it.

## 7. Memory and privacy

Memory must be user-controlled.

Plan distinct concepts for:

-   Short-term conversation context.
-   Long-term memories.
-   Preferences.
-   Project history.
-   Conversation history.
-   Tasks and reminders.
-   Searchable knowledge.

Do not permanently store every conversation by default. Provide clear
retention, search, edit, delete, and export behavior as those features
are implemented. Avoid storing sensitive information unless there is a
clear, approved need and suitable protection.

## 8. Voice

Keep speech-to-text and text-to-speech replaceable behind interfaces. Do
not assume a provider, model, language, or voice is configured until
verified.

The intended language scope may include English, Hindi, and Nepali when
supported by the selected components. Do not claim language support
without testing it.

## 9. OpenCode and automation safety

OpenCode is an external coding engine, not a reason to grant
unrestricted system access.

-   Separate proposing an action from executing it.
-   Require explicit approval for destructive or externally visible
    actions.
-   Validate paths and arguments.
-   Use allowlists and least privilege where practical.
-   Capture process exit codes and output.
-   Handle timeouts, cancellation, and child-process cleanup.
-   Never silently execute arbitrary commands suggested by model output.

## 10. Tauri security

-   Use the minimum Tauri capabilities and permissions required.
-   Validate all command inputs on the Rust side.
-   Avoid broad filesystem or shell permissions.
-   Do not expose secrets to the webview.
-   Treat frontend data and model-generated content as untrusted.
-   Review CSP and capability configuration before release.

## 11. Dependencies and code quality

-   Prefer the standard library or existing dependencies when
    reasonable.
-   Add a dependency only when it provides clear value.
-   Check maintenance, license, platform compatibility, and resource
    cost.
-   Keep modules focused and errors explicit.
-   Avoid placeholder implementations presented as working features.
-   Do not suppress warnings without understanding them.

## 12. Testing and verification

Run checks appropriate to the actual repository. Common examples, only
when the relevant project files and scripts exist:

-   `cargo fmt --check`
-   `cargo check`
-   `cargo test`
-   Frontend package manager typecheck/lint/test scripts
-   Tauri development launch
-   Tauri production build

Do not run commands that do not match the repository's actual
configuration.

In every completion report, distinguish:

-   Implemented
-   Tested and passed
-   Tested and failed
-   Not tested
-   Blocked

Never fabricate output, test results, build success, performance
measurements, or installed versions.

## 13. Documentation and progress

Keep `README.md` accurate. Maintain:

-   `docs/ARCHITECTURE.md` for verified architecture decisions.
-   `docs/ROADMAP.md` for milestones and acceptance criteria.
-   `docs/DEVELOPMENT_LOG.md` for dated work, commands, results, and
    blockers.

If these files do not yet exist, propose creating them as part of an
approved documentation task. Do not mark a milestone complete until its
acceptance criteria are verified.

## 14. Communication

Be direct and technically precise. Explain trade-offs and identify
unrealistic assumptions. Ask one focused question when blocked by
missing information.

Before making a change, summarize the scope. After making a change,
report:

1.  Files changed.
2.  What changed.
3.  Commands run.
4.  Test/build results.
5.  Known limitations.
6.  Roadmap impact.

The project owner has final authority over architecture, scope,
credentials, integrations, and permissions.
