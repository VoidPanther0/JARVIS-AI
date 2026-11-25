# JARVIS AI — Run Guide

## Prerequisites

- Windows 10/11 (x64)
- Node.js 20+ (tested with v26)
- Stonic AI installed at `C:\Users\This PC\AppData\Local\Programs\Stonic AI`
  (provides the Electron runtime used to launch the app)
- ~2 GB free disk space (node_modules + resources)

## Install

```bash
cd "C:\Users\This PC\Desktop\JARVIS AI"
npm install
```

This installs all JS dependencies and native modules (better-sqlite3, @jitsi/robotjs).

## Run (development)

```bash
npm start
```

`npm start` runs `scripts/start.js`, which launches the app using the installed
Electron runtime (`Stonic AI.exe`). The app window opens and the backend server
starts on `http://127.0.0.1:45678`.

Alternative (manual):

```bash
"C:\Users\This PC\AppData\Local\Programs\Stonic AI\Stonic AI.exe" .
```

## First run

- A data folder is created at `Documents\Stonic Data\` (SOUL.md, MEMORY.md, skills).
- Voice/computer runtimes are loaded from `resources\`.
- Media server serves bundled videos from `resources\videos`.

## Build / Package

Not configured in this repo. To package, use electron-builder with the Stonic
Electron binary as the runtime. (TODO)

## Troubleshooting

- **"Electron failed to install correctly"** — run `npm install` again; native
  postinstall scripts must be allowed.
- **Voice runtime errors** — ensure `resources\voice-runtime\venv` exists.
- **Missing media** — check `resources\videos` is present.
- **Port in use** — kill any process on 45678 and retry.