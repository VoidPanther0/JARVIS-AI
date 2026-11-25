// Tasveer wali yaadein — usi yaadash ke folder ke andar, `photo-memory/` mein.
//
//   <account>/photo-memory/2026-11-23-ammis-birthday.jpg   tasveer (app likhti hai)
//   <account>/photo-memory/2026-11-23-ammis-birthday.md    us ki yaad (aam note)
//   <account>/MEMORY.md                                    "- [Ammi's birthday](photo-memory/…md) — … (photo)"
//
// Note bilkul aam yaad hai (Claude Code ki shakl: name / description / metadata.type),
// bas frontmatter mein `image: <file>.jpg`. AI ko hamesha sirf fehrist ki line dikhti
// hai; zaroorat ho to note kholta hai, aur tasveer tab hi dekhta hai jab waqai kaam ki
// ho (Claude Code ka Read tasveer dikhata hai). Har prompt mein tasveer kabhi nahi.
//
// Tasveer SIRF app likhti hai: Claude Agent SDK ke Write/Edit matn likhte hain, binary
// nahi — aur pehre (safety.py, soul.py, store.js) AI ko tasveer ki file chhoone nahi dete.
//
// Teen pakke usool:
//   1. Raasta code banata hai (tareekh + naam se slug), kabhi user/AI nahi — aur phir
//      bhi har raasta store.resolve() se guzarta hai (junction / bahar ka raasta rad).
//   2. Kisi aur ki file kabhi nahi mit-ti / likhi jati: naam pehle se ho to "-2", "-3".
//   3. Save poora ya bilkul nahi: tasveer → note → fehrist; beech mein ruka to jo
//      likha wo wapas mita do.

'use strict';

const fs = require('fs');
const path = require('path');
const { parseNote, writeAtomic, MemoryError, VIRTUAL_ROOT } = require('../file-memory/store');
const official = require('../file-memory/official');

const FOLDER = 'photo-memory';
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
/** Note ke `image:` mein sirf saada naam (koi "/" ya ".." nahi) — isi folder ki file. */
const IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(jpe?g|png|webp)$/i;
const PHOTO_REL = /^photo-memory\/[a-z0-9][a-z0-9-]{0,120}\.(md|jpg)$/;
const INDEX_LINE_CHARS = 150;
const MAX_TITLE = 90;
const MAX_STORY = 4000;
const MAX_PEOPLE = 12;
const MAX_FEELING = 80;
const SOURCES = new Set(['camera', 'attachment', 'clipboard', 'panel']);

class PhotoError extends Error {}

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);
const oneLine = (value, max) => clean(value, max * 2).replace(/\s+/g, ' ').trim().slice(0, max);

/** "Ammi's 60th birthday!" → "ammis-60th-birthday". Urdu/khali → "photo". */
function slugify(title) {
  const ascii = String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return ascii || 'photo';
}

function localDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "photo-memory/2026-11-23-x.md" → us din ki aadhi raat (ms). Na ho to 0. */
function dateFromName(rel) {
  const m = /(?:^|\/)(\d{4})-(\d{2})-(\d{2})-/.exec(String(rel || ''));
  if (!m) return 0;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(at) ? at : 0;
}

