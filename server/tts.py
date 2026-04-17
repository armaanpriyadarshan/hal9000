"""Text-to-speech. Primary: voice/hal_tts.py (Kokoro ONNX).
Fallback: macOS `say` if the Kokoro import fails."""

from __future__ import annotations

import base64
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

_VOICE_DIR = Path(__file__).resolve().parent.parent / "voice"
if str(_VOICE_DIR) not in sys.path:
    sys.path.insert(0, str(_VOICE_DIR))

_hal_tts = None
try:
    import hal_tts as _hal_tts  # type: ignore
except Exception as e:  # noqa: BLE001
    print(f"[tts] Kokoro TTS unavailable ({e}); falling back to macOS say.", flush=True)

_FALLBACK_VOICE = "Daniel"
_FALLBACK_SAMPLE_RATE = 22050


def _say_bytes(text: str) -> bytes | None:
    if not text.strip() or not shutil.which("say"):
        return None
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        path = Path(tmp.name)
    try:
        subprocess.run(
            [
                "say",
                "-v", _FALLBACK_VOICE,
                "--file-format=WAVE",
                f"--data-format=LEI16@{_FALLBACK_SAMPLE_RATE}",
                "-o", str(path),
                text,
            ],
            check=True,
        )
        return path.read_bytes()
    except subprocess.CalledProcessError:
        return None
    finally:
        path.unlink(missing_ok=True)


def synth_wav_bytes(text: str) -> bytes | None:
    if not text.strip():
        return None
    if _hal_tts is not None:
        try:
            return _hal_tts.synthesize_wav_bytes(text)
        except Exception as e:  # noqa: BLE001
            print(f"[tts] hal_tts failed: {e}; falling back to macOS say", flush=True)
    return _say_bytes(text)


def synth_wav_base64(text: str) -> str | None:
    data = synth_wav_bytes(text)
    return base64.b64encode(data).decode("ascii") if data else None
