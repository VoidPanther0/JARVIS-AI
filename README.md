# JARVIS AI

JARVIS AI is an advanced desktop assistant rebuilt from Stonic AI in the same
stack: Electron + JavaScript (main/renderer) with a Python voice/computer runtime.

## Run

```bash
npm install
npm start
```

`npm start` launches the app using the installed Electron runtime.

## Structure

- `electron/` - Main process, IPC handlers, services, PWA
- `dist/` - Renderer UI assets
- `resources/` - Bundled runtimes (voice, computer, python) and media
- `scripts/` - Helper scripts (start)
- `locales/` - Chromium locale files
- `node_modules/` - Dependencies

## Notes

- Core main-process logic is compiled (`electron/main.jsc`) and loaded via
  bytenode; source-level IPC handlers and services live under
  `electron/main/ipc` and `electron/services`.
- Non-Windows/non-x64 native prebuilds and the duplicate
  `resources/app.asar zip` extraction were removed to keep the project lean.