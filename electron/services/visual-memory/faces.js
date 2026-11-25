// Maya chehre pehchanta hai — sirf isi PC par.
//
// ── KAHAN ───────────────────────────────────────────────────────────────────
//
//   %APPDATA%\Maya AI\Faces\<account>.json        chehre ke numbers (128 fi photo)
//   %APPDATA%\Maya AI\Faces\<account>-<id>.jpg    jis photo se seekha (panel mein dikhti hai)
//
// Yaadash ke folder (…\Memory\<account>\) se BAHAR, jaan bujh kar: us folder ko AI
// parhta hai aur jo AI parhta hai wo model ke server tak jata hai. Chehre ke numbers
// aur chehre ki photo kabhi kisi server par nahi jate — AI ko sirf ek line milti hai
// ("camera par Usman hai"). New voice ke pehre (safety.py) is folder ki har file AI ke
// liye band rakhte hain.
//
// Saadi files, encryption NAHI (Usman ka faisla, 23 Nov 2026): Windows ki encryption
// (DPAPI / safeStorage) Windows account se bandhi hoti hai — Windows dobara install ho
// ya account badle to file khulti hi nahi aur chehra dobara sikhana parta.
//
// Face Lock (taala) se KOI taalluq nahi (Usman, 23 Nov 2026): chehra webcam ki saadi
// photo se seekha jata hai, na Face Lock ka scan, na us ka darj chehra. Sirf model ki
// files (SFace, 128 numbers) wohi hain jo app ke saath aati hain.
//
// ── KYA HAI ─────────────────────────────────────────────────────────────────
//
//   { version: 1, people: [{ id, name, relation, templates: [[128]…], photo, createdAt, updatedAt }] }
//
// Dhaancha kai logon ka hai (Phase 2: family ke chehre); Phase 1 ka panel sirf
// user ka apna chehra (`relation: 'self'`) sikhata hai.
//
// Milana: cosine (dono unit length). 0.5 ya zyada = wohi insaan; 0.3 se kam aur
// chehra saaf = koi aur; beech mein = pakka nahi (chup). SFace ke banane walon ki
// "sab se sahi" had 0.363 hai; "kaun hai" mein ghalat naam lena zyada bura hai, is
// liye had upar.
//
// Numbers kabhi log nahi hote, kabhi renderer ko wapas nahi jate.

'use strict';

const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('../file-memory/store');

const VERSION = 1;
const DIM = 128;
const MAX_PEOPLE = 24;
const MAX_TEMPLATES = 12;
const SELF = 'self';
const MATCH_THRESHOLD = 0.5;
/** Is se kam = saaf doosra insaan. Sikhane ki photos bhi aapas mein kam se kam itni milen. */
const UNKNOWN_BELOW = 0.3;
/** Ek "dekhne" mein zyada se zyada itni tasveerein aur fi tasveer itne chehre. */
const MAX_FRAMES = 4;
const MAX_FACES_PER_FRAME = 4;

/** Faces ka root — yaadash ke root (…\Memory) ka padosi, generation se azaad. */
function facesRootFor(appDataDir) {
  return path.join(appDataDir, 'Maya AI', 'Faces');
}

const cleanName = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const cleanId = (value) => String(value || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);

/** 128 numbers → unit length. Kuch bhi ghalat ho to `null`. */
function normalize(raw) {
  if (!raw || typeof raw.length !== 'number' || raw.length !== DIM) return null;
  const out = new Array(DIM);
  let sum = 0;
  for (let i = 0; i < DIM; i += 1) {
    const v = Number(raw[i]);
    if (!Number.isFinite(v)) return null;
    out[i] = v;
    sum += v * v;
  }
  const norm = Math.sqrt(sum);
  if (!(norm > 1e-6)) return null;
  for (let i = 0; i < DIM; i += 1) out[i] /= norm;
  return out;
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < DIM; i += 1) dot += a[i] * b[i];
  return dot;
}

/** Sikhane ki photos ke numbers: 1–12, sab sahi shakal, aur sab ek hi insaan (pehli se milte). */
function prepareTemplates(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_TEMPLATES) return { ok: false, reason: 'bad_input' };
  const list = raw.map(normalize);
  if (list.some((v) => !v)) return { ok: false, reason: 'bad_input' };
  for (let i = 1; i < list.length; i += 1) {
    if (cosine(list[0], list[i]) < UNKNOWN_BELOW) return { ok: false, reason: 'incoherent' };
  }
  return { ok: true, templates: list.map((t) => t.map((v) => Math.round(v * 1e6) / 1e6)) };
}

