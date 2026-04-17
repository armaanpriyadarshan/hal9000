"""Convert the HuggingFace-style dataset (audio/*.wav + metadata.csv
with `file_name,text`) into the pipe-delimited CSV that piper1-gpl's
training pipeline expects:

    01.wav|Good afternoon, Mister Amor.
    02.wav|Everything is going extremely well.
    ...

Output:
    voice/metadata_piper.csv

Audio files stay in voice/audio/ — piper accepts --data.audio_dir
pointing there directly.

Usage:
    python preprocess.py
"""

from __future__ import annotations

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC_META = ROOT / "metadata.csv"
AUDIO_DIR = ROOT / "audio"
OUT = ROOT / "metadata_piper.csv"


def main() -> int:
    if not SRC_META.exists():
        raise SystemExit(f"missing {SRC_META}")

    rows: list[tuple[str, str]] = []
    with SRC_META.open() as fh:
        reader = csv.DictReader(fh, skipinitialspace=True)
        for row in reader:
            rel = row.get("file_name") or row.get("file")
            text = (row.get("text") or "").strip()
            if not rel or not text:
                continue
            wav_name = Path(rel).name  # strip any `audio/` prefix
            if not (AUDIO_DIR / wav_name).exists():
                print(f"skip missing wav: {wav_name}")
                continue
            rows.append((wav_name, text))

    with OUT.open("w") as fh:
        for name, text in rows:
            fh.write(f"{name}|{text}\n")

    print(f"wrote {len(rows)} rows to {OUT.relative_to(ROOT)}")
    print(f"audio dir: {AUDIO_DIR.relative_to(ROOT)}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
