"""Microphone capture. Push-to-talk in the terminal: hold Enter to record."""

import sys
import threading

import numpy as np
import sounddevice as sd

from config import CHANNELS, MAX_RECORDING_SECONDS, SAMPLE_RATE


def record_push_to_talk() -> bytes:
    """Block until the user presses Enter, then record until Enter again.
    Returns raw 16-bit PCM little-endian mono at SAMPLE_RATE.
    """
    print("> Press Enter to start recording, Enter again to stop:", end=" ", flush=True)
    sys.stdin.readline()

    frames: list[np.ndarray] = []
    stop = threading.Event()

    def on_audio(indata, _frames, _time, _status):
        if stop.is_set():
            return
        frames.append(indata.copy())

    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="int16",
        callback=on_audio,
    ):
        print("  Recording. Press Enter to stop.", flush=True)
        watchdog = threading.Timer(MAX_RECORDING_SECONDS, stop.set)
        watchdog.start()
        sys.stdin.readline()
        stop.set()
        watchdog.cancel()

    if not frames:
        return b""
    audio = np.concatenate(frames, axis=0).astype(np.int16)
    return audio.tobytes()