function humanDate(ms) {
  const d = new Date(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

const SOURCE_TEXT = {
  camera: 'from the camera',
  attachment: 'from a picture they shared',
  clipboard: 'from a copied picture',
  panel: 'added in the Memory panel',
};

/** Fehrist / link ke liye: [ ] ( ) aur nayi line link tor dete hain. */
const linkText = (text) => oneLine(text, MAX_TITLE).replace(/[[\]()]/g, '').trim();

function normalizeInput(input) {
  const title = oneLine(input.title, MAX_TITLE);
  if (!title) throw new PhotoError('A photo memory needs a short title (what it is).');
  const people = (Array.isArray(input.people) ? input.people : typeof input.people === 'string' ? input.people.split(',') : [])
    .map((p) => oneLine(p, 60))
    .filter(Boolean)
    .slice(0, MAX_PEOPLE);
  const source = SOURCES.has(input.source) ? input.source : 'panel';
  return {
    title,
    story: clean(String(input.story ?? '').replace(/\r\n?/g, '\n'), MAX_STORY).replace(/\n{3,}/g, '\n\n'),
    people: [...new Set(people)],
    feeling: oneLine(input.feeling, MAX_FEELING),
    source,
  };
}

/** Recall ke liye ek line: kya, kis ke saath, kaisa laga. */
function describe({ title, people, feeling }) {
  const parts = [`Photo of ${title}`];
  if (people.length) parts[0] += ` with ${people.join(', ')}`;
  if (feeling) parts.push(feeling);
  return oneLine(parts.join(' — '), 300);
}

/** MEMORY.md ki line — `- [Title](photo-memory/x.md) — hook (photo)`, 150 huroof ke andar. */
function indexLine(rel, { title, people = [], feeling = '', story = '', hook: given = '' }) {
  const head = `- [${linkText(title) || 'Photo'}](${rel})`;
  const suffix = ' (photo)';
  let hook = given || [people.length ? `with ${people.join(', ')}` : '', feeling].filter(Boolean).join(' — ');
  if (!hook && story) hook = story.split(/(?<=[.!?])\s/)[0];
  hook = oneLine(hook, 200);
  const room = INDEX_LINE_CHARS - head.length - suffix.length - 3;
  if (!hook || room < 8) return `${head}${suffix}`;
  const clipped = hook.length > room ? `${hook.slice(0, room - 1).trimEnd()}…` : hook;
  return `${head} — ${clipped}${suffix}`;
}

/**
 * Panel ki badli hui ek-line description → fehrist ka hook. Title link mein pehle se
 * hai, is liye shuru ka "Photo of <title>" hata do (warna title do dafa aata, aur 150
 * huroof mein jazbaat wala hissa kat jata). "Photo of Car with Ammi — khush" → "with
 * Ammi — khush". Title sirf poore lafz par hat-ta hai ("Car" → "Cartoon day" nahi chhoota).
 */
function hookFromDescription(description, title) {
  let hook = oneLine(description, 300).replace(/^Photo of\s+/i, '');
  const name = oneLine(title, MAX_TITLE);
  if (name && hook.toLowerCase().startsWith(name.toLowerCase())) {
    const rest = hook.slice(name.length);
    if (!rest || /^[\s,.:;—–-]/.test(rest)) hook = rest.replace(/^[\s,.:;—–-]+/, '');
  }
  return hook.trim();
}

function noteText(base, imageFile, fields, savedAt) {
  const yaml = (s) => JSON.stringify(s);
  const lines = [
    '---',
    `name: ${slugify(fields.title)}`,
    `description: ${yaml(describe(fields))}`,
    `image: ${imageFile}`,
    'metadata:',
    '  type: user',
    '---',
    '',
    `Photo memory, saved ${humanDate(savedAt)} ${SOURCE_TEXT[fields.source]}. The picture is \`${imageFile}\` in this same folder.`,
    '',
    `- What: ${fields.title}`,
  ];
  if (fields.people.length) lines.push(`- Who: ${fields.people.join(', ')}`);
  if (fields.feeling) lines.push(`- Feeling: ${fields.feeling}`);
  if (fields.story) lines.push('', fields.story);
  return `${lines.join('\n')}\n`;
}

/** Frontmatter ke baad ka hissa (note ka matn). */
function splitNote(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const match = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  return match ? { head: match[0], body: text.slice(match[0].length) } : { head: '', body: text };
}

/** Frontmatter ki ek top-level line badlo (na ho to `metadata:` se pehle jor do). */
function setFrontmatterField(head, key, value) {
  const line = `${key}: ${JSON.stringify(value)}`;
  const re = new RegExp(`^${key}[ \\t]*:.*$`, 'm');
  if (re.test(head)) return head.replace(re, line);
  return head.replace(/^metadata[ \t]*:/m, `${line}\nmetadata:`);
}

class PhotoMemory {
  /**
   * @param {{ codec: { encode: (buf: Buffer) => any, thumbnail: (buf: Buffer, side?: number) => any },
   *   now?: () => number, log?: (level: string, msg: string) => void }} opts
   */
  constructor({ codec, now = () => Date.now(), log = () => {} }) {
    this.codec = codec;
    this.now = now;
    this.log = log;
    /** rel → { mtimeMs, side, dataUrl } — album har dafa dobara na bane. */
    this._thumbs = new Map();
  }

  // ── Raaste ────────────────────────────────────────────────────────────────

  _target(store, rel) {
    return store.resolve(`${VIRTUAL_ROOT}/${rel}`);
  }

  /** Renderer / note se aaya raasta: sirf photo-memory ki .md (ya .jpg) — warna rad. */
  _checkRel(rel, ext) {
    const value = String(rel || '').replace(/\\/g, '/').replace(/^\/?memories\//, '');
    if (!PHOTO_REL.test(value) || (ext && !value.endsWith(ext))) throw new PhotoError('That is not a photo memory.');
    return value;
  }

  /** Note ka `image:` → usi folder ki tasveer (sirf saada naam). */
  _imageOf(store, noteRel, parsed) {
    const name = String(parsed.fields.image || '').trim();
    if (!IMAGE_NAME.test(name)) return null;
    const rel = `${path.posix.dirname(noteRel)}/${name}`;
    try {
      return { rel, target: this._target(store, rel) };
    } catch {
      return null;
    }
  }

  /** Is naam ka koi note ya tasveer pehle se? To "-2", "-3"… (kisi ki file kabhi nahi badalti). */
  _freeBase(store, base) {
    for (let n = 1; n < 1000; n += 1) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      const md = this._target(store, `${FOLDER}/${candidate}.md`);
      const jpg = this._target(store, `${FOLDER}/${candidate}.jpg`);
      if (!fs.existsSync(md.abs) && !fs.existsSync(jpg.abs)) return candidate;
    }
    throw new PhotoError('Too many photos with that name today. Give it a different title.');
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  /**
   * Nayi tasveer wali yaad. `image` = koi bhi tasveer ke bytes (codec seedha karta,
   * chhota karta aur JPEG banata hai).
   * @param {import('../file-memory/store').FileMemory} store
   * @param {{ image: Buffer, title: string, story?: string, people?: string[]|string, feeling?: string, source?: string }} input
   * @returns {Promise<{ ok: boolean, text: string, path?: string, image?: string, title?: string }>}
   */
  save(store, input) {
    return store._serial(() => {
      let fields;
      try {
        fields = normalizeInput(input || {});
      } catch (err) {
        return { ok: false, text: err.message };
      }
      const encoded = this.codec.encode(input.image);
      if (!encoded || !encoded.ok) {
        const reason = encoded && encoded.reason;
        return {
          ok: false,
          text: reason === 'too_big' ? 'That picture is too large to keep (over 40 MB).'
            : reason === 'empty' ? 'There was no picture to save.'
              : 'That picture could not be read. JPG and PNG pictures work.',
        };
      }

      const savedAt = this.now();
      const written = [];
      try {
        const base = this._freeBase(store, `${localDate(savedAt)}-${slugify(fields.title)}`);
        const imageFile = `${base}.jpg`;
        const jpg = this._target(store, `${FOLDER}/${imageFile}`);
        const md = this._target(store, `${FOLDER}/${base}.md`);
        fs.mkdirSync(path.dirname(jpg.abs), { recursive: true });

        writeAtomic(jpg.abs, encoded.jpeg);
        written.push(jpg.abs);
        const text = official.stampNote(noteText(base, imageFile, fields, savedAt), { now: savedAt });
        writeAtomic(md.abs, text);
        written.push(md.abs);
        store.appendIndexLines([indexLine(md.rel, fields)]);

        store.emit('changed', { op: 'create', path: md.virtual });
        this.log('info', `[PhotoMemory] saved ${md.rel} (${encoded.width}×${encoded.height})`);
        return {
          ok: true,
          text: `Saved the photo memory "${fields.title}" (${md.virtual}).`,
          path: md.virtual,
          image: jpg.virtual,
          title: fields.title,
        };
      } catch (err) {
        for (const file of written.reverse()) {
          try { fs.unlinkSync(file); } catch { /* pehle hi nahi */ }
        }
        if (err instanceof PhotoError || err instanceof MemoryError) return { ok: false, text: err.message };
        this.log('error', `[PhotoMemory] save nakaam: ${err && err.code ? err.code : err && err.message}`);
        return { ok: false, text: 'The photo memory could not be saved right now. Nothing was changed.' };
      }
    });
  }

  // ── Album ─────────────────────────────────────────────────────────────────

  /** Sab tasveer wali yaadein, naye pehle. Jis note ki tasveer gayab ho wo `missing`. */
  list(store) {
    const notes = store.scan().filter((n) => n.rel.startsWith(`${FOLDER}/`) && n.image);
    return notes.map((n) => {
      let image = null;
      try {
        image = IMAGE_NAME.test(n.image) ? this._target(store, `${FOLDER}/${n.image}`) : null;
      } catch { image = null; }
      const exists = Boolean(image && fs.existsSync(image.abs));
      return {
        path: n.path,
        rel: n.rel,
        image: image ? image.rel : '',
        title: n.name,
        description: n.description,
        updatedAt: n.mtimeMs,
        createdAt: dateFromName(n.rel) || n.mtimeMs,
        missing: !exists,
      };
    });
  }

  /** Album ki chhoti tasveer. */
  thumbnail(store, rel, side) {
    try {
      const noteRel = this._checkRel(rel, '.md');
      const { parsed } = this._readNote(store, noteRel);
      const image = this._imageOf(store, noteRel, parsed);
      if (!image) return { ok: false, text: 'This memory has no picture.' };
      const stat = fs.statSync(image.target.abs);
      const key = `${image.rel}|${side || 0}`;
      const hit = this._thumbs.get(key);
      if (hit && hit.mtimeMs === stat.mtimeMs) return { ok: true, dataUrl: hit.dataUrl };
      const thumb = this.codec.thumbnail(fs.readFileSync(image.target.abs), side);
      if (!thumb || !thumb.ok) return { ok: false, text: 'The picture could not be read.' };
      if (this._thumbs.size > 400) this._thumbs.clear();
      this._thumbs.set(key, { mtimeMs: stat.mtimeMs, dataUrl: thumb.dataUrl });
      return { ok: true, dataUrl: thumb.dataUrl };
    } catch (err) {
      return { ok: false, text: err instanceof PhotoError ? err.message : 'The picture could not be read.' };
    }
  }

  /** Bari tasveer + note (panel ka "kholo"). */
  open(store, rel) {
    try {
      const noteRel = this._checkRel(rel, '.md');
      const { raw, parsed } = this._readNote(store, noteRel);
      const image = this._imageOf(store, noteRel, parsed);
      let dataUrl = '';
      if (image && fs.existsSync(image.target.abs)) {
        const big = this.codec.thumbnail(fs.readFileSync(image.target.abs), 1600);
        if (big && big.ok) dataUrl = big.dataUrl;
      }
      const { body } = splitNote(raw);
      return { ok: true, path: `${VIRTUAL_ROOT}/${noteRel}`, title: parsed.name, description: parsed.description, body: body.replace(/^\n+/, ''), dataUrl, missing: !dataUrl };
    } catch (err) {
      return { ok: false, text: err instanceof PhotoError ? err.message : 'This photo memory could not be opened.' };
    }
  }

  _readNote(store, noteRel) {
    const target = this._target(store, noteRel);
    let raw;
    try { raw = fs.readFileSync(target.abs, 'utf8'); } catch { throw new PhotoError('This photo memory is gone.'); }
    return { target, raw, parsed: parseNote(raw) };
  }

  /**
   * Panel se kahani badli: frontmatter (naam, tasveer, qism) wohi, sirf ek-line
   * description aur note ka matn. Description badli to fehrist ki line bhi nayi
   * (wohi line AI ko har baat-cheet mein dikhti hai).
   */
  update(store, rel, { description, body }) {
    return store._serial(() => {
      try {
        const noteRel = this._checkRel(rel, '.md');
        const { target, raw } = this._readNote(store, noteRel);
        const { head, body: oldBody } = splitNote(raw);
        if (!head) throw new PhotoError('This photo memory has no header and cannot be edited here.');
        const nextDescription = description === undefined ? null : oneLine(description, 300);
        const nextBody = body === undefined ? oldBody : `\n${clean(String(body).replace(/\r\n?/g, '\n'), 12_000).replace(/^\n+/, '')}\n`;
        const nextHead = nextDescription ? setFrontmatterField(head, 'description', nextDescription) : head;
        const text = official.stampNote(`${nextHead}${nextBody}`, { now: this.now() });
        writeAtomic(target.abs, text);
        if (nextDescription && nextDescription !== parseNote(raw).description) {
          const title = (/^- What:\s*(.+)$/m.exec(nextBody) || [])[1] || parseNote(raw).name;
          store.removePointers(noteRel);
          store.appendIndexLines([indexLine(noteRel, { title, hook: hookFromDescription(nextDescription, title) })]);
        }
        store.emit('changed', { op: 'update', path: target.virtual });
        return { ok: true, text: 'Saved.' };
      } catch (err) {
        return { ok: false, text: err instanceof PhotoError ? err.message : 'It was not saved.' };
      }
    });
  }

  /** Bhool jao: tasveer + note + fehrist ki line — teeno. */
  forget(store, rel) {
    return store._serial(() => {
      try {
        const noteRel = this._checkRel(rel, '.md');
        const target = this._target(store, noteRel);
        let image = null;
        if (fs.existsSync(target.abs)) {
          const { parsed } = this._readNote(store, noteRel);
          image = this._imageOf(store, noteRel, parsed);
        }
        // Note gayab ho to bhi usi naam ki tasveer (save ke waqt dono ka ek naam).
        const sameName = this._target(store, noteRel.replace(/\.md$/, '.jpg'));
        for (const file of [image && image.target.abs, sameName.abs, target.abs]) {
          if (!file) continue;
          try { fs.unlinkSync(file); } catch (err) { if (err && err.code !== 'ENOENT') throw err; }
        }
        store.removePointers(noteRel);
        for (const key of [...this._thumbs.keys()]) if (image && key.startsWith(`${image.rel}|`)) this._thumbs.delete(key);
        store.emit('changed', { op: 'delete', path: target.virtual });
        return { ok: true, text: 'Forgotten.' };
      } catch (err) {
        return { ok: false, text: err instanceof PhotoError ? err.message : 'It was not deleted.' };
      }
    });
  }

  count(store) {
    try { return this.list(store).length; } catch { return 0; }
  }
}

module.exports = {
  PhotoMemory,
  PhotoError,
  FOLDER,
  IMAGE_EXT,
  IMAGE_NAME,
  slugify,
  indexLine,
  hookFromDescription,
  noteText,
  describe,
  splitNote,
  dateFromName,
};
