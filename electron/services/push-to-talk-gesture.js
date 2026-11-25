// Push-to-talk ka ishara: shortcut DABA KE RAKHA (hold), ek dafa DABAYA (tap), ya CHHORA (release).
//
// Hum keyboard ko lagataar nahi dekhte (GetAsyncKeyState / hook = antivirus ki nazar
// mein keylogger). Sirf Windows ka sarkari hotkey (RegisterHotKey, MOD_NOREPEAT ke
// BAGHAIR) — Microsoft ke docs: "MOD_NOREPEAT na ho to keyboard ka auto-repeat kai
// hotkey notifications deta hai". Yani key dabi rahe to Windows har ~33 ms ek
// WM_HOTKEY bhejta hai (pehli dafa `delay` ke baad, 250–1000 ms — user ki Windows
// setting). Isi se pata chalta hai:
//
//   pehla WM_HOTKEY            → 'press'   (mic foran khulta hai)
//   `delay` ke baad dobara aaye → 'hold'    (daba ke rakha hai)
//   phir aana band ho jaye      → 'release' (chhor diya → jawab)
//   dobara aaya hi nahi         → 'tap'     (ek dafa dabaya → haath-free sunna)
//
// Naap (delay / interval) helper Windows se parh kar deta hai (SystemParametersInfo).
// Ye file sirf hisaab hai — koi Electron nahi — taake test seedha chal sake.

const { EventEmitter } = require('events');

/** Pehla repeat itni der (delay ke upar) na aaye to 'tap'. Windows kabhi zara der karta hai. */
const FIRST_REPEAT_MARGIN_MS = 220;
/** Repeat band hone ke baad chhorna maanne ki hadd (interval ka ~2.5 guna, is hadd ke andar). */
const RELEASE_MIN_MS = 120;
const RELEASE_MAX_MS = 600;

class PttGesture extends EventEmitter {
  /**
   * @param {{ setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} [opts] test ke liye ghari.
   */
  constructor({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    super();
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.delayMs = 500;
    this.intervalMs = 33;
    this.state = 'idle'; // idle | pressed | held
    this.firstTimer = null;
    this.releaseTimer = null;
  }

  /** Windows ki keyboard setting (helper ka "ready" paigham). */
  setTiming(delayMs, intervalMs) {
    const delay = Number(delayMs);
    const interval = Number(intervalMs);
    if (Number.isFinite(delay) && delay >= 100 && delay <= 2000) this.delayMs = delay;
    if (Number.isFinite(interval) && interval >= 10 && interval <= 500) this.intervalMs = interval;
  }

  get releaseGapMs() {
    return Math.max(RELEASE_MIN_MS, Math.min(RELEASE_MAX_MS, Math.round(this.intervalMs * 2.5 + 60)));
  }

  /** Ek WM_HOTKEY aaya. */
  hotkey() {
    if (this.state === 'idle') {
      this.state = 'pressed';
      this.emit('press');
      this._clear();
      this.firstTimer = this.setTimer(() => this._onNoRepeat(), this.delayMs + FIRST_REPEAT_MARGIN_MS);
      return;
    }
    if (this.state === 'pressed') {
      this.state = 'held';
      if (this.firstTimer) { this.clearTimer(this.firstTimer); this.firstTimer = null; }
      this.emit('hold');
    }
    this._armRelease();
  }

  /** Sab bhool jao (helper band hua, shortcut badla, taala laga). Dabi hui key = chhori hui. */
  reset() {
    const was = this.state;
    this._clear();
    this.state = 'idle';
    if (was === 'held' || was === 'pressed') this.emit('release');
  }

  _onNoRepeat() {
    this.firstTimer = null;
    if (this.state !== 'pressed') return;
    this.state = 'idle';
    this.emit('tap');
  }

  _armRelease() {
    if (this.releaseTimer) this.clearTimer(this.releaseTimer);
    this.releaseTimer = this.setTimer(() => {
      this.releaseTimer = null;
      if (this.state !== 'held') return;
      this.state = 'idle';
      this.emit('release');
    }, this.releaseGapMs);
  }

  _clear() {
    if (this.firstTimer) { this.clearTimer(this.firstTimer); this.firstTimer = null; }
    if (this.releaseTimer) { this.clearTimer(this.releaseTimer); this.releaseTimer = null; }
  }
}

module.exports = { PttGesture, FIRST_REPEAT_MARGIN_MS };
