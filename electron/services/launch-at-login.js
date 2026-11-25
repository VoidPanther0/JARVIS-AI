'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  Start with Windows — Settings → Startup (Usman, 24 Nov 2026)
// ═══════════════════════════════════════════════════════════════════════════
//
//  User ki marzi, default OFF. ON ho to PC on ho kar login hote hi Stonic khud
//  uthta hai — chupchaap: bari window nahi khulti, awaaz nahi bajti, sirf
//  floating nazar aata hai (main.js ka "quiet start"). App ke andar jana ho to
//  floating ka button (ya Start menu ka Stonic icon).
//
//  Windows ka apna raasta: HKCU\...\CurrentVersion\Run mein ek value (Electron
//  setLoginItemSettings, naam = AppUserModelId "com.stonicai.desktop"). Task
//  Manager → Startup apps aur Settings → Apps → Startup isi ko dikhate / band
//  karte hain. Wahan band ho to hum bhi OFF dikhate hain aur khud kabhi dobara
//  on NAHI karte — Windows ki halat hi sach hai, alag file nahi.
//
//  🔴 exe ka raasta QUOTES mein: Electron `path` ko jaise ka taisa likhta hai,
//  aur "...\Programs\Stonic AI\Stonic AI.exe" mein space hai. Bina quotes ke
//  Windows pehle "...\Programs\Stonic" dhoondta (unquoted-path ka purana
//  masla, aur ek security soorakh bhi). Asli registry par naapa (24 Nov):
//  quotes ke saath value = "C:\...\Stonic AI.exe" --stonic-startup — bilkul
//  OneDrive / Edge ki entries jaisi.
//
//  Dev (npm run electron:dev) mein registry ko haath NAHI lagta: wahan exe
//  node_modules ka electron.exe hai, jo login par Vite ke baghair khali khulta.
//  Dev mein switch sirf ek file mein yaad rehta hai; quiet start aazmane ke
//  liye: STONIC_SIMULATE_STARTUP=1 (dekho isQuietLaunch).

const fs = require('fs');
const path = require('path');
const os = require('os');

/** Windows login par Stonic isi nishan ke saath chalta hai — isi se pata chalta hai ke ye "quiet start" hai. */
const QUIET_LAUNCH_ARG = '--stonic-startup';
/** Bari window ke renderer (preload) ko: tum chupchaap uthe ho — boot ki awaaz / tour abhi nahi. */
const RENDERER_QUIET_ARG = '--stonic-quiet-launch';

/**
 * Ye process Windows login ne chalaya (ya dev mein us ki naqal)?
 * @param {string[]} argv
 * @param {{ simulate?: string }} [opts] dev ka STONIC_SIMULATE_STARTUP
 */
function isQuietLaunch(argv, { simulate } = {}) {
  if (Array.isArray(argv) && argv.includes(QUIET_LAUNCH_ARG)) return true;
  return simulate === '1';
}

class LaunchAtLogin {
  /**
   * @param {{
   *   app: { getLoginItemSettings: Function, setLoginItemSettings: Function },
   *   userDataDir: string,
   *   isPackaged: boolean,
   *   platform?: string,
   *   execPath?: string,
   *   log?: { warn: Function, log: Function },
   * }} opts
   */
  constructor({ app, userDataDir, isPackaged, platform = process.platform, execPath = process.execPath, log = console }) {
    this.app = app;
    this.isPackaged = Boolean(isPackaged);
    this.platform = platform;
    this.execPath = execPath;
    this.log = log;
    // Sirf dev ki naqal ke liye (packaged mein Windows ki halat hi sach hai).
    this.devFile = path.join(userDataDir, 'launch-at-login.dev.json');
    this.ipcRegistered = false;
  }

  supported() {
    return this.platform === 'win32';
  }

  /** Run value ki shakl — set aur get dono mein BILKUL yehi, warna Electron milan nahi kar pata. */
  itemOptions() {
    return { path: `"${this.execPath}"`, args: [QUIET_LAUNCH_ARG] };
  }

