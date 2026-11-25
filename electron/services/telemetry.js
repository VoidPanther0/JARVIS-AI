// ═══════════════════════════════════════════════════════════════════════════
// telemetry.js — "app khuli" ka event, aur har kaam ka chhota hisaab ("run").
// ---------------------------------------------------------------------------
// KYUN: customer app khareedta hai, access milta hai... aur us ke baad humein
// kuch pata nahi chalta. Kitne log roz app kholte hain? Khareedne ke baad koi
// wapas bhi aata hai? Aur jo kaam wo Stonic se karwate hain (New ya Classic
// voice — dono ke peeche wohi Claude Code harness), wo hota bhi hai ya nahi?
// In sawalon ka jawab dene ke liye ye file hai.
//
// KYA BHEJA JATA HAI:
//   app khuli:  email (account ka), anonymous install id, app version, OS,
//               waqt, session kitni der chali.
//   kaam (run): wohi email / install id / version / waqt, aur sirf ginti:
//               New ya Classic, kaunsa raasta (Stonic Cloud / apni Claude /
//               OpenRouter / Gemini key), hua / nakaam / roka gaya, ghalti ki
//               QISAM (jaise `rate_limit`), kitne qadam, kitne tool chale aur
//               kitne nakaam, tool ke NAAM (jaise `PowerShell`), kitni der.
//               Engine (stonic-voice agent.py `_run_end`) ye banata hai,
//               voice-beta-manager.js `_onRun` saaf kar ke yahan deta hai.
//   onboarding ka qadam (14 Nov 2026): anonymous install id, app version,
//               qadam ka NAAM (jaise `persona`), pichhle qadam par kitne
//               second lage, chune hue character ki QISAM (`female_girlfriend`),
//               aur payment ke tareeqe ka id (`card`). Sign-in se PEHLE bhi —
//               is liye koi email nahi: jo sign-in se pehle chhor de wo bhi
//               gina jaye (admin → Onboarding). Renderer
//               (src/lib/onboarding/insights.ts) bhejta hai.
//
// KYA KABHI NAHI BHEJA JATA:
//   prompt ka text, awaaz, screen ka content, file ya folder ke naam, tool ke
//   arguments ya natije, ghalti ki tafseel, chat history — kuch bhi jo user ka
//   apna kaam ho. Is file mein aisi koi cheez parhne wali ek line bhi nahi hai.
//   Naya field add karne se pehle yehi soch lein: ye us list mein to nahi aata?
//
// ── SAB SE AHEM USOOL ──────────────────────────────────────────────────────
// YE FILE APP KO KABHI NAHI TOR SAKTI.
//
// Har export `safe()` ke andar lipta hai — koi exception yahan se bahar nahi
// jata. Koi bhi function kisi cheez ka intezar nahi karwata (na startup, na
// shutdown). Disk full ho, net band ho, server 500 de raha ho, poora
// analytics system delete ho jaye — customer ki app par is ka asar sifar hai.
// Telemetry chup chaap band ho jayegi, app waise hi chalti rahegi.
//
// Agar kabhi is file mein aisi tabdeeli karni pare jo ye zamanat torti ho,
// to wo tabdeeli galat hai.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
// axios pehli bhejne par load hota hai, boot par nahi (main.js ka note dekho).
const axios = { post: (...args) => require('axios').post(...args) };

// ── Config ────────────────────────────────────────────────────────────────
const DEFAULT_ENDPOINT = 'https://stonicai.com/.netlify/functions/track-app-open';
// Kaam ka hisaab alag darwaze par: purana `track-app-open` har anjaan event ko
// "app khuli" samajh leta — galti se bhi wahan na jaye.
const DEFAULT_RUNS_ENDPOINT = 'https://stonicai.com/.netlify/functions/track-agent-runs';
// Onboarding ke qadam — apna darwaza (website: supabase/onboarding-funnel.sql).
const DEFAULT_STEPS_ENDPOINT = 'https://stonicai.com/.netlify/functions/track-onboarding';

