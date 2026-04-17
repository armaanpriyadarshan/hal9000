# HAL 9000 Agent

On-device voice agent. Mic → Gemma 4 (via Cactus) → macOS `say`.

## Requirements

- macOS with Homebrew
- Cactus CLI + Python FFI (installed by the setup below)
- HuggingFace account with access to the `google/gemma-4-E2B-it` weights (gated)
- Microphone access for Python

## One-time setup

```bash
# 1. Install Cactus (provides the CLI + Python FFI into Homebrew's python 3.14)
brew install cactus-compute/cactus/cactus

# 2. Fix the FFI library path (Homebrew ships cactus.py expecting a non-default path)
mkdir -p /opt/homebrew/lib/cactus/build
ln -sf /opt/homebrew/opt/cactus/lib/libcactus.dylib \
  /opt/homebrew/lib/cactus/build/libcactus.dylib

# 3. Create a venv layered over Homebrew's python 3.14 so it sees the cactus module
cd agent
/opt/homebrew/bin/python3.14 -m venv .venv --system-site-packages
.venv/bin/pip install -r requirements.txt huggingface_hub

# 4. Authenticate with HuggingFace (Gemma 4 is gated — request access on the model page first)
.venv/bin/hf auth login

# 5. Download the Gemma 4 E2B weights (~2 GB at INT4)
cactus download google/gemma-4-E2B-it
```

## Run

```bash
agent/.venv/bin/python agent/main.py
```

You'll be prompted:

```
> Press Enter to start recording, Enter again to stop:
```

Press Enter, speak, press Enter again. HAL will respond in the terminal and
out loud.

## What's here

- `config.py` — model name, sample rate, system prompt, weights root
- `cactus_runtime.py` — thin wrapper around the Cactus FFI
- `audio.py` — push-to-talk mic capture (16 kHz int16 PCM)
- `tts.py` — macOS `say`
- `tools.py` — tool schemas (procedure lookup, telemetry, crew health) — all stubs
- `main.py` — the voice loop

## Next steps

- Wire `tools.py` stubs to real data sources (RAG over onboard docs, telemetry
  bus, medical sensors).
- Swap push-to-talk for VAD (`cactus_vad` in the FFI) so HAL listens continuously.
- Add a FastAPI layer if the Next.js client needs to drive the agent.
- Tune the system prompt for the anomaly-triage direction from the root README.
