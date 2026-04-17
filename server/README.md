# HAL 9000 Server

On-device voice agent. Mic → Gemma 4 E2B (Cactus FFI, audio-in) → macOS `say`.

Gemma 4 E2B does native audio understanding, so this is a single-model
pipeline: the raw PCM goes straight to the LLM — no separate STT step.

## Requirements

- Apple Silicon macOS with Homebrew
- Cactus CLI + Python FFI
- HuggingFace account (to download Gemma 4 weights from `google/gemma-4-E2B-it`)
- Microphone access for Python
- ~10 GB free disk during conversion, ~7 GB final

## One-time setup

```bash
# 1. Install Cactus (provides the CLI + Python FFI into Homebrew's python 3.14)
brew install cactus-compute/cactus/cactus

# 2. Fix the FFI library path (Homebrew ships cactus.py expecting a non-default path)
mkdir -p /opt/homebrew/lib/cactus/build
ln -sf /opt/homebrew/opt/cactus/lib/libcactus.dylib \
  /opt/homebrew/lib/cactus/build/libcactus.dylib

# 3. Patch the Cactus CLI's cmd_download (uses undefined `model_name` on reconvert path)
sed -i '' 's/is_vlm = '"'"'vl'"'"' in model_name.lower/model_name = model_id\n    is_vlm = '"'"'vl'"'"' in model_name.lower/' \
  /opt/homebrew/Cellar/cactus/*/libexec/python/src/cli.py

# 4. Create a venv layered over Homebrew's python 3.14 so it sees the cactus module
cd server
/opt/homebrew/bin/python3.14 -m venv .venv --system-site-packages
.venv/bin/pip install -r requirements.txt huggingface_hub

# 5. Authenticate with HuggingFace (needs access to google/gemma-4-E2B-it)
.venv/bin/hf auth login

# 6. Download + convert Gemma 4 E2B weights from source
#    (the pre-converted INT4 package on Cactus-Compute has missing audio
#    tensors, so we force a fresh conversion from google/gemma-4-E2B-it.)
cactus download google/gemma-4-E2B-it --reconvert
```

Step 6 takes ~15-25 minutes (downloads ~9 GB of fp16 weights then quantizes
to INT4). Coffee break.

## Run

```bash
server/.venv/bin/python server/main.py
```

Each turn:

```
> Press Enter to start recording, Enter again to stop:
  Recording. Press Enter to stop.
HAL: The current altitude of the International Space Station is approximately 400 kilometers.
```

HAL speaks the reply via macOS `say` as well.

## What's here

- `config.py` — model name, sample rate, system prompt, completion options
  (`enable_thinking_if_supported: True`, `max_tokens: 600`)
- `cactus_runtime.py` — `CactusSession` wrapper around the Cactus FFI
- `audio.py` — push-to-talk mic capture (16 kHz int16 PCM)
- `tts.py` — macOS `say`
- `tools.py` — tool schemas (procedure lookup, telemetry, crew health) — all stubs
- `main.py` — the voice loop

## Next steps

- Wire `tools.py` stubs to real data sources (RAG over onboard docs, telemetry
  bus, medical sensors).
- Swap push-to-talk for VAD (`cactus_vad` in the FFI) so HAL listens continuously.
- Tune the system prompt for the anomaly-triage direction from the root README.
- Trim response latency (currently ~10 s on CPU). NPU prefill (`model.mlpackage`,
  `audio_encoder.mlpackage`) isn't loading yet — if Cactus ships the Apple NPU
  bundles, we should see a multi-x speedup.
