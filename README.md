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

End-to-end setup takes ~20-30 min, mostly model downloads. Run steps in
order — the server venv in step 4 layers on top of the source-built
Cactus dylib from step 3, and step 5 patches the FFI so it loads that
dylib instead of brew's 1.13 bundled one.

### Prerequisites

- **Apple Silicon Mac** (M1/M2/M3/M4/M5). Cactus ships ARM64-only; Intel
  Macs will fail at `cactus download`.
- **~15 GB free disk**: ~6.4 GB for the Gemma 4 E2B INT4 weights, ~4.7 GB
  for the zip download, ~400 MB for the Qwen3 embedder, plus ~2 GB of
  Python deps in the server venv.
- **HuggingFace account**. The weights we use live at
  [`Cactus-Compute/gemma-4-E2B-it`](https://huggingface.co/Cactus-Compute/gemma-4-E2B-it)
  and are **not gated** — you still need an HF account to authenticate
  the CLI, but no access request is required.
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

- `python@3.12` is required to *build* Cactus from source (step 3).
- `python@3.14` hosts the server's venv.
- `pnpm` drives the Next.js client (repo uses `pnpm-lock.yaml`).
- The `cactus` brew formula provides the CLI we use for `cactus
  download` and the per-user weights directory
  (`/opt/homebrew/opt/cactus/libexec/weights`). The bundled dylib it
  ships is brew-stable 1.13, which predates the Gemma-4 fixes we need —
  we replace it in step 3.

### 2. Clone

```bash
git clone https://github.com/armaanpriyadarshan/hal9000.git
cd hal9000
```

### 3. Build Cactus from source

Brew's `cactus 1.13` dylib predates three Gemma-4 fixes we depend on:
- PR #582 (non-thinking default for Gemma 4)
- PR #588 (audio-input crash on back-to-back voice turns)
- PR #591 (default confidence routing, avoids silent cloud handoff)

All three landed post-v1.14 on `main`. Build from HEAD:

```bash
# Clone Cactus alongside this repo (../cactus is gitignored)
git clone https://github.com/cactus-compute/cactus.git ../cactus
cd ../cactus
python3.12 -m venv venv
source venv/bin/activate
pip install -e python
cactus build --python   # produces cactus/build/libcactus.dylib
deactivate
cd -
```

### 4. Server venv + models

```bash
cd server

# --system-site-packages so the venv sees brew-installed tools; the
# venv's own site-packages still wins for anything we install into it
# (which is how we override brew's cactus.py in step 5).
/opt/homebrew/bin/python3.14 -m venv .venv --system-site-packages
.venv/bin/pip install -r requirements.txt huggingface_hub

# Authenticate with HuggingFace
.venv/bin/hf auth login

# Download pre-packaged Gemma 4 E2B weights (INT4 quantized, Apple
# variant). ~4.7 GB zip, extracts to ~6.4 GB. On Apple Silicon this
# auto-selects the "-apple" zip which ships audio_encoder.mlpackage
# and vision_encoder.mlpackage for ANE acceleration of those encoders.
# NOTE: do not pass --reconvert — it rebuilds from raw Google
# safetensors and gives up the ANE-ready mlpackages.
HF_HUB_ENABLE_HF_TRANSFER=1 cactus download Cactus-Compute/gemma-4-E2B-it

# RAG embedder (~410 MB)
HF_HUB_ENABLE_HF_TRANSFER=1 cactus download Cactus-Compute/Qwen3-Embedding-0.6B

cd ..
```

### 5. Patch the Cactus FFI in the server venv

```bash
bash scripts/patch-cactus-ffi.sh
```

This script does two things:

1. **Symlinks `/opt/homebrew/lib/cactus/build/libcactus.dylib`** to the
   source build from step 3. Requires `sudo` (writes into
   `/opt/homebrew/lib/cactus/`).
2. **Installs the source `cactus.py`** into the server venv's
   site-packages, overriding brew's. Hard-pins `_LIB_PATH` to the
   symlink above, and replaces per-byte `ctypes` PCM marshalling with
   `from_buffer_copy` (the original path unpacks every byte of audio
   as a separate ctypes arg — seconds of pure Python overhead per
   voice turn).

The script is idempotent and verifies the FFI loads correctly at the
end.

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

### 6. Voice (HAL TTS weights)

The HAL voice ONNX weights live outside git (~61 MB). Pulled from
HuggingFace:

```bash
cd voice
../server/.venv/bin/pip install -r requirements.txt  # into server venv
../server/.venv/bin/hf download campwill/HAL-9000-Piper-TTS \
  hal.onnx hal.onnx.json --local-dir .
cd ..
```

If you skip this, the server falls back to macOS `say` and still runs
— you'll just hear macOS's voice instead of HAL's.

### 7. Client (Next.js)

```bash
cd client
pnpm install
cd ..
```

### 8. Run

Two terminals:

```bash
# Terminal 1 — server on :8000 (start first; client health-checks it)
server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000 \
  --app-dir server

# Terminal 2 — client on :3000
cd client && pnpm dev
```

Open http://localhost:3000. Press **Space** to start recording, press
again to stop and send. **Esc** cancels an in-flight turn.

### Startup expectations

Uvicorn binds port 8000, loads the two Cactus handles (chat + embed)
and the Piper ONNX voice, then accepts traffic. Total ~3-5 s on a warm
machine. No blocking warmup pass — the audio/vision encoder
`.mlmodelc` files ship pre-compiled in the Cactus-Compute weights zip,
so first voice turn pays only its own prefill (no Core ML JIT). Watch
for `All models ready.` in the uvicorn log.

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

### Performance expectations

As of 2026-04-18 on an **M2 MacBook Air** (CPU-only LLM path), with
Gemma 4 thinking disabled:

| phase | ms/turn | notes |
|---|---|---|
| RAG embed | 20-50 | top-2 hybrid (embedding + BM25 via RRF) over `corpus/*.md` |
| LLM prefill (TTFT) | ~4 000 | ~1 000 tokens at ~90 tok/s on CPU (system + tools + audio placeholders) |
| LLM decode | 500-4 000 | ~15-20 tok/s on CPU; decode length tracks reply length |
| Piper TTS | 60-500 | Piper ONNX; scales with reply length |
| Gemini cloud (when triggered) | ~600-1 500 | text turns only; see hybrid section below |
| **text turn total** | **~5-8 s** | tool call: ~5 s; RAG-heavy answer: ~8 s |
| **voice turn total** | **~6-10 s** | adds audio-encoder pass (ANE, pre-compiled `.mlmodelc`) |

The server logs `[turn N] timing rag=… llm_total=… ttft=… decode=…
tts=… cloud=… source=local|cloud total=…` per turn for attribution.

**Why it's CPU-bound:** Cactus ships ANE-accelerated encoder
`.mlpackage`s for Gemma 4 but not the LLM main-transformer
`model.mlpackage` — their publisher (`python/src/publish_to_hf.py`)
special-cases Gemma 4 to build only the two encoders. Cactus logs
`[WARN] [npu] [gemma4] model.mlpackage not found; using CPU prefill`
on startup (`model_gemma4.cpp:206`). When Cactus publishes the LLM
mlpackage, prefill should drop significantly (their published M5
numbers with ANE prefill: 660 tok/s).

**Why `reset()` between turns:** Cactus's audio decode path
(`model_gemma4_mm.cpp:decode_multimodal`) skips the prefix-caching
path used by text turns. Back-to-back voice turns without reset
produce empty completions because the new audio's embeddings never
get applied to the cached KV.

### Hybrid cloud fallback (optional)

With `HYBRID_ENABLED=true` in `server/.env`, text turns that hit any
of three triggers hand off to Google's Generative Language API:

- Local confidence below `CONFIDENCE_THRESHOLD` (default 0.7,
  entropy-based per `cactus_complete.cpp:781`)
- Local reply is empty AND no tool calls were emitted
- Every emitted tool call failed schema validation

Default cloud model is `gemini-3.1-flash-lite-preview` (fast, supports
disabling thinking, round-trip ~1 s for typical prompts). Switch to
`gemini-3.1-pro-preview` via the `GEMINI_MODEL` env var if you want
the flagship — note it requires thinking (budget can't be 0), so
round-trip jumps to 2-4 s. Voice turns stay local.

### Troubleshooting

- **Server startup warning `[WARN] [npu] [gemma4] model.mlpackage not
  found`** — expected. That file isn't in the public zip yet. The
  audio + vision encoder `.mlpackage`s next to the weights still go
  to ANE; only LLM prefill falls back to CPU.
- **Turns return `"I am unable to comply with that request, Ethan."`
  immediately (sub-2 s)** — the audio-linger bug has re-surfaced. The
  server falls back to that line when `function_calls` and
  `response_text` are both empty. Confirm `state.llm.reset()` is
  still being called at the top of `run_turn` in `server/server.py`.
- **Turn 1 takes ~3 min** — you booted before warmup finished, or the
  CoreML compile cache was cold. Wait for `All models ready.` in the
  uvicorn log; subsequent turns will be ~40 s on M2 Air.
- **`libcactus.dylib` not found at runtime** — the symlink from
  `scripts/patch-cactus-ffi.sh` is missing. Verify with
  `ls -l /opt/homebrew/lib/cactus/build/libcactus.dylib`.
- **`import cactus` resolves to the brew 1.13 module** — the venv FFI
  shim from step 5 didn't land. Re-run `bash scripts/patch-cactus-ffi.sh`
  and confirm `python -c "import cactus; print(cactus.__file__)"`
  prints a path inside `server/.venv/`.
- **Gemma download hangs** — check `~/.cache/huggingface/` for partial
  files, delete them, retry with `HF_HUB_ENABLE_HF_TRANSFER=1`.
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
