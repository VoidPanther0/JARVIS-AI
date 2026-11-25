// Reminders / waqt par chalne wale kaam — Settings ki fehrist ke liye, sirf PARHNA.
//
// Ye reminders Stonic nahi banata: Stonic Voice ka dimagh Claude Code harness
// hai, aur ye us ke apne tools hain (CronCreate / CronList / CronDelete —
// stonic-voice/stonic_voice/schedules.py). Harness inhein dimagh ke kaam ke
// folder (user ka ghar) mein apni file `.claude/scheduled_tasks.json` mein
// rakhta hai, aur waqt aane par khud chalata hai.
//
// App is file ko sirf PARHTI hai, taake user dekh sake abhi kya laga hua hai.
// Likhna / mitana sirf harness ka kaam (user Stonic se kehta hai: "wo reminder
// hata do" → CronDelete). Is liye yahan koi write nahi — file ki shakl harness
// ki hai, hum us ke maalik nahi.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Harness khud is se bari file nahi parhta (CLI 2.1.318).
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ITEMS = 100;
const MAX_PROMPT_CHARS = 600;
const MAX_CRON_CHARS = 80;

// Wohi folder jo engine dimagh ko deta hai (config.py `agent_workspace` = user ka ghar).
const remindersFile = (home = os.homedir()) => path.join(home, '.claude', 'scheduled_tasks.json');

const clip = (text, limit) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
};

function parseReminders(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const tasks = data && typeof data === 'object' && Array.isArray(data.tasks) ? data.tasks : [];
  const items = [];
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    const { id, cron, prompt, createdAt } = task;
    if (typeof id !== 'string' || typeof cron !== 'string' || typeof prompt !== 'string') continue;
    if (!id || id.length > 64 || !cron.trim() || cron.length > MAX_CRON_CHARS) continue;
    items.push({
      id,
      cron: cron.trim().replace(/\s+/g, ' '),
      prompt: clip(prompt, MAX_PROMPT_CHARS),
      recurring: task.recurring === true,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

/** Lage hue reminders. File na ho / kharab ho = khali fehrist (ghalti nahi). */
async function readReminders(home) {
  const file = remindersFile(home);
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { ok: true, items: [] };
    return { ok: true, items: parseReminders(await fs.promises.readFile(file, 'utf8')) };
  } catch {
    return { ok: true, items: [] };
  }
}

module.exports = { readReminders, parseReminders, remindersFile };
