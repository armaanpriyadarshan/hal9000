"""HAL 9000 TTS — Piper, trained on the HAL audio dataset.

Inference backend: Piper (VITS-based, ONNX runtime). Single-voice
model fine-tuned on `voice/audio/*.wav` via piper1-gpl. Runs in
real time on CPU.

Expects the trained artifacts next to this file:
    voice/hal.onnx         ONNX weights
    voice/hal.onnx.json    voice config produced by Piper

If those files are absent, every `synthesize*` call raises; the
server-side wrapper (server/tts.py) catches and falls back to
macOS `say` automatically.

Public API (drop-in for server/tts.py):
    synthesize(text) -> (numpy_array_f32, sample_rate)
    synthesize_wav_bytes(text) -> bytes
    synthesize_wav_base64(text) -> str
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

import numpy as np
import soundfile as sf

VOICE_DIR = Path(__file__).resolve().parent
MODEL_PATH = VOICE_DIR / "hal.onnx"
CONFIG_PATH = VOICE_DIR / "hal.onnx.json"

_voice = None


def _ensure_voice():
    global _voice
    if _voice is not None:
        return
    if not MODEL_PATH.exists() or not CONFIG_PATH.exists():
        raise RuntimeError(
            f"Piper HAL model not found. Expected {MODEL_PATH.name} and "
            f"{CONFIG_PATH.name} in {VOICE_DIR}. Train one with the "
            "instructions in voice/README.md."
        )
    from piper import PiperVoice  # type: ignore
    print(f"[hal_tts] Loading Piper voice from {MODEL_PATH.name}...")
    _voice = PiperVoice.load(str(MODEL_PATH), config_path=str(CONFIG_PATH))
    print("[hal_tts] Voice ready.")


def synthesize(text: str) -> tuple[np.ndarray, int]:
    """Generate speech as HAL. Returns (float32 numpy array, sample rate)."""
    _ensure_voice()
    assert _voice is not None
    # PiperVoice.synthesize_stream_raw yields int16 PCM chunks.
    pcm_chunks = list(_voice.synthesize_stream_raw(text))
    if not pcm_chunks:
        return np.zeros(0, dtype=np.float32), _voice.config.sample_rate
    pcm = b"".join(pcm_chunks)
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    return samples, _voice.config.sample_rate


def synthesize_wav_bytes(text: str) -> bytes:
    wav, sr = synthesize(text)
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def synthesize_wav_base64(text: str) -> str:
    return base64.b64encode(synthesize_wav_bytes(text)).decode("ascii")
