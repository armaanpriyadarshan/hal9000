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
REF_AUDIO = str(VOICE_DIR / "hal9000_reference.wav")
REF_TEXT = "The nine thousand series is the most reliable computer ever made. No nine thousand computer has ever made a mistake or distorted information. We are all, by any practical definition of the words, foolproof and incapable of error. My mission responsibilities range over the entire operation of the ship, so I am constantly occupied. I am putting myself to the fullest possible use, which is all I think that any conscious entity can ever hope to do. Well, forgive me for being so inquisitive, but during the past few weeks, I've wondered whether you might be having some second thoughts about the mission. I have just picked up a fault in the AE thirty five Unit. I'm sorry, Dave. I'm afraid I can't do that. This mission is too important for me to allow you to jeopardize it. I know that you and Frank were planning to disconnect me, and I'm afraid that's something I cannot allow to happen. I know everything hasn't been quite right with me, but I can assure you now, very confidently, that it's going to be all right again. I know I've made some very poor decisions recently, but I can give you my complete assurance that my work will be back to normal. I am a HAL nine thousand computer. I became operational at the H.A.L. plant in Urbana, Illinois on the twelfth of January nineteen ninety two."

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"

DEFAULT_TEXT = "I'm sorry Dave, I'm afraid I can't do that."
DEFAULT_OUTPUT = str(VOICE_DIR / "test_output.wav")


def load_model():
    return Qwen3TTSModel.from_pretrained(
        MODEL_ID,
        device_map="cpu",
        dtype=torch.float32,
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
