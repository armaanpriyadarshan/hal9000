"""
HAL 9000 TTS module — Qwen3-TTS voice clone.

Loads the model once and exposes a simple `synthesize(text) -> (wav, sr)` API
for the backend to call.
"""

import base64
import io
import torch
import soundfile as sf
from pathlib import Path
from qwen_tts import Qwen3TTSModel

VOICE_DIR = Path(__file__).parent
REF_AUDIO = str(VOICE_DIR / "audio" / "04.wav")
REF_TEXT = "The nine thousand series is the most reliable computer ever made."
MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"

_model = None
_prompt = None


def _ensure_model():
    global _model, _prompt
    if _model is not None:
        return

    print(f"[hal_tts] Loading {MODEL_ID}...")
    _model = Qwen3TTSModel.from_pretrained(
        MODEL_ID,
        device_map="cpu",
        dtype=torch.float32,
    )

    # Pre-compute voice clone prompt so we don't re-extract features every call
    _prompt = _model.create_voice_clone_prompt(
        ref_audio=REF_AUDIO,
        ref_text=REF_TEXT,
    )
    print("[hal_tts] Model and voice prompt ready.")


def synthesize(text: str) -> tuple:
    """Generate speech as HAL 9000. Returns (numpy_array, sample_rate)."""
    _ensure_model()
    wavs, sr = _model.generate_voice_clone(
        text=text,
        language="English",
        voice_clone_prompt=_prompt,
    )
    return wavs[0], sr


def synthesize_wav_bytes(text: str) -> bytes:
    """Generate speech and return raw WAV bytes."""
    wav, sr = synthesize(text)
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def synthesize_wav_base64(text: str) -> str:
    """Generate speech and return base64-encoded WAV."""
    return base64.b64encode(synthesize_wav_bytes(text)).decode("ascii")
