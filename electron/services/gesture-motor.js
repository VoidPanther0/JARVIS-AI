// Gesture Control ka "motor": HUD ke hukm → asli mouse / keyboard (robotjs).
//
// Ye file sirf hisaab hai — koi Electron nahi — taake test seedha chal sake
// (gesture-motor.test.js). Electron wala hissa: gesture-control.js.
//
// Kaam:
//   1. Cursor ko nishane tak NARMI se le jana (~60 dafa / second). Camera 10–30 frame
//      deta hai; un ke beech cursor khud sarakta hai, is liye kamzor PC par bhi
//      harkat hamwar lagti hai.
//   2. Asli mouse hila → foran haath chhor do (user jeet-ta hai, haath nahi).
//   3. Daba hua button KABHI atka na rahe: HUD chup ho jaye (crash / hang) to chhor do.
//   4. Wheel ke kaam sirf ek pakki list se (koi bhi key renderer se nahi aa sakti).

'use strict';

const TICK_MS = 16;
/** Cursor nishane ki taraf: itne ms mein ~63% raasta. Chhota = tez, bara = narm. */
const GLIDE_TAU_MS = 34;
/** Nishana itni der purana aur cursor pohanch gaya → ghari band (CPU zero). */
const IDLE_STOP_MS = 250;
/** Cursor hamari rakhi jagah se itna (DIP) hata = kisi aur ne (asli mouse) hilaya. */
const YIELD_DIP = 10;
/** HUD se itni der koi paighaam nahi aur button daba hai → chhor do. */
const BUTTON_WATCHDOG_MS = 1500;

/** Wheel ke kaam → key (robotjs naam) + modifiers. 'command' = Windows key / Mac Cmd. */
const KEYS = {
  win32: {
    taskview: ['tab', ['command']],
    desktop: ['d', ['command']],
    screenshot: ['s', ['command', 'shift']],
    back: ['left', ['alt']],
    forward: ['right', ['alt']],
    playpause: ['audio_play', []],
    vol_up: ['audio_vol_up', []],
    vol_down: ['audio_vol_down', []],
  },
  darwin: {
    taskview: ['up', ['control']], // Mission Control
    desktop: ['f11', []],
    screenshot: ['5', ['command', 'shift']],
    back: ['[', ['command']],
    forward: [']', ['command']],
    playpause: ['audio_play', []],
    vol_up: ['audio_vol_up', []],
    vol_down: ['audio_vol_down', []],
  },
};

/** Wheel ke ek "notch" ki robotjs value: Windows = WHEEL_DELTA (120), Mac = pixel. */
const NOTCH = { win32: 120, darwin: 24 };

class GestureMotor {
  /**
   * @param {object} o
   * @param {any} o.robot  @jitsi/robotjs (ya test ka naqli)
   * @param {string} [o.platform]
   * @param {(p:{x:number,y:number}) => {x:number,y:number}} [o.toPhysical] DIP → robotjs pixel
   * @param {() => {x:number,y:number}} o.getCursor  cursor abhi kahan (DIP)
   * @param {(p:{x:number,y:number}) => void} [o.onMove] har harkat ke baad (HUD window saath)
   * @param {() => void} [o.onYield] asli mouse hila
   * @param {() => number} [o.now]
   * @param {typeof setInterval} [o.setTimer]
   * @param {typeof clearInterval} [o.clearTimer]
   */
  constructor(o) {
    this.robot = o.robot;
    this.platform = o.platform || process.platform;
    this.toPhysical = o.toPhysical || ((p) => p);
    this.getCursor = o.getCursor;
    this.onMove = o.onMove || (() => {});
    this.onYield = o.onYield || (() => {});
    this.now = o.now || Date.now;
    this.setTimer = o.setTimer || setInterval;
    this.clearTimer = o.clearTimer || clearInterval;

    this.display = { x: 0, y: 0, width: 1920, height: 1080 };
    this.engaged = false;
    this.goal = null;
    this.cur = null;
    this.lastSet = null;
    this.lastTick = 0;
    this.lastGoalAt = 0;
    this.lastHudAt = this.now();
    this.held = new Set();
    this.timer = null;
    this.scrollRest = { x: 0, y: 0 };
  }

  /** Jis screen par control hai (DIP bounds). */
  setDisplay(bounds) {
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return;
    this.display = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }

  /** HUD zinda hai (har paighaam par). */
  touch() {
    this.lastHudAt = this.now();
  }

  toDip(nx, ny) {
    const d = this.display;
    return { x: d.x + clamp01(nx) * (d.width - 1), y: d.y + clamp01(ny) * (d.height - 1) };
  }

  engage(on) {
    if (on) {
      this.engaged = true;
      this.cur = this._cursor();
      this.goal = null;
      this.lastSet = null;
      return;
    }
    this.engaged = false;
    this.releaseAll();
    this.goal = null;
    this.lastSet = null;
    this._stopTimer();
  }

  target(nx, ny) {
    if (!this.engaged || !finite(nx) || !finite(ny)) return;
    this.goal = this.toDip(nx, ny);
    this.lastGoalAt = this.now();
    if (!this.cur) this.cur = this._cursor();
    this._startTimer();
  }

