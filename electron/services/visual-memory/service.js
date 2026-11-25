// Tasveer wali yaadash ki service — main process ka EK darwaza (visual-memory-handlers.js).
//
//   Tasveerein  → usi yaadash ke folder mein (photos.js), FileMemoryService ke
//                 zariye: wohi account, wohi raaste ki hifazat, wohi atomic likhai.
//   Chehre      → yaadash se BAHAR (faces.js): numbers saadi JSON + jis photo se
//                 seekha (panel mein dikhti hai). Face Lock se koi taalluq nahi.
//   Tasveer ka zariya: camera / panel (renderer bytes bhejta hai), chat ki tasveer
//                 (renderer bytes ya PC par file ka raasta), clipboard (yahin parha jata hai).
//
// Electron (`nativeImage`, `clipboard`) bahar se aata hai — `node --test` mein naqli.

'use strict';

const fs = require('fs');
const path = require('path');
const { PhotoMemory, dateFromName } = require('./photos');
const { FaceStore } = require('./faces');
const codec = require('./photo-codec');

const PICTURE_FILE = /\.(jpe?g|png|webp|gif|bmp)$/i;
/** Chehre ki photo: panel ke liye kaafi, bari nahi. */
const FACE_PHOTO_SIDE = 1024;

/** Is din ki aadhi raat (ms) — photos.js ke `dateFromName` jaisa. */
function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** base64 ya data: URL → Buffer. Kuch aur = null. */
function bytesFrom(data) {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data !== 'string' || !data) return null;
  const comma = data.startsWith('data:') ? data.indexOf(',') : -1;
  const b64 = comma >= 0 ? data.slice(comma + 1) : data;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64.slice(0, 200))) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

class VisualMemoryService {
  /**
   * @param {{
   *   fileMemory: import('../file-memory/service').FileMemoryService,
   *   facesRoot: string,
   *   ownerProvider: () => string,
   *   nativeImage: any,
   *   clipboard?: { readImage: () => any },
   *   now?: () => number,
   *   log?: (level: string, msg: string) => void,
   * }} opts
   */
  constructor(opts) {
    this.fileMemory = opts.fileMemory;
    this.nativeImage = opts.nativeImage;
    this.clipboard = opts.clipboard || null;
    this.log = opts.log || (() => {});
    this.photos = new PhotoMemory({
      codec: {
        encode: (buf) => codec.encodeMemoryPhoto(buf, { nativeImage: this.nativeImage }),
        thumbnail: (buf, side) => codec.thumbnailDataUrl(buf, { nativeImage: this.nativeImage, ...(side ? { side } : {}) }),
      },
      now: opts.now,
      log: this.log,
    });
    this.faces = new FaceStore({ rootDir: opts.facesRoot, ownerProvider: opts.ownerProvider, now: opts.now, log: this.log });
  }

  _store() {
    const svc = this.fileMemory;
    return svc && typeof svc.current === 'function' ? svc.current() : null;
  }

  async _readyStore() {
    const svc = this.fileMemory;
    if (!svc || !svc.enabled) return null;
    try { await svc.whenReady(); } catch { /* muntaqli ka intezar zaroori nahi */ }
    return this._store();
  }

  // ── Halat ─────────────────────────────────────────────────────────────────

  status() {
    const store = this._store();
    const faces = this.faces.status();
    return {
      ok: Boolean(store),
      reason: store ? undefined : (this.fileMemory && this.fileMemory.enabled === false ? 'disabled' : 'signed_out'),
      photos: store ? this.photos.count(store) : 0,
      face: faces.self ? { known: true, name: faces.self.name, photo: faces.self.photo, since: faces.self.createdAt } : { known: false },
    };
  }

  // ── Tasveer ka zariya ─────────────────────────────────────────────────────

