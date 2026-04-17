"""Quick standalone sanity check for the HAL voice pipeline.

Usage:
  python create_voice.py "I'm sorry Dave, I'm afraid I can't do that." out.wav
  python create_voice.py   # uses default test sentence
"""

from __future__ import annotations

import sys
from pathlib import Path

import soundfile as sf

import hal_tts

DEFAULT_TEXT = "I'm sorry Dave, I'm afraid I can't do that."
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "test_output.wav"


def main() -> int:
    text = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TEXT
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUTPUT
    print(f"synthesizing: {text!r}")
    wav, sr = hal_tts.synthesize(text)
    sf.write(str(output), wav, sr)
    print(f"wrote: {output}  ({len(wav)} samples @ {sr} Hz)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
