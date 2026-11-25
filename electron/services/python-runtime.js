// ═══════════════════════════════════════════════════════════════
//  Bundled Python — the one CPython every bundled venv runs on
//
//  Packaged app:  resources/python-runtime/python   (scripts/setup-python-runtime.js)
//  Dev machine:   <repo>/python-runtime/python
//
//  voice-runtime/ (Stonic Voice engine) and computer-runtime/ (computer-use
//  sidecar) are relocatable venvs built on it. A venv's pyvenv.cfg stores the
//  interpreter's folder (`home`) as an ABSOLUTE path — the build machine's —
//  so on first boot it is rewritten to wherever the app was installed. If the
//  install folder refuses that write, venvLaunch() starts the interpreter
//  directly instead, so the app never depends on writing into its own folder.
//
//  (Until Nov 2026 this interpreter lived inside hermes-runtime/. Hermes was
//  removed from Stonic; the interpreter stays on its own.)
// ═══════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';

/** python-runtime/ ka root (jis mein python/ hai), ya null. */
function findPythonRuntimeRoot() {
    const candidates = [
        process.resourcesPath ? path.join(process.resourcesPath, 'python-runtime') : null,
        path.join(__dirname, '..', '..', 'python-runtime'),
    ];
    for (const dir of candidates) {
        try {
            if (dir && fs.existsSync(path.join(dir, 'python'))) return dir;
        } catch { /* parha nahi gaya — agla */ }
    }
    return null;
}

/** Interpreter ka folder (`home`): Windows par python/ (python.exe wahin), Mac/Linux par python/bin. */
function pythonHomeDir() {
    const root = findPythonRuntimeRoot();
    if (!root) return null;
    return isWindows ? path.join(root, 'python') : path.join(root, 'python', 'bin');
}

