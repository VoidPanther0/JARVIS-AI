"""Push-to-talk ke kaan: har baari ki POORI clip, ek dafa likhwai.

Aam baat-cheet ("Conversation") mein kaan Google ki Live line hain (ears.py):
user kab bolna shuru / band kare, ye pata nahi — line hamesha khuli rehti hai.
Push-to-talk mein baari ki shuru aur khatam app batati hai (key daba / chhodi,
`/beta/turn` -> pipeline.manual_turn -> ProposedUser*SpeakingFrame). To:

    key dabi     -> yahan clip record hone lagti hai (mic ki awaaz + judne se
                    pehle ki awaaz jo app ne yaad rakhi thi)
    key chhodi   -> clip band (thori `grace_secs` mohlat: raaste mein atki aakhri
                    awaaz bhi aa jaye), Opus mein (~3.6 KB fi second — WAV se 9
                    guna chhoti, upload foran) -> Google ka FILE wala model
                    (gemini-3.5-transcribe) -> ek pakka jumla (TranscriptionFrame)

Faide (Usman, 14 Nov 2026: "key dabate hi foran ready, Waking ka intezar nahi"):
  - Koi line nahi = baat-cheet "tayyar" khadi reh sakti hai (app ka standby)
    bina kisi kharche ke. Live line khuli rakhna ping maangta hai (bill hota hai)
    aur ~10 min par badalni padti hai.
  - Sirf boli hui clip ka paisa.
Naap (14 Nov, Vertex global, Opus): 3-5 s ki clip ~0.45-0.8 s mein likhi gayi;
["ur-PK","en-US"] ke saath Roman Urdu ("mujhe kal subah 9:00 baje ..."); bina
zubaan ke Devanagari. "Smart" mode beech ke lafz kha gaya — VERBATIM hi.

Raaste:
  Stonic Cloud  -> gateway POST /v1/voice-beta/transcribe (plan, hisaab, zubaan wahan)
  Apni key      -> seedha Google (user ki Gemini key, wohi jo Live kaan ki hai)

Turn ka faisla (turns.PushToTalkStopStrategy) ko yahan se do khabrein seedhi jati
hain: "clip likhi ja rahi hai" (chhodte hi — warna wo "khali baari" samajh kar
band kar deta) aur "likh di" (lafz mile ya nahi — khali ho to baari foran band).

Ghalti: plan / login / chabi ki (dobara koshish bekaar) = ErrorFrame (app wajah
dikhati hai, baat-cheet band — Live kaan jaisa). Lamhe bhar ki (internet,
Google busy) = ek dafa dobara; phir bhi na ho to baat-cheet NAHI tootti: app ko
"stonic-unheard" ("dobara bolo") aur baari khali.
"""

from __future__ import annotations

import asyncio
import base64
import io
import time
import wave
from collections.abc import AsyncGenerator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx
import numpy as np
from loguru import logger
from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    ProposedUserStartedSpeakingFrame,
    ProposedUserStoppedSpeakingFrame,
    TranscriptionFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.stt_service import STTService
from pipecat.utils.time import time_now_iso8601

from stonic_voice import errors
from stonic_voice.cloud import describe_denial

TRANSCRIBE_PATH = "/v1/voice-beta/transcribe"
SAMPLE_RATE = 16000

# Chhodne ke baad itni der aur suno: WebRTC ki awaaz `/beta/turn` ke "end" se thori
# peeche pohanch sakti hai. App pehle hi chup ka intezar kar ke "end" bhejti hai
# (lib/ptt/controller TRAIL_SILENCE_MS), is liye ye sirf raaste ki der hai.
GRACE_SECS = 0.12
# Ek baari ki hadd (app ki TURN_MAX_MS 120 s + mohlat).
MAX_CLIP_SECS = 125.0
# Is se chhoti clip mein koi lafz nahi ho sakta.
MIN_CLIP_SECS = 0.2
# Poori clip ki sab se oonchi awaaz is se kam = bilkul khamoshi (mute mic, ghalti se
# dabi key): Google ko bhejo hi mat. -56 dBFS — dheemi se dheemi baat bhi is se upar.
SILENT_PEAK = 50
# Gateway / Google itni der mein likh na saken to (ek dafa dobara, phir) chhor do.
TIMEOUT_SECS = 15.0
CONNECT_TIMEOUT_SECS = 8.0
# Connection itni der khali rahe to agli baari shuru hote hi garam kar lo (TLS ka
# intezar chhodne ke baad wale qeemti lamhon mein na aaye).
REWARM_AFTER_SECS = 60.0
KEEP_ALIVE_SECS = 300.0

