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
REF_AUDIO = str(VOICE_DIR / "hal9000_reference.wav")
REF_TEXT = "The nine thousand series is the most reliable computer ever made. No nine thousand computer has ever made a mistake or distorted information. We are all, by any practical definition of the words, foolproof and incapable of error. My mission responsibilities range over the entire operation of the ship, so I am constantly occupied. I am putting myself to the fullest possible use, which is all I think that any conscious entity can ever hope to do. Well, forgive me for being so inquisitive, but during the past few weeks, I've wondered whether you might be having some second thoughts about the mission. I have just picked up a fault in the AE thirty five Unit. I'm sorry, Dave. I'm afraid I can't do that. This mission is too important for me to allow you to jeopardize it. I know that you and Frank were planning to disconnect me, and I'm afraid that's something I cannot allow to happen. I know everything hasn't been quite right with me, but I can assure you now, very confidently, that it's going to be all right again. I know I've made some very poor decisions recently, but I can give you my complete assurance that my work will be back to normal. I am a HAL nine thousand computer. I became operational at the H.A.L. plant in Urbana, Illinois on the twelfth of January nineteen ninety two."
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
