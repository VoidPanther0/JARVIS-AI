// ═══════════════════════════════════════════════════════════════════════════
//  Push-to-talk — shortcut daba ke rakho to Maya sunta hai, chhodo to jawab
// ═══════════════════════════════════════════════════════════════════════════
//
//  Settings → AI Engine → "How Maya listens":
//    conversation  (default) — Talk dabao, phir End tak har waqt sunta hai
//    ptt                     — sirf shortcut (ya floating ka mic) dabane par
//
//  Yahan sirf do kaam: (1) user ki pasand (`push-to-talk.json`), (2) Windows par
//  poore PC ka shortcut. Mic, baat-cheet aur dono voices ka hisaab renderer mein
//  (src/lib/ptt) — wahi voice ka maalik hai.
//
//  ── Shortcut KAISE pakarte hain (aur kyun aise) ─────────────────────────────
//  Ek chhota PowerShell + C# helper Windows ka sarkari `RegisterHotKey` lagata hai
//  — wohi API jis se Electron ka globalShortcut bana hai. Keyboard ko lagataar
//  NAHI dekhta (GetAsyncKeyState / low-level hook nahi): wo keylogger ka tareeqa
//  hai aur antivirus app ko pakar leta. Hold / chhorna hotkey ke auto-repeat se
//  (push-to-talk-gesture.js). Shortcut kisi app tak nahi pohanchta (Windows
//  usay "kha" leta hai) — is liye Space dabane se kahin space nahi likha jata.
//
//  Helper sirf tab chalta hai jab mode 'ptt' ho; Settings mein naya shortcut
//  record karte waqt ruk jata hai (warna wohi shortcut record hi na hota).
//  Mac / Linux par shortcut nahi — wahan floating ka mic daba ke rakho.

const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PttGesture } = require('./push-to-talk-gesture');
const { DEFAULT_SHORTCUT, FALLBACK_SHORTCUT, LEGACY_DEFAULT_SHORTCUT, validateShortcut, sameShortcut } = require('./push-to-talk-keys');

const MODES = ['conversation', 'ptt'];
const READY_TIMEOUT_MS = 20_000;
const MAX_RESTARTS = 3;
// ERROR_HOTKEY_ALREADY_REGISTERED — koi aur app ye shortcut le chuka.
const ERROR_HOTKEY_TAKEN = 1409;
// Helper ka apna: akeli key user ke keyboard par harf likhti hai (Arabic par ` = ذ).
const ERROR_TYPES_LETTER = -2;
// v2 (14 Nov): shortcut sirf tab likha jata hai jab user ne khud chuna; null = default.
const PREFS_VERSION = 2;

