// Tasveer ko yaadash ke qabil banana — Electron ke `nativeImage` se, koi naya package nahi.
//
//   encodeMemoryPhoto  koi bhi tasveer (camera / chat / clipboard) → seedhi, zyada se
//                      zyada 1600 px, JPEG 85. Yehi file yaadash ke folder mein jati hai.
//   thumbnailDataUrl   panel ke album ke liye chhoti JPEG (data: URL — renderer ko
//                      file:// ki pohanch nahi chahiye).
//
// ── ROTATION (EXIF) ─────────────────────────────────────────────────────────
//
// Phone ki tasveer aksar "terhi" save hoti hai aur saath ek nishan hota hai
// (EXIF Orientation) ke dikhate waqt use kitna ghumana hai. Naap (23 Nov 2026,
// Electron 34.5.8): `nativeImage` ye nishan NAZAR-ANDAAZ karta hai — Orientation 6
// wali 40×20 tasveer 40×20 hi rehti hai. Isi liye nishan yahan khud parha jata
// hai aur pixel khud ghumaye jate hain (sharp / Chromium bhi yehi karte hain).
//
// Dobara JPEG banane ka ek faida: EXIF poora utar jata hai — tasveer ke andar
// chhupi jagah (GPS), phone ka naam aur waqt yaadash ke folder tak nahi pohnchte.
//
// Electron is file mein `require` nahi hota — `nativeImage` bahar se aata hai,
// taake hisaab (EXIF, ghumana) seedha `node --test` mein parkha ja sake.

'use strict';

/** Itni bari file parhi hi nahi jati (40 MB — 48 MP ki phone tasveer bhi is se chhoti). */
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MEMORY_MAX_SIDE = 1600;
const MEMORY_QUALITY = 85;
const THUMB_SIDE = 360;
const THUMB_QUALITY = 78;

// ── EXIF Orientation ────────────────────────────────────────────────────────

/**
 * JPEG ke andar EXIF ka Orientation (1–8). Na mile, ghalat ho ya JPEG hi na ho = 1.
 * Sirf APP1 "Exif" ke IFD0 ka tag 0x0112 — poora EXIF parhne ki zaroorat nahi.
 * @param {Buffer} buf
 */
function readExifOrientation(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let at = 2;
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff) return 1;
    const marker = buf[at + 1];
    // Bhara hua 0xFF (padding) chhor do.
    if (marker === 0xff) { at += 1; continue; }
    // Tasveer ka data shuru (SOS) ya khatam (EOI) — EXIF is se pehle hi hota hai.
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = buf.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > buf.length) return 1;
    if (marker === 0xe1 && length >= 16 && buf.toString('latin1', at + 4, at + 10) === 'Exif\0\0') {
      return orientationFromTiff(buf, at + 10, at + 2 + length);
    }
    at += 2 + length;
  }
  return 1;
}

function orientationFromTiff(buf, start, end) {
  if (start + 8 > end) return 1;
  const order = buf.toString('latin1', start, start + 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return 1;
  const u16 = (off) => (little ? buf.readUInt16LE(off) : buf.readUInt16BE(off));
  const u32 = (off) => (little ? buf.readUInt32LE(off) : buf.readUInt32BE(off));
  if (u16(start + 2) !== 0x2a) return 1;
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) !== 0x0112) continue;
    // SHORT (3): qeemat value ke pehle do bytes mein.
    const value = u16(entry + 2) === 3 ? u16(entry + 8) : 1;
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

// ── Pixel ghumana ───────────────────────────────────────────────────────────

/**
 * Bitmap (4 byte fi pixel — rang ki tarteeb jo bhi ho, wohi rehti hai) ko EXIF
 * ke hisaab se seedha karo. Har naya pixel (x', y') purane (x, y) se aata hai.
 * @param {Buffer} data  width × height × 4
 * @param {number} width
 * @param {number} height
 * @param {number} orientation  1–8
 * @returns {{ data: Buffer, width: number, height: number }}
 */