const SEND_TIMEOUT_MS   = 8000;   // is se lamba intezar karne ka koi faida nahi
const FLUSH_INTERVAL_MS = 10 * 60 * 1000;
const MAX_QUEUE         = 200;    // is se aage purane events girne lagte hain
const MAX_ATTEMPTS      = 10;     // 10 baar na gaya to ye event kabhi nahi jayega
const MAX_BATCH         = 25;     // server ki had 50 hai; hum us se neeche rehte hain
const MAX_RUN_QUEUE     = 500;    // kaam ke hisaab ki qatar (aksar chand hi hote hain)
const MAX_RUN_BATCH     = 40;
const RUN_FLUSH_DELAY_MS = 30 * 1000;  // kaam ke baad thora ruk kar — kai kaam ek hi request mein
const MAX_STEP_QUEUE    = 300;    // ek onboarding ~15 qadam; kai adhoore safar bhi sama jayein
const MAX_STEP_BATCH    = 40;
// Pehle qadam ke 8 second baad EK request (har qadam par nahi): tez qadam ek
// saath jate hain (functions ka kharcha kam), aur jo banda beech mein app band
// kar de us ke aakhri qadam agli dafa app khulne par chale jate hain.
const STEP_FLUSH_DELAY_MS = 8 * 1000;
const MAX_STEP_SECONDS  = 6 * 60 * 60;  // app raat bhar khuli rahi: ek qadam ka waqt 6 ghante par ruk jata hai

const FILE_QUEUE    = 'telemetry-queue.json';
const FILE_RUN_QUEUE = 'telemetry-runs.json';
const FILE_STEP_QUEUE = 'telemetry-onboarding.json';
const FILE_DEVICE   = 'telemetry-device.json';

// ── State ─────────────────────────────────────────────────────────────────
let cfg = null;            // { userDataDir, appVersion, endpoint, runsEndpoint, machineIdFn }
let deviceId = null;
let flushTimer = null;
let runFlushTimer = null;
let stepFlushTimer = null;
// Device id EK dafa banti hai, chahe kai qadam ek saath maangein (warna hardware
// na milne par har ek apni alag random id bana leta).
let devicePromise = null;
// Login wala account (recordOpen) — kaam ka hisaab isi ke naam. Na ho to hisaab nahi banta.
let accountEmail = null;

// Do qataarein, ek hi tareeqa: "app khuli" aur "kaam ka hisaab". Har ek ki apni
// file, apna darwaza, apni had — aur apna `flushing` pehra.
const OPENS = { name: 'opens', file: FILE_QUEUE, max: MAX_QUEUE, batch: MAX_BATCH, key: 'events', endpoint: () => cfg.endpoint, flushing: false };
const RUNS  = { name: 'runs',  file: FILE_RUN_QUEUE, max: MAX_RUN_QUEUE, batch: MAX_RUN_BATCH, key: 'runs', endpoint: () => cfg.runsEndpoint, flushing: false };
const STEPS = { name: 'steps', file: FILE_STEP_QUEUE, max: MAX_STEP_QUEUE, batch: MAX_STEP_BATCH, key: 'steps', endpoint: () => cfg.stepsEndpoint, flushing: false };

// Is process ki chalti hui session. `sessionClosed` ka pehra is liye hai ke
// quit ke kai raste hain (window band, Cmd+Q, updater, Windows logoff) aur
// unme se ek se zyada chal sakte hain — warna ek hi session ki lambai do
// baar queue mein chali jati.
let sessionEventId = null;
let sessionStartMs = null;
let sessionClosed  = false;
let openRecorded   = false;

// ── Har cheez ke gird deewar ──────────────────────────────────────────────
// Ye poori file ka bunyadi usool hai: telemetry ka koi masla app tak nahi
// pohnchta. `console.warn` jaan bujh kar — log mein nazar aana chahiye, magar
// caller ko kabhi throw nahi milta.
function safe(label, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    console.warn(`[telemetry] ${label} failed (ignored):`, err?.message || err);
    return fallback;
  }
}

const filePath = (name) => path.join(cfg.userDataDir, name);