// ── Helper (PowerShell + C#) ────────────────────────────────────────────────
// Ye JS template literal hai: script mein BACKSLASH, BACKTICK aur DOLLAR-BRACE
// nahi (desktop-presence-native.js wala sabaq). JSON ka quote `(char)34` se.
const PTT_HELPER_PS1 = `param([int]$ParentPid = 0, [int]$Mods = 0, [int]$Vk = 0, [int]$Scan = 0)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class MayaPtt
{
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }

    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, out int value, uint winIni);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
    [DllImport("user32.dll")] static extern uint MapVirtualKeyEx(uint code, uint mapType, IntPtr hkl);
    [DllImport("user32.dll")] static extern int GetKeyboardLayoutList(int count, IntPtr[] list);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ToUnicodeEx(uint vk, uint scan, byte[] keyState, StringBuilder buffer, int size, uint flags, IntPtr hkl);

    const uint WM_HOTKEY = 0x0312;
    const uint MAPVK_VK_TO_VSC = 0;
    const uint MAPVK_VSC_TO_VK = 1;
    // ToUnicodeEx: user ki keyboard ki halat (dead key waghera) na chhero — Windows 10 1607+.
    const uint TU_NO_STATE_CHANGE = 4;
    // Apna error: akeli key user ke kisi keyboard par harf / number likhti hai.
    const int ERROR_TYPES_LETTER = -2;
    const uint SPI_GETKEYBOARDSPEED = 0x000A;
    const uint SPI_GETKEYBOARDDELAY = 0x0016;
    static readonly string Q = ((char)34).ToString();
    static readonly object WriteLock = new object();

    static void Emit(string body)
    {
        lock (WriteLock)
        {
            Console.Out.Write("{" + body + "}");
            Console.Out.Write((char)10);
            Console.Out.Flush();
        }
    }

    static string S(string name, string value) { return Q + name + Q + ":" + Q + value + Q; }
    static string N(string name, long value) { return Q + name + Q + ":" + value; }

    static bool Alive(int pid)
    {
        try { using (Process p = Process.GetProcessById(pid)) { return !p.HasExited; } }
        catch { return false; }
    }

    // Ye vk user ke kisi bhi installed keyboard (English, Arabic, Urdu...) par harf ya number likhti hai?
    // Akeli key ke liye: RegisterHotKey usay poore PC se chheen leta — wo harf likhna hi band ho jata.
    static string LetterOn(uint vk)
    {
        try
        {
            int count = GetKeyboardLayoutList(0, null);
            if (count <= 0) return "";
            IntPtr[] layouts = new IntPtr[count];
            count = GetKeyboardLayoutList(count, layouts);
            byte[] keyState = new byte[256];
            for (int i = 0; i < count; i++)
            {
                StringBuilder text = new StringBuilder(8);
                uint scan = MapVirtualKeyEx(vk, MAPVK_VK_TO_VSC, layouts[i]);
                int got = ToUnicodeEx(vk, scan, keyState, text, text.Capacity, TU_NO_STATE_CHANGE, layouts[i]);
                for (int c = 0; c < got && c < text.Length; c++)
                {
                    if (char.IsLetterOrDigit(text[c])) return text[c].ToString();
                }
            }
        }
        catch { }
        return "";
    }

    public static void Run(int parentPid, uint mods, uint vk, uint scan)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        // stdin band (Electron gaya) ya "quit" → nikal jao.
        Thread reader = new Thread(delegate ()
        {
            try { string line; while ((line = Console.In.ReadLine()) != null) { if (line.Trim() == "quit") break; } } catch { }
            Environment.Exit(0);
        });
        reader.IsBackground = true;
        reader.Start();
        Thread watch = new Thread(delegate ()
        {
            while (true)
            {
                Thread.Sleep(2000);
                if (parentPid > 0 && !Alive(parentPid)) Environment.Exit(0);
            }
        });
        watch.IsBackground = true;
        watch.Start();

        // Windows ki keyboard setting: pehla repeat kab (0..3 = 250..1000 ms) aur kitni tezi (0..31 = ~2.5..30 / s).
        int delay = 1;
        int speed = 31;
        try { SystemParametersInfo(SPI_GETKEYBOARDDELAY, 0, out delay, 0); } catch { }
        try { SystemParametersInfo(SPI_GETKEYBOARDSPEED, 0, out speed, 0); } catch { }
        if (delay < 0 || delay > 3) delay = 1;
        if (speed < 0 || speed > 31) speed = 31;
        int delayMs = (delay + 1) * 250;
        int intervalMs = (int)Math.Round(1000.0 / (2.5 + speed * (27.5 / 31.0)));

        // Key ki JAGAH di gayi (Esc ke neeche wali): is keyboard layout par us ka asli vk lo.
        if (scan > 0)
        {
            uint mapped = MapVirtualKey(scan, MAPVK_VSC_TO_VK);
            if (mapped > 0) vk = mapped;
        }
        if (mods == 0)
        {
            string letter = LetterOn(vk);
            if (letter.Length > 0)
            {
                Emit(S("ev", "ready") + "," + N("ok", 0) + "," + N("error", ERROR_TYPES_LETTER) + "," + S("ch", letter));
                Thread.Sleep(300);
                return;
            }
        }

        // MOD_NOREPEAT jaan boojh kar NAHI: dabi key ke repeats se hi "hold" aur "chhora" pata chalta hai.
        bool ok = RegisterHotKey(IntPtr.Zero, 1, mods, vk);
        int err = ok ? 0 : Marshal.GetLastWin32Error();
        Emit(S("ev", "ready") + "," + N("ok", ok ? 1 : 0) + "," + N("error", err) + "," + N("delay", delayMs) + "," + N("interval", intervalMs));
        if (!ok) { Thread.Sleep(300); return; }

        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            if (msg.message == WM_HOTKEY) Emit(S("ev", "hk"));
        }
        UnregisterHotKey(IntPtr.Zero, 1);
    }
}
'@
[MayaPtt]::Run($ParentPid, [uint32]$Mods, [uint32]$Vk, [uint32]$Scan)
`;

const supportedPlatform = () => process.platform === 'win32';

class PushToTalk {
  /**
   * @param {{ userDataDir: string, isLocked?: () => boolean }} opts
   */
  constructor({ userDataDir, isLocked }) {
    this.file = path.join(userDataDir, 'push-to-talk.json');
    this.helperDir = path.join(userDataDir, 'ptt');
    this.isLocked = typeof isLocked === 'function' ? isLocked : () => false;
    // Default key is PC ke keyboard par jo harf likhti hai (mila to default = Ctrl + Space). Har app start par dobara jaanch.
    this.defaultBlocked = null;
    this.prefs = this._load();
    this.win = null;
    this.ipcRegistered = false;

    this.child = null;
    this.childStopping = false;
    this.readyTimer = null;
    this.restarts = 0;
    this.recording = false;
    this.status = { state: 'off', error: null };

    this.gesture = new PttGesture();
    for (const type of ['press', 'hold', 'release', 'tap']) {
      this.gesture.on(type, () => this._emit(type));
    }
  }