function orientBitmap(data, width, height, orientation) {
  const o = Number(orientation) || 1;
  if (o === 1 || o < 1 || o > 8) return { data, width, height };
  const swap = o >= 5;
  const outW = swap ? height : width;
  const outH = swap ? width : height;
  const out = Buffer.alloc(outW * outH * 4);
  for (let y2 = 0; y2 < outH; y2 += 1) {
    for (let x2 = 0; x2 < outW; x2 += 1) {
      let x;
      let y;
      switch (o) {
        case 2: x = width - 1 - x2; y = y2; break;                 // aaina (daayen-baayen)
        case 3: x = width - 1 - x2; y = height - 1 - y2; break;    // 180°
        case 4: x = x2; y = height - 1 - y2; break;                // aaina (upar-neeche)
        case 5: x = y2; y = x2; break;                             // transpose
        case 6: x = y2; y = height - 1 - x2; break;                // 90° seedhe haath
        case 7: x = width - 1 - y2; y = height - 1 - x2; break;    // transverse
        default: x = width - 1 - y2; y = x2; break;                // 8: 90° ulte haath
      }
      const from = (y * width + x) * 4;
      const to = (y2 * outW + x2) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { data: out, width: outW, height: outH };
}

// ── nativeImage ke saath ────────────────────────────────────────────────────

const isJpeg = (buf) => Buffer.isBuffer(buf) && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

/**
 * @param {Buffer} buf
 * @param {{ nativeImage: any, maxSide: number }} opts
 * @returns {{ ok: true, image: any, width: number, height: number } | { ok: false, reason: string }}
 */
function decodeUpright(buf, { nativeImage, maxSide }) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, reason: 'empty' };
  if (buf.length > MAX_INPUT_BYTES) return { ok: false, reason: 'too_big' };
  let image;
  try { image = nativeImage.createFromBuffer(buf); } catch { return { ok: false, reason: 'unreadable' }; }
  if (!image || image.isEmpty()) return { ok: false, reason: 'unreadable' };
  const size = image.getSize();
  if (!size || !(size.width > 0) || !(size.height > 0)) return { ok: false, reason: 'unreadable' };

  // Pehle chhota, phir ghumao: kam pixel ghumane parte hain.
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  if (scale < 1) {
    image = image.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'best',
    });
  }
  const orientation = isJpeg(buf) ? readExifOrientation(buf) : 1;
  if (orientation !== 1) {
    const now = image.getSize();
    const bitmap = image.toBitmap();
    if (bitmap && bitmap.length === now.width * now.height * 4) {
      const turned = orientBitmap(bitmap, now.width, now.height, orientation);
      image = nativeImage.createFromBitmap(turned.data, { width: turned.width, height: turned.height });
    }
  }
  const finalSize = image.getSize();
  return { ok: true, image, width: finalSize.width, height: finalSize.height };
}

/**
 * Yaadash ki tasveer: seedhi, lambi taraf zyada se zyada 1600 px, JPEG 85, EXIF ke baghair.
 * @param {Buffer} buf  koi bhi tasveer jo nativeImage parh sake (JPEG / PNG …)
 * @param {{ nativeImage: any, maxSide?: number, quality?: number }} opts
 * @returns {{ ok: true, jpeg: Buffer, width: number, height: number } | { ok: false, reason: string }}
 */
function encodeMemoryPhoto(buf, { nativeImage, maxSide = MEMORY_MAX_SIDE, quality = MEMORY_QUALITY }) {
  const decoded = decodeUpright(buf, { nativeImage, maxSide });
  if (!decoded.ok) return decoded;
  const jpeg = decoded.image.toJPEG(quality);
  if (!isJpeg(jpeg)) return { ok: false, reason: 'encode_failed' };
  return { ok: true, jpeg, width: decoded.width, height: decoded.height };
}

/** Album ke liye chhoti tasveer (data: URL). */
function thumbnailDataUrl(buf, { nativeImage, side = THUMB_SIDE, quality = THUMB_QUALITY }) {
  const decoded = decodeUpright(buf, { nativeImage, maxSide: side });
  if (!decoded.ok) return decoded;
  const jpeg = decoded.image.toJPEG(quality);
  return { ok: true, dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`, width: decoded.width, height: decoded.height };
}

module.exports = {
  MAX_INPUT_BYTES,
  MEMORY_MAX_SIDE,
  MEMORY_QUALITY,
  THUMB_SIDE,
  readExifOrientation,
  orientBitmap,
  encodeMemoryPhoto,
  thumbnailDataUrl,
  isJpeg,
};