# Dobara koshish bekaar (user ko kuch karna hai) — Live kaan jaisa: app wajah dikhati hai.
_PERMANENT_CLOUD = frozenset({"cloud_signin", "cloud_no_plan", "cloud_limit"})


class ClipError(Exception):
    """Clip likhi na ja saki. `code` app ki zubaan mein; `permanent` = dobara koshish bekaar."""

    def __init__(self, code: str, detail: str = "", *, permanent: bool = False):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail
        self.permanent = permanent


class ClipTranscriber(Protocol):
    async def warm(self) -> None: ...

    async def transcribe(self, audio: bytes, mime: str, vocabulary: list[str]) -> str: ...

    async def close(self) -> None: ...


# ── Awaaz ki shakl ───────────────────────────────────────────────────────────


def pcm_to_wav(pcm: bytes, rate: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm)
    return buf.getvalue()


def encode_clip(pcm: bytes, rate: int = SAMPLE_RATE) -> tuple[bytes, str]:
    """PCM16 mono -> (bytes, mime). Opus (OGG) pehle — 9 guna chhota; na bane to WAV (hamesha chalta hai)."""
    try:
        import soundfile  # libsndfile (Opus) — runtime mein pehle se, Pipecat ke saath

        samples = np.frombuffer(pcm, dtype=np.int16)
        buf = io.BytesIO()
        soundfile.write(buf, samples, rate, format="OGG", subtype="OPUS")
        data = buf.getvalue()
        if data[:4] == b"OggS":
            return data, "audio/ogg"
    except Exception as error:  # noqa: BLE001 — Opus na bane to bhi baari na ruke
        logger.debug(f"Clip kaan: Opus na ban saka ({type(error).__name__}: {error}) — WAV")
    return pcm_to_wav(pcm, rate), "audio/wav"


# Shuru / aakhir ki khamoshi: app "end" se pehle ~0.9 s chup ka intezar karti hai, aur key
# dabane ke baad bolne mein lamha lagta hai. Wo awaaz Google ko bhejna = paisa + likhai
# ka kabhi Urdu script mein palatna (14 Nov naapa: khamoshi wali clip ek dafa Urdu script,
# kaati hui hamesha Roman). Kinare par itni awaaz chhorte hain — pehla / aakhri lafz na kate.
TRIM_MARGIN_SECS = 0.25
TRIM_FRAME_SECS = 0.02
# Kis se kam = khamoshi: clip ki sab se oonchi 20 ms ki taaqat ka itna hissa (ya kam se kam ye RMS).
TRIM_RELATIVE = 0.02  # -34 dB: dheemi baat (sargoshi) bhi is se upar; kamre ka shor neeche
TRIM_FLOOR_RMS = 120.0


def trim_silence(pcm: bytes, rate: int = SAMPLE_RATE) -> bytes:
    """Clip ke shuru aur aakhir ki khamoshi kaato (beech ki nahi), kinare par `TRIM_MARGIN_SECS` chhor kar."""
    samples = np.frombuffer(pcm, dtype=np.int16)
    step = max(1, int(rate * TRIM_FRAME_SECS))
    count = len(samples) // step
    if count < 3:
        return pcm
    frames = samples[: count * step].astype(np.float32).reshape(count, step)
    rms = np.sqrt(np.mean(frames * frames, axis=1))
    threshold = max(TRIM_FLOOR_RMS, float(rms.max()) * TRIM_RELATIVE)
    loud = np.nonzero(rms >= threshold)[0]
    if loud.size == 0:
        return pcm
    margin = int(TRIM_MARGIN_SECS / TRIM_FRAME_SECS)
    first = max(0, int(loud[0]) - margin)
    last = min(count, int(loud[-1]) + 1 + margin)
    end = len(samples) if last >= count else last * step
    return samples[first * step : end].tobytes()


