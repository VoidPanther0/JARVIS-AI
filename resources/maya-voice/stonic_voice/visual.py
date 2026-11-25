"""Visual Hub ka "drawer" — wohi Claude Agent SDK harness jo user ka dimagh chalata hai.

13 Nov 2026 (Usman): Visual Hub ka apna alag model nahi; jo dimagh user ne chuna
hai (Maya Cloud, apni Claude / OpenRouter key, ya muft Gemini key) wohi Visual
Hub ka bhi dimagh hai — wohi raasta, wohi chabi, wohi hisaab (pipeline.agent_env).

    app (lib/visual/harness.ts) ──POST /visual/run──> yahan ──> Claude Code (bina tools)
    Claude ke lafz ──stdout {"event": "visual", "kind": "delta"}──> app ──> HTML page (Visual Hub)

Drawer kaam NAHI karta, sirf likhta hai:
  - `tools=[]` — Claude Code ka koi tool nahi (PowerShell, files, screen kuch nahi).
    Visual banate waqt PC par kabhi kuch nahi chalta, chahe brief mein kuch bhi likha ho.
  - `max_turns=1`, `setting_sources=[]`, notebook disk par nahi (`--no-session-persistence`).
  - Prompt (page ka designer) app bhejti hai — wahi us ki maalik hai
    (src/lib/visual/designer.ts). Engine sirf chalata hai.

Har request naye, saaf dimagh par jati hai (pichli visual ki baat yaad nahi — "isay
badlo" ke liye app khud screen wala visual prompt mein bhejti hai). Claude Code ka
process uthne mein ~0.5–1.5 s lagte hain, is liye ek visual khatam hote hi agla dimagh
peeche se garam kar diya jata hai (`_Spare`) — doosra visual foran shuru hota hai.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import time
from dataclasses import dataclass, field
from typing import Any

from loguru import logger

from maya_voice import host
from maya_voice.config import ConfigError, Settings, agent_home, agent_thinking, openrouter_claude, work_settings

KINDS = frozenset({"page"})
# Hisaab mein ye kharcha "visual" ke naam (gateway ka `x-maya-purpose`).
PURPOSE = "visual"
# System prompt Windows ki command line par jata hai (SDK `--system-prompt`): ~32k ki hadd se kaafi neeche.
MAX_SYSTEM_CHARS = 20_000
# User ka paigham stdin se jata hai; "isay badlo" mein screen wala page (~90k) bhi hota hai.
MAX_PROMPT_CHARS = 160_000
# Model ke jawab ki hadd (Claude Code ka apna switch). Bhara hua page ~6–10 hazaar tokens.
MAX_OUTPUT_TOKENS = {"page": 16_000}
# Poore kaam ki ghari (app ki apni ghari is se pehle bajti hai — ye sirf aakhri pehra hai).
RUN_TIMEOUT_SECS = 200.0
# Ek waqt mein itne visuals (naya aaye to sab se purana rukta hai).
MAX_RUNS = 2
# Lafz itni der jama kar ke ek khabar mein (har token par ek stdout line nahi).
DELTA_FLUSH_SECS = 0.05
# Garam rakha hua agla dimagh itni der baad band (RAM wapas).
SPARE_IDLE_SECS = 3 * 60
_ID_CHARS = 64

# SDK ki ghalti → app ka chhota code (app usi se user ka paigham chunti hai).
_ASSISTANT_ERRORS = {
    "authentication_failed": "auth",
    "billing_error": "no_credit",
    "rate_limit": "rate_limit",
    "server_error": "upstream",
    "invalid_request": "upstream",
}
# Jawab ke matn mein gateway / provider ke alfaaz (pehle wale pehle).
_TEXT_ERRORS: list[tuple[str, tuple[str, ...]]] = [
    ("blocked", ("402", "usage limit", "maya_rate_limit", "plan_limit", "daily_limit", "monthly_limit", "insufficient_balance", "plan_unavailable")),
    ("auth", ("401", "invalid x-api-key", "authentication", "api key not valid", "invalid_token", "permission_denied")),
    ("no_credit", ("credit balance", "billing")),
    ("rate_limit", ("429", "rate_limit", "rate limit", "quota", "resource_exhausted")),
]


def _clip(text: Any, limit: int) -> str:
    text = str(text or "")
    return text if len(text) <= limit else text[:limit]


def _run_id(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text or len(text) > _ID_CHARS or not all(ch.isalnum() or ch in "-_" for ch in text):
        raise ConfigError("bad_request", "run: chhota naam chahiye (harf, adad, - _)")
    return text


def classify(text: str, assistant_error: str = "") -> str:
    """Ghalti ka chhota code: auth | no_credit | rate_limit | blocked | upstream."""
    lowered = str(text or "").lower()
    for code, hints in _TEXT_ERRORS:
        if any(hint in lowered for hint in hints):
            return code
    if assistant_error:
        return _ASSISTANT_ERRORS.get(assistant_error, "upstream")
    return "upstream"


def route_missing(settings: Settings) -> str:
    """Drawer kyun nahi chal sakta (code) — '' = chal sakta hai.

    Wohi raaste jo Classic ke kaam ke hain (config.work_missing), magar "agent_off"
    yahan rukawat nahi: drawer ke paas koi tool hai hi nahi, wo sirf likhta hai.
    """
    if settings.is_cloud:
        return "" if settings.cloud.brain_provider == "anthropic" else "cloud_no_agent"
    provider = settings.brain.provider
    if provider not in ("anthropic", "openrouter", "gemini") or (provider == "openrouter" and not openrouter_claude(settings.brain.model)):
        return "brain_not_claude"
    return "" if settings.keys.for_brain(provider) else f"{provider}_key_missing"


def visual_workspace() -> str:
    """Drawer ka khali folder (us ke paas file tools hain hi nahi — sirf Claude Code ka cwd)."""
    path = os.path.join(agent_home(), "visual")
    os.makedirs(path, exist_ok=True)
    return path


def _route_key(settings: Settings, kind: str, system: str) -> tuple[str, ...]:
    cloud = settings.cloud
    digest = hashlib.sha256(system.encode("utf-8")).hexdigest()[:16]
    return (
        kind, digest, settings.mode, settings.brain.provider, settings.brain.model,
        settings.keys.for_brain(settings.brain.provider), cloud.url, cloud.token, cloud.brain_model,
    )


def options_for(settings: Settings, kind: str, system: str) -> Any:
    """Claude Code ke options: user ka dimagh, koi tool nahi, ek hi baari, sirf likhna."""
    from claude_agent_sdk import ClaudeAgentOptions

    from maya_voice.pipeline import agent_env

    model = settings.brain.model
    env = agent_env(settings, agent_home())
    # Lambe jawab ki hadd (Claude Code ka official switch) — kharcha qaboo mein.
    env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = str(MAX_OUTPUT_TOKENS.get(kind, 16_000))
    kwargs: dict[str, Any] = dict(
        model=model,
        system_prompt={"type": "custom", "prompt": system, "snapshot": False},
        tools=[],
        setting_sources=[],
        include_partial_messages=True,
        max_turns=1,
        cwd=visual_workspace(),
        effort="low",
        env=env,
        extra_args={"no-session-persistence": None},
        can_use_tool=_deny_tools,
        stderr=lambda line: logger.debug(f"claude[visual]: {line.rstrip()[:400]}"),
    )
    thinking = agent_thinking(model, "low")
    if thinking is not None:
        kwargs["thinking"] = thinking
    return ClaudeAgentOptions(**kwargs)


async def _deny_tools(name: str, _args: dict[str, Any], _context: Any) -> Any:
    """Drawer ke paas koi tool nahi; phir bhi koi call aaye to rad (pehra fail-closed)."""
    from claude_agent_sdk import PermissionResultDeny

    logger.warning(f"Visual: drawer ne tool maanga ({name}) — rad")
    return PermissionResultDeny(message="The Visual Hub drawer has no tools. Write the visual as text only.")


async def _connect(settings: Settings, kind: str, system: str) -> Any:
    from claude_agent_sdk import ClaudeSDKClient

    client = ClaudeSDKClient(options=options_for(settings, kind, system))
    await client.connect()
    return client


async def _disconnect(client: Any) -> None:
    if client is None:
        return
    try:
        await asyncio.wait_for(client.disconnect(), timeout=5)
    except Exception as error:  # noqa: BLE001
        logger.debug(f"Visual: drawer band karte hue: {error}")


# ── Garam rakha hua agla dimagh ──────────────────────────────────────────────


@dataclass
class _Spare:
    key: tuple[str, ...]
    task: asyncio.Task[Any]
    made: float = field(default_factory=time.monotonic)


_spare: _Spare | None = None
_spare_timer: asyncio.Task[None] | None = None


async def _drop_spare() -> None:
    global _spare
    spare, _spare = _spare, None
    if spare is None:
        return
    if not spare.task.done():
        spare.task.cancel()
    try:
        client = await spare.task
    except BaseException:  # noqa: BLE001 — uthte uthte roka gaya / uth na saka
        return
    await _disconnect(client)


async def _take_client(settings: Settings, kind: str, system: str) -> tuple[Any, bool]:
    """Isi raaste ka garam dimagh ho to wohi, warna naya. (client, garam tha?)"""
    global _spare
    key = _route_key(settings, kind, system)
    spare = _spare
    if spare is not None and spare.key == key:
        _spare = None
        try:
            return await spare.task, True
        except Exception as error:  # noqa: BLE001 — garam dimagh uth na saka: naya
            logger.debug(f"Visual: garam dimagh kaam ka nahi ({error}) — naya")
    elif spare is not None:
        await _drop_spare()
    return await _connect(settings, kind, system), False


def _warm_next(settings: Settings, kind: str, system: str) -> None:
    """Agla visual foran shuru ho: isi raaste par ek dimagh peeche se utha kar rakho."""
    global _spare, _spare_timer
    if _spare is not None:
        return
    task = asyncio.create_task(_connect(settings, kind, system), name="maya-visual-spare")
    # Uth na saka to ghalti yahin parh li jati hai (agla visual naya dimagh uthata hai).
    task.add_done_callback(lambda t: None if t.cancelled() else t.exception())
    _spare = _Spare(key=_route_key(settings, kind, system), task=task)
    if _spare_timer is None or _spare_timer.done():
        _spare_timer = asyncio.create_task(_spare_idle(), name="maya-visual-spare-idle")


async def _spare_idle() -> None:
    while _spare is not None:
        await asyncio.sleep(30)
        spare = _spare
        if spare is not None and time.monotonic() - spare.made >= SPARE_IDLE_SECS:
            logger.info(f"Visual: {SPARE_IDLE_SECS // 60} minute koi visual nahi — garam dimagh band")
            await _drop_spare()


# ── Ek visual ────────────────────────────────────────────────────────────────


@dataclass
class _Run:
    id: str
    kind: str
    started: float = field(default_factory=time.monotonic)
    client: Any = None
    task: asyncio.Task[None] | None = None
    stopped: bool = False


_runs: dict[str, _Run] = {}


def _emit(run: _Run, kind: str, **fields: Any) -> None:
    host.emit("visual", run=run.id, kind=kind, **fields)


def _request(payload: Any) -> tuple[str, str, Settings]:
    """App ki request ka kind / system / settings, jaanch ke saath. Wapsi settings drawer ke liye taiyar."""
    if not isinstance(payload, dict):
        raise ConfigError("bad_request", "JSON object chahiye")
    kind = str(payload.get("kind") or "")
    if kind not in KINDS:
        raise ConfigError("bad_request", f"kind: {' | '.join(sorted(KINDS))}")
    system = str(payload.get("system") or "").strip()
    if not system or len(system) > MAX_SYSTEM_CHARS:
        raise ConfigError("bad_request", f"system: 1–{MAX_SYSTEM_CHARS} huroof")
    settings = work_settings(payload.get("config"))
    # Likhai tez: soch kam se kam (effort "low"; Gemini pul ko bhi "low").
    settings.brain.thinking = "low"
    if settings.is_cloud:
        settings.cloud.purpose = PURPOSE
    return kind, system, settings


async def warm(payload: Any) -> dict[str, Any]:
    """Voice judi (POST /visual/warm): pehla visual bhi foran shuru ho — dimagh peeche se garam.

    Claude Code ka process uthne mein ~2–3 s lagte hain (naapa, 13 Nov 2026); garam
    dimagh par pehla lafz ~0.1 s. Koi visual na aaye to `SPARE_IDLE_SECS` baad band.
    """
    kind, system, settings = _request(payload)
    missing = route_missing(settings)
    if missing:
        return {"ok": False, "code": missing}
    _warm_next(settings, kind, system)
    return {"ok": True}


async def run(payload: Any) -> dict[str, Any]:
    """App ka visual (POST /visual/run): {run, kind, system, prompt, config}. Foran lautta hai."""
    if not isinstance(payload, dict):
        raise ConfigError("bad_request", "JSON object chahiye")
    run_id = _run_id(payload.get("run"))
    kind, system, settings = _request(payload)
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise ConfigError("bad_request", "prompt chahiye")
    prompt = _clip(prompt, MAX_PROMPT_CHARS)
    # Dimagh ka raasta wohi jo Classic ke kaam ka hai (Claude, ya muft Gemini key ka pul).
    missing = route_missing(settings)
    if missing:
        return {"ok": False, "code": missing}
    if run_id in _runs:
        return {"ok": False, "code": "duplicate"}
    while len(_runs) >= MAX_RUNS:
        oldest = min(_runs.values(), key=lambda item: item.started)
        logger.info(f"Visual[{oldest.id}]: naya visual aaya — purana roka")
        await stop(oldest.id)
    current = _Run(id=run_id, kind=kind)
    _runs[run_id] = current
    current.task = asyncio.create_task(_drive(current, settings, system, prompt), name=f"maya-visual-{run_id}")
    return {"ok": True, "run": run_id}


async def _drive(current: _Run, settings: Settings, system: str, prompt: str) -> None:
    from claude_agent_sdk import AssistantMessage, ResultMessage, StreamEvent

    client = None
    status, error, detail = "done", "", ""
    output_tokens = 0
    stop_reason = ""
    chars = 0
    warm = False
    pending: list[str] = []
    last_flush = time.monotonic()
    first_at = 0.0

    def flush() -> None:
        nonlocal last_flush
        if pending:
            _emit(current, "delta", text="".join(pending))
            pending.clear()
        last_flush = time.monotonic()

    try:
        client, warm = await _take_client(settings, current.kind, system)
        current.client = client
        if current.stopped:
            raise asyncio.CancelledError
        _emit(current, "started", warm=warm)
        await client.query(prompt)
        saw_delta = False
        async with asyncio.timeout(RUN_TIMEOUT_SECS):
            async for message in client.receive_response():
                if current.stopped:
                    raise asyncio.CancelledError
                if isinstance(message, StreamEvent):
                    event = message.event or {}
                    kind = event.get("type")
                    if kind == "content_block_delta":
                        delta = event.get("delta") or {}
                        if delta.get("type") == "text_delta" and delta.get("text"):
                            if not first_at:
                                first_at = time.monotonic()
                            saw_delta = True
                            chars += len(delta["text"])
                            pending.append(delta["text"])
                            if time.monotonic() - last_flush >= DELTA_FLUSH_SECS:
                                flush()
                    elif kind == "message_delta":
                        stop_reason = str((event.get("delta") or {}).get("stop_reason") or stop_reason)
                        usage = event.get("usage") or {}
                        output_tokens = int(usage.get("output_tokens") or output_tokens)
                elif isinstance(message, AssistantMessage):
                    text = "".join(str(getattr(block, "text", "") or "") for block in message.content)
                    if message.error:
                        status, error, detail = "failed", classify(text, str(message.error)), _clip(text, 300)
                    elif text and not saw_delta:
                        # Stream ke tukre na aaye (kisi raaste par): poora jawab ek saath.
                        chars += len(text)
                        pending.append(text)
                        flush()
                elif isinstance(message, ResultMessage):
                    if message.is_error and status != "failed":
                        reason = "; ".join(getattr(message, "errors", None) or []) or str(message.result or "")
                        status, error, detail = "failed", classify(reason), _clip(reason, 300)
                    usage = message.usage or {}
                    output_tokens = int(usage.get("output_tokens") or output_tokens)
        flush()
        if status == "done" and not chars:
            status, error = "failed", "empty"
    except asyncio.CancelledError:
        status = "stopped"
    except TimeoutError:
        status, error = "failed", "timeout"
    except Exception as exc:  # noqa: BLE001 — har ghalti app tak saaf code ban kar
        text = f"{type(exc).__name__}: {exc}"
        status, error, detail = "failed", ("engine_failed" if client is None else classify(text)), _clip(text, 300)
        logger.error(f"Visual[{current.id}]: {text}")
    finally:
        if status != "stopped":
            flush()
        _runs.pop(current.id, None)
        ms = round((time.monotonic() - current.started) * 1000)
        first_ms = round((first_at - current.started) * 1000) if first_at else 0
        _emit(
            current, "done", status=status, error=error, detail=detail,
            truncated=stop_reason == "max_tokens", output_tokens=output_tokens, ms=ms, first_ms=first_ms, warm=warm,
        )
        logger.info(
            f"Visual[{current.id}]: {current.kind} {status}{f' ({error})' if error else ''} — {ms} ms, "
            f"pehla lafz {first_ms} ms, {output_tokens} tokens{', garam dimagh' if warm else ''}"
        )
        await _disconnect(client)
        if status == "done":
            _warm_next(settings, current.kind, system)


async def stop(run_id: Any) -> bool:
    """Chalta visual roko (user ne Stop dabaya, ya naya visual aa gaya)."""
    current = _runs.get(_run_id(run_id))
    if current is None:
        return False
    current.stopped = True
    client = current.client
    if client is not None:
        try:
            await asyncio.wait_for(client.interrupt(), timeout=3)
        except Exception as error:  # noqa: BLE001
            logger.debug(f"Visual interrupt: {error}")
    task = current.task
    if task is not None and not task.done():
        task.cancel()
    return True


def status() -> dict[str, Any]:
    return {"runs": [{"run": item.id, "kind": item.kind} for item in _runs.values()], "warm": _spare is not None}


async def close_all() -> None:
    for run_id in list(_runs):
        try:
            await stop(run_id)
        except ConfigError:
            pass
    tasks = [item.task for item in list(_runs.values()) if item.task is not None]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    await _drop_spare()
