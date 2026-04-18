# HAL 9000

On-device voice agent for deep space missions where cloud AI is physically unreachable.

Built with [Gemma 4](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/) + [Cactus](https://github.com/cactus-compute/cactus) for the [Gemma 4 Voice Agents Hackathon](https://events.ycombinator.com/voice-agents-hackathon26) (YC x Cactus x Google DeepMind, April 18–19 2026).

## The Problem

Six days ago, Artemis II went dark behind the Moon for 40 minutes — a planned blackout, no anomalies. Christina Koch's first words when signal returned: *"It is so great to hear from Earth again."*

Artemis IV, the first crewed lunar landing since Apollo 17, is scheduled for 2028. Astronauts will spend a week on the surface with **3–14 second communication delays** each way. On Mars, a single round-trip message takes **up to 44 minutes**.

NASA has studied this for 20 years and [rated it a red risk](https://humanresearchroadmap.nasa.gov/Risks/risk.aspx?i=105). Their analysis is direct: unanticipated, time-critical anomalies of unknown origin pose a high risk to missions beyond low Earth orbit because they require a small crew to respond rapidly and accurately to complex system failures. They projected real ISS anomalies onto lunar and Mars delay scenarios and concluded: **crews need tools to support more autonomous operations.**

No adequate tool exists today:

- **Cloud AI is unreachable.** You cannot call an API from behind the Moon or from Mars. On-device is not a preference — it is a hard constraint of the environment.
- **Typed interfaces are unusable.** An astronaut in a suit, hands occupied, under stress, cannot type. Existing onboard systems like Space Llama require typed input.
- **Voice is the only viable interface.** This is not a design choice. It is a consequence of the operational environment.

The crew of Artemis IV will be on the lunar surface for a week, functionally alone during every blackout and every delay window, with no intelligent system capable of reasoning through an emergency beside them.

## Why Gemma 4 + Cactus

This problem could not have been solved before this week. Gemma 4 is the first on-device model with native audio understanding — it processes speech directly, recognizes tone, hesitation, and emphasis, and responds in under 300ms on ARM hardware. A 30-second audio clip gets a response in 0.3 seconds. The audio encoder is 50% smaller than its predecessor. It handles ~80% of tasks locally.

Cactus is the runtime that makes this deployable. Zero-copy memory mapping gives 10x lower RAM usage. ARM SIMD kernels are optimized for the exact class of constrained hardware that spacecraft carry. No server, no network, no cloud fallback required.

| Component | Role |
|---|---|
| **Gemma 4 E2B** | 2.3B effective params, 128K context, vision + audio + text + tool use |
| **Gemma 4 E4B** | 4.5B effective params, 128K context, same multimodal capabilities |
| **Cactus Engine** | On-device inference, OpenAI-compatible API, runs any GGUF model |
| **Cactus Kernels** | ARM SIMD optimized for Apple, Snapdragon, Exynos silicon |

### The fit is exact:

- **On-device constraint** — Cactus runs fully local, Gemma 4 is built for edge
- **Voice constraint** — Gemma 4 is the first model with native audio input on-device
- **Real-time constraint** — sub-second response on ARM hardware
- **Resource constraint** — zero-copy inference, minimal RAM footprint

## What We're Building

HAL 9000 is a voice agent that an astronaut can talk to when Mission Control is unreachable. The infrastructure layer — Gemma 4 running on Cactus with voice-first interaction — is the foundation. The application scope is being defined during the hackathon.

Potential directions:

- **Anomaly triage** — voice-driven diagnosis of system failures using onboard technical documentation
- **Procedure assistance** — step-by-step walkthrough of emergency checklists, hands-free
- **System monitoring** — continuous watch over vehicle telemetry with proactive voice alerts
- **Crew decision support** — reasoning through options when ground cannot advise

### Core Constraints

| Constraint | Reason |
|---|---|
| Fully on-device | No network available during lunar blackouts or Mars transit |
| Voice-first interaction | Astronauts cannot type in suits under operational stress |
| Real-time capable | Time-critical anomalies demand immediate response |
| Resource-constrained | Spacecraft compute is limited and power-budgeted |

## Technical Architecture

```
┌─────────────────────────────────────────────┐
│                 HAL 9000                     │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │  Audio    │  │  Gemma 4 │  │   TTS     │  │
│  │  Input    ├──►  E2B/E4B ├──►  Output   │  │
│  │ (native)  │  │ (Cactus) │  │           │  │
│  └──────────┘  └────┬─────┘  └───────────┘  │
│                     │                        │
│              ┌──────┴──────┐                 │
│              │  Tool Use   │                 │
│              │  (function  │                 │
│              │   calling)  │                 │
│              └──────┬──────┘                 │
│                     │                        │
│         ┌───────────┼───────────┐            │
│         ▼           ▼           ▼            │
│  ┌───────────┐ ┌─────────┐ ┌─────────┐      │
│  │ Technical │ │ Vehicle │ │ Crew    │      │
│  │   Docs    │ │ Telemetry│ │ Health  │      │
│  └───────────┘ └─────────┘ └─────────┘      │
│                                              │
│              Zero network dependency         │
└─────────────────────────────────────────────┘
```

## Setup (new Mac, from scratch)

End-to-end setup takes ~45-60 min, mostly model downloads. Run steps in
order — the server venv in step 4 layers on top of the Cactus dylib
built in step 3.

### Prerequisites

- **Apple Silicon Mac** (M1/M2/M3/M4). Cactus ships ARM64-only; Intel
  Macs will fail at `cactus download`.
- **~15 GB free disk** for Gemma 4 E2B conversion + model cache.
- **HuggingFace account** with approved access to
  [`google/gemma-4-E2B-it`](https://huggingface.co/google/gemma-4-E2B-it)
  (gated — request access on the model page and wait for approval
  before starting step 4).
- **Xcode Command Line Tools**:
  ```bash
  xcode-select --install
  ```
- **Homebrew**: https://brew.sh

### 1. System dependencies

```bash
brew install python@3.12 python@3.14 cmake pnpm
brew install cactus-compute/cactus/cactus
```

- `python@3.12` is required to *build* Cactus from source.
- `python@3.14` hosts the server's venv.
- `pnpm` drives the Next.js client (repo uses `pnpm-lock.yaml`).

### 2. Clone

```bash
git clone https://github.com/armaanpriyadarshan/hal9000.git
cd hal9000
```

### 3. Cactus runtime (build from source)

The v1.13 brew release has Gemma 4 audio-input bugs. Build from source
to pick up commit `a875fc3` (fast, crash-free audio-in), then point
the brew-installed `cactus.py` at the fresh `libcactus.dylib`.

```bash
# Clone Cactus alongside this repo (gitignored path ../cactus/ is
# already reserved)
git clone https://github.com/cactus-compute/cactus.git ../cactus
cd ../cactus
python3.12 -m venv venv
source venv/bin/activate
pip install -e python
cactus build --python
deactivate
cd -

# Symlink the freshly-built dylib to where brew's cactus.py looks
mkdir -p /opt/homebrew/lib/cactus/build
ln -sf "$(pwd)/../cactus/cactus/build/libcactus.dylib" \
  /opt/homebrew/lib/cactus/build/libcactus.dylib

# Patch the brew cactus CLI — v1.13 references an undefined
# `model_name` on the --reconvert path
sed -i '' 's/is_vlm = '"'"'vl'"'"' in model_name.lower/model_name = model_id\n    is_vlm = '"'"'vl'"'"' in model_name.lower/' \
  /opt/homebrew/Cellar/cactus/*/libexec/python/src/cli.py
```

### 4. Server (Python 3.14 venv, models, env)

```bash
cd server

# Venv layered over Homebrew python 3.14; --system-site-packages
# lets it see the cactus.py FFI installed in step 3
/opt/homebrew/bin/python3.14 -m venv .venv --system-site-packages
.venv/bin/pip install -r requirements.txt huggingface_hub

# Authenticate with HuggingFace (needed for gated Gemma 4 download)
.venv/bin/hf auth login

# Download + convert Gemma 4 E2B weights — ~15-25 min, ~9 GB fp16
# quantised to ~4.5 GB INT4. --reconvert is required; the
# pre-converted package on HF has missing audio embedding weights.
HF_HUB_ENABLE_HF_TRANSFER=1 cactus download google/gemma-4-E2B-it --reconvert

# Download the RAG embedder (~300 MB, fast)
cactus download Qwen/Qwen3-Embedding-0.6B
```

#### `server/.env` (optional)

Without a `.env` the server runs fully local. To enable cloud
fallback (Gemma 4 26B on Google's Generative Language API when local
confidence dips), create `server/.env`:

```
GEMINI_API_KEY=<your-google-api-key>
GEMINI_MODEL=gemma-4-26b-a4b-it
HYBRID_ENABLED=true
CONFIDENCE_THRESHOLD=0.7
GEMINI_TIMEOUT_S=20
```

Get a key at https://aistudio.google.com/app/apikey. `.env` is
gitignored.

### 5. Voice (HAL TTS weights)

The HAL voice ONNX weights live outside git (~61 MB). Pulled from
HuggingFace:

```bash
cd ../voice
../server/.venv/bin/pip install -r requirements.txt  # into server venv
../server/.venv/bin/hf download campwill/HAL-9000-Piper-TTS \
  hal.onnx hal.onnx.json --local-dir .
cd ..
```

If you skip this, the server falls back to macOS `say` and still runs
— you'll just hear macOS's voice instead of HAL's.

### 6. Client (Next.js)

```bash
cd client
pnpm install
cd ..
```

### 7. Run

Two terminals:

```bash
# Terminal 1 — server on :8000 (start first; client health-checks it)
server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000 \
  --app-dir server

# Terminal 2 — client on :3000
cd client && pnpm dev
```

Open http://localhost:3000. Hold **Space** to talk, **Esc** to cancel.

### Daily workflow after initial setup

```bash
# Terminal 1
server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000 \
  --app-dir server

# Terminal 2
cd client && pnpm dev
```

No venv activation needed — we call the binaries in `.venv/bin/`
directly.

### Troubleshooting

- **`cactus download` fails with model_name undefined** — the patch
  in step 3 didn't apply. Re-run the `sed` command.
- **`libcactus.dylib` not found at runtime** — the symlink in step 3
  is missing or points nowhere. Verify with
  `ls -l /opt/homebrew/lib/cactus/build/libcactus.dylib`.
- **Gemma download hangs** — check `~/.cache/huggingface/` for partial
  files, delete them, retry with `HF_HUB_ENABLE_HF_TRANSFER=1`.
- **Audio input crashes or returns garbled replies** — you're on the
  brew cactus dylib, not the source build. Re-run step 3's symlink.
- **First server startup is slow** — it builds the RAG index from
  `server/corpus/*.md` and caches to `corpus/data.bin`. Subsequent
  starts skip this.
- **Client shows "server unreachable"** — the FastAPI server isn't up
  on :8000 yet, or it's still initialising (watch the uvicorn log for
  `Application startup complete`).
- **Intel Mac** — won't work; Cactus is Apple-Silicon only.

## Team

TBD

## License

TBD
