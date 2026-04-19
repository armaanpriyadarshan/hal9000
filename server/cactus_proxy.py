"""Python client for the Cactus cloud proxy.

Used by `run_turn` when CLOUD_FIRST is on — lets us try the cloud path
*before* touching the local model, instead of racing it as Cactus's
built-in `auto_handoff` does. Local only runs on cloud failure.

Transport identical to what `cactus_cloud.cpp` does: posts a text prompt
(with optional base64 WAV audio) to `CACTUS_CLOUD_API_BASE` with the
`CACTUS_CLOUD_KEY` in the `X-API-Key` header. Prompt format mirrors the
C side's `build_cloud_text_prompt` so the proxy sees the same shape
either way.
"""

from __future__ import annotations

import base64
import json
import os
import re
import struct
from typing import Any

import httpx


# Matches a trailing JSON array of tool-call objects on its own line(s)
# after the visible reply. Flash-lite sometimes emits prose THEN the
# tool-call JSON, violating the strict output contract — without this
# we'd speak the JSON out loud. Non-greedy inner match, array-closes-
# at-end-of-string anchor.
_TRAILING_TOOL_CALL_RE = re.compile(
    r"\s*(\[\s*\{[^\[\]]*\"name\"[^\[\]]*\}\s*(?:,\s*\{[^\[\]]*\}\s*)*\])\s*\Z",
    re.DOTALL,
)


# Mirrors cactus_cloud.cpp's defaults so behaviour matches when no env
# override is set. The IP endpoint uses a self-signed cert, so we
# default to SSL verify OFF (the C side does the same via
# CACTUS_CLOUD_STRICT_SSL gating — see cactus_cloud.cpp:199).
_DEFAULT_BASE = "https://104.198.76.3/api/v1"


# Known ASR mishears observed on gemini-3-flash-preview via Cactus's
# /transcribe endpoint (2026-04-18). Applied after transcription so the
# RAG query and prompt see the canonical station vocabulary rather than
# phonetic collisions. Grow this list when new mishears show up in the
# `[turn N] transcript='…'` log line — only add patterns you've
# personally heard mis-transcribe, so we don't silently rewrite
# legitimate user input.
_MISHEAR_FIXUPS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\btboly\b", re.IGNORECASE), "tranquility"),
    (re.compile(r"\bq-?ville\b", re.IGNORECASE), "cupola"),
]


def apply_mishear_fixups(text: str) -> str:
    """Replace known phonetic ASR mistakes with the station's canonical
    module names. Returns the original text unchanged when no pattern
    matches — safe to call on every transcript."""
    fixed = text
    for pattern, replacement in _MISHEAR_FIXUPS:
        fixed = pattern.sub(replacement, fixed)
    return fixed


def _transcribe_audio(pcm_data: bytes, timeout_s: float = 10.0) -> str | None:
    """Send PCM to Cactus proxy `/transcribe` and return the text. Returns
    None on any failure so caller can fall back to /omni (which handles
    audio end-to-end internally).

    We split transcribe from complete so we can log what the ASR heard
    — without it we're blind to whether bugs are audio-recognition or
    reasoning. Mirrors `cloud_transcribe_request` in cactus_cloud.cpp:292."""
    api_key = os.environ.get("CACTUS_CLOUD_KEY", "").strip()
    if not api_key:
        return None
    base = os.environ.get("CACTUS_CLOUD_API_BASE", _DEFAULT_BASE).rstrip("/")
    wav = _pcm_to_wav_bytes(pcm_data)
    payload = {
        "audio": base64.b64encode(wav).decode("ascii"),
        "mime_type": "audio/wav",
        "language": "en-US",
    }
    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    strict_ssl = os.environ.get("CACTUS_CLOUD_STRICT_SSL", "").lower() in ("1", "true", "yes")
    try:
        with httpx.Client(timeout=timeout_s, verify=strict_ssl) as client:
            r = client.post(f"{base}/transcribe", headers=headers, json=payload)
    except (httpx.TimeoutException, httpx.RequestError):
        return None
    if r.status_code >= 400:
        return None
    try:
        body = r.json()
    except json.JSONDecodeError:
        return None
    transcript = (
        body.get("transcript") or body.get("text") or body.get("response") or ""
    ).strip()
    return transcript or None


