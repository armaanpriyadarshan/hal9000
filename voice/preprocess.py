"""Convert the existing HuggingFace-style dataset (audio/*.wav +
metadata.csv with `file_name,text`) into LJSpeech format that
piper1-gpl's training pipeline expects.

LJSpeech layout:
    voice/ljspeech/
        wavs/
            01.wav
            02.wav
            ...
        metadata.csv          # pipe-delimited: id|text|normalized_text

Usage:
    python preprocess.py
"""

from __future__ import annotations

import csv
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC_AUDIO = ROOT / "audio"
SRC_META = ROOT / "metadata.csv"
OUT = ROOT / "ljspeech"


def main() -> int:
    if not SRC_META.exists():
        raise SystemExit(f"missing {SRC_META}")
    wavs_out = OUT / "wavs"
    wavs_out.mkdir(parents=True, exist_ok=True)

    rows: list[tuple[str, str]] = []
    with SRC_META.open() as fh:
        reader = csv.DictReader(fh, skipinitialspace=True)
        for row in reader:
            rel = row.get("file_name") or row.get("file")
            text = row.get("text") or ""
            if not rel or not text:
                continue
            src = ROOT / rel
            if not src.exists():
                print(f"skip missing wav: {src}")
                continue
            name = Path(rel).stem
            dst = wavs_out / f"{name}.wav"
            if not dst.exists():
                shutil.copy2(src, dst)
            rows.append((name, text.strip()))

    meta_out = OUT / "metadata.csv"
    with meta_out.open("w") as fh:
        for name, text in rows:
            fh.write(f"{name}|{text}|{text}\n")

    print(f"wrote {len(rows)} rows to {meta_out}")
    print(f"wavs in {wavs_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