  down(button, nx, ny) {
    if (!this.engaged || (button !== 'left' && button !== 'right')) return;
    if (finite(nx) && finite(ny)) {
      // Click bilkul usi jagah — narmi nahi, seedha.
      const p = this.toDip(nx, ny);
      this.goal = p;
      this.cur = { ...p };
      this._place(p);
    }
    try { this.robot.mouseToggle('down', button); } catch { return; }
    this.held.add(button);
    this._startTimer();
  }

  up(button) {
    if (!this.held.has(button)) return;
    this.held.delete(button);
    try { this.robot.mouseToggle('up', button); } catch { /* */ }
  }

  releaseAll() {
    for (const b of [...this.held]) this.up(b);
  }

  /** dx / dy notch mein (+y = upar, +x = daayen). Aadhe notch bhi jama hote hain. */
  scroll(dx, dy) {
    if (!this.engaged || !finite(dx) || !finite(dy)) return;
    const unit = NOTCH[this.platform] || NOTCH.win32;
    this.scrollRest.x += clamp(dx, -40, 40) * unit;
    this.scrollRest.y += clamp(dy, -40, 40) * unit;
    const ix = Math.trunc(this.scrollRest.x);
    const iy = Math.trunc(this.scrollRest.y);
    this.scrollRest.x -= ix;
    this.scrollRest.y -= iy;
    if (!ix && !iy) return;
    try { this.robot.scrollMouse(ix, iy); } catch { /* */ }
  }

  /** @returns {boolean} chala ya nahi */
  action(id) {
    const map = KEYS[this.platform] || KEYS.win32;
    const entry = Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null;
    if (!entry) return false;
    const [key, mods] = entry;
    try {
      if (mods.length) this.robot.keyTap(key, mods);
      else this.robot.keyTap(key);
      return true;
    } catch {
      return false;
    }
  }

  dispose() {
    this.engage(false);
  }

  // ── Ghari ──────────────────────────────────────────────────────────────────

  tick() {
    const now = this.now();
    const dt = this.lastTick ? Math.min(100, now - this.lastTick) : TICK_MS;
    this.lastTick = now;

    // Daba button + HUD chup = chhor do (atka hua mouse button sab se bura tajurba hai).
    if (this.held.size && now - this.lastHudAt > BUTTON_WATCHDOG_MS) this.releaseAll();

    if (!this.engaged || !this.goal || !this.cur) {
      if (!this.held.size) this._stopTimer();
      return;
    }

    // Asli mouse ne cursor hilaya? To user ko control do.
    if (this.lastSet) {
      const actual = this._cursor();
      if (Math.hypot(actual.x - this.lastSet.x, actual.y - this.lastSet.y) > YIELD_DIP) {
        this.engage(false);
        this.onYield();
        return;
      }
    }

    const a = 1 - Math.exp(-dt / GLIDE_TAU_MS);
    this.cur.x += (this.goal.x - this.cur.x) * a;
    this.cur.y += (this.goal.y - this.cur.y) * a;
    if (Math.abs(this.goal.x - this.cur.x) < 0.4 && Math.abs(this.goal.y - this.cur.y) < 0.4) {
      this.cur.x = this.goal.x;
      this.cur.y = this.goal.y;
    }

    const rx = Math.round(this.cur.x);
    const ry = Math.round(this.cur.y);
    if (!this.lastSet || rx !== Math.round(this.lastSet.x) || ry !== Math.round(this.lastSet.y)) {
      this._place({ x: rx, y: ry });
    }

    const settled = this.cur.x === this.goal.x && this.cur.y === this.goal.y;
    if (settled && now - this.lastGoalAt > IDLE_STOP_MS && !this.held.size) this._stopTimer();
  }

  _place(p) {
    const phys = this.toPhysical({ x: p.x, y: p.y });
    try {
      // Mac par button dabe hue "drag" event chahiye, warna apps drag nahi maanti.
      if (this.platform === 'darwin' && this.held.size) this.robot.dragMouse(Math.round(phys.x), Math.round(phys.y), [...this.held][0]);
      else this.robot.moveMouse(Math.round(phys.x), Math.round(phys.y));
    } catch { /* */ }
    this.lastSet = { x: p.x, y: p.y };
    this.onMove(p);
  }

  _cursor() {
    try {
      const p = this.getCursor();
      if (p && finite(p.x) && finite(p.y)) return { x: p.x, y: p.y };
    } catch { /* */ }
    return { x: this.display.x + this.display.width / 2, y: this.display.y + this.display.height / 2 };
  }

  _startTimer() {
    if (this.timer) return;
    this.lastTick = 0;
    this.timer = this.setTimer(() => this.tick(), TICK_MS);
  }

  _stopTimer() {
    if (!this.timer) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }
}

function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function clamp01(v) { return clamp(v, 0, 1); }

module.exports = { GestureMotor, KEYS, YIELD_DIP, BUTTON_WATCHDOG_MS };
