// Gesture Control — main process ka hissa (Electron glue).
//
// Panel (bari window) se ON → ek chhoti shaffaf, click-through, hamesha-upar window
// ("HUD", `?mode=gesture`) banti hai. Usi mein camera + MediaPipe + gesture machine
// chalte hain, aur wahi cursor ke gird ring dikhati hai. HUD sirf hukm bhejti hai
// (cursor yahan, button daba, scroll, wheel ka kaam); asal mouse / keyboard yahan
// gesture-motor.js chalata hai. OFF → window khatam, camera band, CPU zero.
//
// Hifazat:
//   - Camera ki light jalti rehti hai jab tak ON; app band / Face Lock / PC lock /
//     sleep = foran OFF. App khulne par khud ON nahi hota.
//   - Ctrl + Alt + G (Mac: Cmd + Option + G) — kahin se bhi OFF.
//   - HUD ke paighaam sirf HUD window se maane jaate hain; har number / id jaancha jata hai.
//   - Daba hua mouse button kabhi atka nahi rehta (motor ka watchdog + har band hone par chhorna).

'use strict';

const { BrowserWindow, ipcMain, screen, globalShortcut, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const { GestureMotor } = require('./gesture-motor');

const PRELOAD = path.join(__dirname, '..', 'preload.js');
const HUD_SIZE = 320;
const PREFS_FILE = 'gesture-control.json';
const START_TIMEOUT_MS = 30000;
const STOP_HOTKEY = 'CommandOrControl+Alt+G';
const TELEMETRY_MIN_MS = 80;

const REACH = new Set(['small', 'medium', 'large']);
const MOTOR_ACTIONS = new Set(['taskview', 'forward', 'desktop', 'screenshot', 'back', 'playpause', 'vol_up', 'vol_down']);
const DEFAULT_PREFS = { reach: 'medium', naturalScroll: true };

let robot = null;
function getRobot() {
  if (!robot) robot = require('@jitsi/robotjs');
  return robot;
}

class GestureControl {
  /**
   * @param {{
   *   userDataDir: string,
   *   loadPage: (win: BrowserWindow, query: string, label: string) => void,
   *   isLocked?: () => boolean,
   *   onSummon?: () => void,
   * }} opts
   */
  constructor({ userDataDir, loadPage, isLocked, onSummon }) {
    this.prefsPath = path.join(userDataDir, PREFS_FILE);
    this.loadPage = loadPage;
    this.isLocked = isLocked || (() => false);
    this.onSummon = onSummon || (() => {});
    this.prefs = this._readPrefs();
    this.main = null;
    this.hud = null;
    this.motor = null;
    this.phase = 'off';
    this.error = '';
    this.delegate = '';
    this.startTimer = null;
    this.lastTelemetryAt = 0;
    this.hotkeyOn = false;
    this.powerHooked = false;
  }

  setWindow(win) {
    this.main = win;
  }

  // ── Halat ──────────────────────────────────────────────────────────────────

  getState() {
    return { phase: this.phase, prefs: { ...this.prefs }, error: this.error, delegate: this.delegate };
  }

  _broadcast() {
    this._sendMain('gesture:state', this.getState());
  }

  _sendMain(channel, payload) {
    const win = this.main;
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send(channel, payload); } catch { /* window ja rahi hai */ }
  }

  _sendHud(payload) {
    const win = this.hud;
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send('gesture:to-hud', payload); } catch { /* */ }
  }

  _readPrefs() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.prefsPath, 'utf8'));
      return sanitizePrefs(raw, DEFAULT_PREFS);
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  _savePrefs() {
    try {
      fs.writeFileSync(this.prefsPath, JSON.stringify(this.prefs, null, 2));
    } catch (err) {
      console.warn('[Gesture] settings save nahi hui:', err.message);
    }
  }

  // ── ON / OFF ───────────────────────────────────────────────────────────────

  start() {
    if (this.phase !== 'off') return this.getState();
    if (this.isLocked()) {
      this.error = 'Unlock Stonic first.';
      this._broadcast();
      return this.getState();
    }
    let r;
    try {
      r = getRobot();
    } catch (err) {
      this.error = 'Mouse control is not available on this PC.';
      console.error('[Gesture] robotjs load nahi hua:', err.message);
      this._broadcast();
      return this.getState();
    }

    this.error = '';
    this.delegate = '';
    this.phase = 'starting';
    this.motor = new GestureMotor({
      robot: r,
      platform: process.platform,
      toPhysical: process.platform === 'win32' ? (p) => screen.dipToScreenPoint(p) : (p) => p,
      getCursor: () => screen.getCursorScreenPoint(),
      onMove: (p) => this._moveHud(p),
      onYield: () => this._sendHud({ t: 'yield' }),
    });
    this._pickDisplay();
    this._createHud();
    this._registerHotkey();
    this._hookPower();
    this.startTimer = setTimeout(() => {
      if (this.phase === 'starting') this.stop('Gesture control took too long to start. Check the camera and try again.');
    }, START_TIMEOUT_MS);
    this._broadcast();
    return this.getState();
  }

  /** @param {string} [error] user ko dikhane wali wajah (khali = user ne khud band kiya) */
  stop(error = '') {
    if (this.startTimer) { clearTimeout(this.startTimer); this.startTimer = null; }
    if (this.motor) {
      try { this.motor.dispose(); } catch { /* */ }
      this.motor = null;
    }
    const hud = this.hud;
    this.hud = null;
    if (hud && !hud.isDestroyed()) {
      try { hud.destroy(); } catch { /* */ }
    }
    this._unregisterHotkey();
    const changed = this.phase !== 'off' || error !== this.error;
    this.phase = 'off';
    this.delegate = '';
    this.error = error;
    if (changed) this._broadcast();
    this._sendMain('gesture:telemetry', null);
    return this.getState();
  }

  /** Face Lock laga. */
  handleLock() {
    if (this.phase !== 'off') this.stop();
  }

  shutdown() {
    this.stop();
  }

  // ── HUD window ─────────────────────────────────────────────────────────────

  _createHud() {
    const c = screen.getCursorScreenPoint();
    let win;
    try {
      win = new BrowserWindow({
        x: Math.round(c.x - HUD_SIZE / 2),
        y: Math.round(c.y - HUD_SIZE / 2),
        width: HUD_SIZE,
        height: HUD_SIZE,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        focusable: false,
        title: 'Stonic Gesture',
        webPreferences: {
          preload: PRELOAD,
          contextIsolation: true,
          nodeIntegration: false,
          // Window chhupi / dhaki ho tab bhi camera ke frame aate rahein.
          backgroundThrottling: false,
          spellcheck: false,
        },
      });
    } catch (err) {
      console.error('[Gesture] HUD window nahi bani:', err.message);
      this.stop('Gesture control could not start.');
      return;
    }
    this.hud = win;
    try { win.setAlwaysOnTop(true, 'screen-saver'); } catch { /* */ }
    try { win.setIgnoreMouseEvents(true); } catch { /* */ }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    // Window dikhni ZAROORI hai: chhupi window ko frame (rAF / video callback) nahi milte.
    win.webContents.once('did-finish-load', () => {
      if (this.hud === win && !win.isDestroyed()) win.showInactive();
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      if (this.hud !== win) return;
      console.error('[Gesture] HUD band ho gayi:', details?.reason);
      this.stop('Gesture control stopped unexpectedly. Start it again.');
    });
    win.on('closed', () => {
      if (this.hud === win) this.stop();
    });
    this.loadPage(win, '?mode=gesture', 'gesture hud');
  }

  _moveHud(p) {
    const win = this.hud;
    if (!win || win.isDestroyed()) return;
    try { win.setPosition(Math.round(p.x - HUD_SIZE / 2), Math.round(p.y - HUD_SIZE / 2)); } catch { /* */ }
  }

  /** Jis screen par cursor hai wahi control hogi (har dafa haath uthane par dobara). */
  _pickDisplay() {
    const c = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(c);
    const b = d.bounds;
    if (this.motor) this.motor.setDisplay(b);
    return {
      aspect: b.width / b.height,
      cursor: { x: (c.x - b.x) / Math.max(1, b.width - 1), y: (c.y - b.y) / Math.max(1, b.height - 1) },
      dip: c,
    };
  }

  // ── HUD ke paighaam ────────────────────────────────────────────────────────

  _fromHud(event) {
    return Boolean(this.hud && !this.hud.isDestroyed() && event.sender === this.hud.webContents);
  }

  _onHud(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (this.motor) this.motor.touch();
    switch (msg.t) {
      case 'ready':
        if (this.phase !== 'starting') return;
        if (this.startTimer) { clearTimeout(this.startTimer); this.startTimer = null; }
        this.phase = 'running';
        this.delegate = msg.delegate === 'GPU' ? 'GPU' : 'CPU';
        this._broadcast();
        return;
      case 'error':
        this.stop(String(msg.message || 'Gesture control stopped.').slice(0, 300));
        return;
      case 'cmds':
        if (!Array.isArray(msg.list)) return;
        for (const cmd of msg.list.slice(0, 40)) this._runCmd(cmd);
        return;
      case 'telemetry': {
        const now = Date.now();
        if (now - this.lastTelemetryAt < TELEMETRY_MIN_MS) return;
        this.lastTelemetryAt = now;
        this._sendMain('gesture:telemetry', sanitizeTelemetry(msg.data));
        return;
      }
      default:
    }
  }

  _runCmd(cmd) {
    const m = this.motor;
    if (!m || !cmd || typeof cmd !== 'object') return;
    switch (cmd.t) {
      case 'arm': {
        const info = this._pickDisplay();
        this._moveHud(info.dip);
        this._sendHud({ t: 'cursor', x: info.cursor.x, y: info.cursor.y, aspect: info.aspect });
        return;
      }
      case 'engage':
        m.engage(cmd.on === true);
        return;
      case 'target':
        m.target(unit(cmd.x), unit(cmd.y));
        return;
      case 'down':
        if (cmd.button === 'left' || cmd.button === 'right') m.down(cmd.button, unit(cmd.x), unit(cmd.y));
        return;
      case 'up':
        if (cmd.button === 'left' || cmd.button === 'right') m.up(cmd.button);
        return;
      case 'scroll':
        m.scroll(num(cmd.dx), num(cmd.dy));
        return;
      case 'action':
        if (cmd.id === 'stonic') {
          if (!this.isLocked()) this.onSummon();
        } else if (MOTOR_ACTIONS.has(cmd.id)) {
          m.action(cmd.id);
        }
        return;
      default:
    }
  }

  // ── Hotkey / power ─────────────────────────────────────────────────────────

  _registerHotkey() {
    if (this.hotkeyOn) return;
    try {
      this.hotkeyOn = globalShortcut.register(STOP_HOTKEY, () => this.stop());
      if (!this.hotkeyOn) console.warn('[Gesture] Ctrl+Alt+G kisi aur app ke paas hai — panel se band karein.');
    } catch (err) {
      this.hotkeyOn = false;
      console.warn('[Gesture] hotkey nahi laga:', err.message);
    }
  }

  _unregisterHotkey() {
    if (!this.hotkeyOn) return;
    try { globalShortcut.unregister(STOP_HOTKEY); } catch { /* */ }
    this.hotkeyOn = false;
  }

  _hookPower() {
    if (this.powerHooked) return;
    this.powerHooked = true;
    const off = () => { if (this.phase !== 'off') this.stop(); };
    try {
      powerMonitor.on('lock-screen', off);
      powerMonitor.on('suspend', off);
    } catch { /* */ }
  }

  // ── IPC ────────────────────────────────────────────────────────────────────

  registerIpc() {
    ipcMain.handle('gesture:get-state', () => this.getState());
    ipcMain.handle('gesture:start', () => this.start());
    ipcMain.handle('gesture:stop', () => this.stop());
    ipcMain.handle('gesture:set-prefs', (_e, patch) => {
      this.prefs = sanitizePrefs(patch, this.prefs);
      this._savePrefs();
      this._sendHud({ t: 'prefs', prefs: { ...this.prefs } });
      this._broadcast();
      return this.getState();
    });
    ipcMain.handle('gesture:hud-init', (event) => {
      if (!this._fromHud(event)) return null;
      const info = this._pickDisplay();
      return { prefs: { ...this.prefs }, aspect: info.aspect, cursor: info.cursor };
    });
    ipcMain.on('gesture:hud', (event, msg) => {
      if (!this._fromHud(event)) return;
      this._onHud(msg);
    });
  }
}