function readJson(name, fallback) {
  try {
    const p = filePath(name);
    if (!fs.existsSync(p)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    // File kharab hai. Isay theek karne ki koshish bekaar hai — analytics ka
    // purana data khona koi nuqsan nahi.
    return fallback;
  }
}

function writeJson(name, value) {
  try {
    fs.writeFileSync(filePath(name), JSON.stringify(value), 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEVICE ID
// ---------------------------------------------------------------------------
// Ye sirf EXTRA maloomat hai, identity nahi. Saari ginti aur retention account
// ki EMAIL par hoti hai (app login ke baghair khulti hi nahi, is liye email
// hamesha mojood hoti hai). Ye id sirf ye batane ke liye hai ke ek customer
// kitni alag machines par app chala raha hai.
//
// Do parton wala tareeqa, dono ke apne faide:
//
//   1. File (`telemetry-device.json`) — jab tak install zinda hai, id wahi
//      rehti hai. Hardware badalne (SSD lagwane) se bhi id nahi badalti.
//
//   2. Hardware (`getMachineId` — CPU + disk serial ka SHA-256) — file ka
//      pehla source. App uninstall + reinstall, ya Windows dobara install
//      hone ke baad bhi WAHI id wapas ban jati hai.
//
// Dono milkar dono taraf se cover kar dete hain. Agar hardware bhi na mile to
// aakhri chara ek random id hai — us soorat mein multi-device ki ginti thori
// kam sahi hogi, magar DAU aur retention par koi asar nahi (wo email par hain).
async function resolveDeviceId() {
  const saved = readJson(FILE_DEVICE, null);
  if (saved && typeof saved.id === 'string' && saved.id.length >= 16) {
    return saved.id;
  }

  let id = null;

  if (typeof cfg.machineIdFn === 'function') {
    try {
      const hw = await cfg.machineIdFn();
      if (typeof hw === 'string' && hw.length >= 16) id = hw;
    } catch {
      // Hardware parhna nakaam — neeche random par chale jate hain.
    }
  }

  if (!id) id = crypto.randomBytes(16).toString('hex');

  writeJson(FILE_DEVICE, { id, createdAt: new Date().toISOString() });
  return id;
}

/** Ek hi id, chahe kitne raaste ek saath maangein. Nakaami par agli dafa phir koshish. */
function getDevice() {
  if (deviceId) return Promise.resolve(deviceId);
  if (!devicePromise) {
    devicePromise = resolveDeviceId()
      .then((id) => { deviceId = id; return id; })
      .finally(() => { devicePromise = null; });
  }
  return devicePromise;
}

// ── Queue ─────────────────────────────────────────────────────────────────
const readQueue = (channel = OPENS) => {
  const q = readJson(channel.file, []);
  return Array.isArray(q) ? q : [];
};

// Had se zyada bhar jaye to PURANE events girte hain, naye nahi. Wajah: agar
// koi machine mahine bhar offline rahi, to naye din ka sach purane din ke
// sach se zyada kaam ka hai.
function writeQueue(events, channel = OPENS) {
  const trimmed = events.length > channel.max ? events.slice(events.length - channel.max) : events;
  return writeJson(channel.file, trimmed);
}

function enqueue(event, channel = OPENS) {
  const q = readQueue(channel);
  q.push(event);
  writeQueue(q, channel);
}

// ── Bhejna ────────────────────────────────────────────────────────────────
// Server hamesha 200 deta hai aur jawab mein `done` bhejta hai — un events ke
// id jinhe queue se hata dena chahiye. Us mein wo bhi hain jo darj ho gaye
// aur wo bhi jo hamesha ke liye rad huay (jaise anjaan email). Jo `done` mein
// nahi, wo waqti masla tha — us par dobara koshish hoti hai.
//
// Ye ahem hai: hum khud faisla nahi karte ke kya dobara bhejna hai. Server
// batata hai. Warna ek permanent rad-shuda event hamesha ke liye queue mein
// atka rehta.
async function sendBatch(batch, channel = OPENS) {
  const res = await axios.post(
    channel.endpoint(),
    { [channel.key]: batch.map(({ attempts, ...ev }) => ev) },
    { timeout: SEND_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } },
  );
  const done = res?.data?.done;
  return Array.isArray(done) ? new Set(done) : new Set();
}

async function flushInternal(channel = OPENS) {
  if (!cfg || channel.flushing) return;

  let queue = readQueue(channel);
  if (queue.length === 0) return;

  channel.flushing = true;
  try {
    const batch = queue.slice(0, channel.batch);
    let done;

    try {
      done = await sendBatch(batch, channel);
    } catch (err) {
      // Net band, DNS fail, server down, timeout — sab yahan aate hain. Har
      // event ki koshish ginti hai; had par pohnchne wale gir jate hain,
      // taake ek zid'di event queue ko hamesha ke liye jaam na kar de.
      console.warn(`[telemetry] ${channel.name} flush failed (will retry later):`, err?.message || err);

      const batchIds = new Set(batch.map((e) => e.id));
      const after = readQueue(channel)
        .map((e) => (batchIds.has(e.id) ? { ...e, attempts: (e.attempts || 0) + 1 } : e))
        .filter((e) => (e.attempts || 0) < MAX_ATTEMPTS);
      writeQueue(after, channel);
      return;
    }

    // Kamyabi. Queue DOBARA parhi ja rahi hai, apni purani copy nahi likhi ja
    // rahi: network call ke doran `enqueue` chal chuka ho sakta hai, aur apni
    // purani copy likhne se wo naya event chup chaap mit jata.
    const after = readQueue(channel).filter((e) => !done.has(e.id));
    writeQueue(after, channel);

    // Aur bhi parra hai to bhejte raho — magar isi call mein nahi, warna ek
    // bari queue lambi der tak chalti rehti. Agla chakkar isay le lega.
    if (after.length > 0) scheduleFlush(2000, channel);

  } finally {
    channel.flushing = false;
  }
}

function scheduleFlush(delayMs, channel = OPENS) {
  if (!cfg) return;
  // Timer ko `unref` — ye kabhi app ko band hone se na roke.
  const t = setTimeout(() => { void flushInternal(channel); }, delayMs);
  if (typeof t.unref === 'function') t.unref();
}

/** Saari qataarein — har ek apne pehre ke saath (ek ki nakaami doosri ko nahi rokti). */
const flushAll = () => Promise.all([
  flushInternal(OPENS).catch(() => {}),
  flushInternal(RUNS).catch(() => {}),
  flushInternal(STEPS).catch(() => {}),
]);

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ek baar, app ke shuru mein. Sirf config yaad rakhta hai — na network, na
 * disk ka bhaari kaam. Startup ko ek millisecond bhi mehnga nahi karta.
 */
function init({ userDataDir, appVersion, machineIdFn, endpoint, runsEndpoint, stepsEndpoint } = {}) {
  return safe('init', () => {
    if (!userDataDir) return false;

    cfg = {
      userDataDir,
      appVersion: appVersion || 'unknown',
      endpoint: endpoint || process.env.STONIC_TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT,
      runsEndpoint: runsEndpoint || process.env.STONIC_RUNS_ENDPOINT || DEFAULT_RUNS_ENDPOINT,
      stepsEndpoint: stepsEndpoint || process.env.STONIC_ONBOARDING_ENDPOINT || DEFAULT_STEPS_ENDPOINT,
      machineIdFn,
    };

    return true;
  }, false);
}

/**
 * "App khuli" — login kamyab hone par bulaya jata hai.
 *
 * `await` karne ki zaroorat nahi (aur karni bhi nahi chahiye): ye foran wapas
 * aa jata hai, asal kaam peechay hota hai.
 *
 * Ek process mein sirf ek baar chalta hai. Wajah: AuthGate logout ke baad
 * dobara login par phir se `license-passed` bhejta hai, aur wo ek nayi "app
 * khuli" nahi hai — wohi chalti hui session hai.
 */
function recordOpen(email) {
  return safe('recordOpen', () => {
    if (!cfg) return;
    if (!email || typeof email !== 'string' || !email.includes('@')) return;

    // Kaam ka hisaab (recordRun) isi account ke naam — logout ke baad doosra
    // login ho to naya account (ye "app khuli" dobara nahi ginta, neeche dekho).
    accountEmail = email.toLowerCase().trim();

    if (openRecorded) return;
    openRecorded = true;

    // Peechay chalne wala kaam. Startup ke raste mein kuch bhi nahi aata —
    // yahan tak ke device id parhna bhi nahi.
    setImmediate(() => {
      void (async () => {
        try {
          await getDevice();

          sessionEventId = crypto.randomUUID();
          sessionStartMs = Date.now();
          sessionClosed  = false;

          enqueue({
            id:         sessionEventId,
            type:       'open',
            eventName:  'app_opened',   // aage feature events isi field se aayenge
            email:      email.toLowerCase().trim(),
            deviceId,
            appVersion: cfg.appVersion,
            platform:   process.platform,
            osVersion:  `${os.release()}`,
            openedAt:   new Date().toISOString(),
            attempts:   0,
          });

          // Ek line ka saboot. Is ke baghair "kuch nahi aa raha" ki tehqeeq
          // hamesha andhere mein hoti hai — pata hi nahi chalta ke event bana
          // hi nahi tha ya bana magar pohnch nahi raha. Ab log file (userData/
          // logs) mein ye line ya to hogi ya nahi hogi, aur jawab wahin mil
          // jayega. Email jaan bujh kar nahi likhi — log file share hoti hai.
          console.log('[telemetry] app_opened queued —', cfg.appVersion, process.platform);

          startPeriodicFlush();
          await flushInternal();
          // Pichli session ke kaam ka hisaab (aur onboarding ke qadam) jo net na hone se reh gaye the.
          await flushInternal(RUNS);
          await flushInternal(STEPS);
        } catch (err) {
          console.warn('[telemetry] recordOpen background step failed (ignored):', err?.message || err);
        }
      })();
    });
  });
}

/**
 * App band ho rahi hai — session ki lambai mehfooz karo.
 *
 * JAAN BUJH KAR SYNCHRONOUS, aur JAAN BUJH KAR yahan se kuch bheja nahi jata.
 *
 * Quit ke waqt network call ka intezar karna do wajah se galat hai: shutdown
 * lataka hua mehsoos hota hai, aur Windows logoff par humein itna waqt milta
 * hi nahi — call adhi mein mar jati aur duration waise bhi kho jati. Is liye
 * hum sirf ek chhoti file likhte hain (microseconds) aur agli launch par wo
 * event chala jata hai.
 *
 * Nateeja: session ki lambai ek launch der se pohnchti hai. DAU, WAU, MAU aur
 * retention par is ka koi asar nahi — wo "app khuli" wale event par hain, jo
 * pehle hi ja chuka hota hai. Yehi wajah hai ke app crash bhi ho jaye to
 * ginti sahi rehti hai; sirf us session ki lambai khaali reh jati hai.
 */
function endSession() {
  return safe('endSession', () => {
    if (!cfg) return;
    if (!sessionEventId || sessionClosed) return;

    sessionClosed = true;

    const seconds = Math.max(0, Math.round((Date.now() - sessionStartMs) / 1000));
    enqueue({
      id:             sessionEventId,
      type:           'close',
      sessionSeconds: seconds,
      attempts:       0,
    });
  });
}

/** Waqfay se queue khaali karna — lambi chalti hui sessions ke liye. */
function startPeriodicFlush() {
  return safe('startPeriodicFlush', () => {
    if (flushTimer || !cfg) return;
    flushTimer = setInterval(() => { void flushAll(); }, FLUSH_INTERVAL_MS);
    if (typeof flushTimer.unref === 'function') flushTimer.unref();
  });
}

/** Bahar se hath se flush karwana (test ya "net wapas aa gaya" jaise mauqe par). */
function flush() {
  return safe('flush', () => flushAll(), undefined);
}

// ── Kaam ka hisaab ("run") ────────────────────────────────────────────────
const RUN_FIELDS_TEXT = ['mode', 'route', 'trigger', 'origin', 'status', 'errorKind'];
const RUN_FIELDS_INT  = ['steps', 'toolCalls', 'toolErrors', 'held', 'refused', 'durationMs'];
const RUN_MAX_TOOLS   = 20;

/**
 * Ek kaam (New ya Classic voice ka turn jis mein kaam hua) ka hisaab — qatar
 * mein, ~30 second baad bhej diya jata hai. `run` voice-beta-manager.js
 * `_onRun` se pehle hi saaf aata hai; yahan phir bhi SIRF jaane pehchane field
 * copy hote hain, taake galti se bhi koi aur cheez (matn) server tak na jaye.
 *
 * Foran wapas aata hai, kabhi throw nahi karta. Login na ho (account email nahi)
 * to hisaab nahi banta — bina account ke iska koi matlab nahi.
 */
function recordRun(run) {
  return safe('recordRun', () => {
    if (!cfg || !accountEmail || !run || typeof run !== 'object') return;

    const event = {
      id:         crypto.randomUUID(),
      email:      accountEmail,
      deviceId:   deviceId || null,
      appVersion: cfg.appVersion,
      at:         new Date().toISOString(),
    };
    for (const name of RUN_FIELDS_TEXT) {
      if (typeof run[name] === 'string' && run[name]) event[name] = run[name].slice(0, 40);
    }
    if (!event.errorKind) event.errorKind = '';   // hamesha mojood (khali = koi ghalti nahi)
    for (const name of RUN_FIELDS_INT) {
      const n = Number(run[name]);
      event[name] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
    event.tools = (Array.isArray(run.tools) ? run.tools : []).slice(0, RUN_MAX_TOOLS)
      .filter((t) => t && typeof t.name === 'string' && t.name)
      .map((t) => ({ name: t.name.slice(0, 64), calls: Math.max(0, Math.floor(Number(t.calls) || 0)), errors: Math.max(0, Math.floor(Number(t.errors) || 0)) }));
    if (!event.mode || !event.status) return;
    event.attempts = 0;

    enqueue(event, RUNS);
    scheduleRunFlush();
  });
}

function scheduleRunFlush() {
  if (runFlushTimer || !cfg) return;
  runFlushTimer = setTimeout(() => {
    runFlushTimer = null;
    void flushInternal(RUNS).catch(() => {});
  }, RUN_FLUSH_DELAY_MS);
  if (typeof runFlushTimer.unref === 'function') runFlushTimer.unref();
}

// ── Onboarding ke qadam ───────────────────────────────────────────────────
// Sirf ye shaklen: qadam / pichhla qadam = chhote lafz (`persona`, `pay_tab`),
// detail = payment ke tareeqe jaisa id (`card`), character = qisam ki id. Koi
// naam, email ya likha hua matn is raaste se ja hi nahi sakta.
const STEP_RE      = /^[a-z_]{1,24}$/;
const DETAIL_RE    = /^[a-z0-9_]{1,24}$/;
const CHARACTER_RE = /^(female|male)_[a-z_]{1,30}$/;

/**
 * Onboarding ka ek qadam (renderer → main IPC `onboarding:step`). Login ki
 * zaroorat NAHI — sign-in se pehle chhorne wale hi to ginne hain. Pehchan sirf
 * anonymous install id. Foran wapas aata hai, kabhi throw nahi karta.
 */
function recordOnboardingStep(input) {
  return safe('recordOnboardingStep', () => {
    if (!cfg || !input || typeof input !== 'object') return;
    const step = typeof input.step === 'string' ? input.step : '';
    if (!STEP_RE.test(step)) return;

    const event = {
      id:         crypto.randomUUID(),
      step,
      appVersion: cfg.appVersion,
      at:         new Date().toISOString(),
    };
    if (typeof input.detail === 'string' && DETAIL_RE.test(input.detail)) event.detail = input.detail;
    if (typeof input.from === 'string' && STEP_RE.test(input.from)) {
      event.from = input.from;
      const seconds = Math.floor(Number(input.fromSeconds));
      if (Number.isFinite(seconds) && seconds > 0) event.fromSeconds = Math.min(seconds, MAX_STEP_SECONDS);
    }
    if (typeof input.character === 'string' && CHARACTER_RE.test(input.character)) event.character = input.character;

    // Device id disk / hardware se — peechay. Qatar ki tarteeb wohi rehti hai
    // (sab ek hi promise ke peechay, FIFO).
    void getDevice()
      .then((device) => {
        enqueue({ ...event, device, attempts: 0 }, STEPS);
        scheduleStepFlush();
      })
      .catch((err) => console.warn('[telemetry] onboarding step dropped (ignored):', err?.message || err));
  });
}

function scheduleStepFlush() {
  if (stepFlushTimer || !cfg) return;
  stepFlushTimer = setTimeout(() => {
    stepFlushTimer = null;
    void flushInternal(STEPS).catch(() => {});
  }, STEP_FLUSH_DELAY_MS);
  if (typeof stepFlushTimer.unref === 'function') stepFlushTimer.unref();
}

module.exports = {
  init,
  recordOpen,
  endSession,
  flush,
  recordRun,
  recordOnboardingStep,
};