function sanitizePerson(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Pehle (isi din ke dev build mein) Face Lock se copy hua chehra — ab us se koi taalluq nahi.
  if (raw.source === 'face-lock') return null;
  const templates = Array.isArray(raw.templates) ? raw.templates.map(normalize).filter(Boolean).slice(0, MAX_TEMPLATES) : [];
  if (templates.length === 0) return null;
  const id = cleanId(raw.id);
  if (!id) return null;
  return {
    id,
    name: cleanName(raw.name),
    relation: cleanName(raw.relation) || (id === SELF ? SELF : 'other'),
    templates,
    photo: raw.photo === true,
    // Album mein is chehre ki aakhri tasveer wali yaad (photo-memory/…md) — sirf raasta.
    memory: /^photo-memory\/[a-z0-9][a-z0-9-]{0,120}\.md$/.test(String(raw.memory || '')) ? String(raw.memory) : '',
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

class FaceStore {
  /**
   * @param {{ rootDir: string, ownerProvider: () => string, now?: () => number,
   *   log?: (level: string, msg: string) => void }} opts
   */
  constructor({ rootDir, ownerProvider, now = () => Date.now(), log = () => {} }) {
    this.rootDir = rootDir;
    this.ownerProvider = ownerProvider;
    this.now = now;
    this.log = log;
    this._cache = null; // { file, mtimeMs, people }
  }

  _owner() {
    try {
      const owner = String(this.ownerProvider() || '');
      return /^[A-Za-z0-9_-]{1,80}$/.test(owner) ? owner : '';
    } catch {
      return '';
    }
  }

  /** Is account ki file. Sign out = '' (koi chehra nahi). */
  filePath() {
    const owner = this._owner();
    return owner ? path.join(this.rootDir, `${owner}.json`) : '';
  }

  /** Is shakhs ki photo ka raasta ('' = sign out / ghalat id). */
  photoPath(id = SELF) {
    const owner = this._owner();
    const safe = cleanId(id);
    return owner && safe ? path.join(this.rootDir, `${owner}-${safe}.jpg`) : '';
  }

  _read() {
    const file = this.filePath();
    if (!file) return [];
    let stat;
    try { stat = fs.statSync(file); } catch { this._cache = null; return []; }
    if (this._cache && this._cache.file === file && this._cache.mtimeMs === stat.mtimeMs) return this._cache.people;
    let people = [];
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      people = (Array.isArray(raw && raw.people) ? raw.people : []).map(sanitizePerson).filter(Boolean).slice(0, MAX_PEOPLE);
    } catch {
      // Toota hua file = koi chehra nahi (dobara sikhaya ja sakta hai). Kuch log nahi — us mein numbers hain.
      people = [];
    }
    this._cache = { file, mtimeMs: stat.mtimeMs, people };
    return people;
  }

  _write(people) {
    const file = this.filePath();
    if (!file) return false;
    if (people.length === 0) {
      try { fs.unlinkSync(file); } catch (err) { if (err && err.code !== 'ENOENT') throw err; }
      this._cache = null;
      return true;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = {
      version: VERSION,
      about: 'Maya face recognition on this PC: numbers from your face photo. Never uploaded. "Forget my face" in Memory → Photos deletes it.',
      people,
    };
    writeAtomic(file, `${JSON.stringify(body)}\n`);
    this._cache = null;
    return true;
  }

  // ── Bahar ke liye (numbers kabhi nahi) ────────────────────────────────────

  status() {
    const owner = this._owner();
    if (!owner) return { ok: false, reason: 'signed_out', people: [], self: null };
    const people = this._read().map((p) => ({
      id: p.id, name: p.name, relation: p.relation, templates: p.templates.length,
      photo: p.photo && fs.existsSync(this.photoPath(p.id)),
      createdAt: p.createdAt, updatedAt: p.updatedAt,
    }));
    return { ok: true, people, self: people.find((p) => p.id === SELF) || null };
  }

  hasFaces() {
    return this._read().length > 0;
  }

  /**
   * Webcam ki photo se chehra sikhao. `templates` = us photo (ya ek hi lamhe ki chand
   * photos) ke numbers; `photo` = JPEG jo panel mein dikhti hai. Phase 1: sirf `self`.
   * @param {{ templates: number[][], name?: string, photo?: Buffer|null, id?: string, relation?: string }} input
   */
  enroll({ templates, name, photo = null, id = SELF, relation = SELF } = {}) {
    if (!this._owner()) return { ok: false, reason: 'signed_out' };
    const prepared = prepareTemplates(templates);
    if (!prepared.ok) return { ok: false, reason: prepared.reason };
    const safeId = cleanId(id) || SELF;
    const people = this._read().filter((p) => p.id !== safeId);
    if (people.length >= MAX_PEOPLE) return { ok: false, reason: 'full' };
    const before = this._read().find((p) => p.id === safeId);
    const now = this.now();
    try {
      if (Buffer.isBuffer(photo) && photo.length > 0) {
        fs.mkdirSync(this.rootDir, { recursive: true });
        writeAtomic(this.photoPath(safeId), photo);
      }
      people.unshift({
        id: safeId,
        name: cleanName(name) || (before && before.name) || '',
        relation: cleanName(relation) || SELF,
        templates: prepared.templates,
        photo: Buffer.isBuffer(photo) && photo.length > 0 ? true : Boolean(before && before.photo),
        memory: before ? before.memory : '',
        createdAt: now,
        updatedAt: now,
      });
      this._write(people);
    } catch (err) {
      this.log('error', `[Faces] save nakaam: ${err && err.code ? err.code : 'error'}`);
      return { ok: false, reason: 'save_failed' };
    }
    return { ok: true, status: this.status() };
  }

  /** Album mein is chehre ki aakhri tasveer wali yaad ('' = nahi). */
  memoryOf(id = SELF) {
    const person = this._read().find((p) => p.id === id);
    return person ? person.memory || '' : '';
  }

  setMemory(id, rel) {
    const people = this._read();
    const person = people.find((p) => p.id === id);
    if (!person) return false;
    person.memory = /^photo-memory\/[a-z0-9][a-z0-9-]{0,120}\.md$/.test(String(rel || '')) ? String(rel) : '';
    try { this._write(people); return true; } catch { return false; }
  }

  rename(id, name) {
    const people = this._read();
    const person = people.find((p) => p.id === id);
    if (!person) return { ok: false, reason: 'not_found' };
    person.name = cleanName(name);
    person.updatedAt = this.now();
    try { this._write(people); } catch { return { ok: false, reason: 'save_failed' }; }
    return { ok: true, status: this.status() };
  }

  /** "Forget my face": us shakhs ke numbers aur photo foran. `id` na ho = sab. */
  forget(id) {
    try {
      const all = this._read();
      const gone = id ? all.filter((p) => p.id === id) : all;
      const kept = id ? all.filter((p) => p.id !== id) : [];
      this._write(kept);
      const ids = new Set([...gone.map((p) => p.id), ...(id ? [cleanId(id)] : [SELF])]);
      for (const one of ids) {
        const file = this.photoPath(one);
        if (file) { try { fs.unlinkSync(file); } catch (err) { if (err && err.code !== 'ENOENT') throw err; } }
      }
      return { ok: true, status: this.status() };
    } catch (err) {
      this.log('error', `[Faces] forget nakaam: ${err && err.code ? err.code : 'error'}`);
      return { ok: false, reason: 'save_failed' };
    }
  }

  /**
   * Camera par kaun hai? `frames` = har tasveer ke chehre: [[{ embedding, clear }]].
   * `clear` = chehra saaf tha (qareeb, seedha, roshni theek) — "pehchana nahi" ka
   * faisla sirf saaf chehre par hota hai.
   *
   * @returns {{ ok: boolean, enrolled: boolean, known: Array<{ id: string, name: string, relation: string, score: number }>,
   *   unknown: number, unclear: number, faces: number }}
   */
  identify(frames) {
    const people = this._read();
    const empty = { ok: true, enrolled: people.length > 0, known: [], unknown: 0, unclear: 0, faces: 0 };
    if (!Array.isArray(frames) || people.length === 0) return empty;
    const best = new Map(); // id → score
    const perFrame = [];
    for (const frame of frames.slice(0, MAX_FRAMES)) {
      const faces = Array.isArray(frame) ? frame.slice(0, MAX_FACES_PER_FRAME) : [];
      const row = { faces: 0, known: new Set(), unknown: 0, unclear: 0 };
      for (const face of faces) {
        const vec = normalize(face && face.embedding);
        if (!vec) continue;
        row.faces += 1;
        let top = { id: '', score: -1 };
        for (const person of people) {
          let score = -1;
          for (const t of person.templates) score = Math.max(score, cosine(vec, t));
          if (score > top.score) top = { id: person.id, score };
        }
        if (top.score >= MATCH_THRESHOLD) {
          row.known.add(top.id);
          best.set(top.id, Math.max(best.get(top.id) || 0, top.score));
        } else if (top.score < UNKNOWN_BELOW && face.clear === true) {
          row.unknown += 1;
        } else {
          row.unclear += 1;
        }
      }
      perFrame.push(row);
    }
    const knownTotal = best.size;
    // Ek hi insaan ek tasveer mein pehchana gaya aur doosri mein sar ghuma hua tha:
    // us ko "ajnabi" na gino. Fi tasveer: chehre − (kul pehchane gaye), un mein se ajnabi.
    let unknown = 0;
    let unclear = 0;
    let faces = 0;
    for (const row of perFrame) {
      faces = Math.max(faces, row.faces);
      const room = Math.max(0, row.faces - knownTotal);
      unknown = Math.max(unknown, Math.min(row.unknown, room));
      unclear = Math.max(unclear, Math.min(row.unclear, Math.max(0, room - Math.min(row.unknown, room))));
    }
    const known = [...best.entries()]
      .map(([id, score]) => {
        const person = people.find((p) => p.id === id);
        return { id, name: person ? person.name : '', relation: person ? person.relation : '', score: Math.round(score * 1000) / 1000 };
      })
      .sort((a, b) => (a.relation === SELF ? -1 : b.relation === SELF ? 1 : b.score - a.score));
    return { ok: true, enrolled: true, known, unknown, unclear, faces };
  }
}

module.exports = { FaceStore, facesRootFor, prepareTemplates, SELF, MATCH_THRESHOLD, UNKNOWN_BELOW };
