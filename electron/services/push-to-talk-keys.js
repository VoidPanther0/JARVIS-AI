// Push-to-talk ke shortcut ki fehrist aur qaide — main process hi faisla karta hai.
//
// Renderer sirf `KeyboardEvent.code` + modifiers bhejta hai; yahan us ka Windows
// virtual-key aur label banta hai, aur jaancha jata hai ke shortcut user ka koi
// zaroori kaam na chheene (Ctrl+C, typing, Alt+F4…). RegisterHotKey dabaye gaye
// shortcut ko poore Windows se "kha" leta hai — is liye ghalat chunao = user ka
// ek shortcut har app mein band. Pehle hi rok do.

const MOD = { alt: 0x1, ctrl: 0x2, shift: 0x4, win: 0x8 };
const MOD_ORDER = ['ctrl', 'alt', 'shift', 'win'];
const MOD_LABEL = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', win: 'Win' };

/**
 * code → { vk, label, kind, scan }. kind: 'solo' = akela bhi chalega; 'nav' = ek modifier kaafi; 'type' = likhne wali key.
 * scan (sirf kuch keys): key ki JAGAH (scan code). Helper isi se user ke keyboard layout ka asli vk nikalta hai —
 * warna UK layout par 0xC0 = apostrophe ki key, aur poore PC se ' likhna band ho jata.
 */
const KEYS = (() => {
  const table = {};
  const add = (code, vk, label, kind, scan = 0) => { table[code] = { vk, label, kind, scan }; };
  for (let i = 0; i < 26; i += 1) {
    const ch = String.fromCharCode(65 + i);
    add(`Key${ch}`, 0x41 + i, ch, 'type');
  }
  for (let i = 0; i <= 9; i += 1) add(`Digit${i}`, 0x30 + i, String(i), 'type');
  for (let i = 1; i <= 24; i += 1) add(`F${i}`, 0x6f + i, `F${i}`, 'solo');
  add('Pause', 0x13, 'Pause', 'solo');
  add('ScrollLock', 0x91, 'Scroll Lock', 'solo');
  add('Insert', 0x2d, 'Insert', 'solo');
  add('Space', 0x20, 'Space', 'nav');
  add('Home', 0x24, 'Home', 'nav');
  add('End', 0x23, 'End', 'nav');
  add('PageUp', 0x21, 'Page Up', 'nav');
  add('PageDown', 0x22, 'Page Down', 'nav');
  add('ArrowUp', 0x26, 'Up', 'nav');
  add('ArrowDown', 0x28, 'Down', 'nav');
  add('ArrowLeft', 0x25, 'Left', 'nav');
  add('ArrowRight', 0x27, 'Right', 'nav');
  for (let i = 0; i <= 9; i += 1) add(`Numpad${i}`, 0x60 + i, `Num ${i}`, 'type');
  add('NumpadMultiply', 0x6a, 'Num *', 'type');
  add('NumpadAdd', 0x6b, 'Num +', 'type');
  add('NumpadSubtract', 0x6d, 'Num -', 'type');
  add('NumpadDecimal', 0x6e, 'Num .', 'type');
  add('NumpadDivide', 0x6f, 'Num /', 'type');
  // Esc ke neeche wali key: US par ` likhti hai, aam log kabhi nahi likhte — akeli push-to-talk (default).
  // Jis keyboard par ye koi HARF likhe (Arabic = ذ), helper usay nahi leta (push-to-talk.js dekho).
  add('Backquote', 0xc0, '`', 'solo', 0x29);
  add('Minus', 0xbd, '-', 'type');
  add('Equal', 0xbb, '=', 'type');
  add('BracketLeft', 0xdb, '[', 'type');
  add('BracketRight', 0xdd, ']', 'type');
  add('Backslash', 0xdc, '\\', 'type');
  add('Semicolon', 0xba, ';', 'type');
  add('Quote', 0xde, "'", 'type');
  add('Comma', 0xbc, ',', 'type');
  add('Period', 0xbe, '.', 'type');
  add('Slash', 0xbf, '/', 'type');
  return Object.freeze(table);
})();

/**
 * Default: EK key — Esc ke neeche wali (Usman, 14 Nov: "single key, daba ke rakho = suno, chhodo = bhejo").
 * Letter (jaise M) nahi ho sakta: RegisterHotKey wo harf poore PC se chheen leta, typing band.
 * Caps Lock bhi nahi: asli test mein hotkey chali lekin har dabane par Caps on/off hota.
 */
