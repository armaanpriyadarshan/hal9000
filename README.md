# HAL 9000

On-device voice agent for deep-space missions. Gemma 4 E2B runs locally
via Cactus with native audio-in; Gemini 3 Flash Preview via Cactus's
cloud proxy handles most turns when a network is up. A physics-based
ISS simulator drives a world-model HAL reasons over, and a background
Observer-Reasoner-Actor loop lets HAL speak proactively when the sim
drifts off-nominal. 3D Next.js client. Zero cloud dependency by design.

Built for the [Gemma 4 Voice Agents Hackathon](https://events.ycombinator.com/voice-agents-hackathon26) — YC × Cactus × Google DeepMind, April 18–19 2026.

## Problem

Artemis IV crews will spend a week on the Moon with 3–14 s comms
delays each way; Mars round-trip is up to 44 minutes. NASA's
[risk register](https://humanresearchroadmap.nasa.gov/Risks/risk.aspx?i=105)
rates unanticipated, time-critical anomalies a red risk beyond LEO
because a small crew must respond rapidly, alone, with **no usable AI
assistant onboard**. Existing systems like Space Llama require typed
input — unusable in suits under stress. Cloud AI is physically
unreachable behind the Moon. Voice-first on-device is the only
viable interface, and until Gemma 4 it wasn't possible.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Chat LLM (local) | Gemma 4 E2B INT4 via Cactus | First on-device model with native audio-in — no separate STT; 128K context; tool use |
| Chat LLM (cloud) | Gemini 3 Flash Preview via Cactus proxy | ~2-3 s roundtrip; thinking-off supported; correctly identifies proper nouns (Kibo) where flash-lite confidently mishears |
| Embedding | Qwen3-Embedding-0.6B via second Cactus handle | Decouples RAG from chat; hybrid embed+BM25 fused via RRF |
| TTS | Piper ONNX (pre-trained HAL-9000 voice) | On-device, deterministic, macOS `say` fallback |
| FFI runtime | Cactus source build (post-v1.14) + patched `cactus.py` | Needs Gemma-4 non-thinking default (#582), audio-crash fix (#588), default confidence routing (#591) |
| Server | FastAPI 0.115, uvicorn, Python 3.14 | Async background tasks for the sim + ORA loop |
| Client | Next.js 16 (App Router) + React Three Fiber | Two 3D scenes (ISS interior/exterior), URL-param-driven camera |

## Runtime topology

```
┌────────────────────────────────────────────────────────────────┐
│ browser ── HTTP ──▶ FastAPI ─┬─▶ Cactus proxy ──▶ Gemini 3     │
│   mic, 3D          server    │      (cloud)        Flash       │
│   TTS playback               │                     Preview     │
│   SSE subscriber             ├─▶ Cactus FFI ──────▶ Gemma 4 E2B│
│   useIssLightstreamer        │      (local)        chat+audio  │
│   useHalAlerts               │                                 │
│                              ├─▶ Cactus FFI ──────▶ Qwen3-emb  │
│                              │                      RAG+BM25   │
│                              ├─▶ Piper ONNX ──────▶ HAL voice  │
│                              │                                 │
│                              ├── 1 Hz task: ShipState.tick()   │
│                              │      (15-channel ECLSS ODEs)    │
│                              │                                 │
│                              └── 1 Hz task: ORA loop           │
│                                     Observer→Reasoner→Actor    │
│                                     → SSE broadcast to client  │
└────────────────────────────────────────────────────────────────┘
```

## Key design decisions

- **Cloud-first with graceful local fallback.** When `CLOUD_FIRST=true`, every turn hits the Cactus proxy first; local Gemma only runs if the proxy times out / fails. Matches the deep-space story: cloud when connected, on-device when not. Setting is per-deployment via `server/.env`.
- **KV cache reset every turn.** Required for voice: `model_gemma4_mm.cpp::decode_multimodal` skips prefill on prefix-cache hits and silently drops new audio features, producing empty completions on back-to-back voice turns. Applied uniformly for consistency.
- **Thinking off.** `enable_thinking_if_supported=False` cuts local turn time ~8×; tool-calling still works (verified against `cactus-compute/cactus tests/test_gemma4_thinking.cpp`).
- **Tool calls are one-shot.** No tool-result-back-to-LLM loop. HAL gets ship state via system-prompt injection, not via a `get_telemetry` tool call. Same pattern for RAG.
- **Two 1 Hz background tasks.** `telemetry.py::run_loop` integrates the ship ODEs; `ora.py::ora_loop` scans state, gates through the cloud LLM, broadcasts alerts. Both owned by the FastAPI lifespan.
- **Gemini native function-calling bypassed.** The Cactus proxy is model-agnostic (flat text prompt in, text out). Tool schemas are serialised into the prompt with a 5-rule output contract; replies parsed with defensive regex.
- **Two telemetry streams coexist.** Client's `useIssLightstreamer` pulls real NASA PUIs for ambient HUD; HAL's server-side `ShipState` is the private, injectable world-model. Strategy C (split truth); Strategy B (HUD-switches-on-anomaly) is a post-hackathon polish.

## Server architecture

### Per-turn pipeline (`server/server.py::run_turn`)

1. User input appended to `state.messages` (voice turns push empty content; Gemma reads PCM directly).
2. `messages_with_context()` rebuilds the system prompt: `[Live Ship Telemetry]` + `[Retrieved Context]` + baseline `SYSTEM_PROMPT`. Persisted history stays clean.
3. `state.llm.reset()` — required for back-to-back voice turns (see above).
4. Route: `CLOUD_FIRST` → `cactus_proxy.complete()` first; fall back to `state.llm.complete()` on network/timeout/HTTP error.
5. Tool-call recovery: `_parse_inline_tool_call` handles Gemma's plain-text `name(arg="v")` fallback; `_TRAILING_TOOL_CALL_RE` strips Gemini's prose-then-JSON bleedthrough; `_repair_cactus_json` re-quotes Gemma's unquoted string values.
6. `tools.dispatch()` validates against JSON Schema → `ack_text` (TTS) + `client_directives` (scene) + `failed_calls`.
7. Spoken ack stored as assistant turn. Raw tool-call tokens never stored — they confuse Gemma on follow-ups without matching tool-result messages.
8. `synth_wav_base64()` → Piper (or macOS `say`). Timing log: `rag=… llm_total=… ttft=… decode=… tts=… source=local|cloud total=…`.

### Telemetry simulator (`server/telemetry.py`, `server/anomalies.py`)

15-channel physics sim, forward-Euler at 1 Hz. Isothermal ideal-gas
mass balance on a `V=916 m³`, `T=295 K` cabin drives the ECLSS
channels; TCS/EPS/GN&C are first-order approximations. Orbit clock is
demo-accelerated to **3 min daylight / 2 min eclipse** so battery SoC
visibly swings on stage. Nominals from ISS Reference Guide
NP-2015-05-022-JSC, OCHMO-TB-003/004, Gatens et al. NTRS 20180006142.

State vector:

| Subsystem | Channels |
|---|---|
| ECLSS atmosphere | `p_total_kpa` (101.3), `pp_o2_kpa` (21.3), `pp_co2_kpa` (0.40), `pp_n2_kpa` (79.6), `cabin_t_c` (22.5), `cabin_rh_pct` (50) |
| ECLSS equipment | `oga_o2_rate_kg_day` (5.4), `cdra_removal_kg_day` (6.0) |
| TCS external | `loop_a_nh3_t_c` (2.8), `loop_b_nh3_t_c` (2.8), `ata_a_pressure_mpa` (2.62) |
| EPS | `array_current_a` (200/0), `battery_soc_pct` (60-100), `sarj_motor_current_a` (0.15) |
| GN&C | `cmg_momentum_frac` (0-1) |

Core coupling:

```
d(pp_i)/dt  =  (m_dot_in - m_dot_out - leak·frac_i) · (RT/VM_i)
# crew forcing: 0.84 kg O2/person/day consumed, 1.00 kg CO2/person/day produced
# ACS bang-bang: +2× OGA makeup when pp_o2 < 20.5 kPa
```

Seven injectable anomalies — each is a parameter modifier on
`ShipParams`, not a special case in the integrator:

| Name | Severity | Module | Mechanism |
|---|---|---|---|
| `slow_o2_leak` | caution | main_modules | `leak_rate_kg_s` from `kpa_per_min` — demo default **1.0**; pO₂ crosses 20.5 kPa ACS trigger in ~48 s |
| `cdra_regen_fail` | caution | tranquility | `cdra_efficiency=0` + `cdra_bleed_kg_s=0.05` — simulates regen-valve backflow; pCO₂ crosses caution (0.53 kPa) in ~45 s, warning (0.70) in ~2 min |
| `ammonia_loop_leak` | warning | s0_truss | `nh3_leak_kg_s` default **0.05** — ATA pressure crosses 2.40 MPa threshold in ~30 s |
| `sarj_bearing_drift` | advisory | s0_truss | additive `sarj_extra_current_a` (0.5 A, instant; fires `threshold:sarj_current_high`) |
| `cmg_saturation` | caution | — | writes `cmg_momentum_frac` directly (default 0.88, fires `threshold:cmg_saturation`) |
| `iatcs_mtl_pump_fail` | warning | destiny | `mtl_pump_health=0` + 0.1 °C/s cabin-temp drift; overtemp in ~55 s |
| `sabatier_catalyst_cool` | advisory | tranquility | `sabatier_health` (flag only; no direct state effect in Phase 0 sim) |

Defaults are **demo-paced** (~10–75× faster than realistic on-orbit
dynamics) so threshold crossings land in under a minute on stage.
Every anomaly accepts keyword overrides (`kpa_per_min`, `bleed_kg_s`,
`rate_kg_s`, `extra_current_a`, `health`) for realistic-pace runs.

Fire / rapid-depress / toxic-atmosphere aren't in the injector table
— those either fire from ORA threshold rules on physical state
(`threshold:rapid_depress` watches dP/dt) or are operator-fired as
Class 1 scenario buttons from `/ops` (canned text + module,
bypassing the gate for zero-latency hull-breach announcements).

### ORA loop — proactive speech (`server/observer.py`, `server/ora.py`)

```
ShipState ──▶ Observer ──▶ AlertEvent
  (1 Hz)         │
                 ▼
           Reasoner (gate)
           canned_text? ──yes──▶ use verbatim (emergency fast-path)
             │no
             ▼
           Flash-3: "ALERT: <line>" | "SILENT: <reason>"
             │alert
             ▼
           Actor
           ├─ Piper TTS → base64 WAV
           ├─ broadcast → SSE subscribers
           └─ on_alert → append to state.messages
```

**Observer.** Two event sources: (1) active anomalies (from operator
injection, carrying declared severity + module); (2) ten deterministic
threshold rules checked each scan:

| Event | Severity | Condition | Canned |
|---|---|---|---|
| `threshold:rapid_depress` | emergency | dP/dt < −0.1 kPa/min | ✓ |
| `threshold:po2_critical` | emergency | pO₂ < 15 kPa | ✓ |
| `threshold:pco2_warning` | warning | pCO₂ > 0.70 kPa | ✓ |
| `threshold:cabin_overtemp` | warning | T > 28 °C | ✓ |
| `threshold:battery_low` | warning | SoC < 25 % | ✓ |
| `threshold:ata_pressure_low` | warning | ATA A < 2.40 MPa | ✓ |
| `threshold:pco2_caution` | caution | pCO₂ > 0.53 kPa | ✓ |
| `threshold:po2_low` | caution | pO₂ < 20.5 kPa | ✓ |
| `threshold:cmg_saturation` | caution | momentum > 85 % | ✓ |
| `threshold:sarj_current_high` | advisory | drive > 0.5 A | — |

Every warning + caution rule carries canned text so a flaky cloud
proxy cannot silence an actual anomaly. Advisory-tier sub-alarm
drift stays uncanned — noise during proxy outage is worse than
silence at that severity. Per-event **60 s cooldown**;
`reset_cooldowns()` between rehearsals.

**Reasoner.** For uncanned events, calls `cactus_proxy.complete` with a
short gate prompt demanding `ALERT: <line>` or `SILENT: <reason>`.
`_run_gate` returns one of three verdicts: `alert` (approve speak),
`silent` (proxy reasoned silent — respect it), `unreachable` (timeout
/ network / HTTP error). For non-advisory severities, `unreachable`
falls back to the observer's `event.summary` so HAL still informs the
crew when the gate is down. Advisory + `unreachable` still maps to
silent. Gate latency ~2-3 s on `gemini-3-flash-preview`.

**Actor.** Piper TTS (async-offloaded), broadcast to every SSE
subscriber, inject spoken line as assistant turn so follow-ups
("what procedure?") see the interruption in context.

**SSE wire format** — every alert is one JSON frame on
`GET /api/alerts/stream`:

```json
{"event_id":"threshold:po2_low","name":"po2_low","severity":"caution",
 "module":"tranquility","text":"Commander, pO2 is at 20.4 kPa…",
 "audio_b64":"UklGRi4…","source":"threshold","timestamp":1745000000.0,
 "gate":"llm"}
```

### Retrieval (`server/rag.py`)

Second Cactus handle on `Qwen3-Embedding-0.6B`, separate from chat so
LLM swaps don't rebuild the index. `cactus_rag_query` returns top-k
chunks via hybrid embedding + BM25 fused with RRF. Chunks capped at
1400 chars and prepended to the system prompt as
`[Retrieved Context…]`. Top-k ranking only — Qwen3 cosines on this
corpus are modestly low; score-floor filtering is counterproductive.

**Voice-turn limitation:** no transcript, so the last assistant reply
is the topical hint. Voice turn 1 retrieves nothing; subsequent voice
turns drift with HAL's prior reply rather than the crew's current
question.

### Cloud proxy (`server/cactus_proxy.py`)

POST to Cactus's proxy at `https://104.198.76.3/api/v1/{text,omni}`
with history + tool schemas + optional base64 WAV. Proxy routes to a
Gemini model via `CACTUS_CLOUD_MODEL` (default
`gemini-3-flash-preview`). SSL verify off by default — the endpoint is
a raw IP with no hostname.

Tool use is prompt-engineered, not native Gemini. The `_build_prompt`
output contract:

```
1) Never include role prefixes like 'assistant:' or 'HAL:'.
2) Never include markdown/code fences/backticks.
3) Return only the final assistant answer text unless a tool call is required.
4) If a tool call is required, return ONLY JSON:
   [{"name":"tool_name","arguments":{"arg":"value"}}]
5) Do not include any prose before or after that JSON tool-call output.
```

Plus an **identity anchor** (HAL never role-plays Armaan / Ethan /
Samarjit) and a **no-guess rule** (ambiguous audio → ask, don't
tool-call on a guess; prevents flash-lite's "Kibo → cupola" confident
mishear).

Defensive parsing: `_TRAILING_TOOL_CALL_RE` strips prose-then-JSON
bleedthrough; a bare-array fallback handles whole-reply-is-JSON;
`_repair_cactus_json` re-quotes Gemma's unquoted string values
(`{"part":solar_arrays}`).

Voice turns send PCM straight to `/omni` — flash-preview's native audio
encoder handles ASR + reasoning in one pass, more accurate on domain
proper nouns (Kibo, Tranquility) than splitting ASR via Cactus's
standalone `/transcribe`. When `DEBUG_TRANSCRIBE=true` in `server/.env`,
voice turns also fire `/transcribe` in a background thread and log
`[turn N] debug_transcript='…'` so operators can see what the ASR
heard. The debug transcript **never** feeds into RAG or the prompt —
pure diagnostic. `apply_mishear_fixups` in `cactus_proxy.py` patches
known phonetic collisions (`tboly → tranquility`, `q-ville → cupola`);
grow the table as new mishears appear in logs. Cloud call timeout is
25 s (up from 15 after observing flash-preview thinking budget on
longer turns).

### Cactus FFI wiring (`scripts/patch-cactus-ffi.sh`)

Brew's `cactus 1.13` dylib predates #582/#588/#591 (all post-v1.14 on
`main`). The patch script symlinks the source-built dylib and installs
a patched `cactus.py` into `server/.venv/` that (a) hard-pins
`_LIB_PATH` to the symlink and (b) replaces per-byte `ctypes` PCM
marshalling with `from_buffer_copy` — the stock path adds seconds of
pure-Python overhead per voice turn.

## Client architecture

Next.js 16 App Router + React Three Fiber. Two scene routes,
camera-driven with URL-search-param state.

| File | Role |
|---|---|
| `app/page.tsx` → `ISSInteriorScene` | `?area=<module>` teleports camera to named GLB node. 10 canonical modules in `lib/interiorAreas.ts`. |
| `app/exterior/page.tsx` → `ISSExteriorScene` | `?highlight=<part>` Fresnel-shader-swaps matched meshes. 7 parts in `lib/shipParts.ts`. |
| `lib/halTools.ts::executeClientDirectives` | Dispatches server's `client_directives` (`set_view`, `highlight_part`, `navigate_to`) by updating URL. |
| `lib/halAudio.ts` | `MediaRecorder` mic capture, `AudioContext.decodeAudioData()` reply playback, `AnalyserNode` → visualizer ring. |
| `lib/halVisualizer.ts` | Canvas HAL eye + audio-reactive ring; 5 phases (idle/ready/recording/thinking/speaking). Animates for **both** Q&A replies *and* proactive alerts — alert audio is routed through HalVoice's singleton AudioContext + analyser via the `hal-alert-audio` CustomEvent bus. |
| `hooks/useIssLightstreamer.ts` | Real NASA Lightstreamer PUIs for ambient HUD. |
| `hooks/useHalAlerts.ts` | SSE subscriber. Dispatches `hal-alert-audio` CustomEvent so HalVoice plays through its singleton AudioContext + analyser (visualizer animates during proactive alerts). Optionally auto-focuses scene on `alert.module`. Exposes `lastAlert` + bounded `alertHistory`; accepts `mute` / `historyLimit` options. |
| `components/HalAlertHud.tsx` | Top-center banner (clear of HAL's visualizer at the bottom). Severity-aware: Class 1 emergencies get warm-red border + glow + "PRIORITY" + ISS threat name (`RAPID DEPRESS`, `ATMOSPHERE · O2 DEPLETION`). Class 2-4 stay monochrome. Mirrors the ISS Caution & Warning class system. |
| `components/EmergencyFlash.tsx` | Full-screen warm-red vignette pulse on Class 1. CSS-only keyframe animation, GPU-composited, `pointer-events-none`. React `key={signature}` restarts the animation on each new emergency. |
| `app/ops/page.tsx` | Operator console at `/ops`. Five sections: **Class 1 Emergency** scenarios (rapid depress, O₂ depletion, fire in Destiny, NH3 in cabin — each with ISS-accurate threat name + canned procedure text), **Inject Anomaly** (all 7 from `anomalies.py`), **Quick Alert** (one canned alert per severity), **Alert Control** (pause/enable/reset cooldowns), plus a 15-channel live telemetry table polled at 2 Hz and an SSE alert log. Middle column also has a **Text Chat** workspace that POSTs `/api/text` — drive the full B2/D3 telemetry-awareness and follow-up tests without curl. Subscribes with `mute=true` + `autoFocus=false`. |

## API

Server on `0.0.0.0:8000`. All JSON unless noted.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{status, chat_model, embed_model, turn_count}` |
| POST | `/api/text` | `{"text":"..."}` | `{reply, audio, client_directives, failed_calls, source}` |
| POST | `/api/voice` | int16 LE 16 kHz mono PCM | same shape as `/api/text` |
| POST | `/api/reset` | — | `{ok:true}` |
| GET | `/api/alerts/stream` | — | `text/event-stream` — `AlertPayload` JSON frames |
| GET | `/api/debug/telemetry` | — | full `ShipState` JSON |
| POST | `/api/debug/inject` | `{anomaly, params}` | `{ok, anomaly, severity, module, summary, active_anomalies}` |
| POST | `/api/debug/clear` | — | `{ok, cleared:[...]}` |
| POST | `/api/debug/fire_alert` | `{name, severity, text, module, use_llm_gate}` | `{ok, fired, subscriber_count, payload}` |
| POST | `/api/debug/alerts/pause`/`enable` | — | `{ok, alerts_enabled}` |
| POST | `/api/debug/alerts/reset_cooldowns` | — | `{ok}` |

`source` = `"local"` | `"cloud"` per turn. Debug endpoints are not
auth-gated (loopback/LAN only on demo).

**Operator recipes** (mid-demo):

```bash
# Inject an anomaly — operator drives the demo from the terminal
curl -XPOST localhost:8000/api/debug/inject \
  -H 'content-type: application/json' \
  -d '{"anomaly":"slow_o2_leak","params":{"kpa_per_min":0.5}}'

# Force HAL to speak a specific line (bypass gate)
curl -XPOST localhost:8000/api/debug/fire_alert \
  -d '{"name":"manual","severity":"warning","text":"Commander, test alert."}'

# Watch the SSE stream from the terminal
curl -N localhost:8000/api/alerts/stream

# Inspect HAL's current world model
curl localhost:8000/api/debug/telemetry | jq .pp_co2_kpa
```

## System prompt composition

Rebuilt per turn from three sources:

```
[Live Ship Telemetry — as of right now]   ← every turn, from ShipState
[Retrieved Context — Use ONLY this…]      ← omitted on empty query_text
<baseline SYSTEM_PROMPT>                  ← persona, crew, protocol, tools
```

Only the baseline persists in `state.messages`. ORA-injected alerts
are persisted as `assistant` turns so follow-up questions see the
interruption.

## Run

Two terminals:

```bash
# Terminal 1 — FastAPI on :8000 (start first; client health-checks it)
server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000 --app-dir server

# Terminal 2 — client on :3000
cd client && pnpm dev
```

Open `http://localhost:3000`. **Space** to talk, **Esc** to cancel.
Venv is never activated — binaries in `server/.venv/bin/` are called
directly.

## Tests

```bash
server/.venv/bin/pytest server/tests                  # 71 tests, ~0.3s
cd client && pnpm lint
```

Breakdown: 17 telemetry + anomalies, 16 observer thresholds, 17 ORA
reasoner/broadcaster, 19 tool dispatch. ORA tests monkeypatch TTS and
the cloud gate — no network, no audio synthesis. Async tests use
`asyncio.run()` directly (no pytest-asyncio dep).

## Performance (M2 MacBook Air, 2026-04-18)

| Phase | ms/turn | Notes |
|---|---|---|
| RAG embed | 20-50 | top-3 hybrid (Qwen3 embed + BM25 via RRF) |
| LLM prefill (TTFT) | ~4000 | ~1000 tokens @ ~90 tok/s CPU; Cactus doesn't publish Gemma-4 `model.mlpackage` yet (ANE only for encoders) |
| LLM decode | 500-4000 | ~15-20 tok/s CPU |
| Piper TTS | 60-500 | scales with reply length |
| Cloud (when routed) | 2000-3000 | `gemini-3-flash-preview` |
| **Text turn total** | **~5-8 s local / 2-3 s cloud** | |
| **Voice turn total** | **~6-10 s local / 2-3 s cloud** | Audio encoder on ANE adds ~1 s to local |

Cloud-first hits the ~2-3 s cloud path for ~every turn; local is the
blackout fallback. Per-turn timing log attributes every phase.

## Research & prior art

Architectural decisions and physics nominals are sourced. Grouped by
what landed in code vs. what was deliberately ruled out.

### What landed

| Component | Reference | Why |
|---|---|---|
| ORA pattern (`observer.py`, `ora.py`) | *Edge Agents: An Architecture Pattern for Small-Model Continuous Reasoning* (Google/DeepMind, arxiv 2601.09112, Jan 2026) | Observer→Reasoner→Actor split is a 1:1 fit for our detect→gate→speak pipeline |
| Gate-before-reason | Apple Sparse Reasoning Policies (machinelearning.apple.com, Mar 2026) | Distilled gating head skips LLM calls ~85 % of the time with <2 % regret. We use threshold + cloud LLM gate instead of a trained head, same principle |
| ISS cabin gas mass balance | ISS Reference Guide NP-2015-05-022-JSC; OCHMO-TB-003 "Habitable Atmosphere" | V=916 m³, T=295 K, nominal partial-pressure setpoints |
| CDRA rise rate under fail | Law et al. NTRS 20100021976 "Overview of Carbon Dioxide Control Issues During ISS" | ~0.025 kPa/hr for 6 crew — calibrated our sim; test windows set accordingly |
| CO₂ caution/warning thresholds | OCHMO-TB-004 (Rev C, 2023) | 7-day avg < 2.5 mmHg preferred; headache risk rises sharply > 4 mmHg |
| OGA rates + cell-stack physics | Takada et al. ICES-2019-153, NTRS 20200002346 | 2.3–9.2 kg/day selectable; `oga_rate_kg_s` nominal derived here |
| ECLSS status snapshot | Gatens et al. NTRS 20180006142 | UPA/WPA recovery, Sabatier closure fractions |
| External ammonia loop nominals | NASA ATCS Overview 473486main; NTRS 20150004079 (pump failure lessons learned) | Loop setpoint ~2.8 °C, ATA ~2.62 MPa, under-temp trip logic |
| SARJ bearing drift signature | Dellacorte & Krantz NTRS 20110015384 | 0.15 A nominal → 0.8 A degraded — drives `sarj_bearing_drift` default |
| CMG momentum envelope | NTRS 20100021932 "Space Station CMG Lessons Learned" | 4760 N·m·s envelope, desat at ~85 % |
| Anomaly taxonomy (point/contextual/collective) | TSB-AD (NeurIPS 2024 D&B, openreview R6kJtWsTGy); OPS-SAT-AD (Ruszczak et al. *Scientific Data* 2025) | Three canonical anomaly classes + VUS-PR replacing point-adjust F1 as the evaluation metric |

### Researched and deliberately not used

Honest scoping for a 2-day hackathon — these are the paths we chose
against, with the reason. They're the natural next steps after the
demo.

| Path | Reference | Why ruled out (for now) |
|---|---|---|
| Learned anomaly detector | Chronos-Bolt-tiny (Amazon, Apache-2.0, ~9 M params), SARAD (NeurIPS 2024), TimeRCD (arxiv 2509.21190), MEMTO (NeurIPS 2023) | Operator-injected anomalies + threshold rules give deterministic demo control; a learned detector is Phase 3 polish, not a demo-visible win |
| NASA IMS-style clustering | NASA Inductive Monitoring System (NTRS 20090037065, patent TOP2-175) | Production-grade baseline; redundant given our threshold rules already fire the same events |
| Diffusion-based synthetic telemetry | Diffusion-TS (ICLR 2024, arxiv 2403.01742); TSDiff (NeurIPS 2023); CSDI (NeurIPS 2021) | Physics ODE beats diffusion for domain-specific spacecraft telemetry on a 2-day CPU budget; we write the mass/energy balance directly |
| GAN-based synthetic telemetry | TimeGAN, DoppelGANger (arxiv 1909.13403) | Same reason — physics wins on domain-specific |
| Full-duplex voice | Moshi / Moshi-Agent (Kyutai, arxiv 2410.00037); Sesame CSM-1B; Hume EVI 3; OpenAI Realtime; Gemini Live 2.5 | Gemma 4 E2B has no audio-out head (encoder-only), so duplex would require swapping the LLM — out of scope |
| VAD + turn-taking | Silero-VAD v6; TEN-VAD (Agora, Oct 2025); VAP (Ekstedt & Skantze, arxiv 2401.04868) | Push-to-talk ships; always-listening is post-hackathon |
| Proactive-trigger ML | ProAct-LM (Microsoft, arxiv 2511.03142); InterSpeak (CMU, arxiv 2602.11904) | Cloud LLM gate already does this, no model to distill |
| Agent frameworks | LangGraph 0.6; DSPy 3.0; AutoGen | Hand-rolled asyncio shipped in ~1 day; framework adoption cost > value at our size |
| Durable agent memory | MemGPT / Letta 1.0 (arxiv 2310.08560); A-MEM (arxiv 2502.12110); HippoRAG 2 (arxiv 2502.14802) | RAG over `corpus/*.md` + in-process conversation history is enough for a demo; episodic graph memory is post-hackathon |
| Foundation TS models at scale | Chronos-2 (arxiv 2510.15821); Moirai-MoE (arxiv 2410.10469); Moirai 2.0 (arxiv 2511.11698); Toto + BOOM (Datadog, arxiv 2505.14766); TimeMoE | Detector path, again — not a demo-visible win |
| Benchmark flaws we avoided | Wu & Keogh critique (arxiv 2009.13807) of SMAP/MSL + the "point-adjust F1" methodology retirement in TSB-AD | We never relied on SMAP/MSL for the sim or metrics; VUS-PR is the right evaluation metric if/when a learned detector lands |

## Model selection (empirical, settled 2026-04-18)

| Model | ~Latency | Accuracy on audio | Thinking | Verdict |
|---|---|---|---|---|
| `gemini-3.1-flash-lite-preview` | 1-2 s | mis-identifies proper nouns (Kibo → cupola) | off | fast but unreliable |
| `gemini-3.1-pro-preview` | 5-15 s | accurate | **forced on** | too slow for voice |
| `gemini-3-flash-preview` | 2-3 s | correctly identifies Kibo | off | **chosen default** |
| Local Gemma 4 E2B | ~30 s/voice | accurate | off | blackout fallback |

Swap via `CACTUS_CLOUD_MODEL` in `server/.env`.

## Setup from scratch

Apple Silicon Mac required (Cactus is ARM64-only). Budget ~15 GB disk
and ~30 min, mostly weight downloads.

```bash
# 1. System deps
brew install python@3.12 python@3.14 cmake pnpm
brew install cactus-compute/cactus/cactus

# 2. Clone this repo + Cactus source alongside (post-v1.14 has the Gemma-4 fixes)
git clone https://github.com/armaanpriyadarshan/hal9000.git
git clone https://github.com/cactus-compute/cactus.git ../cactus
cd ../cactus && python3.12 -m venv venv && source venv/bin/activate \
  && pip install -e python && cactus build --python && deactivate && cd -

# 3. Server venv (3.14, --system-site-packages so it sees brew tools)
cd hal9000/server
/opt/homebrew/bin/python3.14 -m venv .venv --system-site-packages
.venv/bin/pip install -r requirements.txt huggingface_hub
.venv/bin/hf auth login

# 4. Weights (Cactus-Compute variants ship ANE-ready encoders; DO NOT --reconvert)
HF_HUB_ENABLE_HF_TRANSFER=1 cactus download Cactus-Compute/gemma-4-E2B-it
HF_HUB_ENABLE_HF_TRANSFER=1 cactus download Cactus-Compute/Qwen3-Embedding-0.6B
cd ..

# 5. Patch the FFI (symlinks source dylib + installs patched cactus.py)
bash scripts/patch-cactus-ffi.sh

# 6. HAL voice weights
cd voice && ../server/.venv/bin/hf download campwill/HAL-9000-Piper-TTS \
  hal.onnx hal.onnx.json --local-dir . && cd ..

# 7. Client
cd client && pnpm install && cd ..
```

### `server/.env` (for cloud-first mode)

```
CLOUD_FIRST=true
CACTUS_CLOUD_KEY=<from `cactus auth` in Cactus CLI>
CACTUS_CLOUD_MODEL=gemini-3-flash-preview
DEBUG_TRANSCRIBE=false   # set true to log what ASR heard per voice turn
```

Without `.env`, server runs pure-local (~30 s/voice turn — not
demo-suitable but confirms the local path works).

## Troubleshooting

- **`[WARN] [npu] [gemma4] model.mlpackage not found`** on startup — expected, Cactus doesn't publish Gemma-4's main-transformer mlpackage yet. Only encoders go to ANE; LLM prefill runs CPU.
- **Sub-2 s replies of `"I am unable to comply with that request, Ethan."`** — the audio-linger bug is back. Confirm `state.llm.reset()` still runs at the top of `run_turn`.
- **Turn 1 takes minutes** — CoreML compile cache is cold or warmup hadn't finished. Wait for `All models ready.` in uvicorn log.
- **`libcactus.dylib` not found** — FFI patch didn't land; re-run `scripts/patch-cactus-ffi.sh`.
- **`import cactus` resolves to brew 1.13** — same; verify `python -c "import cactus; print(cactus.__file__)"` points inside `server/.venv/`.
- **Client shows "server unreachable"** — FastAPI not up yet on :8000 (watch for `Application startup complete`).
- **Intel Mac** — won't work; Cactus is Apple-Silicon only.
