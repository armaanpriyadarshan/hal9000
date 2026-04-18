# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HAL 9000 is an on-device voice agent for deep-space missions. Gemma 4 E2B runs locally via Cactus and handles chat, tool-calling, and native audio-in through its multimodal conformer. Qwen3-Embedding-0.6B drives RAG retrieval; Piper does TTS. An optional hybrid fallback routes low-confidence turns to a Gemini model via Cactus's built-in cloud handoff (proxy at `https://104.198.76.3/api/v1`). Next.js 16 3D client. Full setup from scratch is in `README.md`; subsystem details are in `server/README.md`, `voice/README.md`, and `client/AGENTS.md`.

## Running locally

After one-time setup, dev usage is two processes:

```bash
# server on :8000 (start first — client health-checks it)
server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000 --app-dir server

# client on :3000
cd client && pnpm dev
```

Do **not** activate the venv — invoke binaries in `server/.venv/bin/` directly. The venv is layered over Homebrew's Python 3.14 with `--system-site-packages` so it can see the Cactus FFI built separately in `../cactus/`.

## Tests

```bash
server/.venv/bin/pytest server/tests                    # all server tests
server/.venv/bin/pytest server/tests/test_tools.py      # single file
server/.venv/bin/pytest server/tests -k "name_fragment" # single test
cd client && pnpm lint                                  # client
```

No client test suite exists yet.

## Architecture

Two local Cactus models plus Piper ONNX, all CPU, all proxied through the FastAPI server. The client never loads a model directly.

```
browser (mic, 3D)  ──HTTP──▶  FastAPI  ──FFI──▶  Cactus dylib
                                                    ├─ Gemma 4 E2B (chat + native audio-in + tools)
                                                    ├─ Qwen3-Embedding-0.6B (RAG)
                                                    └─ auto_handoff ──HTTPS──▶  Cactus proxy (104.198.76.3) → Gemini
                      ONNX──▶  Piper (HAL voice TTS)
```

### Per-turn pipeline (`server/server.py`)