const DEFAULT_SHORTCUT = Object.freeze({ code: 'Backquote', mods: [] });

/**
 * Jis PC ke keyboard par default key koi harf likhti ho (Arabic layout par ذ), wahan ye.
 * Usman (14 Nov): "keys 2 hi hon, 3 unpractical" — do keys, haath ki sab se natural pakar
 * (chhoti ungli Ctrl, angootha Space). Kami: VS Code ka autocomplete, Chinese/Japanese IME ka on/off.
 * Alt + Space NAHI (Windows menu, ChatGPT). Wispr Flow jaisi apps modifier combos leti hain
 * (Usman ka Wispr = Shift + Caps Lock) — ` aur Ctrl + Space un se nahi takrate.
 */
const FALLBACK_SHORTCUT = Object.freeze({ code: 'Space', mods: ['ctrl'] });

/** 14 Nov se pehle ka default — purani pasand ki file mein ye mile to user ne kuch nahi chuna tha. */
const LEGACY_DEFAULT_SHORTCUT = Object.freeze({ code: 'Space', mods: ['ctrl', 'alt'] });

/** Ye kabhi nahi — Windows / har app ka bunyadi kaam. */
const BLOCKED = new Set([
  'alt+F4', 'ctrl+F4', 'alt+Tab', 'ctrl+alt+Delete', 'win+KeyL', 'win+KeyD', 'win+KeyE', 'win+KeyR',
]);

const MESSAGES = {
  bad_key: 'That key can’t be used as a shortcut. Try the key below Esc, or Ctrl + Space.',
  needs_modifier: 'Add Ctrl or Alt to this key, so normal typing keeps working.',
  needs_two: 'Use two keys with this one (for example Ctrl + Alt + K), so your usual shortcuts keep working.',
  blocked: 'Windows uses this shortcut. Pick a different one.',
};

const normalizeMods = (mods) => {
  const set = new Set((Array.isArray(mods) ? mods : []).map((m) => String(m).toLowerCase()).filter((m) => MOD[m] !== undefined));
  return MOD_ORDER.filter((m) => set.has(m));
};

/**
 * Renderer ka bheja hua shortcut jaancho.
 * @returns {{ ok: true, shortcut: { code: string, mods: string[], vk: number, modBits: number, label: string } } | { ok: false, code: string, message: string }}
 */
function validateShortcut(input) {
  const code = String(input?.code || '');
  const key = KEYS[code];
  if (!key) return { ok: false, code: 'bad_key', message: MESSAGES.bad_key };
  const mods = normalizeMods(input?.mods);
  const strong = mods.filter((m) => m !== 'shift');
  if (key.kind === 'nav' && strong.length === 0) return { ok: false, code: 'needs_modifier', message: MESSAGES.needs_modifier };
  // Likhne wali key: Ctrl+C / Alt+F (menu) jaise aam shortcuts bachane ke liye do modifiers (Shift akela nahi ginta).
  if (key.kind === 'type' && (strong.length === 0 || mods.length < 2)) {
    return { ok: false, code: strong.length === 0 ? 'needs_modifier' : 'needs_two', message: strong.length === 0 ? MESSAGES.needs_modifier : MESSAGES.needs_two };
  }
  const id = [...mods, code].join('+');
  if (BLOCKED.has(id)) return { ok: false, code: 'blocked', message: MESSAGES.blocked };
  const modBits = mods.reduce((bits, m) => bits | MOD[m], 0);
  return {
    ok: true,
    shortcut: { code, mods, vk: key.vk, scan: key.scan, modBits, label: [...mods.map((m) => MOD_LABEL[m]), key.label].join(' + ') },
  };
}

/** Do shortcut ek hi hain? (pasand ki file purani ho ya naye, dono par chale) */
const sameShortcut = (a, b) => Boolean(a && b) && a.code === b.code && normalizeMods(a.mods).join('+') === normalizeMods(b.mods).join('+');

module.exports = { KEYS, DEFAULT_SHORTCUT, FALLBACK_SHORTCUT, LEGACY_DEFAULT_SHORTCUT, validateShortcut, sameShortcut, MESSAGES };
