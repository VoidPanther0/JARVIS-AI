"""Reminders aur waqt par chalne wale kaam — Claude Code harness ke APNE tools.

Stonic yahan kuch nahi banata. Teen tool Claude Code ke hain, jaise hain waise:

    CronCreate   waqt par (ek dafa) ya baar baar chalne wala kaam / reminder banata hai
    CronList     jo lage hue hain un ki fehrist
    CronDelete   kisi ek ko hatata hai (id se)

Ghari bhi harness ki apni hai: waqt aane par wo likha hua prompt session mein KHUD
daalta hai (jaise user ne kaha ho) aur dimagh jaag kar jawab deta hai. Naapa
(13 Nov 2026, CLI 2.1.318, naqli Claude): ek dafa wala reminder theek second par
baja; `durable` ho to engine ke dobara chalne par naye process mein bhi; waqt par
engine band tha to agli dafa uthte hi harness khud batata hai ke ye chhoot gaya.

Harness ke apne qaide (hum nahi badalte):
  - sirf chalte dimagh mein bajta hai (baat-cheet band = us lamhe nahi bajta);
  - baar baar wala 7 din baad khud khatam, aur apne waqt se 30 minute tak der kar sakta hai;
  - `durable` = kaam ke folder mein `.claude/scheduled_tasks.json` (harness ki apni file).

Stonic ki taraf sirf jor hai:
  - New voice ko ye teen tool milte hain (pipeline.py);
  - har reminder `durable` (agent.py, PreToolUse hook ka `updatedInput`): voice ki
    baat-cheet chand minute ki hoti hai — session ke saath mar jane wala reminder
    user ke liye "baja hi nahi";
  - reminder qareeb ho to khamoshi par baat-cheet band nahi hoti (pipeline.py);
  - Settings mein fehrist: app harness ki file sirf PARHTI hai (electron/services/
    voice-reminders.js). Likhna / mitana sirf harness ka kaam.

`Monitor` (harness ka "nazar rakhna") yahan NAHI: Windows par wo command bash se
chalata hai (naapa: PowerShell command par exit 127) — user ke PC par bash hota
nahi, aur wo command hamare PowerShell ke pehre (safety.py) se guzarta bhi nahi.
"Jab ye ho jaye to batana" pehle se chalta hai: PowerShell `run_in_background`.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import time
from typing import Any

CREATE_TOOL = "CronCreate"
LIST_TOOL = "CronList"
DELETE_TOOL = "CronDelete"
SCHEDULE_TOOLS: tuple[str, ...] = (CREATE_TOOL, LIST_TOOL, DELETE_TOOL)

# Screen ki chhoti line (agent.py `describe_tool`).
LABELS = {
    CREATE_TOOL: "Setting a reminder",
    LIST_TOOL: "Checking your reminders",
    DELETE_TOOL: "Removing a reminder",
}

# Harness ki file, kaam ke folder (cwd) ke andar.
FILE_PARTS = (".claude", "scheduled_tasks.json")
# Harness khud is se bari file nahi parhta (CLI 2.1.318).
MAX_FILE_BYTES = 1024 * 1024
# Ek dafa wala reminder itni der ke andar ho to khamoshi par baat-cheet band nahi
# hoti. Wohi hadd jo peeche chalte command ki zyada se zyada umar hai (2 ghante).
HOLD_SECS = 2 * 60 * 60


def file_path(cwd: str) -> str:
    return os.path.join(cwd or os.path.expanduser("~"), *FILE_PARTS)


def read(cwd: str) -> list[dict[str, Any]]:
    """Lage hue reminders, harness ki file se — sirf parhna. File na ho / kharab ho = khali."""
    path = file_path(cwd)
    try:
        if os.path.getsize(path) > MAX_FILE_BYTES:
            return []
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []
    tasks = data.get("tasks") if isinstance(data, dict) else None
    out: list[dict[str, Any]] = []
    for item in tasks if isinstance(tasks, list) else []:
        if not isinstance(item, dict):
            continue
        job_id, cron, prompt = item.get("id"), item.get("cron"), item.get("prompt")
        if not (isinstance(job_id, str) and isinstance(cron, str) and isinstance(prompt, str)):
            continue
        created = item.get("createdAt")
        out.append({
            "id": job_id,
            "cron": cron,
            "prompt": prompt,
            "recurring": item.get("recurring") is True,
            "created_at": created / 1000 if isinstance(created, (int, float)) and not isinstance(created, bool) else 0.0,
        })
    return out


def one_shot_time(cron: str, created_at: float) -> float | None:
    """Ek dafa wale reminder ka waqt (epoch second), jab cron ka minute / ghanta / din / mahina pakka ho.

    Harness aisa hi likhwata hai ("30 14 28 2 *"). Saal cron mein nahi hota: banne
    ke baad ka pehla aisa din. Kuch aur shakl (`*/5`, range) = None.
    """
    parts = str(cron or "").split()
    if len(parts) != 5 or parts[4] != "*" or not all(part.isdigit() for part in parts[:4]):
        return None
    minute, hour, day, month = (int(part) for part in parts[:4])
    base = dt.datetime.fromtimestamp(created_at) if created_at > 0 else dt.datetime.now()
    for year in (base.year, base.year + 1):
        try:
            moment = dt.datetime(year, month, day, hour, minute)
        except ValueError:
            continue  # 29 Feb / 31 Nov jaisa din is saal nahi
        # Harness :00 / :30 wale ko 90 s tak pehle baja sakta hai: banne se thora pehle ka waqt bhi isi saal ka.
        if moment.timestamp() >= base.timestamp() - 120:
            return moment.timestamp()
    return None


def due_within(cwd: str, secs: float, now: float | None = None) -> bool:
    """Koi ek dafa wala reminder agle `secs` second mein bajna hai?

    Baar baar wale yahan nahi gine jate: wo 7 din tak rehte hain — un ke liye
    baat-cheet (aur mic) ghanton khuli nahi rakhi jati.
    """
    now = time.time() if now is None else now
    for job in read(cwd):
        if job["recurring"]:
            continue
        at = one_shot_time(job["cron"], job["created_at"])
        if at is not None and now - 60 <= at <= now + secs:
            return True
    return False
