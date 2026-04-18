# HAL 9000 Server

HTTP bridge for the Next.js client. Gemma 4 E2B handles chat with
native audio-in; Qwen3-Embedding-0.6B drives RAG retrieval against
`corpus/`; a Piper voice (pre-trained HAL from HF) synthesises the reply. All three run
locally through Cactus, on CPU.

## Requirements

See the repo-root README for full from-scratch setup. Short version:

- Apple Silicon macOS with Homebrew
- Python 3.12 (to build Cactus) and 3.14 (for the server venv)
- HuggingFace account (no gated-model access required — we pull
  `Cactus-Compute/gemma-4-E2B-it`, which is public)
- ~15 GB free disk

## One-time setup

All steps live in the root `README.md`. Abridged:

1. `brew install cactus-compute/cactus/cactus python@3.12 python@3.14 cmake pnpm`
2. Clone Cactus to `../cactus`; build the dylib from source
   (post-v1.14 on `main`) for the non-thinking-default + audio-crash
   + default-confidence fixes.
3. `python3.14 -m venv server/.venv --system-site-packages`
4. `server/.venv/bin/pip install -r server/requirements.txt huggingface_hub`
5. `server/.venv/bin/hf auth login`
6. `HF_HUB_ENABLE_HF_TRANSFER=1 cactus download Cactus-Compute/gemma-4-E2B-it`
   — NO `--reconvert`; that gives up the Apple `.mlpackage` encoders.
7. `HF_HUB_ENABLE_HF_TRANSFER=1 cactus download Cactus-Compute/Qwen3-Embedding-0.6B`
8. `bash scripts/patch-cactus-ffi.sh` — symlinks our source dylib and
   overrides the brew `cactus.py` inside the server venv (so
   `_LIB_PATH` is pinned and PCM marshalling uses `from_buffer_copy`).
9. Piper HAL voice weights: `cd voice && ../server/.venv/bin/hf download
   campwill/HAL-9000-Piper-TTS hal.onnx hal.onnx.json --local-dir .`

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
| `tts.py`             | `synth_wav_bytes` / `_base64` — Piper primary (voice/hal.onnx), macOS `say` fallback |
| `corpus/`            | 35 markdown reference files for RAG (ammonia, emergencies, systems, ops) |
| `requirements.txt`   | fastapi, uvicorn, piper-tts, onnxruntime, soundfile |

## Known issues

- **LLM main-transformer runs on CPU.** Cactus's Apple-variant zip
  (`gemma-4-e2b-it-int4-apple.zip`) ships
  `audio_encoder.mlpackage` + `vision_encoder.mlpackage` (both
  pre-compiled to `.mlmodelc` in the same folder, so no runtime Core ML
  compile), but **not** the LLM `model.mlpackage`. Cactus's publisher
  (`publish_to_hf.py:56-84`) special-cases Gemma 4 to build only the two
  encoder packages; the main-transformer path through `cactus-pro` is
  in a private repo we don't have. Cactus logs
  `[WARN] [npu] [gemma4] model.mlpackage not found; using CPU prefill`
  at startup (`model_gemma4.cpp:206`). Post-thinking-off turn times on
  an M2 MacBook Air: ~5-8 s for a text turn, ~6-10 s for a voice turn
  (both CPU-bound on prefill; decode is sub-second for short replies).
- **KV cache resets between voice turns.** Smart prompt caching (which
  would normally let turn N skip re-prefilling the system prompt +
  tool schema) requires us to NOT call `state.llm.reset()`. We tested
  that: back-to-back voice turns then return empty completions because
  Cactus's audio path (`decode_with_audio` → `decode_multimodal` in
  `model_gemma4_mm.cpp:252`) skips `do_prefill` entirely and treats
  second-turn `<|audio|>` placeholder tokens as plain text without
  re-applying the new `audio_features` tensor. So we keep the reset
  and pay full prefill per voice turn until Cactus fixes that path.
- **RAG retrieval quality is moderate.** Qwen3-Embedding gives correct
  top-k ranking for most queries; absolute cosine scores stay low, so
  we rely on top-k ordering alone rather than applying a score floor.
- **Voice turns don't get the user's transcript into RAG** (we feed raw
  PCM to Gemma). The system uses the last assistant reply as a
  topical hint for retrieval on follow-up turns. Consequences:
  (a) voice turn 1 retrieves nothing — no prior reply to query on;
  (b) subsequent voice turns drift with what HAL last said rather
  than what the crew is currently asking. Cactus's auto-RAG skips
  retrieval entirely on empty user content (`cactus_complete.cpp:46`
  — `extract_last_user_query` returns empty → `inject_rag_context`
  returns early); we chose to inject a topical hint rather than
  nothing. Revisit when a lightweight STT is wired in.
- **Cloud fallback uses Cactus's built-in `auto_handoff`.** When rolling
  confidence drops below `COMPLETION_OPTIONS["confidence_threshold"]`,
  Cactus fires a parallel cloud request to its proxy at
  `https://104.198.76.3/api/v1`, which routes to Gemini. Model selected
  by `CACTUS_CLOUD_MODEL` env var (default `gemini-3.1-pro-preview`).
  Auth via `CACTUS_CLOUD_KEY`. See `cactus_complete.cpp:780-948` for
  the trigger/join logic. Response shape carries `cloud_handoff: bool`
  which `server.py` maps to a `source: "local"|"cloud"` field. Disable
  entirely by flipping `auto_handoff: False` in `config.py`.
