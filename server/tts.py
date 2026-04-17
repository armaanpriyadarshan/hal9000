"""Text-to-speech via macOS `say`. Returns WAV bytes so the client can
analyse the waveform for visualisation."""

import base64
import os
import shutil
import subprocess
import tempfile

DEFAULT_VOICE = "Daniel"
SAMPLE_RATE = 22050


def synth_wav_bytes(text: str, voice: str = DEFAULT_VOICE) -> bytes | None:
    if not text.strip() or not shutil.which("say"):
        return None
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        subprocess.run(
            [
                "say",
                "-v", voice,
                "--file-format=WAVE",
                f"--data-format=LEI16@{SAMPLE_RATE}",
                "-o", path,
                text,
            ],
            check=True,
        )
        with open(path, "rb") as fh:
            return fh.read()
    except subprocess.CalledProcessError:
        return None
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def synth_wav_base64(text: str, voice: str = DEFAULT_VOICE) -> str | None:
    data = synth_wav_bytes(text, voice)
    return base64.b64encode(data).decode("ascii") if data else None


def speak(text: str, voice: str = DEFAULT_VOICE) -> None:
    """Play TTS locally — used by the CLI (main.py), not the HTTP server."""
    if not text.strip() or not shutil.which("say"):
        return
    subprocess.run(["say", "-v", voice, text], check=False)