def _resample(pcm: bytes, rate: int) -> bytes:
    """Kisi aur rate ki awaaz 16 kHz par (aam taur par sab 16 kHz hi aati hai)."""
    if rate == SAMPLE_RATE or not pcm:
        return pcm
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    count = max(1, int(len(samples) * SAMPLE_RATE / rate))
    out = np.interp(np.linspace(0, len(samples) - 1, count), np.arange(len(samples)), samples)
    return out.astype(np.int16).tobytes()


@dataclass
class _Clip:
    started: float
    pcm: bytearray = field(default_factory=bytearray)
    ending: float | None = None

    def add(self, audio: bytes, rate: int) -> None:
        if len(self.pcm) >= int(MAX_CLIP_SECS * SAMPLE_RATE) * 2:
            return
        self.pcm += _resample(audio, rate)

    @property
    def seconds(self) -> float:
        return len(self.pcm) / 2 / SAMPLE_RATE

    def silent(self) -> bool:
        if not self.pcm:
            return True
        return int(np.abs(np.frombuffer(bytes(self.pcm), dtype=np.int16).astype(np.int32)).max()) < SILENT_PEAK


# ── Likhne wale: Cloud aur apni key ──────────────────────────────────────────


class CloudClipTranscriber:
    """Stonic Cloud ka gateway: plan, zubaan aur hisaab wahan; yahan sirf clip aur khaas lafz."""

    def __init__(self, *, url: str, token: str, timeout_secs: float = TIMEOUT_SECS, transport: httpx.AsyncBaseTransport | None = None):
        self._http = httpx.AsyncClient(
            base_url=url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=httpx.Timeout(timeout_secs, connect=CONNECT_TIMEOUT_SECS),
            limits=httpx.Limits(keepalive_expiry=KEEP_ALIVE_SECS),
            transport=transport,
        )

    async def warm(self) -> None:
        try:
            await self._http.get("/health")
        except httpx.HTTPError as error:
            logger.debug(f"Clip kaan: gateway garam na ho saka ({error})")

    async def transcribe(self, audio: bytes, mime: str, vocabulary: list[str]) -> str:
        payload: dict[str, Any] = {"audio": base64.b64encode(audio).decode("ascii"), "mime": mime}
        if vocabulary:
            payload["vocabulary"] = vocabulary
        try:
            response = await self._http.post(TRANSCRIBE_PATH, json=payload)
        except httpx.HTTPError as error:
            raise ClipError("network", f"{type(error).__name__}: {error}"[:200]) from error
        if response.status_code != 200:
            if response.status_code == 404:
                # Purana gateway (ye raasta abhi laga nahi). App ko session par hi bata
                # diya jata hai (transcribe capability); yahan pohanchna ghalti hai.
                raise ClipError("cloud_unavailable", "Stonic Cloud does not have push-to-talk transcription yet.")
            denial = describe_denial(response.status_code, response.content)
            raise ClipError(denial.code, str(denial), permanent=denial.code in _PERMANENT_CLOUD)
        try:
            data = response.json()
        except ValueError as error:
            raise ClipError("cloud_unavailable", "Stonic Cloud returned an unreadable transcript.") from error
        return " ".join(str(data.get("text") or "").split())

    async def close(self) -> None:
        try:
            await self._http.aclose()
        except Exception:  # noqa: BLE001 — band hote waqt ki ghalti kisi kaam ki nahi
            pass