  /**
   * @param {{ data?: string, path?: string, clipboard?: boolean }} image
   * @returns {{ ok: true, bytes: Buffer } | { ok: false, text: string }}
   */
  _picture(image) {
    const src = image && typeof image === 'object' ? image : {};
    if (src.clipboard === true) {
      let img = null;
      try { img = this.clipboard ? this.clipboard.readImage() : null; } catch { img = null; }
      if (!img || img.isEmpty()) return { ok: false, text: 'There is no picture on the clipboard. Copy a picture first.' };
      return { ok: true, bytes: img.toPNG() };
    }
    if (typeof src.path === 'string' && src.path.trim()) {
      const file = src.path.trim();
      if (!path.isAbsolute(file) || file.includes('\0')) return { ok: false, text: 'That picture path is not usable.' };
      if (!PICTURE_FILE.test(file)) return { ok: false, text: 'That file is not a picture Maya can keep (JPG or PNG).' };
      // Chehron ki file (aur us ka folder) kabhi tasveer ka zariya nahi.
      const facesRoot = path.resolve(this.faces.rootDir).toLowerCase();
      if (path.resolve(file).toLowerCase().startsWith(facesRoot)) return { ok: false, text: 'That file cannot be used.' };
      let stat;
      try { stat = fs.statSync(file); } catch { return { ok: false, text: 'That picture was not found on this PC.' }; }
      if (!stat.isFile()) return { ok: false, text: 'That is not a picture file.' };
      if (stat.size > codec.MAX_INPUT_BYTES) return { ok: false, text: 'That picture is too large to keep (over 40 MB).' };
      try { return { ok: true, bytes: fs.readFileSync(file) }; } catch { return { ok: false, text: 'That picture could not be opened.' }; }
    }
    const bytes = bytesFrom(src.data);
    if (!bytes) return { ok: false, text: 'There was no picture to save.' };
    if (bytes.length > codec.MAX_INPUT_BYTES) return { ok: false, text: 'That picture is too large to keep (over 40 MB).' };
    return { ok: true, bytes };
  }

  // ── Tasveer wali yaadein ──────────────────────────────────────────────────

  async savePhoto({ image, title, story, people, feeling, source } = {}) {
    const store = await this._readyStore();
    if (!store) return { ok: false, text: 'Memory is not available until they sign in to Maya.' };
    const picture = this._picture(image);
    if (!picture.ok) return picture;
    return this.photos.save(store, { image: picture.bytes, title, story, people, feeling, source });
  }

  listPhotos() {
    const store = this._store();
    if (!store) return { ok: false, reason: 'signed_out', photos: [] };
    try {
      return { ok: true, photos: this.photos.list(store) };
    } catch (err) {
      this.log('warn', `[PhotoMemory] list nakaam: ${err && err.message}`);
      return { ok: false, reason: 'error', photos: [] };
    }
  }

  thumbnail(rel, side) {
    const store = this._store();
    return store ? this.photos.thumbnail(store, rel, side) : { ok: false, text: 'Memory is not available.' };
  }

  openPhoto(rel) {
    const store = this._store();
    return store ? this.photos.open(store, rel) : { ok: false, text: 'Memory is not available.' };
  }

  async updatePhoto(rel, patch) {
    const store = this._store();
    return store ? this.photos.update(store, rel, patch || {}) : { ok: false, text: 'Memory is not available.' };
  }

  async forgetPhoto(rel) {
    const store = this._store();
    return store ? this.photos.forget(store, rel) : { ok: false, text: 'Memory is not available.' };
  }

  // ── Chehra ────────────────────────────────────────────────────────────────

  faceStatus() {
    const s = this.faces.status();
    return { ok: s.ok, reason: s.reason, self: s.self };
  }

