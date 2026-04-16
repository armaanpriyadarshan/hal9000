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

## Quick Start

```bash
# Install Cactus
brew install cactus-compute/cactus/cactus

# Run Gemma 4
cactus run google/gemma-4-E2B-it

# Clone this repo
git clone https://github.com/YOUR_USERNAME/hal9000.git
cd hal9000
```

Further setup instructions TBD as we build during the hackathon.

## Team

TBD

## License

TBD