class DirectClipTranscriber:
    """User ki apni Gemini key: seedha Google (wohi key jo Live kaan ki hai)."""

    def __init__(self, *, api_key: str, model: str, languages: list[str], timeout_secs: float = TIMEOUT_SECS):
        from google import genai
        from google.genai import types

        self._types = types
        self._model = model
        self._languages = list(languages)
        self._client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=int(timeout_secs * 1000)))

    async def warm(self) -> None:
        return None

    async def transcribe(self, audio: bytes, mime: str, vocabulary: list[str]) -> str:
        types = self._types
        config = types.GenerateContentConfig(
            audio_transcription_config=types.AudioTranscriptionConfig(
                language_codes=self._languages or None,
                custom_vocabulary=vocabulary or None,
            )
        )
        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=[types.Part.from_bytes(data=audio, mime_type=mime)],
                config=config,
            )
        except Exception as error:  # noqa: BLE001 — SDK ki har ghalti ek hi raaste
            text = f"{type(error).__name__}: {error}"
            code = errors.code_for(text, "gemini", cloud=False)
            raise ClipError(code, text[:300], permanent=errors.is_permanent(text, cloud=False)) from error
        parts = []
        for candidate in (response.candidates or [])[:1]:
            for part in getattr(candidate.content, "parts", None) or []:
                if part.text:
                    parts.append(part.text)
        return " ".join(" ".join(parts).split())

    async def close(self) -> None:
        try:
            await self._client.aio.aclose()
        except Exception:  # noqa: BLE001
            pass


# ── Pipecat ki service ───────────────────────────────────────────────────────


class ClipTurnListener(Protocol):
    """turns.PushToTalkStopStrategy — baari ka faisla clip ke intezar mein."""

    def clip_pending(self) -> None: ...

    async def clip_done(self, heard: bool) -> None: ...