function sanitizePrefs(raw, base) {
  const out = { ...base };
  if (raw && typeof raw === 'object') {
    if (REACH.has(raw.reach)) out.reach = raw.reach;
    if (typeof raw.naturalScroll === 'boolean') out.naturalScroll = raw.naturalScroll;
  }
  return out;
}

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : NaN; }
function unit(v) { const n = num(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : NaN; }

const MODES = new Set(['none', 'arming', 'hover', 'press', 'right', 'scroll', 'wheel', 'volume']);

function sanitizeTelemetry(d) {
  if (!d || typeof d !== 'object') return null;
  const points = Array.isArray(d.points) && d.points.length === 42 && d.points.every((v) => typeof v === 'number' && Number.isFinite(v))
    ? d.points
    : null;
  const b = d.box;
  const box = b && typeof b === 'object' && [b.x, b.y, b.w, b.h].every((v) => typeof v === 'number' && Number.isFinite(v))
    ? { x: b.x, y: b.y, w: b.w, h: b.h }
    : null;
  return {
    mode: MODES.has(d.mode) ? d.mode : 'none',
    points,
    box,
    pinch: unit(d.pinch) || 0,
    fps: Math.max(0, Math.min(120, Math.round(num(d.fps) || 0))),
    inferMs: Math.max(0, Math.min(10000, num(d.inferMs) || 0)),
    action: typeof d.action === 'string' ? d.action.slice(0, 40) : '',
    actionAt: num(d.actionAt) || 0,
  };
}

module.exports = { GestureControl, sanitizePrefs, sanitizeTelemetry, STOP_HOTKEY };
