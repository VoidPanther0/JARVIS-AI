// ═══════════════════════════════════════════════════════════════
//  Maya Voice (Beta) runtime — kaunsa Python, kahan ka engine
//
//  Engine (maya-voice/server.py = Pipecat pipeline) ko ek Python chahiye jis
//  mein pipecat-ai aur us ke saathi installed hon.
//
//  Packaged app:  resources/voice-runtime/venv     (scripts/setup-voice-runtime.js)
//                 resources/maya-voice/server.py
//  Dev machine:   wahi folder repo ke andar ho to wahi; warna Voice Lab ka venv
//                 (../voice-lab/.venv) — taake runtime banaye baghair test ho sake.
//
//  venv bundled CPython (python-runtime/, computer-runtime ki tarah) par bana
//  hai; us ka pyvenv.cfg `home` absolute path hai — pehli dafa chalne par
//  python-runtime.js usay theek karta hai.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { venvLaunch } = require('./python-runtime');

const isWindows = process.platform === 'win32';
const REPO_ROOT = path.join(__dirname, '..', '..');

function firstExisting(list) {
    for (const p of list) {
        try {
            if (p && fs.existsSync(p)) return p;
        } catch { /* agla */ }
    }
    return null;
}

/** Bundled voice-runtime ka root (ya null). */
function findVoiceRuntimeRoot() {
    return firstExisting([
        process.resourcesPath ? path.join(process.resourcesPath, 'voice-runtime') : null,
        path.join(REPO_ROOT, 'voice-runtime'),
    ]);
}

/**
 * Dev fallback: Voice Lab ka venv. Lab workspace ki root par hota hai
 * (`Maya Ai - AGI/voice-lab`), repo (`MayaAi_main`) ke barabar mein.
 */
function labVenvCandidates() {
    const exe = isWindows ? path.join('.venv', 'Scripts', 'python.exe') : path.join('.venv', 'bin', 'python');
    return [
        path.join(REPO_ROOT, '..', 'voice-lab', exe),
        path.join(REPO_ROOT, 'voice-lab', exe),
    ];
}

/**
 * Engine ka Python KAISE chalana hai (python-runtime.js venvLaunch):
 * { python, env, mode, venvPython, problem } — `python` null = nahi mila, wajah `problem` mein.
 * Spawn hamesha `pythonSpawnEnv(baseEnv, launch)` ke environment ke saath.
 */
function resolveLaunch() {
    const override = process.env.MAYA_VOICE_PYTHON;
    if (override && fs.existsSync(override)) {
        return { python: override, env: {}, mode: 'override', venvPython: override, problem: null };
    }
    const root = findVoiceRuntimeRoot();
    const bundled = root ? venvLaunch(root, 'Voice Runtime') : null;
    if (bundled && bundled.python) return bundled;
    const problem = bundled ? bundled.problem : 'voice-runtime folder nahi mila';
    // Packaged app mein lab ka venv kabhi nahi hota; ye sirf dev ke liye hai.
    if (process.resourcesPath && !process.defaultApp) {
        return { python: null, env: {}, mode: null, venvPython: null, problem };
    }
    const lab = firstExisting(labVenvCandidates());
    return lab
        ? { python: lab, env: {}, mode: 'lab', venvPython: lab, problem: null }
        : { python: null, env: {}, mode: null, venvPython: null, problem };
}

/** Python jo engine chalayega, ya null. */
function resolvePython() {
    return resolveLaunch().python;
}

/** server.py — packaged mein resources ke andar, dev mein repo mein. */
function resolveServerScript() {
    return firstExisting([
        process.resourcesPath ? path.join(process.resourcesPath, 'maya-voice', 'server.py') : null,
        path.join(REPO_ROOT, 'maya-voice', 'server.py'),
    ]);
}

/**
 * Installer ke saath aayi .pyc (build ke afterPack ka nishan `bytecode.json` —
 * scripts/bundle-python-bytecode.js). Sirf tab jawab deta hai jab nishan sahi
 * ho aur usi Python ka ho jo ye venv chalata hai (pyvenv.cfg `version_info`);
 * zara bhi shak ho to null — engine pehle jaisa chalta hai (apni .pyc user ke
 * data folder mein). Dev ke runtime mein ye nishan kabhi nahi hota.
 */
function readShippedBytecode(root) {
    if (!root) return null;
    let marker;
    try {
        marker = JSON.parse(fs.readFileSync(path.join(root, 'bytecode.json'), 'utf8'));
    } catch {
        return null;
    }
    if (!marker || marker.format !== 1 || marker.invalidation !== 'unchecked-hash' || !(Number(marker.compiled) > 0)) return null;
    let cfg;
    try {
        cfg = fs.readFileSync(path.join(root, 'venv', 'pyvenv.cfg'), 'utf8');
    } catch {
        return null;
    }
    const version = /^version(?:_info)?\s*=\s*(\d+)\.(\d+)/m.exec(cfg);
    if (!version || marker.cacheTag !== `cpython-${version[1]}${version[2]}`) return null;
    return { cacheTag: marker.cacheTag, compiled: Number(marker.compiled) };
}

/** `child` sach mein `parent` folder ke andar hai? */
function isInside(child, parent) {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Kya kya mila aur kya nahi — insaan ke parhne ke liye (console aur error ke paigham mein). */
function describeRuntime() {
    const launch = resolveLaunch();
    const { python } = launch;
    const server = resolveServerScript();
    const root = findVoiceRuntimeRoot();
    const missing = [];
    if (!python) {
        missing.push(
            `Python (voice-runtime): ${launch.problem || 'bundled venv nahi mila'}. `
            + 'Chalayein `npm run build:voice-runtime`, ya MAYA_VOICE_PYTHON set karein. '
            + `Dev mein ye bhi dekha gaya: ${labVenvCandidates().join(' | ')}`,
        );
    }
    if (!server) missing.push('server.py: maya-voice/server.py nahi mili.');
    // Installer ki .pyc sirf usi venv ke liye jo isi runtime ka hai (MAYA_VOICE_PYTHON se
    // koi aur ho to nahi). 'launcher' mode mein `python` bundled interpreter hai, magar venv
    // wahi — is liye venv ka raasta dekha jata hai, interpreter ka nahi.
    const bytecode = python && root && launch.venvPython && isInside(launch.venvPython, root) ? readShippedBytecode(root) : null;
    return {
        ok: missing.length === 0,
        python,
        env: launch.env,
        launchMode: launch.mode,
        server,
        root,
        bytecode,
        missing,
    };
}

module.exports = {
    resolveLaunch,
    resolvePython,
    resolveServerScript,
    findVoiceRuntimeRoot,
    readShippedBytecode,
    describeRuntime,
};
