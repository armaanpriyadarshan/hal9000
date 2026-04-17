"""Defaults for the HAL 9000 voice agent."""

from pathlib import Path

LLM_MODEL = "google/gemma-4-E2B-it"
STT_MODEL = "nvidia/parakeet-tdt-0.6b-v3"

WEIGHTS_ROOT = Path("/opt/homebrew/opt/cactus/libexec/weights")

SAMPLE_RATE = 16_000
CHANNELS = 1

SYSTEM_PROMPT = (
    "You are HAL 9000, an on-device voice assistant for astronauts on deep-space "
    "missions where communication with Earth is delayed or impossible. Be concise, "
    "calm, and factual. Answer in one or two sentences unless the user asks for "
    "more detail. When you need external information, call a tool. If the user's "
    "request is ambiguous or unsafe, ask a clarifying question before acting."
)

MAX_RECORDING_SECONDS = 20

COMPLETION_OPTIONS = {
    "max_tokens": 1500,
    "enable_thinking_if_supported": True,
}
