# HAL 9000 Server

HTTP bridge for the Next.js client. Gemma 4 E2B handles chat with
native audio-in; Qwen3-Embedding-0.6B drives RAG retrieval against
`corpus/`; Kokoro-82M synthesises the reply voice. All three run
locally through Cactus, on CPU.

## Requirements

- Apple Silicon macOS with Homebrew
- Python 3.12 (`brew install python@3.12`) to build Cactus from source
- HuggingFace account + access to `google/gemma-4-E2B-it`
- ~10 GB free disk during model conversion

## One-time setup

```bash
# 1. Install Cactus CLI + Python FFI
brew install cactus-compute/cactus/cactus

# 2. Build Cactus from source to pick up the Gemma4 fixes (commit a875fc3)
#    that aren't in the v1.13 brew release yet. This produces a
#    libcactus.dylib with fast, crash-free audio-in.
git clone https://github.com/cactus-compute/cactus.git ../cactus
cd ../cactus
python3.12 -m venv venv
source venv/bin/activate
pip install -e python
cactus build --python
deactivate
cd -

# 3. Point the Homebrew-shipped cactus.py at the freshly-built dylib
mkdir -p /opt/homebrew/lib/cactus/build
ln -sf "$(pwd)/../cactus/cactus/build/libcactus.dylib" \
  /opt/homebrew/lib/cactus/build/libcactus.dylib

# 4. Patch the brew cactus CLI's cmd_download (v1.13 references an
#    undefined `model_name` on the --reconvert path)
sed -i '' 's/is_vlm = '"'"'vl'"'"' in model_name.lower/model_name = model_id\n    is_vlm = '"'"'vl'"'"' in model_name.lower/' \
  /opt/homebrew/Cellar/cactus/*/libexec/python/src/cli.py

# 5. Create the server's own venv layered over Homebrew's python 3.14
cd server
/opt/homebrew/bin/python3.14 -m venv .venv --system-site-packages
.venv/bin/pip install -r requirements.txt huggingface_hub

# 6. Authenticate with HuggingFace
.venv/bin/hf auth login

# 7. Download + convert Gemma 4 E2B weights
#    (the pre-converted INT4 package has missing audio embedding weights
#    that break audio-in, so we force a fresh convert from the source.)
HF_HUB_ENABLE_HF_TRANSFER=1 cactus download google/gemma-4-E2B-it --reconvert

# 8. Download the embedder (small and fast)
cactus download Qwen/Qwen3-Embedding-0.6B

# 9. Install the voice TTS deps (Kokoro lives under voice/)
cd ../voice
/opt/homebrew/bin/python3.14 -m pip install -r requirements.txt \
  --target "$(pwd)/../server/.venv/lib/python3.14/site-packages"
```

Step 7 takes ~15-25 min (downloads ~9 GB fp16, quantises to INT4).
Coffee break.

## Run

```bash
server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000
```

Hit the Next.js client at `http://localhost:3000` — Space to talk,
Esc to cancel.

## Endpoints

| Method | Path         | Purpose |
|--------|--------------|---------|
| GET    | `/api/health`| model + turn info |
| POST   | `/api/text`  | `{"text": "..."}` → JSON with reply + base64 WAV |
| POST   | `/api/voice` | raw int16 LE 16 kHz mono PCM → same reply JSON |
| POST   | `/api/reset` | clears the conversation |

## What's here

| File                 | Role |
|----------------------|------|
| `server.py`          | FastAPI app + per-turn pipeline |
| `config.py`          | model names, weights dir, system prompt, completion options |
| `cactus_runtime.py`  | `CactusSession` wrapper around the Cactus FFI |
| `rag.py`             | `EmbedRagIndex` + `build_context_block` (Qwen3-embed driven retrieval) |
| `tts.py`             | `synth_wav_bytes` / `_base64` — Kokoro primary, macOS `say` fallback |
| `corpus/`            | 35 markdown reference files for RAG (ammonia, emergencies, systems, ops) |
| `requirements.txt`   | fastapi, uvicorn, kokoro-onnx |

## Known issues

- Gemma 4 main transformer runs on CPU — `model.mlpackage` for NPU
  acceleration isn't shipped by Cactus yet. Turn time on a small
  reply is ~1-5 s end-to-end after the fixes; longer replies scale
  with decode tokens.
- RAG retrieval quality is moderate. Qwen3-Embedding gives correct
  top-k ranking for most queries; absolute cosine scores stay low,
  which we work around by not filtering on `min_score`.
- Voice turns don't get the user's transcript into RAG (we feed raw
  PCM to Gemma). The system uses the last assistant reply as a
  topical hint for retrieval on follow-up turns.