  /**
   * Webcam ki photo se chehra sikhao: numbers (renderer ne usi photo se banaye) +
   * photo (seedhi, 1024 px, JPEG — chehre ke card mein dikhti hai, Faces folder mein).
   *
   * Saath wohi photo album mein bhi ek tasveer wali yaad ban jati hai (Usman, 23 Nov
   * 2026: "hamari photo bhi memory ka hissa hai") — AI use sirf zaroorat par kholta
   * hai, jaise baqi tasveerein. Ek din mein ek: usi din dobara photo = purani ki jagah
   * nayi; alag din = nayi tasveer, purani rehti hai (waqt ke saath badlaav yaad rahe).
   * Pehchan ke numbers phir bhi sirf Faces folder mein.
   */
  async enrollFace({ templates, name, photo, memory = null }) {
    let jpeg = null;
    const bytes = bytesFrom(photo);
    if (bytes) {
      const encoded = codec.encodeMemoryPhoto(bytes, { nativeImage: this.nativeImage, maxSide: FACE_PHOTO_SIDE });
      if (!encoded.ok) return { ok: false, reason: 'bad_photo' };
      jpeg = encoded.jpeg;
    }
    const previous = this.faces.memoryOf('self');
    const res = this.faces.enroll({ templates, name, photo: jpeg });
    if (!res.ok || !bytes) return res;
    const album = await this._faceToAlbum(bytes, String(res.status?.self?.name || name || ''), previous, memory);
    if (album) this.faces.setMemory('self', album);
    return { ...res, album: Boolean(album), status: this.faces.status() };
  }

  /**
   * Chehre ki photo album mein (tasveer wali yaad). Lautata hai: note ka rel ('' = nahi bani).
   * `memory` (onboarding ki Day 1 tasveer, 24 Nov 2026): apna title / kahani / jazba —
   * "The day we met". Khali khane aam matn par.
   */
  async _faceToAlbum(bytes, name, previous, memory = null) {
    const store = await this._readyStore();
    if (!store) return '';
    try {
      // Aaj hi ki purani chehre wali photo ho to us ki jagah (ek din, ek photo).
      if (previous && dateFromName(previous) === startOfDay(this.photos.now())) {
        await this.photos.forget(store, previous);
      }
      const own = memory && typeof memory === 'object' ? memory : {};
      const title = typeof own.title === 'string' && own.title.trim() ? own.title.trim() : '';
      const story = typeof own.story === 'string' && own.story.trim() ? own.story.trim() : '';
      const feeling = typeof own.feeling === 'string' && own.feeling.trim() ? own.feeling.trim() : '';
      const res = await this.photos.save(store, {
        image: bytes,
        title: title || (name ? `${name}'s face` : 'My face'),
        story: story || `${name ? `${name}'s` : 'Their'} own face, taken with the webcam so Maya knows how ${name || 'they'} look${name ? 's' : ''}.`,
        people: title && name ? [name] : [],
        ...(feeling ? { feeling } : {}),
        source: 'camera',
      });
      return res.ok && res.path ? res.path.replace(/^\/memories\//, '') : '';
    } catch (err) {
      this.log('warn', `[Faces] album mein photo nahi gayi: ${err && err.code ? err.code : 'error'}`);
      return '';
    }
  }

  /** Jis photo se chehra seekha — panel ke liye data: URL. */
  facePhoto(side) {
    const file = this.faces.photoPath('self');
    if (!file || !fs.existsSync(file)) return { ok: false, text: 'No face photo.' };
    try {
      const thumb = codec.thumbnailDataUrl(fs.readFileSync(file), { nativeImage: this.nativeImage, ...(side ? { side } : {}) });
      return thumb && thumb.ok ? { ok: true, dataUrl: thumb.dataUrl } : { ok: false, text: 'The face photo could not be read.' };
    } catch {
      return { ok: false, text: 'The face photo could not be read.' };
    }
  }

  identify(frames) {
    return this.faces.identify(frames);
  }

  forgetFace() {
    return this.faces.forget();
  }

  renameFace(name) {
    return this.faces.rename('self', name);
  }
}

module.exports = { VisualMemoryService, bytesFrom };
