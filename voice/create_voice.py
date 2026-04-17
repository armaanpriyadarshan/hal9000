"""
Create a HAL 9000 voice clone using Qwen3-TTS.

Uses Qwen3-TTS-12Hz-1.7B-Base for zero-shot voice cloning from
the HAL 9000 reference audio samples.

Usage:
  python create_voice.py "I'm sorry Dave, I'm afraid I can't do that." output.wav
  python create_voice.py  # uses default test sentence
"""

import sys
import torch
import soundfile as sf
from pathlib import Path
from qwen_tts import Qwen3TTSModel

VOICE_DIR = Path(__file__).parent
REF_AUDIO = str(VOICE_DIR / "audio" / "04.wav")  # "The nine thousand series is the most reliable computer ever made."
REF_TEXT = "The nine thousand series is the most reliable computer ever made."

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"

DEFAULT_TEXT = "I'm sorry Dave, I'm afraid I can't do that."
DEFAULT_OUTPUT = str(VOICE_DIR / "test_output.wav")


def load_model():
    return Qwen3TTSModel.from_pretrained(
        MODEL_ID,
        device_map="cuda:0",
        dtype=torch.bfloat16,
    )


def clone_voice(model, text: str, output_path: str):
    wavs, sr = model.generate_voice_clone(
        text=text,
        language="English",
        ref_audio=REF_AUDIO,
        ref_text=REF_TEXT,
    )
    sf.write(output_path, wavs[0], sr)
    print(f"Wrote: {output_path}")
    return wavs[0], sr


if __name__ == "__main__":
    text = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TEXT
    output = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUTPUT

    print(f"Loading model: {MODEL_ID}")
    model = load_model()

    print(f"Cloning HAL voice for: \"{text}\"")
    clone_voice(model, text, output)