class ClipSTTService(STTService):
    """Push-to-talk: baari ki clip record, chhodne par ek dafa likhwao (upar dekho)."""

    def __init__(
        self,
        *,
        transcriber: ClipTranscriber,
        vocabulary: list[str] | None = None,
        turn_listener: ClipTurnListener | None = None,
        notify: Callable[[dict[str, Any]], Awaitable[Any]] | None = None,
        grace_secs: float = GRACE_SECS,
        timeout_secs: float = TIMEOUT_SECS,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._transcriber = transcriber
        self._vocabulary = [str(word) for word in (vocabulary or []) if str(word).strip()][:24]
        self._turn_listener = turn_listener
        self._notify = notify
        self._grace_secs = grace_secs
        self._timeout_secs = timeout_secs
        self._clip: _Clip | None = None
        # Clips ek ke baad ek likhi jati hain — jumle tarteeb se aayein.
        self._lock = asyncio.Lock()
        self._jobs: set[asyncio.Task] = set()
        self._last_call = 0.0
        self.clips_done = 0

    def can_generate_metrics(self) -> bool:
        return False

    # ── Pipecat ke darwaze ──

    async def start(self, frame: Frame) -> None:  # type: ignore[override]
        await super().start(frame)
        self._spawn(self._warm(), "warm")

    async def stop(self, frame: Frame) -> None:  # type: ignore[override]
        await self._drop_jobs()
        await self._transcriber.close()
        await super().stop(frame)

    async def cancel(self, frame: Frame) -> None:  # type: ignore[override]
        await self._drop_jobs()
        await self._transcriber.close()
        await super().cancel(frame)

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]:
        # Har 20 ms ka tukra yahan nahi aata (neeche `process_audio_frame`): clip poori hone par likhai.
        yield None

    async def process_audio_frame(self, frame: InputAudioRawFrame, direction: FrameDirection) -> None:
        clip = self._clip
        if clip is not None and frame.audio:
            clip.add(frame.audio, frame.sample_rate or SAMPLE_RATE)

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        # Baari ke ishare aage (turn ka faisla) jane se PEHLE: "end" par turn wala
        # pehle se jaanta ho ke clip likhi ja rahi hai.
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, ProposedUserStartedSpeakingFrame):
                self._begin()
            elif isinstance(frame, ProposedUserStoppedSpeakingFrame):
                self._end()
        await super().process_frame(frame, direction)

    # ── Clip ──

    def _begin(self) -> None:
        current = self._clip
        if current is not None and current.ending is None:
            return  # baari pehle se chal rahi hai (dohra "start")
        # Pichli clip mohlat mein ho to wo apne task mein jo hai us par likhi jayegi.
        self._clip = _Clip(started=time.monotonic())
        if time.monotonic() - self._last_call > REWARM_AFTER_SECS:
            # User bol raha hai: gateway tak connection abhi garam — chhodne ke baad TLS ka intezar nahi.
            self._last_call = time.monotonic()
            self._spawn(self._warm(), "rewarm")

    def _end(self) -> None:
        clip = self._clip
        if clip is None or clip.ending is not None:
            return
        clip.ending = time.monotonic()
        if self._turn_listener is not None:
            self._turn_listener.clip_pending()
        self._spawn(self._finish(clip), "clip")

    async def _finish(self, clip: _Clip) -> None:
        heard = False
        try:
            await asyncio.sleep(self._grace_secs)
            if self._clip is clip:
                self._clip = None
            async with self._lock:
                text = await self._transcribe(clip)
                heard = bool(text)
                # Pehle turn wale ko "likh di" — phir jumla: jumla pohanchte hi wo
                # jaanta ho ke aur clip baqi nahi (foran baari band, 0.5 s ka intezar nahi).
                if self._turn_listener is not None:
                    await self._turn_listener.clip_done(heard)
                    clip = None  # type: ignore[assignment]
                if text:
                    await self.push_frame(TranscriptionFrame(text, self._user_id, time_now_iso8601(), finalized=True))
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001 — ek clip ki ghalti baat-cheet na gire
            logger.exception(f"Clip kaan: clip toot gayi — {type(error).__name__}: {error}")
        finally:
            if clip is not None and self._turn_listener is not None:
                try:
                    await self._turn_listener.clip_done(heard)
                except Exception:  # noqa: BLE001
                    pass

    async def _transcribe(self, clip: _Clip) -> str:
        seconds = clip.seconds
        if seconds < MIN_CLIP_SECS or clip.silent():
            logger.info(f"Clip kaan: {seconds:.1f} s — khamoshi, Google ko nahi bheja")
            return ""
        pcm = await asyncio.to_thread(trim_silence, bytes(clip.pcm))
        audio, mime = await asyncio.to_thread(encode_clip, pcm)
        seconds = len(pcm) / 2 / SAMPLE_RATE
        started = time.monotonic()
        for attempt in (1, 2):
            try:
                self._last_call = time.monotonic()
                text = await asyncio.wait_for(
                    self._transcriber.transcribe(audio, mime, self._vocabulary), timeout=self._timeout_secs
                )
            except (ClipError, asyncio.TimeoutError) as error:
                failure = error if isinstance(error, ClipError) else ClipError("network", "transcription timed out")
                if failure.permanent:
                    logger.warning(f"Clip kaan: {failure.code} — {failure.detail}")
                    await self.push_error(f"stonic:{failure.code}: {failure.detail}")
                    return ""
                if attempt == 1:
                    logger.warning(f"Clip kaan: {failure.code} ({failure.detail}) — dobara koshish")
                    continue
                logger.warning(f"Clip kaan: likhai nahi hui ({failure.code}) — baari khali, user ko 'dobara bolo'")
                await self._tell({"type": "stonic-unheard", "code": failure.code})
                return ""
            self.clips_done += 1
            logger.info(
                f"Clip kaan: {seconds:.1f} s ({len(audio) / 1024:.1f} KB {mime.split('/')[1]}) -> "
                f"{len(text)} huroof, {round((time.monotonic() - started) * 1000)} ms"
            )
            return text
        return ""

    async def _tell(self, data: dict[str, Any]) -> None:
        if self._notify is None:
            return
        try:
            await self._notify(data)
        except Exception:  # noqa: BLE001 — app tak khabar na pohnche to bhi baari chale
            pass

    async def _warm(self) -> None:
        self._last_call = time.monotonic()
        try:
            await self._transcriber.warm()
        except Exception:  # noqa: BLE001
            pass

    def _spawn(self, coroutine: Awaitable[Any], name: str) -> None:
        task = self.create_task(coroutine, f"{self}::{name}")  # type: ignore[arg-type]
        self._jobs.add(task)
        task.add_done_callback(self._jobs.discard)

    async def _drop_jobs(self) -> None:
        for task in list(self._jobs):
            await self.cancel_task(task)
        self._jobs.clear()
