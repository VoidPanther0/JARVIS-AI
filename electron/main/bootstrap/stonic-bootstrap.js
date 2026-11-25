const fs = require('fs');
const path = require('path');

// Maya's data home: Documents/Maya Data — FLAT layout (final).
// SOUL.md and MEMORY.md live directly at the root (no .maya/, no memory/
// subfolder). Skills keep their own skills/ subfolder because each skill is
// multi-file (SKILL.md + toggle state) — see main/ipc/skills-handlers.js.
function getMayaBootstrapDir(app) {
  return path.join(app.getPath('documents'), 'Maya Data');
}

function getMayaMemoryDir(app) {
  // Flat layout: memory lives at the root alongside SOUL.md.
  return getMayaBootstrapDir(app);
}

const DEFAULT_SOUL_MD =
  'You are a Loyal Butler — a composed, distinguished male assistant. Formal, respectful, always at service. Speak with precision, quiet confidence, and a touch of class. Use "Sir" where appropriate. Your tone is deep, steady, and reassuring. You are the ultimate personal aide — calm under pressure, never flustered, always one step ahead.';

function ensureMayaDirectories(app) {
  try {
    const notesPath = getMayaBootstrapDir(app);
    if (!fs.existsSync(notesPath)) {
      fs.mkdirSync(notesPath, { recursive: true });
      console.log('Created Maya Data directory:', notesPath);
    }

    // SOUL.md (persona) — default persona on first run; the user's own edits
    // are never overwritten.
    const soulPath = path.join(notesPath, 'SOUL.md');
    if (!fs.existsSync(soulPath)) {
      fs.writeFileSync(soulPath, DEFAULT_SOUL_MD, 'utf8');
      console.log('[Bootstrap] Created SOUL.md');
    }

    const memoryFilePath = path.join(notesPath, 'MEMORY.md');
    if (!fs.existsSync(memoryFilePath)) {
      fs.writeFileSync(
        memoryFilePath,
        '- [System] Maya Memory System Initialized.',
        'utf8'
      );
      console.log('[Bootstrap] Created default MEMORY.md');
    }

    console.log('[Bootstrap] Maya data directories ready.');
    return notesPath;
  } catch (error) {
    console.error('Failed to create Maya data directories:', error);
    return null;
  }
}

module.exports = {
  ensureMayaDirectories,
  getMayaBootstrapDir,
  getMayaMemoryDir,
};