  // ── Bahar se ────────────────────────────────────────────────────────────

  /** Bari window (voice ki maalik) — ishare isi ko jate hain. */
  setWindow(win) {
    this.win = win && !win.isDestroyed() ? win : null;
    if (this.win) this.win.on('closed', () => { this.win = null; this._sync(); });
    this._sync();
  }

  /** Maya Voice ka engine (voice-beta-manager) baat-cheet shuru karte waqt yahi poochta hai. */
  mode() {
    return this.prefs.mode;
  }

  registerIpc() {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;
    ipcMain.handle('ptt:get-state', () => this._state());
    ipcMain.handle('ptt:set-prefs', (_event, patch) => this._setPrefs(patch));
    // Settings mein naya shortcut record ho raha hai: helper ruke, warna purana shortcut keys kha leta.
    ipcMain.on('ptt:recording', (_event, active) => {
      this.recording = Boolean(active);
      this._sync();
    });
  }

  shutdown() {
    this._stopHelper();
  }

  // ── Pasand ──────────────────────────────────────────────────────────────

  /** Is PC ka default: Esc ke neeche wali key — magar jis keyboard par wo harf likhe, wahan Ctrl + Space. */
  _defaultShortcut() {
    return validateShortcut(this.defaultBlocked ? FALLBACK_SHORTCUT : DEFAULT_SHORTCUT).shortcut;
  }

