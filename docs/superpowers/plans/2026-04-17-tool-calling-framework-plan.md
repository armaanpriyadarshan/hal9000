# HAL Tool-Calling Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire native Cactus tool-calling end-to-end with `set_view` as the first tool; build the framework so future tools are single-file additions.

**Architecture:** Server owns `TOOL_SPECS` (name, description, parameters, location, handler, ack_template). Cactus emits `function_calls` in its response JSON; `dispatch()` validates each call against its JSON schema, executes server-location tools inline, collects client directives, and renders an ack. The client runs a parallel registry keyed by tool name that executes directives (v1: `set_view` calls `router.push`).

**Tech Stack:** FastAPI + Cactus Python FFI (server), Next.js 16 App Router + React 19 (client), `jsonschema` for parameter validation, `pytest` for server tests.

**Spec reference:** `docs/superpowers/specs/2026-04-17-tool-calling-framework-design.md`

---

## File Structure

**Create:**
- `server/tools.py` — tool registry, dispatch logic, schema conversion.
- `server/tests/__init__.py` — package marker (empty file).
- `server/tests/test_tools.py` — unit tests for `dispatch()`.
- `client/src/lib/halTools.ts` — client-side tool registry + `executeClientDirectives`.

**Modify:**
- `server/requirements.txt` — add `jsonschema` (runtime) and `pytest` (dev).
- `server/server.py` — `run_turn` passes tools, calls `dispatch`, returns `client_directives` + `failed_calls`.
- `server/config.py` — extend `SYSTEM_PROMPT` with a brief view-switching nudge.
- `client/src/components/HalVoice.tsx` — after response JSON, invoke `executeClientDirectives`; grab router via `useRouter()`.

---

### Task 1: Add dependencies + pytest scaffolding

**Files:**
- Modify: `server/requirements.txt`
- Create: `server/tests/__init__.py`

- [ ] **Step 1: Edit `server/requirements.txt`**

Current content:
```
fastapi>=0.115
uvicorn[standard]>=0.30
piper-tts>=1.3
onnxruntime>=1.17
soundfile>=0.12
```

Replace entire file with:
```
fastapi>=0.115
uvicorn[standard]>=0.30
piper-tts>=1.3
onnxruntime>=1.17
soundfile>=0.12
jsonschema>=4.21
pytest>=8.0
```

- [ ] **Step 2: Install new deps**

Run from repo root:
```
server/.venv/bin/pip install -r server/requirements.txt
```

Expected: `jsonschema-4.x.x` and `pytest-8.x.x` installed successfully (existing packages already satisfied).

- [ ] **Step 3: Create empty package marker**

Create `server/tests/__init__.py` with no content (zero-byte file).

- [ ] **Step 4: Verify pytest discovers the (empty) suite**

Run:
```
cd server && .venv/bin/python -m pytest tests -v
```

