"""HAL 9000 TTS — Kokoro 82M (ONNX runtime).

Kokoro is a tiny (~80M param) non-autoregressive TTS model that runs in
real time on CPU via onnxruntime. It ships with ~50 pre-trained voices
(no voice cloning), so "HAL" here is an approximation — a calm,
measured British male — rather than a clone of Douglas Rain.

Model and voice are loaded once; each call is a single ONNX inference,
so latency is sub-second for a typical sentence on Apple Silicon CPU.

Public API (drop-in for server/tts.py):
    synthesize(text) -> (numpy_array_f32, sample_rate)
    synthesize_wav_bytes(text) -> bytes
    synthesize_wav_base64(text) -> str

The model + voices files (~340 MB combined) are downloaded once on
first load if missing, into this directory.
"""

from __future__ import annotations

import base64
import io
import os
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

VOICE = "bm_george"  # calm British male — closest to HAL's measured delivery
LANG = "en-gb"
VOICE_DIR = Path(__file__).resolve().parent
MODEL_PATH = VOICE_DIR / "kokoro-v1.0.onnx"
VOICES_PATH = VOICE_DIR / "voices-v1.0.bin"

_MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
_VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

_kokoro = None


def _ensure_files() -> None:
    for path, url in ((MODEL_PATH, _MODEL_URL), (VOICES_PATH, _VOICES_URL)):
        if path.exists() and path.stat().st_size > 1_000_000:
            continue
        print(f"[hal_tts] downloading {url} -> {path.name}")
        tmp = path.with_suffix(path.suffix + ".tmp")
        urllib.request.urlretrieve(url, tmp)
        os.replace(tmp, path)


def _ensure_model():
    global _kokoro
    if _kokoro is not None:
        return
    from kokoro_onnx import Kokoro  # heavy import

    _ensure_files()
    print(f"[hal_tts] Loading Kokoro (voice={VOICE}, lang={LANG})...")
    _kokoro = Kokoro(str(MODEL_PATH), str(VOICES_PATH))
    # Pre-warm with a cheap call so the first real request is fast.
    _kokoro.create("hello", voice=VOICE, speed=1.0, lang=LANG)
    print("[hal_tts] Pipeline ready.")


def synthesize(text: str) -> tuple[np.ndarray, int]:
    """Generate speech as HAL. Returns (numpy_array_f32, sample_rate)."""
    _ensure_model()
    assert _kokoro is not None
    samples, sr = _kokoro.create(text, voice=VOICE, speed=1.0, lang=LANG)
    return np.asarray(samples, dtype=np.float32), int(sr)


def synthesize_wav_bytes(text: str) -> bytes:
    wav, sr = synthesize(text)
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def synthesize_wav_base64(text: str) -> str:
    return base64.b64encode(synthesize_wav_bytes(text)).decode("ascii")