1. `/api/voice` takes raw int16 LE 16 kHz mono PCM; `/api/text` takes a string. Both land in `run_turn()`. Voice turns pass PCM through `CactusSession.complete(pcm_data=...)` straight into Gemma 4 E2B's audio encoder — no separate STT.
2. RAG: `EmbedRagIndex` (`server/rag.py`) retrieves top-k chunks from `server/corpus/*.md` via `cactus_rag_query` (hybrid embedding + BM25, fused with RRF, the same retrieval Cactus's auto-RAG uses internally). On voice turns the user's transcript isn't available for retrieval, so the last assistant reply is used as a topical hint — voice turn 1 retrieves nothing, later voice turns drift with HAL's prior reply rather than the crew's current question. Retrieved chunks are injected into the system prompt for that turn only — they do not persist into conversation memory.
3. KV cache is reset before every turn. Text turns could in principle reuse Cactus's smart prefix caching; voice turns can't (`decode_multimodal` in `model_gemma4_mm.cpp:252` skips `do_prefill` and doesn't re-apply fresh audio features when the prefix matches), so the reset is needed for voice and we apply it uniformly for consistency.
4. `CactusSession.complete()` (`server/cactus_runtime.py`) runs Gemma 4 E2B with `enable_thinking_if_supported=False` (thinking-on adds hundreds of CoT tokens; disabling cuts turn time ~8x, tool-calling still works). `auto_handoff=True` lets Cactus fire a parallel cloud request during local decode when rolling confidence drops below `confidence_threshold` (default 0.7 — entropy-based, `cactus_complete.cpp:781`) and swap the cloud reply in if it arrives within `cloud_timeout_ms`.
5. Tool calls are dispatched by `server/tools.py` and returned to the client as `client_directives` for the 3D scene. Gemma occasionally emits plain-text `name(arg="v")` instead of the proper token format — `_parse_inline_tool_call` in `server.py` recovers these.
6. Hybrid fallback: Cactus's built-in `auto_handoff` routes low-confidence turns through the Cactus-Compute proxy at `https://104.198.76.3/api/v1`, which in turn calls a Gemini model (default `gemini-3.1-flash-lite-preview` — ~1 s roundtrip; set `CACTUS_CLOUD_MODEL=gemini-3.1-pro-preview` in `server/.env` for the flagship at ~2 s). Auth uses the `CACTUS_CLOUD_KEY` env var (loaded from `server/.env` at import time by `python-dotenv`, picked up by the C engine via `getenv()`). Response carries `cloud_handoff: true` when the cloud path won; `server.py` exposes this as a `source: "local"|"cloud"` field.
7. TTS: `server/tts.py` calls the Piper ONNX voice in `voice/` (imports `hal_tts`). If `voice/hal.onnx` isn't present, falls back to macOS `say`.
8. Per-turn timing is logged as one line — `rag=… llm_total=… ttft=… decode=… tts=… [cloud=…] source=local|cloud total=…`. Useful when chasing latency regressions.

### Client

Next.js 16 App Router. Two pages:

- `client/src/app/page.tsx` — interior view (ISS interior GLB, camera teleport between modules).
- `client/src/app/exterior/page.tsx` — exterior view (ISS model, parts highlight).

Shared lib:
- `client/src/lib/halTools.ts` — executes `client_directives` (`set_view`, `navigate_to`, `highlight_part`) returned from the server.
- `client/src/lib/halAudio.ts` — mic capture + base64 WAV playback.
- `client/src/lib/shipParts.ts`, `interiorAreas.ts` — canonical part/area names matching the server's tool schema in `config.py`.

The set of accepted tool arguments (module names, ship parts) is defined in `server/config.py`'s `SYSTEM_PROMPT` and `server/tools.py`'s `TOOL_SPECS`; mirrored in `client/src/lib/*`. Changes must stay in sync on both sides.

### Cactus FFI wiring

`cactus.py` (the Python FFI) is installed into the server venv by `scripts/patch-cactus-ffi.sh`, which also symlinks `/opt/homebrew/lib/cactus/build/libcactus.dylib` to the source build at `../cactus/cactus/build/libcactus.dylib` (note: the cactus checkout lives next to this repo, gitignored). Source build tracks upstream `main` post-v1.14 — gets Gemma 4 tool-calling + RoPE fixes.

## Performance snapshot (2026-04-18, M2 MacBook Air)

Text turn tool call: ~5 s total (ttft ~4 s prefill, decode ~1 s).
Text turn RAG-heavy answer: ~8 s total.
Voice turn: ~6-10 s total (audio encoder on ANE adds ~1 s before prefill).
Cloud handoff (Gemini 3.1 flash-lite): ~1 s added when triggered.

The wall is LLM prefill running on CPU. Cactus ships ANE encoders but not the LLM `model.mlpackage` for Gemma 4 — their publisher (`python/src/publish_to_hf.py:56-84`) special-cases Gemma 4 to build only the two encoder packages. When upstream publishes the LLM mlpackage, prefill should drop significantly (M5 reference: 660 tok/s vs. our 90 on CPU).

## Conventions

- **No venv activation in scripts or docs** — always call `server/.venv/bin/<tool>` directly.
- **Secrets and weights are per-machine**, gitignored: `server/.env`, `voice/hal.onnx{,.json}`, `weights/`, `server/corpus/*.bin` (RAG index cache, regenerates on first run).
- **`cactus/` at the repo root is gitignored** — a local checkout of the upstream Cactus repo lives at `../cactus` (sibling path per the source-build flow), not a submodule.
- **Client is Next.js 16 with breaking changes from prior versions** (see `client/AGENTS.md`). Consult `client/node_modules/next/dist/docs/` before writing Next.js code; don't rely on training data.
- **Commit message style**: imperative sentence, no `feat:` prefix, no trailing period (see `git log`).