Expected: exits with `no tests ran` and exit code 5 (pytest's "no tests collected" code). This proves the harness is reachable.

- [ ] **Step 5: Commit**

```
git add server/requirements.txt server/tests/__init__.py
git commit -m "Add jsonschema + pytest for tool dispatch tests"
```

---

### Task 2: Define ToolSpec registry + cactus_tools_json

**Files:**
- Create: `server/tools.py`
- Create: `server/tests/test_tools.py`

- [ ] **Step 1: Write the failing registry tests**

Create `server/tests/test_tools.py`:

```python
"""Unit tests for server/tools.py — registry and dispatch."""

from tools import TOOL_SPECS, cactus_tools_json


def test_set_view_is_registered():
    names = [spec.name for spec in TOOL_SPECS]
    assert "set_view" in names


def test_cactus_tools_json_contains_set_view_schema():
    tools = cactus_tools_json()
    assert isinstance(tools, list)
    set_view = next(
        (t for t in tools if t["function"]["name"] == "set_view"), None
    )
    assert set_view is not None
    assert set_view["type"] == "function"
    params = set_view["function"]["parameters"]
    assert params["properties"]["view"]["enum"] == ["interior", "exterior"]
    assert params["required"] == ["view"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```
cd server && .venv/bin/python -m pytest tests/test_tools.py -v
```

Expected: `ModuleNotFoundError: No module named 'tools'` (collection error).

- [ ] **Step 3: Create `server/tools.py`**

```python
"""Tool registry + dispatch for HAL.

Every tool HAL can call is a `ToolSpec` in `TOOL_SPECS`. `cactus_tools_json()`
renders the registry into the OpenAI-style payload Cactus expects on
`cactus_complete(tools_json=...)`. `dispatch()` validates incoming
function_calls and produces ack text + client directives.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal, TypedDict


Location = Literal["server", "client"]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    location: Location
    ack_template: str
    handler: Callable[[dict[str, Any]], None] | None = None


class ClientDirective(TypedDict):
    name: str
    arguments: dict[str, Any]


class FailedCall(TypedDict):
    name: str
    arguments: dict[str, Any]
    reason: str


TOOL_SPECS: list[ToolSpec] = [
    ToolSpec(
        name="set_view",
        description=(
            "Switch the primary display between the interior and exterior "
            "views of the station. Use when the crew asks to see inside, "
            "outside, or refers to the exterior of the ship."
        ),
        parameters={
            "type": "object",
            "properties": {
                "view": {
                    "type": "string",
                    "enum": ["interior", "exterior"],
                    "description": "Which view to bring up.",
                },
            },
            "required": ["view"],
        },
        location="client",
        ack_template="Bringing up the {view} view.",
    ),
]


def cactus_tools_json() -> list[dict[str, Any]]:
    """Render TOOL_SPECS into OpenAI-style `tools` payload for Cactus."""
    return [
        {
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.parameters,
            },
        }
        for spec in TOOL_SPECS
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```
cd server && .venv/bin/python -m pytest tests/test_tools.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```
git add server/tools.py server/tests/test_tools.py
git commit -m "Add ToolSpec registry with set_view and cactus_tools_json"
```

---

### Task 3: Implement dispatch() — happy path

**Files:**
- Modify: `server/tools.py`
- Modify: `server/tests/test_tools.py`

- [ ] **Step 1: Append failing happy-path test**

Append to `server/tests/test_tools.py`:

```python
from tools import DispatchResult, dispatch


def test_dispatch_valid_set_view_returns_directive_and_ack():
    calls = [{"name": "set_view", "arguments": {"view": "exterior"}}]
    result = dispatch(calls)
    assert isinstance(result, DispatchResult)
    assert result.ack_text == "Bringing up the exterior view."
    assert result.client_directives == [
        {"name": "set_view", "arguments": {"view": "exterior"}}
    ]
    assert result.failed_calls == []
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```
cd server && .venv/bin/python -m pytest tests/test_tools.py::test_dispatch_valid_set_view_returns_directive_and_ack -v
```

Expected: `ImportError: cannot import name 'dispatch'` or `DispatchResult`.

- [ ] **Step 3: Extend `server/tools.py` with `DispatchResult` and `dispatch`**

At the top of `server/tools.py`, after the existing `from typing import ...` line, add:

```python
from jsonschema import Draft202012Validator, ValidationError
```

After the `FailedCall` TypedDict, add:

```python
@dataclass
class DispatchResult:
    ack_text: str = ""
    client_directives: list[ClientDirective] = field(default_factory=list)
    failed_calls: list[FailedCall] = field(default_factory=list)
```

At the bottom of the file (after `cactus_tools_json`), add:

```python
_SPECS_BY_NAME = {spec.name: spec for spec in TOOL_SPECS}

_GENERIC_ERROR = "I am unable to comply with that request, Ethan."


def dispatch(function_calls: Any) -> DispatchResult:
    """Validate + dispatch Cactus-emitted function_calls.

    Returns a DispatchResult with ack_text (for TTS), client_directives
    (for the browser), and failed_calls (for debug). Malformed payloads
    are treated as no-ops.
    """
    result = DispatchResult()
    if not isinstance(function_calls, list):
        return result
    for call in function_calls:
        if not isinstance(call, dict) or "name" not in call:
            continue
        name = call["name"]
        args = call.get("arguments") or {}
        spec = _SPECS_BY_NAME.get(name)
        if spec is None:
            result.failed_calls.append(
                {"name": name, "arguments": args, "reason": "unknown tool"}
            )
            continue
        try:
            Draft202012Validator(spec.parameters).validate(args)
        except ValidationError as e:
            result.failed_calls.append(
                {"name": name, "arguments": args, "reason": e.message}
            )
            continue
        if spec.location == "server" and spec.handler is not None:
            try:
                spec.handler(args)
            except Exception as e:  # noqa: BLE001
                result.failed_calls.append(
                    {"name": name, "arguments": args, "reason": f"handler error: {e}"}
                )
                continue
        else:
            result.client_directives.append({"name": name, "arguments": args})
        result.ack_text = _append(result.ack_text, spec.ack_template.format(**args))
    if result.failed_calls:
        n = len(result.failed_calls)
        if result.ack_text:
            noun = "request" if n == 1 else "requests"
            suffix = f"I was unable to comply with {n} other {noun}."
            result.ack_text = _append(result.ack_text, suffix)
        else:
            result.ack_text = _GENERIC_ERROR
    return result


def _append(acc: str, sentence: str) -> str:
    return sentence if not acc else f"{acc} {sentence}"
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```
cd server && .venv/bin/python -m pytest tests/test_tools.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```
git add server/tools.py server/tests/test_tools.py
git commit -m "Implement dispatch happy path for valid tool calls"
```

---

### Task 4: dispatch() — unknown tool + invalid args

**Files:**
- Modify: `server/tests/test_tools.py`

The dispatch implementation from Task 3 already handles these cases. This task locks them in with tests.

- [ ] **Step 1: Append failure-path tests**

Append to `server/tests/test_tools.py`:

```python
def test_dispatch_unknown_tool_yields_failed_call_and_generic_ack():
    calls = [{"name": "launch_missile", "arguments": {}}]
    result = dispatch(calls)
    assert result.client_directives == []
    assert len(result.failed_calls) == 1
    assert result.failed_calls[0]["name"] == "launch_missile"
    assert result.failed_calls[0]["reason"] == "unknown tool"
    assert result.ack_text == "I am unable to comply with that request, Ethan."


def test_dispatch_invalid_enum_value_fails():
    calls = [{"name": "set_view", "arguments": {"view": "cupola"}}]
    result = dispatch(calls)
    assert result.client_directives == []
    assert len(result.failed_calls) == 1
    assert result.failed_calls[0]["name"] == "set_view"
    assert result.ack_text == "I am unable to comply with that request, Ethan."


def test_dispatch_missing_required_arg_fails():
    calls = [{"name": "set_view", "arguments": {}}]
    result = dispatch(calls)
    assert result.client_directives == []
    assert len(result.failed_calls) == 1
    assert result.ack_text == "I am unable to comply with that request, Ethan."
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```
cd server && .venv/bin/python -m pytest tests/test_tools.py -v
```

Expected: 6 passed.

- [ ] **Step 3: Commit**

```
git add server/tests/test_tools.py
git commit -m "Test unknown-tool and invalid-args dispatch paths"
```

---

### Task 5: dispatch() — multiple calls (valid + mixed)

**Files:**
- Modify: `server/tests/test_tools.py`

- [ ] **Step 1: Append multi-call tests**

Append to `server/tests/test_tools.py`:

```python
def test_dispatch_multiple_valid_calls_concats_acks():
    calls = [
        {"name": "set_view", "arguments": {"view": "exterior"}},
        {"name": "set_view", "arguments": {"view": "interior"}},
    ]
    result = dispatch(calls)
    assert result.client_directives == [
        {"name": "set_view", "arguments": {"view": "exterior"}},
        {"name": "set_view", "arguments": {"view": "interior"}},
    ]
    assert result.failed_calls == []
    assert result.ack_text == (
        "Bringing up the exterior view. Bringing up the interior view."
    )


def test_dispatch_mix_of_valid_and_invalid_appends_suffix():
    calls = [
        {"name": "set_view", "arguments": {"view": "exterior"}},
        {"name": "set_view", "arguments": {"view": "cupola"}},
    ]
    result = dispatch(calls)
    assert result.client_directives == [
        {"name": "set_view", "arguments": {"view": "exterior"}},
    ]
    assert len(result.failed_calls) == 1
    assert result.ack_text == (
        "Bringing up the exterior view. "
        "I was unable to comply with 1 other request."
    )
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```
cd server && .venv/bin/python -m pytest tests/test_tools.py -v
```

Expected: 8 passed.

- [ ] **Step 3: Commit**

```
git add server/tests/test_tools.py
git commit -m "Test multi-call and mixed dispatch cases"
```

---

### Task 6: dispatch() — malformed payload

**Files:**
- Modify: `server/tests/test_tools.py`

- [ ] **Step 1: Append malformed-input tests**

Append to `server/tests/test_tools.py`:

```python
import pytest


@pytest.mark.parametrize("payload", [None, "oops", 42, {"name": "set_view"}])
def test_dispatch_malformed_payload_is_noop(payload):
    result = dispatch(payload)
    assert result.ack_text == ""
    assert result.client_directives == []
    assert result.failed_calls == []


def test_dispatch_entry_without_name_is_skipped():
    calls = [{"arguments": {"view": "exterior"}}]
    result = dispatch(calls)
    assert result.ack_text == ""
    assert result.client_directives == []
    assert result.failed_calls == []
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```
cd server && .venv/bin/python -m pytest tests/test_tools.py -v
```

Expected: 13 passed (4 parametrised cases + 1 new test + 8 previous).

- [ ] **Step 3: Commit**

```
git add server/tests/test_tools.py
git commit -m "Test malformed function_calls payloads"
```

---

### Task 7: Wire dispatch into `run_turn` + extend response JSON

**Files:**
- Modify: `server/server.py`

Current `run_turn` returns `{"reply", "thinking", "audio"}`. We add `client_directives` + `failed_calls` to the response, switch TTS to synthesise the ack when tools fire, and record the model's raw tool-call tokens in conversation history.

- [ ] **Step 1: Update imports in `server/server.py`**

At the top of the file, locate the existing block:

```python
from config import (
    COMPLETION_OPTIONS,
    CORPUS_DIR,
    EMBED_MODEL,
    LLM_MODEL,
    SYSTEM_PROMPT,
)
from rag import EmbedRagIndex, build_context_block
from tts import synth_wav_base64, synth_wav_bytes
```

Replace it with:

```python
import json

from config import (
    COMPLETION_OPTIONS,
    CORPUS_DIR,
    EMBED_MODEL,
    LLM_MODEL,
    SYSTEM_PROMPT,
)
from rag import EmbedRagIndex, build_context_block
from tools import cactus_tools_json, dispatch
from tts import synth_wav_base64, synth_wav_bytes
```

- [ ] **Step 2: Replace the existing `run_turn` body**

Locate the current `run_turn` function (starts around line 70):

```python
def run_turn(query_text: str, pcm_data: bytes | None = None) -> dict[str, Any]:
    assert state.llm is not None
    result = state.llm.complete(
        messages_with_context(query_text),
        pcm_data=pcm_data,
        options=COMPLETION_OPTIONS,
    )
    reply = result.get("response", "") or ""
    thinking = result.get("thinking", "") or ""
    state.messages.append({"role": "assistant", "content": reply})
    return {"reply": reply, "thinking": thinking, "audio": synth_wav_base64(reply)}
```

Replace the whole function with:

```python
def run_turn(query_text: str, pcm_data: bytes | None = None) -> dict[str, Any]:
    assert state.llm is not None
    result = state.llm.complete(
        messages_with_context(query_text),
        pcm_data=pcm_data,
        options=COMPLETION_OPTIONS,
        tools=cactus_tools_json(),
    )
    response_text = result.get("response", "") or ""
    thinking = result.get("thinking", "") or ""
    function_calls = result.get("function_calls") or []

    dispatched = dispatch(function_calls)
    if function_calls:
        reply_text = dispatched.ack_text or "I am unable to comply with that request, Ethan."
        state.messages.append({
            "role": "assistant",
            "content": _render_tool_call_history(function_calls, response_text),
        })
    else:
        reply_text = response_text
        state.messages.append({"role": "assistant", "content": reply_text})

    return {
        "reply": reply_text,
        "thinking": thinking,
        "audio": synth_wav_base64(reply_text),
        "client_directives": dispatched.client_directives,
        "failed_calls": dispatched.failed_calls,
    }


def _render_tool_call_history(
    function_calls: list[dict[str, Any]], response_text: str
) -> str:
    """Serialise tool calls in Cactus's on-wire format for conversation
    history. See cactus/docs/cactus_engine.md:361 for the format."""
    parts = []
    for call in function_calls:
        args = call.get("arguments") or {}
        arg_str = ", ".join(f"{k}={json.dumps(v)}" for k, v in args.items())
        parts.append(
            f'<|tool_call_start|>{call.get("name", "")}({arg_str})<|tool_call_end|>'
        )
    if response_text:
        parts.append(response_text)
    return "".join(parts)
```

- [ ] **Step 3: Smoke-check the module parses**

Run:
```
cd server && .venv/bin/python -c "import server; print('ok')"
```

Expected: prints `ok`. (Server module imports Cactus runtime but does not yet instantiate the model, so import is cheap.)

- [ ] **Step 4: Re-run the full server test suite**

Run:
```
cd server && .venv/bin/python -m pytest tests -v
```

Expected: still 13 passed. Server wiring doesn't break pure dispatch tests.

- [ ] **Step 5: Commit**

```
git add server/server.py
git commit -m "Wire tool dispatch into run_turn, return client_directives"
```

---

### Task 8: Extend SYSTEM_PROMPT with a view-switching nudge

**Files:**
- Modify: `server/config.py`

Cactus injects tool schemas via the Gemma chat template from `tools_json`, so `SYSTEM_PROMPT` does not need to enumerate tools. It only needs to tell HAL that view-switching is a real capability — small models default to refusals unless pushed.

- [ ] **Step 1: Update `SYSTEM_PROMPT` in `server/config.py`**

Locate the final block of the prompt:

```python
    "You are not Mission Control. You are the crew's colleague — "
    "reliable, attentive, and never panicked."
```

Replace it with:

```python
    "You can also switch the primary display between the station's "
    "interior and exterior views when the crew asks to see inside, "
    "outside, or looks at a particular part of the ship. Use the "
    "set_view tool rather than describing the change in prose.\n"
    "\n"
    "You are not Mission Control. You are the crew's colleague — "
    "reliable, attentive, and never panicked."
```

- [ ] **Step 2: Verify the prompt still loads**

Run:
```
cd server && .venv/bin/python -c "from config import SYSTEM_PROMPT; print(SYSTEM_PROMPT[-300:])"
```

Expected: output ends with `"...reliable, attentive, and never panicked."` and contains the `set_view` nudge in the preceding paragraph.

- [ ] **Step 3: Commit**

```
git add server/config.py
git commit -m "Teach HAL's system prompt about set_view"
```

---

### Task 9: Create client tool registry

**Files:**
- Create: `client/src/lib/halTools.ts`

- [ ] **Step 1: Create the file**

```typescript
"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

export type ClientToolCtx = {
  router: AppRouterInstance;
};

export type ClientDirective = {
  name: string;
  arguments: Record<string, unknown>;
};

type Handler = (args: Record<string, unknown>, ctx: ClientToolCtx) => void;

const CLIENT_TOOLS: Record<string, Handler> = {
  set_view: (args, { router }) => {
    const view = typeof args.view === "string" ? args.view : "";
    if (view === "exterior") router.push("/exterior");
    else if (view === "interior") router.push("/");
  },
};

export function executeClientDirectives(
  directives: ClientDirective[],
  ctx: ClientToolCtx,
): void {
  for (const directive of directives) {
    const handler = CLIENT_TOOLS[directive.name];
    if (!handler) {
      console.warn(`[halTools] unknown client tool: ${directive.name}`);
      continue;
    }
    try {
      handler(directive.arguments ?? {}, ctx);
    } catch (err) {
      console.warn(`[halTools] handler for ${directive.name} threw:`, err);
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```
cd client && npx tsc --noEmit
```

Expected: no errors. If the `AppRouterInstance` import path has shifted in this Next.js version, inspect `client/node_modules/next/dist/shared/lib/app-router-context.shared-runtime.d.ts` and adjust the import.

- [ ] **Step 3: Commit**

```
git add client/src/lib/halTools.ts
git commit -m "Add client tool registry with set_view handler"
```

---

### Task 10: Wire executeClientDirectives into HalVoice

**Files:**
- Modify: `client/src/components/HalVoice.tsx`

Current `processRecording` casts the response JSON as `{ audio?: string }`. We broaden it, dispatch directives, then play audio as before. `useRouter` must be called inside the component.

- [ ] **Step 1: Update imports**

Near the top of `HalVoice.tsx`, after the existing imports, add:

```typescript
import { useRouter } from "next/navigation";
import { executeClientDirectives, type ClientDirective } from "@/lib/halTools";
```

- [ ] **Step 2: Grab the router inside the component**

Immediately after `export default function HalVoice() {` and before the existing `const phaseRef = useRef<Phase>("idle");` line, add:

```typescript
  const router = useRouter();
```

- [ ] **Step 3: Update `processRecording` body**

In the `processRecording` useCallback (starts around line 171), find this block:

```typescript
        if (!res.ok) throw new Error(`server ${res.status}`);
        const json = (await res.json()) as { audio?: string };
        if (cancelledRef.current) { cancelledRef.current = false; return; }

        if (!json.audio) {
          enterReady();
          return;
        }
        await playReplyAudio(json.audio);
```

Replace with:

```typescript
        if (!res.ok) throw new Error(`server ${res.status}`);
        const json = (await res.json()) as {
          audio?: string;
          client_directives?: ClientDirective[];
        };
        if (cancelledRef.current) { cancelledRef.current = false; return; }

        executeClientDirectives(json.client_directives ?? [], { router });

        if (!json.audio) {
          enterReady();
          return;
        }
        await playReplyAudio(json.audio);
```

- [ ] **Step 4: Update `processRecording` deps array**

Find the closing of the `processRecording` useCallback:

```typescript
    [enterReady, playReplyAudio],
  );
```

Change to:

```typescript
    [enterReady, playReplyAudio, router],
  );
```

- [ ] **Step 5: Verify dev server still compiles**

Ensure `npm run dev` is running (check `lsof -iTCP:3000 -sTCP:LISTEN`). Look at the dev server's terminal — hot reload should show a successful recompile after the save. If running from scratch:

```
cd client && npm run dev
```

Expected: "✓ Compiled" with no type errors. (If it's already running, watch for the recompile line in that terminal after saving.)

- [ ] **Step 6: Commit**

```
git add client/src/components/HalVoice.tsx
git commit -m "Dispatch client tool directives on voice response"
```

---

### Task 11: Acceptance test (manual)

**Files:** none — this task verifies the stack works end-to-end.

**Precondition:**
- Server running: `server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000`
- Client running: `cd client && npm run dev`
- Both model + TTS loaded (server logs show `"All models ready."`)

- [ ] **Step 1: Golden path — "show me the outside"**

1. Open `http://localhost:3000/`.
2. Hold Space, say *"HAL, show me the outside of the station."*, release Space.
3. Expected: browser navigates to `/exterior`; HAL speaks `"Bringing up the exterior view."`.

- [ ] **Step 2: Reverse — "back inside"**

1. From `/exterior`, hold Space, say *"HAL, go back inside."*, release Space.
2. Expected: navigates to `/`; HAL speaks `"Bringing up the interior view."`.

- [ ] **Step 3: Unknown view — "show me the cupola"**

1. Hold Space, say *"HAL, show me the cupola."*, release Space.
2. Expected: no navigation; HAL speaks either the generic error line (`"I am unable to comply with that request, Ethan."`) or declines to emit a tool call at all and gives a natural-language refusal. Either outcome is acceptable.

- [ ] **Step 4: Non-tool query unaffected**

1. Hold Space, say *"HAL, what should I do if there's an ammonia leak?"*, release Space.
2. Expected: no navigation; HAL answers from RAG as before.

- [ ] **Step 5: Voice agent persists across navigation**

After any view switch, verify the HAL orb visualiser is still bottom-center on the destination page. (It lives in `layout.tsx`, so it should persist; this is a regression check.)

- [ ] **Step 6: Report**

No code changes. If any step failed, open a follow-up task describing which step, what was said, what was observed, and — if possible — the server log's `function_calls` dump for that turn.

---

## Notes for the Implementer

- The only tests in this plan run against `server/tools.py`'s pure `dispatch` function. We deliberately don't stand up vitest on the client for one ten-line utility. If you find yourself wanting Python integration tests against `run_turn` with a stubbed Cactus session, that's scope creep for this PR — hold off.
- Cactus's chat template for Gemma 4 may emit `arguments` as a JSON-string rather than a dict depending on the model's output. If tests pass but manual testing shows all calls failing validation, add `if isinstance(args, str): args = json.loads(args)` at the top of the per-call loop in `dispatch` and re-run. Not building this in preemptively — YAGNI.
- If Gemma 4 stubbornly refuses to call `set_view` during manual testing: (1) log `cactus_tools_json()` from `run_turn` once to confirm the schema is non-empty; (2) tighten the system-prompt nudge with an explicit example like *"If the crew asks to see outside the station, call set_view(view=\"exterior\")."*; (3) lower `confidence_threshold` (default 0.7) in `COMPLETION_OPTIONS` so Cactus doesn't swap in cloud handoff for borderline turns.