  /**
   * @returns {{ supported: boolean, enabled: boolean, blockedBySystem: boolean, dev: boolean, error?: string }}
   *   blockedBySystem = Stonic ki entry hai magar Task Manager / Settings → Startup apps mein band.
   */
  getState() {
    if (!this.supported()) return { supported: false, enabled: false, blockedBySystem: false, dev: false };
    if (!this.isPackaged) return { supported: true, enabled: this._readDev(), blockedBySystem: false, dev: true };
    const sys = this._readSystem();
    if (!sys) return { supported: true, enabled: false, blockedBySystem: false, dev: false, error: 'read' };
    return {
      supported: true,
      enabled: sys.registered && sys.willLaunch,
      blockedBySystem: sys.registered && !sys.willLaunch,
      dev: false,
    };
  }

  /**
   * @param {boolean} on
   * @returns {{ ok: boolean, code?: string, state: ReturnType<LaunchAtLogin['getState']> }}
   */
  setEnabled(on) {
    if (typeof on !== 'boolean') return { ok: false, code: 'invalid', state: this.getState() };
    if (!this.supported()) return { ok: false, code: 'unsupported', state: this.getState() };
    if (!this.isPackaged) {
      this._writeDev(on);
      this.log.log(`[Startup] (dev) Start with Windows ${on ? 'ON' : 'OFF'} — registry ko haath nahi lagaya.`);
      return { ok: true, state: this.getState() };
    }
    try {
      // ON: `enabled` (default true) Task Manager wala "band" bhi hata deta hai —
      // user ne yahan khud ON dabaya hai. OFF: Run value aur us ka "approved" dono mitte hain.
      this.app.setLoginItemSettings({ openAtLogin: on, ...this.itemOptions() });
    } catch (err) {
      this.log.warn('[Startup] Windows startup entry nahi likhi:', err && err.message);
      return { ok: false, code: 'system', state: this.getState() };
    }
    const state = this.getState();
    if (state.enabled !== on) {
      this.log.warn(`[Startup] Likhne ke baad bhi halat ${state.enabled ? 'ON' : 'OFF'} (maanga ${on ? 'ON' : 'OFF'}).`);
      return { ok: false, code: 'system', state };
    }
    this.log.log(`[Startup] Start with Windows ${on ? 'ON' : 'OFF'}.`);
    return { ok: true, state };
  }

  /** @param {{ handle: Function }} ipcMain */
  registerIpc(ipcMain) {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;
    ipcMain.handle('startup:get-state', () => this.getState());
    ipcMain.handle('startup:set-enabled', (_event, on) => this.setEnabled(on));
  }

  _readSystem() {
    try {
      const s = this.app.getLoginItemSettings(this.itemOptions());
      return { registered: s.openAtLogin === true, willLaunch: s.executableWillLaunchAtLogin === true };
    } catch (err) {
      this.log.warn('[Startup] Windows startup entry parhi nahi ja saki:', err && err.message);
      return null;
    }
  }

  _readDev() {
    try {
      return JSON.parse(fs.readFileSync(this.devFile, 'utf8')).enabled === true;
    } catch {
      return false;
    }
  }

  _writeDev(on) {
    try {
      fs.mkdirSync(path.dirname(this.devFile), { recursive: true });
      fs.writeFileSync(this.devFile, JSON.stringify({ enabled: on }, null, 2), 'utf8');
    } catch (err) {
      this.log.warn('[Startup] (dev) pasand save nahi hui:', err && err.message);
    }
  }
}

