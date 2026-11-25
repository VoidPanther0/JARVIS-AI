const { BrowserWindow } = require('electron');

// Tasveer wali yaadash + "Stonic aap ka chehra jaanta hai" — IPC darwaza
// (services/visual-memory/service.js).
//
// Tasveerein: Memory panel ka album, aur dono voices ka `remember_photo` tool.
// Chehra: webcam ki photo se sikhana / bhoolna sirf MAIN window se (player / browser
// windows wohi preload baant-ti hain). Chehre ke numbers renderer se AATE hain (photo
// se, pehchan ke liye), wapas kabhi nahi jate — jawab mein sirf naam aur score.
// Face Lock (taala) se koi taalluq nahi.
//
// Koi handler throw nahi karta; har jawab ek object.

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try { win.webContents.send(channel, payload); } catch { /* window band ho rahi hai */ }
  }
}

const str = (value, max = 4096) => (typeof value === 'string' ? value.slice(0, max) : '');
/** 40 MB ki tasveer base64 mein ~54 MB. */
const MAX_IMAGE_CHARS = 56 * 1024 * 1024;

function imageArg(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  if (src.clipboard === true) return { clipboard: true };
  if (typeof src.path === 'string' && src.path) return { path: src.path.slice(0, 1024) };
  if (typeof src.data === 'string' && src.data.length <= MAX_IMAGE_CHARS) return { data: src.data };
  return {};
}

/** Chehre ke numbers: [[128]] — shakal yahin pakki, baqi jaanch faces.js mein. */
function vectors(raw, max) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, max).filter((v) => Array.isArray(v) && v.length === 128).map((v) => v.map(Number));
}

function frames(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).map((frame) => (Array.isArray(frame) ? frame : []).slice(0, 4)
    .filter((face) => face && Array.isArray(face.embedding) && face.embedding.length === 128)
    .map((face) => ({ embedding: face.embedding.map(Number), clear: face.clear === true })));
}

function registerVisualMemoryHandlers({ getVisualMemoryService, getMainWindow }) {
  const { ipcMain } = require('electron');

  const call = (fn, { mainOnly = false } = {}) => async (event, payload) => {
    const svc = typeof getVisualMemoryService === 'function' ? getVisualMemoryService() : null;
    if (!svc) return { ok: false, reason: 'not_initialised' };
    if (mainOnly) {
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      if (!win || win.isDestroyed() || event.sender !== win.webContents) return { ok: false, reason: 'forbidden' };
    }
    try {
      return await fn(svc, payload && typeof payload === 'object' ? payload : {});
    } catch (err) {
      // Matn mein kabhi numbers nahi — sirf ghalti ka naam.
      return { ok: false, reason: 'error', text: String(err && err.code ? err.code : 'error').slice(0, 60) };
    }
  };

  const faceChanged = async (pending) => {
    const result = await pending;
    if (result && result.ok) broadcast('visual-memory:face-changed', { self: result.status ? result.status.self : null });
    return result;
  };

  ipcMain.handle('visual-memory:status', call((svc) => svc.status()));

  // ── Tasveer wali yaadein ──────────────────────────────────────────────────
  ipcMain.handle('visual-memory:photos', call((svc) => svc.listPhotos()));
  ipcMain.handle('visual-memory:thumb', call((svc, p) => svc.thumbnail(str(p.path, 512), Number(p.side) > 0 ? Math.min(800, Number(p.side)) : undefined)));
  ipcMain.handle('visual-memory:open', call((svc, p) => svc.openPhoto(str(p.path, 512))));
  ipcMain.handle('visual-memory:save', call((svc, p) => svc.savePhoto({
    image: imageArg(p.image),
    title: str(p.title, 200),
    story: str(p.story, 8000),
    people: Array.isArray(p.people) ? p.people.slice(0, 20).map((x) => str(x, 80)) : str(p.people, 800),
    feeling: str(p.feeling, 200),
    source: str(p.source, 20),
  })));
  ipcMain.handle('visual-memory:update', call((svc, p) => svc.updatePhoto(str(p.path, 512), {
    description: typeof p.description === 'string' ? p.description.slice(0, 400) : undefined,
    body: typeof p.body === 'string' ? p.body.slice(0, 16_000) : undefined,
  })));
  ipcMain.handle('visual-memory:forget', call((svc, p) => svc.forgetPhoto(str(p.path, 512))));

  // ── Chehra ────────────────────────────────────────────────────────────────
  ipcMain.handle('visual-memory:face-status', call((svc) => svc.faceStatus()));
  ipcMain.handle('visual-memory:face-identify', call((svc, p) => svc.identify(frames(p.frames))));
  ipcMain.handle('visual-memory:face-photo', call((svc, p) => svc.facePhoto(Number(p.side) > 0 ? Math.min(800, Number(p.side)) : undefined)));
  ipcMain.handle('visual-memory:face-enroll', call((svc, p) => faceChanged(svc.enrollFace({
    templates: vectors(p.templates, 12),
    name: str(p.name, 80),
    photo: typeof p.photo === 'string' && p.photo.length <= MAX_IMAGE_CHARS ? p.photo : null,
    // Onboarding ki Day 1 tasveer: album wali yaad ka apna title / kahani (ikhtiyari).
    memory: p.memory && typeof p.memory === 'object'
      ? { title: str(p.memory.title, 120), story: str(p.memory.story, 1200), feeling: str(p.memory.feeling, 80) }
      : null,
  })), { mainOnly: true }));
  ipcMain.handle('visual-memory:face-rename', call((svc, p) => faceChanged(svc.renameFace(str(p.name, 80))), { mainOnly: true }));
  ipcMain.handle('visual-memory:face-forget', call((svc) => faceChanged(svc.forgetFace()), { mainOnly: true }));
}

module.exports = { registerVisualMemoryHandlers };
