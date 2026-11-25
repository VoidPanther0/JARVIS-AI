"""`loudness` (Pipecat ka awaaz naapne wala C++ hissa) Windows rok de to bhi engine chale.

Pipecat (pipecat/audio/utils.py) shuru mein hi `import loudness` karta hai: VAD
(user bol raha hai ya chup) aur RTVI isi se awaaz ka level naapte hain (ITU-R
BS.1770, LUFS). Ye ek chhoti C++ DLL hai, na us par signature hai na wo zyada
logon ke paas hai. Windows 11 ka Smart App Control (On) aisi file ko "An
Application Control policy has blocked this file" keh kar rok deta hai, aur
poora engine uthte hi gir jata hai ("Stonic Voice could not start").

15 Nov 2026: dev ka venv (pip se bana) isi wajah se ruka. Installer ki laai hui
file par Windows ka bharose ka nishan hota hai, is liye installed app mein wohi
file chali. Lekin ye nishan har raaste par pakka nahi (update, doosri machine,
build ka verify, runtime dobara banana).

`install()` pehle asal DLL aazmata hai. Wo ruk jaye to `sys.modules["loudness"]`
mein yahi hisaab numpy mein rakh deta hai: wohi BS.1770 (K-weighting, 400 ms ke
block, 75% overlap, -70 LUFS aur -10 LU ke gate). selftest dono ko milata hai.
Pipecat ka code nahi badalta.
"""

from __future__ import annotations

import math
import sys
import types
from functools import lru_cache

import numpy as np

BLOCK_SECS = 0.4  # BS.1770 ka gating block
STEP_SECS = 0.1  # 75% overlap
ABSOLUTE_GATE_LUFS = -70.0
RELATIVE_GATE_LU = -10.0
# BS.1770 ke channel weights (L, R, C, Ls, Rs). Pipecat sirf mono bhejta hai.
CHANNEL_WEIGHTS = (1.0, 1.0, 1.0, 1.41, 1.41)

_fallback_reason: str | None = None


def _k_weighting(rate: int) -> tuple[tuple[tuple[float, float, float], tuple[float, float, float]], ...]:
    """K-weighting ke do filter (high-shelf, phir high-pass), har sample rate ke liye.

    BS.1770 ke analog prototype se (libebur128 wale adad). 48 kHz par ye
    standard ke chhape hue coefficients hi dete hain.
    """
    f0, gain_db, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = math.tan(math.pi * f0 / rate)
    vh = 10.0 ** (gain_db / 20.0)
    vb = vh ** 0.4996667741545416
    a0 = 1.0 + k / q + k * k
    shelf = (
        ((vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0),
        (1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0),
    )
    f0, q = 38.13547087602444, 0.5003270373238773
    k = math.tan(math.pi * f0 / rate)
    a0 = 1.0 + k / q + k * k
    high_pass = (
        (1.0, -2.0, 1.0),
        (1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0),
    )
    return shelf, high_pass


@lru_cache(maxsize=8)
def _k_weighting_spectrum(rate: int, length: int, nfft: int) -> np.ndarray:
    """Filter ka impulse response (pehle `length` samples) ka FFT.

    Har sample par Python loop sirf ek dafa (har rate/lambai ke liye), phir
    filter FFT se lagta hai: zero se shuru hone wale IIR filter ke barabar,
    lekin numpy ki raftar se (VAD ise har 30 ms par bulata hai).
    """
    response = [0.0] * length
    response[0] = 1.0
    for (b0, b1, b2), (_, a1, a2) in _k_weighting(rate):
        x1 = x2 = y1 = y2 = 0.0
        for i, x in enumerate(response):
            y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2, x1, y2, y1 = x1, x, y1, y
            response[i] = y
    return np.fft.rfft(np.asarray(response), nfft)


def integrated_loudness(data, rate) -> float:
    """`loudness.integrated_loudness` ka badal: integrated loudness (LUFS), BS.1770.

    `data`: (samples,) ya (samples, channels), float, -1..1. Gate se neeche ki
    awaaz par `-inf`. 400 ms se chhoti awaaz par ValueError (asal ki tarah).
    """
    rate = int(rate)
    if rate <= 0:
        raise ValueError(f"Sample rate must be positive, got {rate}.")
    samples = np.asarray(data, dtype=np.float64)
    if samples.ndim == 1:
        samples = samples[:, None]
    if samples.ndim != 2 or samples.shape[1] < 1:
        raise ValueError("Audio must be shaped (samples,) or (samples, channels).")
    length, channels = samples.shape
    if channels > len(CHANNEL_WEIGHTS):
        raise ValueError(f"At most {len(CHANNEL_WEIGHTS)} channels are supported, got {channels}.")
    block = int(round(BLOCK_SECS * rate))
    step = max(1, int(round(STEP_SECS * rate)))
    if length < block:
        raise ValueError("Audio must be at least one gating block (400 ms) long.")

    nfft = 2 * length
    spectrum = _k_weighting_spectrum(rate, length, nfft)
    weighted = np.fft.irfft(np.fft.rfft(samples, nfft, axis=0) * spectrum[:, None], nfft, axis=0)[:length]

    energy = np.concatenate([np.zeros((1, channels)), np.cumsum(weighted * weighted, axis=0)])
    starts = np.arange(0, length - block + 1, step)
    mean_square = (energy[starts + block] - energy[starts]) / block  # (blocks, channels)
    power = mean_square @ np.asarray(CHANNEL_WEIGHTS[:channels])

    with np.errstate(divide="ignore"):
        block_lufs = -0.691 + 10.0 * np.log10(power)
        keep = block_lufs > ABSOLUTE_GATE_LUFS
        if not keep.any():
            return float("-inf")
        relative_gate = -0.691 + 10.0 * np.log10(power[keep].mean()) + RELATIVE_GATE_LU
        keep &= block_lufs > relative_gate
        if not keep.any():
            return float("-inf")
        return float(-0.691 + 10.0 * np.log10(power[keep].mean()))


def install() -> bool:
    """Pipecat se PEHLE bulao. True = asal DLL chali; False = numpy wala badal laga.

    Dobara bulane par kuch nahi badalta.
    """
    global _fallback_reason
    current = sys.modules.get("loudness")
    if current is not None:
        return not getattr(current, "__stonic_fallback__", False)
    try:
        import loudness  # noqa: F401  (C++ DLL: Smart App Control yahin rokta hai)

        return True
    except (ImportError, OSError) as err:
        module = types.ModuleType("loudness")
        module.__doc__ = "Stonic: numpy BS.1770 fallback (the native loudness DLL could not load)."
        module.__stonic_fallback__ = True
        module.integrated_loudness = integrated_loudness
        sys.modules["loudness"] = module
        _fallback_reason = str(err)
        return False


def fallback_reason() -> str | None:
    """Asal DLL kyun nahi chali (log ke liye). Chal gayi ho to None."""
    return _fallback_reason
