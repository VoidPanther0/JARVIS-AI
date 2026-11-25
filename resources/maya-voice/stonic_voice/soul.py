"""Maya ki Ruh — awareness ka dimagh, Claude Agent SDK par (wohi harness jo dono voices chalata hai).

23 Nov 2026 (Usman): awareness "ek call wala" dimagh na rahe, Maya ki ZINDA RUH bane — jo
peeche jaagti hai, mehsoos karti hai, aur yaadash ki maalik hai: parhti hai, nayi yaad likhti
hai, purani sanwarti hai. Sirf jab Maya app chal rahi ho (app band = ruh bhi band).

    app (lib/awareness/soul.ts) ──POST /soul/think──> yahan ──> Claude Code
    qadam ──stdout {"event": "soul", "kind": "step"}──> app   (parha / likha)
    jawab ──stdout {"event": "soul", "kind": "done", "text": …}──> app (JSON faisla)

Do tarah ki soch (`mode`):
  moment  awareness ka ek lamha: yaadash dekho, zaroorat ho to note kholo, kuch seekha
          ho to likho, phir JSON faisla (chup / bolo / dekho) — engine.ts wohi chalata hai.
  sleep   din mein ek dafa "neend": aaj ki baatein yaadash mein bithao, bikhri yaadein
          jodo, apni diary likho. User door ho tab (app phir bhi chal rahi ho).

Yaadash = Claude Code ki OFFICIAL auto memory (`autoMemoryDirectory`), wohi folder aur wohi
qaide jo New voice ke hain (agent.memory_options). MEMORY.md CLI khud pehle paigham mein laata hai.

Ruh PC par sirf yaadash chhoti hai. Pehre (PreToolUse, fail-closed):
  - Tools sirf Read / Glob / Grep / Write / Edit — aur sab SIRF yaadash ke folder mein.
    PowerShell, web, doosri files: hain hi nahi.
  - Likhai sirf `.md` notes par, chhupe folder (".xyz") par nahi.
  - YAAD KABHI NAHI MITTI: kisi maujood note par likhne se PEHLE us ki naqal backup mein
    (yaadash ke folder se BAHAR — ruh usay chhoo bhi nahi sakti). Note ko aadhe se chhota
    karna ya bara hissa mitana rad — jorna / sanwarna haan.
  - Har soch mein parhne / likhne ki ginti ki hadd; poori soch ki ghari.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import os
import shutil
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from loguru import logger

from maya_voice import host
from maya_voice.config import ConfigError, Settings, agent_home, agent_thinking, work_settings
from maya_voice.visual import classify, route_missing
from maya_voice.world import inside

# Gateway ke hisaab mein wohi naam jo purani awareness ka tha (ledger mein alag nazar aaye).
PURPOSE = "awareness"
# System prompt Windows ki command line par jata hai (SDK `--system-prompt`): ~32k ki hadd se neeche.
MAX_SYSTEM_CHARS = 24_000
MAX_PROMPT_CHARS = 60_000
MAX_MEMORY_DIR_CHARS = 1024
_ID_CHARS = 64

# Tasveerein (screen / camera): engine.ts ek soch mein zyada se zyada 1 screen + 3 camera bhejta hai.
MAX_IMAGES = 4
MAX_IMAGE_B64_CHARS = 4_000_000
IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")

# Ruh ka halka Claude: har lamha sochna hai, is liye sab se tez aur sasta (Cloud par model
# gateway tay karta hai — wohi jo Classic ke kaam ka hai).
SOUL_MODEL_ANTHROPIC = "claude-haiku-5-5"
SOUL_MODEL_OPENROUTER = "anthropic/claude-haiku-5.5"


@dataclass(frozen=True)
class Mode:
    effort: str
    max_turns: int
    max_reads: int
    max_writes: int
    max_output_tokens: int
    timeout_secs: float


MODES: dict[str, Mode] = {
    # Lamha: zyada tar ek do qadam (fehrist dekhi, shayad ek note khola) — phir faisla.
    "moment": Mode(effort="low", max_turns=14, max_reads=8, max_writes=4, max_output_tokens=2_000, timeout_secs=90.0),
    # Neend: poori yaadash dekh kar jorna — lamba magar din mein ek dafa.
    "sleep": Mode(effort="medium", max_turns=48, max_reads=40, max_writes=16, max_output_tokens=8_000, timeout_secs=300.0),
}

READ_TOOLS = ("Read", "Glob", "Grep")
WRITE_TOOLS = ("Write", "Edit")
TOOLS = READ_TOOLS + WRITE_TOOLS

# Note itna chhota ho jaye (purane ke muqable) to "mitana" — rad.
SHRINK_FLOOR = 0.5
# Edit mein itne se bara hissa bilkul khali kar dena = mitana — rad.
ERASE_CHARS = 300
# Backup itne din rakhe jate hain (us ke baad purane din ka folder saaf).
BACKUP_DAYS = 30
MAX_NOTE_CHARS = 40_000

OUTSIDE_MEMORY = "You can only read and write inside your memory folder."
NO_OTHER_TOOLS = "You only have your memory: Read, Glob, Grep, Write and Edit inside the memory folder."
ONLY_NOTES = "You can only write Markdown notes (.md) in your memory folder, not hidden files or other file types."
NO_ERASING = (
    "You never erase memories. Do not shorten a note or remove a big part of it — add to it, "
    "merge, or correct a detail instead."
)
READ_LIMIT_TEXT = "You have read enough for this moment. Decide now with what you know."
WRITE_LIMIT_TEXT = "You have written enough for now. Finish with what you have."
NOTE_TOO_LONG = "That note would be too long. Keep notes short; start a new note for a new subject."


def _clip(text: Any, limit: int) -> str:
    text = str(text or "")
    return text if len(text) <= limit else text[:limit]


def _run_id(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text or len(text) > _ID_CHARS or not all(ch.isalnum() or ch in "-_" for ch in text):
        raise ConfigError("bad_request", "run: chhota naam chahiye (harf, adad, - _)")
    return text


def _memory_dir(raw: Any) -> str:
    """App ka bheja yaadash ka folder: poora raasta aur asli folder ho, warna '' (ruh nahi chalti)."""
    value = str(raw or "").strip()
    if not value or len(value) > MAX_MEMORY_DIR_CHARS or "\x00" in value or not os.path.isabs(value):
        return ""
    return value if os.path.isdir(value) else ""


def backup_root(memory_dir: str) -> str:
    """Backup yaadash ke folder ke BAHAR, us ke saath wale chhupe folder mein: ruh ki pohnch se door.

    %APPDATA%\\Maya AI\\Memory\\u-123  →  %APPDATA%\\Maya AI\\Memory\\.soul-backup\\u-123
    """
    base = os.path.dirname(os.path.abspath(memory_dir).rstrip("\\/"))
    return os.path.join(base, ".soul-backup", os.path.basename(os.path.abspath(memory_dir).rstrip("\\/")))


def _hidden(path: str, memory_dir: str) -> bool:
    """Yaadash ke folder ke andar koi hissa "." se shuru hota hai? (.git, .migration.json …)"""
    try:
        rel = os.path.relpath(os.path.realpath(path), os.path.realpath(memory_dir))
    except ValueError:
        return True
    return any(part.startswith(".") for part in rel.replace("\\", "/").split("/") if part not in ("", "."))


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except (OSError, UnicodeDecodeError):
        return None


@dataclass
class _Run:
    id: str
    mode: str
    memory_dir: str
    started: float = field(default_factory=time.monotonic)
    started_wall: float = field(default_factory=time.time)
    client: Any = None
    task: asyncio.Task[None] | None = None
    stopped: bool = False
    reads: int = 0
    turns: int = 0
    # Is soch mein likhi gayi notes: [{"file": "family.md", "action": "created" | "updated"}]
    writes: list[dict[str, str]] = field(default_factory=list)


def review(name: str, args: dict[str, Any], run: _Run, limits: Mode) -> tuple[bool, str]:
    """Pehra: (ijazat, wajah). Sirf yaadash ka folder; likhai sirf .md par; mitana nahi."""
    if name not in TOOLS or not run.memory_dir:
        return False, NO_OTHER_TOOLS
    if name in READ_TOOLS:
        if run.reads >= limits.max_reads:
            return False, READ_LIMIT_TEXT
        if name == "Read":
            return (True, "") if inside(args.get("file_path"), run.memory_dir) else (False, OUTSIDE_MEMORY)
        path = args.get("path")
        if path and not inside(path, run.memory_dir):
            return False, OUTSIDE_MEMORY
        pattern = str(args.get("pattern") or "")
        if name == "Glob" and (os.path.isabs(pattern) or ".." in pattern.replace("\\", "/").split("/")):
            return False, OUTSIDE_MEMORY
        return True, ""

    # Write / Edit
    target = str(args.get("file_path") or "")
    if not inside(target, run.memory_dir):
        return False, OUTSIDE_MEMORY
    if not target.lower().endswith(".md") or _hidden(target, run.memory_dir):
        return False, ONLY_NOTES
    if len(run.writes) >= limits.max_writes:
        return False, WRITE_LIMIT_TEXT
    old = _read(target) if os.path.isfile(target) else None
    if name == "Write":
        content = str(args.get("content") or "")
        if len(content) > MAX_NOTE_CHARS:
            return False, NOTE_TOO_LONG
        if old is not None and len(old.strip()) > 0 and len(content.strip()) < len(old.strip()) * SHRINK_FLOOR:
            return False, NO_ERASING
        return True, ""
    old_string = str(args.get("old_string") or "")
    new_string = str(args.get("new_string") or "")
    if len(old_string) >= ERASE_CHARS and len(new_string.strip()) < len(old_string) * SHRINK_FLOOR:
        return False, NO_ERASING
    if bool(args.get("replace_all")) and len(new_string) < len(old_string):
        return False, NO_ERASING
    return True, ""


def back_up(target: str, memory_dir: str, now: datetime | None = None) -> str:
    """Maujood note ki naqal likhai se PEHLE. Raasta lautata hai ('' = note naya tha / naqal na ho saki)."""
    if not os.path.isfile(target):
        return ""
    now = now or datetime.now()
    rel = os.path.relpath(os.path.realpath(target), os.path.realpath(memory_dir))
    safe = rel.replace("\\", "__").replace("/", "__")
    folder = os.path.join(backup_root(memory_dir), now.strftime("%Y-%m-%d"))
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, f"{now.strftime('%H%M%S')}-{now.microsecond // 1000:03d}-{safe}")
    shutil.copy2(target, dest)
    return dest


def prune_backups(memory_dir: str, now: datetime | None = None) -> int:
    """BACKUP_DAYS se purane din ke folder saaf (sirf backup — yaadash nahi). Kitne hataye."""
    root = backup_root(memory_dir)
    if not os.path.isdir(root):
        return 0
    cutoff = (now or datetime.now()) - timedelta(days=BACKUP_DAYS)
    removed = 0
    for name in os.listdir(root):
        try:
            day = datetime.strptime(name, "%Y-%m-%d")
        except ValueError:
            continue
        if day < cutoff:
            shutil.rmtree(os.path.join(root, name), ignore_errors=True)
            removed += 1
    return removed


def soul_model(settings: Settings) -> str:
    """Ruh ka model: Cloud par gateway ka; apni key par halka Claude (Haiku); muft Gemini par wohi."""
    if settings.is_cloud:
        return settings.brain.model
    if settings.brain.provider == "anthropic":
        return SOUL_MODEL_ANTHROPIC
    if settings.brain.provider == "openrouter":
        return SOUL_MODEL_OPENROUTER
    return settings.brain.model


def soul_workspace() -> str:
    path = os.path.join(agent_home(), "soul")
    os.makedirs(path, exist_ok=True)
    return path


def parse_images(raw: Any) -> list[dict[str, Any]]:
    """App ki tasveerein (data: URL) → Anthropic image blocks. Ghalat / bari tasveer chhor di jati hai."""
    blocks: list[dict[str, Any]] = []
    for item in (raw if isinstance(raw, list) else [])[:MAX_IMAGES]:
        text = str(item or "")
        if not text.startswith("data:") or ";base64," not in text:
            continue
        head, data = text[5:].split(";base64,", 1)
        media = head.strip().lower()
        if media not in IMAGE_TYPES or not data or len(data) > MAX_IMAGE_B64_CHARS:
            continue
        try:
            base64.b64decode(data[:64] + "=" * (-len(data[:64]) % 4), validate=True)
        except (binascii.Error, ValueError):
            continue
        blocks.append({"type": "image", "source": {"type": "base64", "media_type": media, "data": data}})
    return blocks


# ── Ek soch ──────────────────────────────────────────────────────────────────


_runs: dict[str, _Run] = {}


def _emit(run: _Run, kind: str, **fields: Any) -> None:
    host.emit("soul", run=run.id, mode=run.mode, kind=kind, **fields)


def options_for(settings: Settings, system: str, run: _Run) -> Any:
    """Claude Code ke options: halka Claude, sirf yaadash ke tools, official auto memory."""
    import json

    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher, PermissionResultAllow, PermissionResultDeny

    from maya_voice.agent import memory_options
    from maya_voice.pipeline import agent_env

    limits = MODES[run.mode]
    model = settings.brain.model
    env = agent_env(settings, agent_home())
    env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = str(limits.max_output_tokens)
    memory_env, memory_settings = memory_options(run.memory_dir)
    env.update(memory_env)

    def decide(name: str, args: dict[str, Any]) -> tuple[bool, str]:
        allowed, reason = review(name, args, run, limits)
        if not allowed:
            logger.info(f"Soul[{run.id}]: {name} rad — {reason[:80]}")
            return allowed, reason
        if name in READ_TOOLS:
            run.reads += 1
            target = str(args.get("file_path") or args.get("pattern") or "")
            _emit(run, "step", tool="read", file=_clip(os.path.basename(target), 80), n=run.reads)
            return True, ""
        target = str(args.get("file_path") or "")
        existed = os.path.isfile(target)
        try:
            back_up(target, run.memory_dir)
        except OSError as error:
            # Naqal na ban saki to likhai bhi nahi — "yaad kabhi nahi mitti" ka waada pehle.
            logger.warning(f"Soul[{run.id}]: backup na ban saka — likhai rad ({error})")
            return False, "Your memory could not be saved safely right now. Do not write; carry on without it."
        file = os.path.relpath(os.path.realpath(target), os.path.realpath(run.memory_dir)).replace("\\", "/")
        action = "updated" if existed else "created"
        run.writes.append({"file": _clip(file, 120), "action": action})
        _emit(run, "step", tool="write", file=_clip(file, 120), action=action, n=len(run.writes))
        return True, ""

    async def pre_tool_use(input_data: Any, _tool_use_id: str | None, _context: Any) -> dict[str, Any]:
        allowed, reason = decide(str(input_data.get("tool_name") or ""), dict(input_data.get("tool_input") or {}))
        output: dict[str, Any] = {"hookEventName": "PreToolUse", "permissionDecision": "allow" if allowed else "deny"}
        if not allowed:
            output["permissionDecisionReason"] = reason
        return {"hookSpecificOutput": output}

    async def can_use_tool(name: str, args: dict[str, Any], _context: Any) -> Any:
        # Sirf wo call jis par hook faisla na de saka: pehra phir bhi wohi (ginti dobara nahi).
        allowed, reason = review(name, dict(args or {}), run, limits)
        return PermissionResultAllow() if allowed else PermissionResultDeny(message=reason)

    kwargs: dict[str, Any] = dict(
        model=model,
        system_prompt={"type": "custom", "prompt": system, "snapshot": False},
        tools=list(TOOLS) if run.memory_dir else [],
        permission_mode="default",
        can_use_tool=can_use_tool,
        hooks={"PreToolUse": [HookMatcher(hooks=[pre_tool_use], on_failure="block")]},
        setting_sources=[],
        max_turns=limits.max_turns,
        cwd=run.memory_dir or soul_workspace(),
        effort=limits.effort,
        env=env,
        extra_args={"no-session-persistence": None},
        stderr=lambda line: logger.debug(f"claude[soul]: {line.rstrip()[:400]}"),
    )
    if memory_settings:
        kwargs["settings"] = json.dumps(json.loads(memory_settings))
    thinking = agent_thinking(model, limits.effort)
    if thinking is not None:
        kwargs["thinking"] = thinking
    return ClaudeAgentOptions(**kwargs)


def _request(payload: Any) -> tuple[str, str, str, list[dict[str, Any]], Settings, str]:
    """App ki request: (mode, system, prompt, images, settings, memory_dir), jaanch ke saath."""
    if not isinstance(payload, dict):
        raise ConfigError("bad_request", "JSON object chahiye")
    mode = str(payload.get("mode") or "moment")
    if mode not in MODES:
        raise ConfigError("bad_request", "mode: moment | sleep")
    system = str(payload.get("system") or "").strip()
    if not system or len(system) > MAX_SYSTEM_CHARS:
        raise ConfigError("bad_request", f"system: 1–{MAX_SYSTEM_CHARS} huroof")
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise ConfigError("bad_request", "prompt chahiye")
    settings = work_settings(payload.get("config"))
    settings.brain.model = soul_model(settings)
    settings.brain.thinking = MODES[mode].effort
    if settings.is_cloud:
        settings.cloud.purpose = PURPOSE
    return mode, system, _clip(prompt, MAX_PROMPT_CHARS), parse_images(payload.get("images")), settings, _memory_dir(payload.get("memory_dir"))


async def think(payload: Any) -> dict[str, Any]:
    """Ruh ki ek soch (POST /soul/think): {run, mode, system, prompt, images?, config, memory_dir}. Foran lautta hai."""
    if not isinstance(payload, dict):
        raise ConfigError("bad_request", "JSON object chahiye")
    run_id = _run_id(payload.get("run"))
    mode, system, prompt, images, settings, memory_dir = _request(payload)
    missing = route_missing(settings)
    if missing:
        return {"ok": False, "code": missing}
    if not memory_dir:
        # Yaadash nahi (sign out / band) = ruh nahi; app purane halke dimagh par soch leti hai.
        return {"ok": False, "code": "no_memory"}
    if run_id in _runs:
        return {"ok": False, "code": "duplicate"}
    for other in list(_runs.values()):
        if other.mode == "sleep" or mode == "sleep":
            # Neend ke dauran naya lamha (ya lamhe ke dauran neend) nahi: ek waqt mein ek ruh.
            return {"ok": False, "code": "busy"}
        # Naya lamha purane se taaza hai: purana roko.
        logger.info(f"Soul[{other.id}]: naya lamha aaya — purana roka")
        await stop(other.id)
    current = _Run(id=run_id, mode=mode, memory_dir=memory_dir)
    _runs[run_id] = current
    current.task = asyncio.create_task(_drive(current, settings, system, prompt, images), name=f"maya-soul-{run_id}")
    return {"ok": True, "run": run_id, "mode": mode}


async def _messages(prompt: str, images: list[dict[str, Any]]):
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}, *images]
    yield {"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": None}


async def _drive(current: _Run, settings: Settings, system: str, prompt: str, images: list[dict[str, Any]]) -> None:
    from claude_agent_sdk import AssistantMessage, ClaudeSDKClient, ResultMessage

    client = None
    status, error, detail = "done", "", ""
    final = ""
    cost: Any = None
    usage: dict[str, Any] = {}
    free = not settings.is_cloud and settings.brain.provider == "gemini"
    limits = MODES[current.mode]
    try:
        try:
            prune_backups(current.memory_dir)
        except OSError:
            pass
        client = ClaudeSDKClient(options=options_for(settings, system, current))
        await client.connect()
        current.client = client
        if current.stopped:
            raise asyncio.CancelledError
        _emit(current, "started", images=len(images))
        if images:
            await client.query(_messages(prompt, images))
        else:
            await client.query(prompt)
        async with asyncio.timeout(limits.timeout_secs):
            async for message in client.receive_response():
                if current.stopped:
                    raise asyncio.CancelledError
                if isinstance(message, AssistantMessage):
                    current.turns += 1
                    text = "".join(str(getattr(block, "text", "") or "") for block in message.content)
                    used_tool = any(hasattr(block, "input") and hasattr(block, "name") for block in message.content)
                    if message.error:
                        status, error, detail = "failed", classify(text, str(message.error)), _clip(text, 300)
                    elif used_tool:
                        final = ""
                    elif text.strip():
                        final = text
                elif isinstance(message, ResultMessage):
                    if message.is_error and status != "failed":
                        reason = "; ".join(getattr(message, "errors", None) or []) or str(message.result or message.subtype or "")
                        status, error, detail = "failed", classify(reason), _clip(reason, 300)
                    if not free:
                        cost = getattr(message, "total_cost_usd", None)
                    raw_usage = getattr(message, "usage", None)
                    if isinstance(raw_usage, dict):
                        usage = {key: raw_usage.get(key) for key in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens") if isinstance(raw_usage.get(key), int)}
        if status == "done" and not final.strip():
            status, error = "failed", "empty"
    except asyncio.CancelledError:
        status = "stopped"
    except TimeoutError:
        status, error = "failed", "timeout"
    except Exception as exc:  # noqa: BLE001 — har ghalti app tak saaf code ban kar
        text = f"{type(exc).__name__}: {exc}"
        status, error, detail = "failed", ("engine_failed" if client is None else classify(text)), _clip(text, 300)
        logger.error(f"Soul[{current.id}]: {text}")
    finally:
        _runs.pop(current.id, None)
        current.writes = confirmed_writes(current)
        ms = round((time.monotonic() - current.started) * 1000)
        fields: dict[str, Any] = dict(
            status=status, error=error, detail=detail,
            text=_clip(final, 24_000) if status == "done" else "",
            writes=list(current.writes), reads=current.reads, turns=current.turns, ms=ms, model=settings.brain.model,
        )
        if isinstance(cost, (int, float)):
            fields["cost_usd"] = cost
        if usage:
            fields["usage"] = usage
        _emit(current, "done", **fields)
        logger.info(
            f"Soul[{current.id}] ({current.mode}): {status}{f' ({error})' if error else ''} — {ms} ms, "
            f"{current.reads} parhi, {len(current.writes)} likhi, {current.turns} qadam"
        )
        if client is not None:
            try:
                await asyncio.wait_for(client.disconnect(), timeout=5)
            except Exception as close_error:  # noqa: BLE001
                logger.debug(f"Soul: dimagh band karte hue: {close_error}")


def confirmed_writes(run: _Run) -> list[dict[str, str]]:
    """Sirf wo likhai jo waqai disk par hui (pehra ijazat deta hai, magar Edit phir bhi nakaam ho sakta hai)."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in run.writes:
        path = os.path.join(run.memory_dir, item["file"])
        try:
            changed = os.path.getmtime(path) >= run.started_wall - 1
        except OSError:
            changed = False
        if changed and item["file"] not in seen:
            seen.add(item["file"])
            out.append(item)
    return out


async def stop(run_id: Any) -> bool:
    """Chalti soch roko (awareness band hui, app band, ya naya lamha)."""
    current = _runs.get(_run_id(run_id))
    if current is None:
        return False
    current.stopped = True
    client = current.client
    if client is not None:
        try:
            await asyncio.wait_for(client.interrupt(), timeout=3)
        except Exception as error:  # noqa: BLE001
            logger.debug(f"Soul interrupt: {error}")
    task = current.task
    if task is not None and not task.done():
        task.cancel()
    return True


def status() -> dict[str, Any]:
    return {"runs": [{"run": item.id, "mode": item.mode, "reads": item.reads, "writes": len(item.writes)} for item in _runs.values()]}


async def close_all() -> None:
    for run_id in list(_runs):
        try:
            await stop(run_id)
        except ConfigError:
            pass
    tasks = [item.task for item in list(_runs.values()) if item.task is not None]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
