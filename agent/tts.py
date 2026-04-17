"""Text-to-speech via macOS `say`."""

import shutil
import subprocess

DEFAULT_VOICE = "Daniel"


def speak(text: str, voice: str = DEFAULT_VOICE) -> None:
    if not text.strip():
        return
    if not shutil.which("say"):
        print(f"[tts fallback] {text}")
        return
    subprocess.run(["say", "-v", voice, text], check=False)
