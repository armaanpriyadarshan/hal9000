"""HAL 9000 TTS — Piper, pre-trained HAL voice from
huggingface.co/campwill/HAL-9000-Piper-TTS.

Inference backend: Piper (VITS-based, ONNX runtime). Runs in real
time on CPU.

Expects the weights next to this file:
    voice/hal.onnx         ONNX model
    voice/hal.onnx.json    voice config

If either is missing, every `synthesize*` call raises; the server
wrapper (server/tts.py) catches and falls back to macOS `say`.

Public API:
    synthesize(text) -> (numpy_array_f32, sample_rate)
    synthesize_wav_bytes(text) -> bytes
"""

from __future__ import annotations

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
            f"Piper HAL weights not found. Expected {MODEL_PATH.name} and "
            f"{CONFIG_PATH.name} in {VOICE_DIR}. Download them with:\n"
            f"  hf download campwill/HAL-9000-Piper-TTS hal.onnx hal.onnx.json "
            f"--local-dir {VOICE_DIR}"
        )
    from piper import PiperVoice  # type: ignore
    print(f"[hal_tts] Loading Piper voice from {MODEL_PATH.name}...")
    _voice = PiperVoice.load(str(MODEL_PATH), config_path=str(CONFIG_PATH))
    print("[hal_tts] Voice ready.")


def synthesize(text: str) -> tuple[np.ndarray, int]:
    """Generate speech as HAL. Returns (float32 numpy array, sample rate)."""
    _ensure_voice()
    assert _voice is not None
    chunks = list(_voice.synthesize(text))
    if not chunks:
        return np.zeros(0, dtype=np.float32), 22050
    sr = chunks[0].sample_rate
    samples = np.concatenate(
        [c.audio_int16_array.astype(np.float32) / 32768.0 for c in chunks]
    )
    return samples, sr


def synthesize_wav_bytes(text: str) -> bytes:
    wav, sr = synthesize(text)
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()