def _build_prompt(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    local_draft: str,
) -> str:
    """Mirror of `build_cloud_text_prompt` in cactus_cloud.cpp:124-151."""
    lines = [
        # Identity anchor. Flash-lite otherwise sometimes role-plays a
        # crew member named in the HAL system prompt (Armaan, Ethan,
        # Samarjit) when audio input is ambiguous. Spelling it out here
        # at the top of the proxy prompt stops that.
        "You are HAL 9000, the ship's onboard AI. Always respond as HAL.",
        "Never adopt the identity of a crew member (Armaan, Ethan, or "
        "Samarjit) — they are the humans you are speaking to. Follow "
        "the persona and rules declared in the [system] block below.",
        "",
        "Output contract:",
        "1) Never include role prefixes like 'assistant:' or 'HAL:'.",
        "2) Never include markdown/code fences/backticks.",
        "3) Return only the final assistant answer text unless a tool call is required.",
        "4) If a tool call is required, return ONLY JSON with this exact shape:",
        '[{"name":"tool_name","arguments":{"arg":"value"}}]',
        "5) Do not include any prose before or after that JSON tool-call output.",
        "",
        "Conversation:",
    ]
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "") or ""
        lines.append(f"[{role}] {content}")
    if tools:
        lines.extend([
            "",
            "Reminder: you are HAL 9000 answering the crew. Reply as HAL.",
            "Never speak as a crew member (Armaan, Ethan, Samarjit).",
            "",
            "Available tools JSON (use only these tool names and arguments):",
            json.dumps(tools),
            # Rewritten 2026-04-18: the prior wording ('prefer the strict JSON
            # tool-call output contract') combined with the HAL system prompt's
            # 'prefer invoking a tool over describing the change in prose' led
            # flash-lite to over-trigger tool calls on questions — e.g. 'who
            # are you' routing to highlight_part(solar_arrays). Reframe to
            # make the tool path conditional on an explicit action request.
            "Tool use is STRICTLY CONDITIONAL: emit a tool call ONLY if the "
            "user is clearly asking you to perform one of the specific "
            "actions listed above (switch to interior/exterior view, "
            "highlight a named exterior part, or navigate to a named "
            "interior module). For ANY other input — questions about your "
            "identity, the crew, procedures, systems, the mission, or "
            "anything else — respond in natural-language text. When in "
            "doubt between a tool call and a text reply, always choose the "
            "text reply.",
            "If you DO emit a tool call, you MUST be able to identify the "
            "exact enum value the user named (e.g. the specific module "
            "like 'kibo_jpm' or 'tranquility', the specific part like "
            "'solar_arrays', the specific view). If you are not sure which "
            "enum value the user meant — including when audio is unclear "
            "or the user's phrasing is ambiguous — DO NOT guess. Instead "
            "respond in text asking the crew to repeat or clarify. A wrong "
            "tool call is worse than asking again.",
        ])
    if local_draft:
        lines.extend([
            "",
            "Local model draft (useful fallback reference, may be low confidence):",
            local_draft,
        ])
    return "\n".join(lines)


def _pcm_to_wav_bytes(pcm: bytes) -> bytes:
    """PCM int16 LE mono 16kHz → RIFF WAV (mirrors cloud_build_wav)."""
    sample_rate = 16000
    channels = 1
    bits = 16
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    data_size = len(pcm)
    file_size = 36 + data_size
    header = b"RIFF" + struct.pack("<I", file_size) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, bits)
    header += b"data" + struct.pack("<I", data_size)
    return header + pcm


