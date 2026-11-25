"""Your world ka brief — wohi Claude Agent SDK harness jo dono voices ka dimagh chalata hai.

14 Nov 2026 (Usman): baayan panel "Your world" ka apna alag sasta model nahi. Jo
dimagh user ne chuna hai (Maya Cloud, apni Claude / OpenRouter key, ya muft Gemini
key) wohi Claude Code harness din mein ek dafa:

    1. user ki yaadein khud parhta hai   (Read / Glob / Grep — SIRF yaadash ka folder)
    2. us ke hisaab se web par dhoondta hai  (`web_search`, zyada se zyada MAX_SEARCHES)
    3. aakhir mein ek brief likhta hai    (JSON — app use panel mein dikhati hai)

    app (lib/mind/brief-harness.ts) ──POST /world/run──> yahan ──> Claude Code
    qadam ──stdout {"event": "world", "kind": "step"}──> app  ("Reading… / Searching…")
    search ──stdout {"event": "world", "kind": "search"}──> main process (web-search.js)
           <──POST /world/search-result── natija (matn + sources)
    brief ──stdout {"event": "world", "kind": "done", "text": …}──> app

Ye dimagh PC par kuch nahi karta, sirf parhta aur dhoondta hai:
  - Tools sirf Read / Glob / Grep, aur pehra (PreToolUse, fail-closed) unhein yaadash
    ke folder se bahar nahi jane deta. PowerShell, Write, Edit — hain hi nahi.
  - Web search app ka apna (main process: Cloud gateway ya user ki chabi) — chabiyan
    engine tak aati hi nahi. Ginti yahin: MAX_SEARCHES ke baad search rad.
  - `setting_sources=[]`, notebook disk par nahi (`--no-session-persistence`).
  - Prompt app bhejti hai — wahi us ki maalik hai (src/lib/mind/brief.ts).
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from loguru import logger

from maya_voice import host
from maya_voice.config import ConfigError, Settings, agent_home, agent_thinking, work_settings
from maya_voice.visual import classify, route_missing

# Hisaab mein ye kharcha "world" ke naam (gateway ka `x-maya-purpose`).
PURPOSE = "world"
# System prompt Windows ki command line par jata hai (SDK `--system-prompt`): ~32k ki hadd se neeche.
MAX_SYSTEM_CHARS = 20_000
# User ka paigham stdin se: aaj ki tareekh, profile, yaadash ki fehrist (MEMORY.md).
MAX_PROMPT_CHARS = 60_000
# Ek brief mein web searches ki sakht hadd (app kam maang sakti hai, zyada nahi).
MAX_SEARCHES = 5
# Qadam: chhote models ek qadam mein ek hi file parhte hain — is liye hadd khuli, aur
# kharcha yaadon ki ginti (MAX_READS) aur searches (MAX_SEARCHES) se qaboo mein.
MAX_TURNS = 48
# Ek brief mein yaadash ke itne tools (Read / Glob / Grep); us ke baad "ab dhoondo".
MAX_READS = 40
# Soch: yaadon mein se kya aham hai aur kya dhoondna hai — ye faisla "low" par kamzor hota hai.
EFFORT = "medium"
MAX_OUTPUT_TOKENS = 6_000
# Poore kaam ki ghari (app ki apni ghari is se pehle bajti hai — ye aakhri pehra hai).
RUN_TIMEOUT_SECS = 300.0
# Ek search ka intezar (main process: Gemini 15 s + Claude 35 s ka silsila).
SEARCH_TIMEOUT_SECS = 75.0
# Search ka sawal: ek chhota public topic (lamba matn = yaadon ka hissa bahar jane ka khatra).
MAX_QUERY_CHARS = 160
MAX_SEARCH_TEXT_CHARS = 6_000
MAX_SOURCES_PER_SEARCH = 10
MAX_SOURCES = 60
# Dimagh ko link ka sirf itna hissa dikhta hai (pehchan ke liye); asli link app ke paas rehta hai.
MAX_SOURCE_SHOWN_CHARS = 90
MAX_BRIEF_CHARS = 24_000
MAX_MEMORY_DIR_CHARS = 1024
_ID_CHARS = 64

READ_TOOLS = ("Read", "Glob", "Grep")
SERVER = "world"
SEARCH_TOOL = "web_search"
SEARCH_TOOL_FULL = f"mcp__{SERVER}__{SEARCH_TOOL}"
SEARCH_LIMIT_TEXT = "Search limit reached for this brief. Write the brief now from what you already found."
READ_LIMIT_TEXT = "You have read enough of the notes. Search the web now, then write the brief."
OUTSIDE_MEMORY = "You can only read inside the memory folder. Read the notes there, then search the web."
NO_OTHER_TOOLS = "This brief only reads the memory folder and searches the web."


def _clip(text: Any, limit: int) -> str:
    text = str(text or "")
    return text if len(text) <= limit else text[:limit]


def _run_id(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text or len(text) > _ID_CHARS or not all(ch.isalnum() or ch in "-_" for ch in text):
        raise ConfigError("bad_request", "run: chhota naam chahiye (harf, adad, - _)")
    return text


def _memory_dir(raw: Any) -> str:
    """App ka bheja yaadash ka folder: poora raasta aur asli folder ho, warna '' (yaadein nahi)."""
    value = str(raw or "").strip()
    if not value or len(value) > MAX_MEMORY_DIR_CHARS or "\x00" in value or not os.path.isabs(value):
        return ""
    return value if os.path.isdir(value) else ""


def _real(path: str) -> str:
    return os.path.normcase(os.path.realpath(path)).rstrip("\\/")


def inside(path: Any, root: str) -> bool:
    """Ye raasta (shortcut / junction khol kar) is folder ke andar hai?"""
    if not root or not path:
        return False
    try:
        target, base = _real(str(path)), _real(root)
    except (OSError, TypeError, ValueError):
        return False
    return target == base or target.startswith(base + os.sep)


def review(name: str, args: dict[str, Any], memory_dir: str, searches: int, max_searches: int, reads: int = 0) -> tuple[bool, str]:
    """Pehra: sirf yaadash ke folder ka parhna aur (hadd ke andar) web search. (ijazat, wajah)"""
    if name == SEARCH_TOOL_FULL:
        return (True, "") if searches < max_searches else (False, SEARCH_LIMIT_TEXT)
    if name not in READ_TOOLS or not memory_dir:
        return False, NO_OTHER_TOOLS
    if reads >= MAX_READS:
        return False, READ_LIMIT_TEXT
    if name == "Read":
        return (True, "") if inside(args.get("file_path"), memory_dir) else (False, OUTSIDE_MEMORY)
    # Glob / Grep: raasta na ho to cwd (= yaadash ka folder); ho to usi ke andar.
    path = args.get("path")
    if path and not inside(path, memory_dir):
        return False, OUTSIDE_MEMORY
    pattern = str(args.get("pattern") or "")
    if name == "Glob" and (os.path.isabs(pattern) or ".." in pattern.replace("\\", "/").split("/")):
        return False, OUTSIDE_MEMORY
    return True, ""


def world_workspace() -> str:
    """Yaadash ka folder na ho to dimagh ka khali cwd (us ke paas file tools hote hi nahi)."""
    path = os.path.join(agent_home(), "world")
    os.makedirs(path, exist_ok=True)
    return path


# ── Ek brief ─────────────────────────────────────────────────────────────────


@dataclass
class _Run:
    id: str
    memory_dir: str
    max_searches: int
    started: float = field(default_factory=time.monotonic)
    client: Any = None
    task: asyncio.Task[None] | None = None
    stopped: bool = False
    searches: int = 0
    reads: int = 0
    turns: int = 0
    waiting: dict[str, asyncio.Future[dict[str, Any]]] = field(default_factory=dict)
    # uri -> title, jis tarteeb mein search ne diye (app sirf inhi links ko asli maanti hai).
    sources: dict[str, str] = field(default_factory=dict)


_runs: dict[str, _Run] = {}


def _emit(run: _Run, kind: str, **fields: Any) -> None:
    host.emit("world", run=run.id, kind=kind, **fields)


def _search_tool(run: _Run) -> Any:
    from claude_agent_sdk import tool

    async def handler(args: dict[str, Any]) -> dict[str, Any]:
        query = " ".join(str((args or {}).get("query") or "").split())[:MAX_QUERY_CHARS]
        if not query:
            return {"content": [{"type": "text", "text": "query is required."}], "is_error": True}
        if run.searches >= run.max_searches:
            return {"content": [{"type": "text", "text": SEARCH_LIMIT_TEXT}], "is_error": True}
        run.searches += 1
        call_id = uuid.uuid4().hex[:16]
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        run.waiting[call_id] = future
        _emit(run, "search", id=call_id, query=query, n=run.searches)
        try:
            result = await asyncio.wait_for(future, SEARCH_TIMEOUT_SECS)
        except asyncio.TimeoutError:
            logger.warning(f"World[{run.id}]: search {SEARCH_TIMEOUT_SECS:.0f} s mein jawab na de saka")
            result = {"ok": False, "text": "The search did not answer in time. Carry on with what you have."}
        finally:
            run.waiting.pop(call_id, None)
        text = str(result.get("text") or "").strip()
        if not result.get("ok"):
            return {"content": [{"type": "text", "text": text or "The search did not work."}], "is_error": True}
        # Har link ko is brief mein ek number: dimagh brief mein sirf number likhta hai
        # ("ref": 3) — lamba link copy nahi karta (Google ke links 200+ huroof ke hote hain).
        lines: list[str] = []
        for source in result.get("sources") or []:
            uri, title = str(source.get("uri") or ""), str(source.get("title") or "")
            if not uri.startswith("https://"):
                continue
            if uri not in run.sources:
                if len(run.sources) >= MAX_SOURCES:
                    continue
                run.sources[uri] = title
            number = list(run.sources).index(uri) + 1
            lines.append(f"[{number}] {title or 'source'} — {_clip(uri, MAX_SOURCE_SHOWN_CHARS)}")
        body = text or "No results found."
        if lines:
            body = f"{body}\n\nSources:\n" + "\n".join(lines)
        return {"content": [{"type": "text", "text": body}]}

    return tool(
        SEARCH_TOOL,
        "Search the live web for something happening in the world right now. One focused, public topic per call. "
        "Returns a short answer and the source links.",
        {"query": str},
    )(handler)


def options_for(settings: Settings, system: str, run: _Run) -> Any:
    """Claude Code ke options: user ka dimagh, sirf parhna + web search, likhna kuch nahi."""
    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher, PermissionResultAllow, PermissionResultDeny, create_sdk_mcp_server

    from maya_voice.pipeline import agent_env

    model = settings.brain.model
    env = agent_env(settings, agent_home())
    env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = str(MAX_OUTPUT_TOKENS)

    def decide(name: str, args: dict[str, Any]) -> tuple[bool, str]:
        allowed, reason = review(name, args, run.memory_dir, run.searches, run.max_searches, run.reads)
        if not allowed:
            logger.info(f"World[{run.id}]: {name} rad — {reason[:80]}")
        elif name in READ_TOOLS:
            run.reads += 1
            target = str(args.get("file_path") or args.get("pattern") or "")
            _emit(run, "step", tool="read", detail=_clip(os.path.basename(target), 80), n=run.reads)
        return allowed, reason

    async def pre_tool_use(input_data: Any, _tool_use_id: str | None, _context: Any) -> dict[str, Any]:
        allowed, reason = decide(str(input_data.get("tool_name") or ""), dict(input_data.get("tool_input") or {}))
        output: dict[str, Any] = {"hookEventName": "PreToolUse", "permissionDecision": "allow" if allowed else "deny"}
        if not allowed:
            output["permissionDecisionReason"] = reason
        return {"hookSpecificOutput": output}

    async def can_use_tool(name: str, args: dict[str, Any], _context: Any) -> Any:
        # Sirf wo call jis par upar wala hook faisla na de saka: wohi pehra dobara.
        allowed, reason = decide(name, dict(args or {}))
        return PermissionResultAllow() if allowed else PermissionResultDeny(message=reason)

    kwargs: dict[str, Any] = dict(
        model=model,
        system_prompt={"type": "custom", "prompt": system, "snapshot": False},
        # Yaadash ka folder na ho (sign out / yaadash band) to file tools hi nahi.
        tools=list(READ_TOOLS) if run.memory_dir else [],
        mcp_servers={SERVER: create_sdk_mcp_server(name=SERVER, version="1.0.0", tools=[_search_tool(run)])},
        permission_mode="default",
        can_use_tool=can_use_tool,
        # Pehra fail-closed: hook gire to tool NAHI chalta.
        hooks={"PreToolUse": [HookMatcher(hooks=[pre_tool_use], on_failure="block")]},
        setting_sources=[],
        max_turns=MAX_TURNS,
        cwd=run.memory_dir or world_workspace(),
        effort=EFFORT,
        env=env,
        extra_args={"no-session-persistence": None},
        stderr=lambda line: logger.debug(f"claude[world]: {line.rstrip()[:400]}"),
    )
    thinking = agent_thinking(model, EFFORT)
    if thinking is not None:
        kwargs["thinking"] = thinking
    return ClaudeAgentOptions(**kwargs)


def _request(payload: Any) -> tuple[str, str, Settings, str, int]:
    """App ki request: (system, prompt, settings, memory_dir, max_searches), jaanch ke saath."""
    if not isinstance(payload, dict):
        raise ConfigError("bad_request", "JSON object chahiye")
    system = str(payload.get("system") or "").strip()
    if not system or len(system) > MAX_SYSTEM_CHARS:
        raise ConfigError("bad_request", f"system: 1–{MAX_SYSTEM_CHARS} huroof")
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise ConfigError("bad_request", "prompt chahiye")
    settings = work_settings(payload.get("config"))
    settings.brain.thinking = EFFORT
    if settings.is_cloud:
        settings.cloud.purpose = PURPOSE
    try:
        asked = int(payload.get("max_searches") or MAX_SEARCHES)
    except (TypeError, ValueError):
        asked = MAX_SEARCHES
    return system, _clip(prompt, MAX_PROMPT_CHARS), settings, _memory_dir(payload.get("memory_dir")), max(1, min(MAX_SEARCHES, asked))


async def run(payload: Any) -> dict[str, Any]:
    """App ka brief (POST /world/run): {run, system, prompt, config, memory_dir?, max_searches?}. Foran lautta hai."""
    if not isinstance(payload, dict):
        raise ConfigError("bad_request", "JSON object chahiye")
    run_id = _run_id(payload.get("run"))
    system, prompt, settings, memory_dir, max_searches = _request(payload)
    # Dimagh ka raasta wohi jo Classic ke kaam / Visual Hub ka hai (Claude, ya muft Gemini key ka pul).
    missing = route_missing(settings)
    if missing:
        return {"ok": False, "code": missing}
    if run_id in _runs:
        return {"ok": False, "code": "duplicate"}
    # Ek waqt mein ek hi brief: naya aaye (app dobara khuli) to purana rukta hai.
    for other in list(_runs):
        logger.info(f"World[{other}]: naya brief aaya — purana roka")
        await stop(other)
    current = _Run(id=run_id, memory_dir=memory_dir, max_searches=max_searches)
    _runs[run_id] = current
    current.task = asyncio.create_task(_drive(current, settings, system, prompt), name=f"maya-world-{run_id}")
    return {"ok": True, "run": run_id, "memory": bool(memory_dir)}


async def _drive(current: _Run, settings: Settings, system: str, prompt: str) -> None:
    from claude_agent_sdk import AssistantMessage, ClaudeSDKClient, ResultMessage

    client = None
    status, error, detail = "done", "", ""
    final = ""       # aakhri paigham jis mein koi tool nahi = brief
    cost: Any = None
    free = not settings.is_cloud and settings.brain.provider == "gemini"
    try:
        client = ClaudeSDKClient(options=options_for(settings, system, current))
        await client.connect()
        current.client = client
        if current.stopped:
            raise asyncio.CancelledError
        _emit(current, "started", memory=bool(current.memory_dir))
        await client.query(prompt)
        async with asyncio.timeout(RUN_TIMEOUT_SECS):
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
                        _emit(current, "step", tool="write", detail="", n=0)
                elif isinstance(message, ResultMessage):
                    if message.is_error and status != "failed":
                        reason = "; ".join(getattr(message, "errors", None) or []) or str(message.result or message.subtype or "")
                        status, error, detail = "failed", classify(reason), _clip(reason, 300)
                    if not free:
                        cost = getattr(message, "total_cost_usd", None)
        if status == "done" and not final.strip():
            status, error = "failed", "empty"
    except asyncio.CancelledError:
        status = "stopped"
    except TimeoutError:
        status, error = "failed", "timeout"
    except Exception as exc:  # noqa: BLE001 — har ghalti app tak saaf code ban kar
        text = f"{type(exc).__name__}: {exc}"
        status, error, detail = "failed", ("engine_failed" if client is None else classify(text)), _clip(text, 300)
        logger.error(f"World[{current.id}]: {text}")
    finally:
        _runs.pop(current.id, None)
        for future in current.waiting.values():
            if not future.done():
                future.set_result({"ok": False, "text": "The brief stopped before this search finished."})
        current.waiting.clear()
        ms = round((time.monotonic() - current.started) * 1000)
        fields: dict[str, Any] = dict(
            status=status, error=error, detail=detail,
            text=_clip(final, MAX_BRIEF_CHARS) if status == "done" else "",
            sources=[{"uri": uri, "title": title} for uri, title in current.sources.items()],
            searches=current.searches, reads=current.reads, turns=current.turns, ms=ms,
        )
        if isinstance(cost, (int, float)):
            fields["cost_usd"] = cost
        _emit(current, "done", **fields)
        logger.info(
            f"World[{current.id}]: {status}{f' ({error})' if error else ''} — {ms} ms, "
            f"{current.reads} yaadein, {current.searches} searches, {current.turns} qadam"
        )
        if client is not None:
            try:
                await asyncio.wait_for(client.disconnect(), timeout=5)
            except Exception as close_error:  # noqa: BLE001
                logger.debug(f"World: dimagh band karte hue: {close_error}")


def search_result(payload: Any) -> bool:
    """Main process ka search ka natija (POST /world/search-result). False = koi intezar mein nahi."""
    if not isinstance(payload, dict):
        raise ConfigError("bad_request", "JSON object chahiye")
    current = _runs.get(_run_id(payload.get("run")))
    future = current.waiting.get(str(payload.get("id") or "")) if current is not None else None
    if future is None or future.done():
        return False
    raw = payload.get("sources")
    sources = [
        {"uri": _clip(item.get("uri"), 2000), "title": " ".join(_clip(item.get("title"), 160).split())}
        for item in (raw if isinstance(raw, list) else [])[:MAX_SOURCES_PER_SEARCH]
        if isinstance(item, dict)
    ]
    future.set_result({"ok": bool(payload.get("ok")), "text": _clip(payload.get("text"), MAX_SEARCH_TEXT_CHARS), "sources": sources})
    return True


async def stop(run_id: Any) -> bool:
    """Chalta brief roko (user ne Stop dabaya, app band, ya naya brief aa gaya)."""
    current = _runs.get(_run_id(run_id))
    if current is None:
        return False
    current.stopped = True
    client = current.client
    if client is not None:
        try:
            await asyncio.wait_for(client.interrupt(), timeout=3)
        except Exception as error:  # noqa: BLE001
            logger.debug(f"World interrupt: {error}")
    task = current.task
    if task is not None and not task.done():
        task.cancel()
    return True


def status() -> dict[str, Any]:
    return {"runs": [{"run": item.id, "searches": item.searches, "reads": item.reads} for item in _runs.values()]}


async def close_all() -> None:
    for run_id in list(_runs):
        try:
            await stop(run_id)
        except ConfigError:
            pass
    tasks = [item.task for item in list(_runs.values()) if item.task is not None]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
