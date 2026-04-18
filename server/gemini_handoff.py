"""Cloud fallback via Google's Generative Language API (Gemini 3.x).

Called from run_turn when local confidence is low, the local reply is
empty, or every emitted tool call failed schema validation. Text turns
only — voice turns stay local because the Gemini audio path is out of
scope for this pass.

The variable and env names use GEMINI_* because the endpoint is
generativelanguage.googleapis.com regardless of whether you point it at
a Gemini or Gemma model via GEMINI_MODEL.

Translation contract:
- Messages in Cactus shape (role + content) → Gemini `contents` array;
  the first `system` message becomes `systemInstruction` (Gemini's
  separate field). `assistant` role maps to Gemini's `model`.
- Tools in cactus_tools_json() shape → Gemini `functionDeclarations`.
- Response parts are demuxed into a response_text string and a
  function_calls list in Cactus shape (`{name, arguments}`), so the
  server.py dispatcher needs no branching between local and cloud.
"""

from __future__ import annotations

import json
from typing import Any

import httpx


_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def _to_gemini_contents(
    messages: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Split system message into a separate systemInstruction and convert
    the rest to Gemini's contents array. Only the first system message is
    honoured — Gemini takes a single systemInstruction."""
    system_instruction: dict[str, Any] | None = None
    contents: list[dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "") or ""
        if role == "system":
            if system_instruction is None and content:
                system_instruction = {"parts": [{"text": content}]}
            continue
        gemini_role = "model" if role == "assistant" else "user"
        if not content:
            continue
        contents.append({"role": gemini_role, "parts": [{"text": content}]})
    return system_instruction, contents


def _to_function_declarations(
    tools: list[dict[str, Any]] | None,
) -> list[dict[str, Any]] | None:
    """cactus_tools_json() emits `{type: function, function: {name, description, parameters}}`
    per entry. Gemini wants a single tools entry containing a
    functionDeclarations list. Gemini's parameters schema drops the
    `$schema` and a few other JSON-Schema fields — we pass through only
    the keys Gemini recognises."""
    if not tools:
        return None
    declarations: list[dict[str, Any]] = []
    for t in tools:
        fn = t.get("function") if t.get("type") == "function" else t
        if not fn or "name" not in fn:
            continue
        decl: dict[str, Any] = {"name": fn["name"]}
        if "description" in fn:
            decl["description"] = fn["description"]
        if "parameters" in fn:
            decl["parameters"] = _sanitise_schema(fn["parameters"])
        declarations.append(decl)
    if not declarations:
        return None
    return [{"functionDeclarations": declarations}]


def _sanitise_schema(schema: Any) -> Any:
    """Strip JSON-Schema keys Gemini's function-declaration parser
    rejects. Gemini accepts a subset: type, description, properties,
    required, items, enum, nullable."""
    if not isinstance(schema, dict):
        return schema
    allowed = {"type", "description", "properties", "required", "items", "enum", "nullable"}
    out: dict[str, Any] = {}
    for k, v in schema.items():
        if k not in allowed:
            continue
        if k == "properties" and isinstance(v, dict):
            out[k] = {pk: _sanitise_schema(pv) for pk, pv in v.items()}
        elif k == "items":
            out[k] = _sanitise_schema(v)
        else:
            out[k] = v
    return out


def _parse_gemini_response(payload: dict[str, Any]) -> dict[str, Any]:
    candidates = payload.get("candidates") or []
    if not candidates:
        # Prompt-level block (safety, recitation) shows up as no candidates
        # plus a promptFeedback.blockReason. Surface that as an error.
        feedback = payload.get("promptFeedback", {})
        reason = feedback.get("blockReason", "no_candidates")
        return {"response": "", "function_calls": [], "error": reason}
    cand = candidates[0]
    finish_reason = cand.get("finishReason", "")
    parts = (cand.get("content") or {}).get("parts") or []
    texts: list[str] = []
    function_calls: list[dict[str, Any]] = []
    for p in parts:
        if "functionCall" in p:
            fc = p["functionCall"]
            # Gemini includes an `id` on the call that we don't use; strip.
            function_calls.append({
                "name": fc.get("name", ""),
                "arguments": fc.get("args", {}) or {},
            })
        elif "text" in p:
            texts.append(p["text"])
    response_text = "".join(texts).strip()
    # MAX_TOKENS with non-empty text is still a usable reply; only a hard
    # empty response with a terminal non-STOP reason counts as failure.
    if not response_text and not function_calls and finish_reason and finish_reason != "STOP":
        return {"response": "", "function_calls": [], "error": finish_reason}
    return {"response": response_text, "function_calls": function_calls, "error": None}


def cloud_complete(
    messages: list[dict[str, Any]],
    *,
    api_key: str,
    model: str,
    tools: list[dict[str, Any]] | None = None,
    local_draft: str = "",
    timeout_s: float = 20.0,
    max_output_tokens: int = 512,
) -> dict[str, Any]:
    """Synchronous cloud completion. Returns:
        {"used_cloud": bool, "response": str, "function_calls": list, "error": str|None}

    The local draft is appended to the system instruction as a
    low-confidence reference (mirrors Cactus's own cloud proxy prompt
    shape in cactus_cloud.cpp:124). Helps the cloud model see where the
    local model went wrong without forcing it to copy."""
    if not api_key:
        return {"used_cloud": False, "response": "", "function_calls": [], "error": "missing_api_key"}

    system_instruction, contents = _to_gemini_contents(messages)
    if local_draft and system_instruction is not None:
        system_instruction["parts"].append({
            "text": (
                "\n\nThe on-device model's draft reply (may be low confidence, "
                "ignore if unhelpful):\n"
                + local_draft
            ),
        })

    function_tools = _to_function_declarations(tools)

    body: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": max_output_tokens,
            # flash-lite accepts thinkingBudget=0 (thinking fully off).
            # Pro models reject 0 — switch to a small budget like 256 if
            # you flip GEMINI_MODEL to gemini-3.1-pro-preview.
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    if system_instruction is not None:
        body["systemInstruction"] = system_instruction
    if function_tools is not None:
        body["tools"] = function_tools

    url = _ENDPOINT.format(model=model)
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}

    try:
        with httpx.Client(timeout=timeout_s) as client:
            r = client.post(url, headers=headers, json=body)
    except httpx.TimeoutException:
        return {"used_cloud": False, "response": "", "function_calls": [], "error": "timeout"}
    except httpx.RequestError as e:
        return {"used_cloud": False, "response": "", "function_calls": [], "error": f"request_error:{e}"}

    if r.status_code >= 400:
        try:
            err = r.json().get("error", {}).get("message", "")
        except json.JSONDecodeError:
            err = r.text[:160]
        return {"used_cloud": False, "response": "", "function_calls": [], "error": f"http_{r.status_code}:{err}"}

    try:
        payload = r.json()
    except json.JSONDecodeError:
        return {"used_cloud": False, "response": "", "function_calls": [], "error": "invalid_json"}

    parsed = _parse_gemini_response(payload)
    used_cloud = not parsed["error"] and (parsed["response"] or parsed["function_calls"])
    return {
        "used_cloud": bool(used_cloud),
        "response": parsed["response"],
        "function_calls": parsed["function_calls"],
        "error": parsed["error"],
    }