def complete(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    pcm_data: bytes | None = None,
    local_draft: str = "",
    timeout_s: float = 15.0,
) -> dict[str, Any]:
    """Call the Cactus proxy. Returns:
        {"ok": bool, "response": str, "function_calls": list, "error": str|None}

    `ok=True` means the proxy returned a usable reply; `ok=False`
    means the caller should fall back to local. Errors are stringified
    in `error` for logging only.

    Voice turns go to /omni with the raw PCM so the reasoning model
    does ASR + reasoning end-to-end with its native audio encoder —
    Cactus's separate /transcribe endpoint uses a weaker ASR that
    degraded proper-noun recognition during testing. For debug
    visibility into what the model heard, see the DEBUG_TRANSCRIBE
    parallel-log path in server.py's run_turn.
    """
    api_key = os.environ.get("CACTUS_CLOUD_KEY", "").strip()
    if not api_key:
        return {"ok": False, "response": "", "function_calls": [], "error": "missing_cactus_cloud_key"}
    base = os.environ.get("CACTUS_CLOUD_API_BASE", _DEFAULT_BASE).rstrip("/")
    model = os.environ.get("CACTUS_CLOUD_MODEL", "gemini-3-flash-preview")

    prompt_text = _build_prompt(messages, tools, local_draft)
    payload: dict[str, Any] = {
        "text": prompt_text,
        "language": "en-US",
        "model": model,
    }
    if pcm_data:
        wav = _pcm_to_wav_bytes(pcm_data)
        payload["audio"] = base64.b64encode(wav).decode("ascii")
        payload["audio_mime_type"] = "audio/wav"
        endpoint = f"{base}/omni"
    else:
        endpoint = f"{base}/text"

    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}

    # SSL verification off by default because the upstream endpoint is a
    # raw IP (104.198.76.3) with no hostname to verify against. Matches
    # cactus_cloud.cpp:199-201.
    strict_ssl = os.environ.get("CACTUS_CLOUD_STRICT_SSL", "").lower() in ("1", "true", "yes")

    try:
        with httpx.Client(timeout=timeout_s, verify=strict_ssl) as client:
            r = client.post(endpoint, headers=headers, json=payload)
    except httpx.TimeoutException:
        return {"ok": False, "response": "", "function_calls": [], "error": "timeout"}
    except httpx.RequestError as e:
        return {"ok": False, "response": "", "function_calls": [], "error": f"request_error:{type(e).__name__}"}

    if r.status_code >= 400:
        try:
            err = r.json().get("error", "")
            if isinstance(err, dict):
                err = err.get("message", "") or json.dumps(err)[:160]
        except Exception:
            err = r.text[:160]
        return {"ok": False, "response": "", "function_calls": [], "error": f"http_{r.status_code}:{err}"}

    try:
        body = r.json()
    except json.JSONDecodeError:
        return {"ok": False, "response": "", "function_calls": [], "error": "invalid_json"}

    response_text = (body.get("text") or body.get("analysis") or "").strip()
    function_calls_raw = body.get("function_calls") or []

    # Proxy sometimes returns function_calls as a list of dicts directly,
    # sometimes as a list of JSON strings. Normalise.
    function_calls: list[dict[str, Any]] = []
    for entry in function_calls_raw:
        if isinstance(entry, dict):
            function_calls.append(entry)
        elif isinstance(entry, str):
            try:
                function_calls.append(json.loads(entry))
            except json.JSONDecodeError:
                continue

    # If no structured function_calls, look for an inline tool-call
    # JSON array in the text. Two cases:
    #   1. Whole response IS a bare array (matches cactus_cloud.cpp:431-442)
    #   2. Prose then trailing array (flash-lite violates the output
    #      contract and does this — without handling it, HAL TTS would
    #      speak the JSON out loud)
    if not function_calls and response_text:
        stripped = response_text.strip()
        bare_array = (
            stripped.startswith("[") and stripped.endswith("]") and '"name"' in stripped
        )
        if bare_array:
            try:
                maybe_calls = json.loads(stripped)
                if isinstance(maybe_calls, list) and all(isinstance(c, dict) for c in maybe_calls):
                    function_calls = maybe_calls
                    response_text = ""
            except json.JSONDecodeError:
                pass
        else:
            m = _TRAILING_TOOL_CALL_RE.search(response_text)
            if m:
                try:
                    maybe_calls = json.loads(m.group(1))
                    if isinstance(maybe_calls, list) and all(isinstance(c, dict) for c in maybe_calls):
                        function_calls = maybe_calls
                        response_text = response_text[: m.start()].rstrip()
                except json.JSONDecodeError:
                    pass

    if not response_text and not function_calls:
        return {"ok": False, "response": "", "function_calls": [], "error": "missing_text"}

    return {"ok": True, "response": response_text, "function_calls": function_calls, "error": None}