  /** Abhi chalne wala shortcut: user ka chuna hua, warna default. */
  _shortcut() {
    return this.prefs.custom || this._defaultShortcut();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // v1 (14 Nov se pehle) har dafa shortcut likhta tha: wahan purana default (Ctrl + Alt + Space) = user ne kuch nahi chuna.
      const oldDefault = raw.v !== PREFS_VERSION && sameShortcut(raw.shortcut, LEGACY_DEFAULT_SHORTCUT);
      const checked = raw.shortcut && !oldDefault ? validateShortcut(raw.shortcut) : null;
      return {
        mode: MODES.includes(raw.mode) ? raw.mode : 'conversation',
        custom: checked?.ok ? checked.shortcut : null,
      };
    } catch {
      return { mode: 'conversation', custom: null };
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const custom = this.prefs.custom ? { code: this.prefs.custom.code, mods: this.prefs.custom.mods } : null;
      fs.writeFileSync(this.file, JSON.stringify({ v: PREFS_VERSION, mode: this.prefs.mode, shortcut: custom }, null, 2), 'utf8');
    } catch (err) {
      console.warn('[PTT] pasand save nahi hui:', err.message);
    }
  }

  _state() {
    const { code, mods, label } = this._shortcut();
    return {
      mode: this.prefs.mode,
      shortcut: { code, mods, label },
      defaultLabel: this._defaultShortcut().label,
      // Esc ke neeche wali key is PC ke keyboard par ye harf likhti hai — is liye default Ctrl + Space.
      defaultBlockedBy: this.defaultBlocked,
      supported: { shortcut: supportedPlatform() },
      status: { ...this.status },
    };
  }

  _broadcast() {
    const state = this._state();
    for (const win of BrowserWindow.getAllWindows()) {
      try { if (!win.isDestroyed()) win.webContents.send('ptt:state', state); } catch { /* window ja rahi hai */ }
    }
  }

  _setPrefs(patch) {
    if (!patch || typeof patch !== 'object') return { ok: false, code: 'bad_request', state: this._state() };
    let changedShortcut = false;
    if (patch.mode !== undefined) {
      if (!MODES.includes(patch.mode)) return { ok: false, code: 'bad_mode', state: this._state() };
      this.prefs.mode = patch.mode;
    }
    if (patch.shortcut !== undefined) {
      const before = this._shortcut().label;
      if (patch.shortcut === 'default') {
        this.prefs.custom = null;
      } else {
        const checked = validateShortcut(patch.shortcut);
        if (!checked.ok) return { ok: false, code: checked.code, message: checked.message, state: this._state() };
        this.prefs.custom = checked.shortcut;
      }
      changedShortcut = this._shortcut().label !== before;
    }
    this._save();
    if (changedShortcut) {
      this.restarts = 0;
      this._stopHelper();
    }
    this._sync();
    this._broadcast();
    return { ok: true, state: this._state() };
  }

  // ── Helper ka chalna / rukna ────────────────────────────────────────────

  _wanted() {
    return supportedPlatform() && this.prefs.mode === 'ptt' && !this.recording && Boolean(this.win);
  }

  _sync() {
    if (this._wanted()) this._startHelper();
    else this._stopHelper();
  }

  _setStatus(state, error = null) {
    if (this.status.state === state && this.status.error === error) return;
    this.status = { state, error };
    this._broadcast();
  }

  _startHelper() {
    if (this.child) return;
    let script;
    try {
      fs.mkdirSync(this.helperDir, { recursive: true });
      script = path.join(this.helperDir, 'ptt-helper.ps1');
      fs.writeFileSync(script, PTT_HELPER_PS1, 'utf8');
    } catch (err) {
      console.warn('[PTT] helper likha nahi gaya:', err.message);
      this._setStatus('error', 'helper');
      return;
    }
    const { modBits, vk, scan } = this._shortcut();
    let child;
    try {
      child = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script, '-ParentPid', String(process.pid), '-Mods', String(modBits), '-Vk', String(vk), '-Scan', String(scan || 0),
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      console.warn('[PTT] helper shuru nahi hua:', err.message);
      this._setStatus('error', 'helper');
      return;
    }
    this.child = child;
    this.childStopping = false;
    this._setStatus('starting');
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      if (this.child === child && this.status.state === 'starting') {
        console.warn('[PTT] helper waqt par tayyar nahi hua');
        this._setStatus('error', 'helper');
        this._stopHelper(true);
      }
    }, READY_TIMEOUT_MS);

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.replace(/^﻿/, '').trim();
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (this.child === child) this._onHelper(msg);
      }
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-1500); });
    child.stdin.on('error', () => { /* process ja chuka — exit sambhalta hai */ });
    child.on('error', () => { /* exit sambhalta hai */ });
    child.once('exit', (code) => {
      if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; }
      if (this.child !== child) return;
      this.child = null;
      this.gesture.reset();
      const intentional = this.childStopping;
      this.childStopping = false;
      if (intentional) return;
      if (this.status.state === 'error') return; // shortcut kisi aur ka — dobara koshish se kuch nahi badlega
      if (stderr.trim()) console.warn('[PTT] helper stderr:', stderr.trim().split(/\r?\n/).slice(-3).join(' | '));
      console.warn(`[PTT] helper band hua (${code})`);
      if (!this._wanted()) { this._setStatus('off'); return; }
      if (this.restarts >= MAX_RESTARTS) { this._setStatus('error', 'helper'); return; }
      this.restarts += 1;
      this._setStatus('starting');
      setTimeout(() => { if (this._wanted() && !this.child) this._startHelper(); }, 1500 * this.restarts).unref?.();
    });
  }

  _onHelper(msg) {
    if (msg.ev === 'ready') {
      if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; }
      if (Number(msg.ok) === 1) {
        this.gesture.setTiming(msg.delay, msg.interval);
        this.restarts = 0;
        this._setStatus('ready');
      } else if (Number(msg.error) === ERROR_TYPES_LETTER) {
        this._onTypesLetter(String(msg.ch || ''));
      } else {
        this._setStatus('error', Number(msg.error) === ERROR_HOTKEY_TAKEN ? 'taken' : 'register');
      }
      return;
    }
    if (msg.ev === 'hk') this.gesture.hotkey();
  }

  /**
   * Akeli key user ke keyboard par harf likhti hai (Arabic par Esc ke neeche = ذ) — lete to wo harf poore PC par band.
   * Default thi → is PC par chupchaap Ctrl + Space (Settings wajah batata hai). User ne khud chuni → saaf error.
   */
  _onTypesLetter(ch) {
    if (!this.prefs.custom && !this.defaultBlocked) {
      this.defaultBlocked = ch || '?';
      console.warn('[PTT] default key is keyboard par harf likhti hai — Ctrl + Space laga');
      this.restarts = 0;
      this._stopHelper();
      this._sync();
      this._broadcast();
      return;
    }
    this._setStatus('error', 'letter');
  }

  _stopHelper(keepStatus = false) {
    const child = this.child;
    this.child = null;
    if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; }
    this.gesture.reset();
    if (child) {
      this.childStopping = true;
      try { child.stdin.write('quit\n'); } catch { /* ja chuka */ }
      setTimeout(() => { try { child.kill(); } catch { /* ja chuka */ } }, 600).unref?.();
    }
    if (!keepStatus) this._setStatus(this._wanted() ? 'starting' : 'off');
  }

  // ── Ishara voice tak ────────────────────────────────────────────────────

  _emit(type) {
    // Face Lock laga ho to koi sunna nahi (taale ke saamne koi aur ho sakta hai).
    if (this.isLocked() && type !== 'release') return;
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send('ptt:event', { type, at: Date.now() }); } catch { /* window ja rahi hai */ }
  }
}

module.exports = { PushToTalk, PTT_HELPER_PS1 };