/** Windows par raaste ke chhote/bare huroof ek hi hain; baqi jagah bilkul barabar. */
function samePath(a, b) {
    const x = path.resolve(a);
    const y = path.resolve(b);
    return isWindows ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * Venv ka pyvenv.cfg `home` bundled Python par lagao.
 *
 * Lautata hai:
 *   'ok'        `home` pehle se sahi tha, ya ab likh diya gaya — venv chal sakta hai.
 *   'readonly'  `home` purana hai aur install folder likhne nahi deta (Program Files,
 *               Controlled Folder Access, read-only file…).
 *   'broken'    bundled Python ya pyvenv.cfg hi nahi — files gayab hain.
 *
 * File UTF-8 mein likhi jati hai, kyunke Python (venv redirector, getpath, site.py)
 * usay UTF-8 hi parhta hai. Pehle yahan 'ascii' tha: jis user ke Windows naam mein
 * English ke ilawa koi harf ho (maslan Urdu), us ka raasta bigar kar likha jata aur
 * Stonic Voice chal hi nahi sakti thi.
 *
 * @param {string} venvRoot  wo folder jis mein venv/ hai (voice-runtime / computer-runtime)
 * @param {string} label     log ke liye
 */
function relocateVenvStatus(venvRoot, label) {
    const cfgPath = path.join(venvRoot, 'venv', 'pyvenv.cfg');
    const home = pythonHomeDir();
    if (!home) return 'broken';
    let cfg;
    try { cfg = fs.readFileSync(cfgPath, 'utf8'); } catch { return 'broken'; }
    const current = /^home\s*=\s*(.*)$/m.exec(cfg);
    if (current && samePath(current[1].trim(), home)) return 'ok';
    // Replacer function, string nahi: folder ke naam mein "$&" ya "$'" ho to
    // replace() unhein pattern samajh kar raasta bigaar deta.
    const next = current
        ? cfg.replace(/^home\s*=\s*.*$/m, () => `home = ${home}`)
        : `home = ${home}\n${cfg}`;
    try {
        fs.writeFileSync(cfgPath, next, 'utf8');
        console.log(`[${label}] pyvenv.cfg home →`, home);
        return 'ok';
    } catch (err) {
        console.warn(`[${label}] pyvenv.cfg likhi nahi ja saki (${err.code || err.message}).`);
        return 'readonly';
    }
}

/** Purana jawab (true/false) — `relocateVenvStatus` ka 'ok'. */
function relocateVenv(venvRoot, label) {
    return relocateVenvStatus(venvRoot, label) === 'ok';
}

// Jis venv ka pyvenv.cfg is session mein likha na ja saka, uska faisla yaad: har
// status poll par dobara nakaam likhai aur log ki line nahi.
const launcherFallbacks = new Map();

/**
 * Bundled venv (voice-runtime / computer-runtime) ka Python KAISE chalana hai.
 *
 *   mode 'venv'      Aam raasta, har per-user install: <venv>\Scripts\python.exe, jab
 *                    pyvenv.cfg ka `home` bundled interpreter par ho (relocateVenvStatus).
 *   mode 'launcher'  pyvenv.cfg purana hai aur install folder usay theek nahi karne
 *                    deta. Venv ka redirector (Scripts\python.exe) purane `home` par
 *                    "No Python at …" keh kar mar jata — Stonic Voice ka "missing
 *                    from this copy" isi se aata tha. Is liye bundled interpreter ko
 *                    seedha chalao aur venv ka pata __PYVENV_LAUNCHER__ se do: yahi
 *                    hand-off CPython ka apna venv redirector aur multiprocessing
 *                    (bpo-35797) karte hain. Python `home` ki jagah asal exe se apna
 *                    stdlib dhoondta hai, site.py venv ki site-packages (.pth samet)
 *                    lagata hai, aur startup par variable khud environment se hata
 *                    deta hai — aage ke processes tak nahi jata. Kuch likha nahi jata.
 *                    Sirf Windows (redirector wahin hai); baqi jagah pehle jaisa.
 *
 * Python ko hamesha `pythonSpawnEnv()` wale environment ke saath chalao.
 *
 * @returns {{ python: string|null, env: Record<string,string>, mode: 'venv'|'launcher'|null, venvPython: string, problem: string|null }}
 */
function venvLaunch(venvRoot, label) {
    const venvPython = path.join(venvRoot, 'venv', isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python');
    const none = (problem) => ({ python: null, env: {}, mode: null, venvPython, problem });
    if (!fs.existsSync(venvPython)) return none(`${venvPython} nahi mili`);

    const home = pythonHomeDir();
    // Windows par interpreter ki file bhi dekho: folder ho magar python.exe gayab
    // (antivirus) to redirector "No Python at …" se marta, aur woh "files gayab"
    // ki jagah engine ki nakaami lagti.
    const base = home && isWindows ? path.join(home, 'python.exe') : null;
    if (!home || (base && !fs.existsSync(base))) return none('bundled Python (python-runtime) nahi mila');

    const key = path.resolve(venvRoot).toLowerCase();
    const remembered = launcherFallbacks.get(key);
    if (remembered) return { ...remembered, env: { ...remembered.env } };

    const status = relocateVenvStatus(venvRoot, label);
    if (status === 'ok') return { python: venvPython, env: {}, mode: 'venv', venvPython, problem: null };
    if (status === 'broken') return none(`${path.join(venvRoot, 'venv', 'pyvenv.cfg')} nahi parhi ja saki`);
    if (!base) return none('pyvenv.cfg purani hai aur install folder likhne nahi deta');

    const spec = { python: base, env: { __PYVENV_LAUNCHER__: venvPython }, mode: 'launcher', venvPython, problem: null };
    launcherFallbacks.set(key, spec);
    console.warn(`[${label}] Install folder likhne nahi deta — venv bundled Python se seedha chal raha hai (__PYVENV_LAUNCHER__).`);
    return { ...spec, env: { ...spec.env } };
}

/**
 * Bundled Python ka environment: `baseEnv` ki copy, kisi purane __PYVENV_LAUNCHER__
 * ke baghair, upar se `launch.env`. Purana variable reh jaye to seedha chalaya gaya
 * interpreter khud ko kisi aur venv ka samajh leta.
 */
function pythonSpawnEnv(baseEnv, launch) {
    const env = { ...baseEnv };
    delete env.__PYVENV_LAUNCHER__;
    return { ...env, ...((launch && launch.env) || {}) };
}

module.exports = { findPythonRuntimeRoot, pythonHomeDir, relocateVenv, relocateVenvStatus, venvLaunch, pythonSpawnEnv };