// ── PC start ke foran baad: kab uthna hai ──────────────────────────────────
//
// Login ke pehle minute mein Windows, antivirus, OneDrive, browser sab ek saath
// uthte hain. Usi waqt Stonic ka ~3MB bundle aur React boot PC ko aur bhaari
// karta. Is liye bari window ka page tab load hota hai jab:
//   - kam se kam MIN waqt guzar jaye (taza boot par zyada), aur
//   - CPU do lagataar naap mein narm ho (saare cores mila kar ≤ CALM_BUSY), aur
//   - network jura ho (warna login check fail → floating hi nahi aata).
// Jo bhi ho, MAX ke baad zaroor — PC kabhi narm na ho to bhi Stonic aaye.
// User beech mein khud Stonic khole to intezaar foran khatam (`release`).

const QUIET_DEFAULTS = Object.freeze({
  freshBootUptimeS: 180, // is se kam uptime = PC abhi abhi on hua
  minFreshMs: 15_000,
  minLateMs: 4_000, // sign out → sign in, ya user switch: PC pehle se garam
  maxFreshMs: 90_000,
  maxLateMs: 30_000,
  sampleMs: 2_000,
  calmBusy: 0.5,
  calmSamples: 2,
});

/** Do os.cpus() naap ke beech CPU kitna masroof raha (0..1, saare cores mila kar). */
function cpuBusy(before, after) {
  let busy = 0;
  let total = 0;
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i += 1) {
    const a = before[i].times;
    const b = after[i].times;
    const idle = b.idle - a.idle;
    const all = (b.user - a.user) + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq) + idle;
    if (all <= 0) continue;
    total += all;
    busy += all - idle;
  }
  return total > 0 ? Math.min(1, Math.max(0, busy / total)) : 0;
}

/**
 * Narm lamhe ka intezaar. Har cheez bahar se di ja sakti hai (test ke liye).
 * @returns {{ promise: Promise<{ reason: 'calm'|'max-wait'|'released', waitedMs: number, busy: number|null, online: boolean|null }>, release: (why?: string) => void }}
 */
function waitForQuietMoment({
  cpus = () => os.cpus(),
  uptimeS = () => os.uptime(),
  isOnline = () => true,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  options = {},
} = {}) {
  const o = { ...QUIET_DEFAULTS, ...options };
  const started = now();
  let fresh = true;
  try { fresh = uptimeS() < o.freshBootUptimeS; } catch { /* na pata ho to ehtiyaat */ }
  const minMs = fresh ? o.minFreshMs : o.minLateMs;
  const maxMs = fresh ? o.maxFreshMs : o.maxLateMs;

  let settle;
  let timer = null;
  let done = false;
  let lastBusy = null;
  let lastOnline = null;
  const promise = new Promise((resolve) => { settle = resolve; });
  const finish = (reason) => {
    if (done) return;
    done = true;
    if (timer) { clearTimer(timer); timer = null; }
    settle({ reason, waitedMs: now() - started, busy: lastBusy, online: lastOnline });
  };

  let prev = null;
  try { prev = cpus(); } catch { prev = null; }
  let calm = 0;
  const tick = () => {
    timer = null;
    if (done) return;
    let cur = null;
    try { cur = cpus(); } catch { cur = null; }
    lastBusy = prev && cur ? cpuBusy(prev, cur) : null;
    prev = cur;
    try { lastOnline = Boolean(isOnline()); } catch { lastOnline = true; }
    const elapsed = now() - started;
    // CPU naapa hi na ja sake to us ki wajah se mat ruko — sirf waqt aur network.
    calm = lastBusy === null || lastBusy <= o.calmBusy ? calm + 1 : 0;
    if (elapsed >= minMs && calm >= o.calmSamples && lastOnline) { finish('calm'); return; }
    if (elapsed >= maxMs) { finish('max-wait'); return; }
    timer = setTimer(tick, o.sampleMs);
  };
  timer = setTimer(tick, o.sampleMs);

  return { promise, release: () => finish('released') };
}

module.exports = {
  LaunchAtLogin,
  QUIET_LAUNCH_ARG,
  RENDERER_QUIET_ARG,
  QUIET_DEFAULTS,
  isQuietLaunch,
  cpuBusy,
  waitForQuietMoment,
};
