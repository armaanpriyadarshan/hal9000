# HAL Tool-Calling Framework — Design

**Date:** 2026-04-17
**Status:** Approved design; ready for implementation planning
**Scope:** Native Cactus tool-calling wired end-to-end, with `set_view` as the first registered tool.

## Goal

Give HAL the ability to invoke structured tools during a turn. `set_view` is the first tool: crew says "show me the outside," HAL switches the viewport to `/exterior`. The framework registration pattern is reusable so future tools (interior lighting, telemetry readings, alarm acknowledgement) are single-file additions.

## Non-goals

- Two-pass inference (model → tool result → model again). Every tool-using turn uses a single inference pass plus a templated acknowledgement string.
- Retry / reprompt on malformed tool calls. Malformed calls fail over to a generic spoken error.
- Client-side test framework. Tests scoped to the pure server-side dispatch logic only.
- Speaker identification / per-crew addressing. The generic error line is hardcoded to address Ethan for now; revisit when speaker ID lands.

## Background

Cactus's FFI already accepts a `tools_json` parameter on `cactus_complete`, and `google/gemma-4-E2B-it` is tagged with `tools` in Cactus's `models.json:11`. The engine parses the model's emitted `<|tool_call_start|>name(args)<|tool_call_end|>` tokens into a structured `function_calls: [{name, arguments}]` array in the response JSON (see `cactus/docs/cactus_engine.md:257-281`).

So the machinery is in place — we wire registration, dispatch, and client execution on top.

## Architecture

Three new/changed units:

### `server/tools.py` (new)

Single source of truth for tool definitions. Exports:

- **`TOOL_SPECS: list[ToolSpec]`** — registry entries, each:
  - `name: str`
  - `description: str` — prose HAL sees; should teach when to use the tool.
  - `parameters: dict` — OpenAI-style JSON schema.
  - `location: Literal["server", "client"]` — where the side effect runs.
  - `handler: Callable[[dict], None] | None` — for `location="server"` only; called during dispatch.
  - `ack_template: str` — Python format string rendered against the tool's arguments.

- **`cactus_tools_json() -> list[dict]`** — converts `TOOL_SPECS` into the OpenAI-style payload Cactus expects (`[{"type": "function", "function": {name, description, parameters}}]`).

- **`dispatch(function_calls: list[dict]) -> DispatchResult`** — runs every function call through JSON-schema validation + dispatch. Returns:
  ```python
  @dataclass
  class DispatchResult:
      ack_text: str                          # what TTS should synthesise
      client_directives: list[ClientDirective]  # for the browser
      failed_calls: list[FailedCall]
  ```
  Where:
  ```python
  ClientDirective = TypedDict("ClientDirective", {"name": str, "arguments": dict})
  FailedCall     = TypedDict("FailedCall",     {"name": str, "arguments": dict, "reason": str})
  ```

Validation uses the `jsonschema` package (added as a runtime dep to `server/requirements.txt`).

### `server/server.py` (modified)

`run_turn` reads `result["function_calls"]`:

- **Empty** → existing behavior. TTS the model's text reply.
- **Non-empty** → call `tools.dispatch`. TTS the `ack_text`. Include `client_directives` and `failed_calls` in the response JSON.

Conversation history stores the assistant's raw tool-call tokens verbatim, matching the Cactus docs example (`cactus/docs/cactus_engine.md:361`). This preserves follow-up coherence ("HAL, never mind, go back inside").

Both `/api/text` and `/api/voice` route through `run_turn`, so both endpoints get tool-calling for free.

### `client/src/lib/halTools.ts` (new)

Client-side tool registry.

- **`CLIENT_TOOLS: Record<string, (args: Record<string, unknown>, ctx: ClientToolCtx) => void>`** — v1 entry: `set_view`, which `router.push`es based on `args.view`.
- **`executeClientDirectives(directives, ctx)`** — iterates and dispatches. Unknown names logged with `console.warn` (defense in depth; server already filters them).

`ClientToolCtx` is `{ router: AppRouterInstance }`.

### `client/src/components/HalVoice.tsx` (modified)

After parsing the response JSON in `processRecording`, call `executeClientDirectives(json.client_directives ?? [], { router })`. Imports `useRouter` from `next/navigation`.

### `server/config.py` (modified)

Small system-prompt addition teaching HAL about the available display views and when to invoke `set_view`. Does **not** enumerate the tool schema — Cactus injects that from `tools_json` via the Gemma chat template.

## Tool Spec — `set_view`

```python
{
    "name": "set_view",
    "description": (
        "Switch the primary display between the interior and exterior views "
        "of the station. Use when the crew asks to see inside, outside, or "
        "refers to the exterior of the ship."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "view": {
                "type": "string",
                "enum": ["interior", "exterior"],
                "description": "Which view to bring up.",
            }
        },
        "required": ["view"],
    },
    "location": "client",
    "handler": None,
    "ack_template": "Bringing up the {view} view.",
}
```

Client handler:

```ts
set_view: (args, { router }) => {
  const view = args.view === "exterior" ? "/exterior" : "/";
  router.push(view);
}
```

## Data Flow (one turn)

```
Browser                   Server                         Cactus (Gemma 4)
───────                   ──────                         ────────────────
[user holds space]
[records audio]
POST /api/voice  ──────►  run_turn(pcm):
                            messages = messages_with_context(last_reply)
                            result = llm.complete(
                              messages, pcm, options,
                              tools=cactus_tools_json() ) ──► model sees tools,
                                                              emits <|tool_call_start|>
                                                              set_view(view="exterior")
                                                              <|tool_call_end|>
                          ◄── result = {
                                response: "",
                                function_calls: [
                                  {name: "set_view",
                                   arguments: {view: "exterior"}}
                                ]
                              }
                            dispatch(function_calls):
                              - lookup "set_view" in TOOL_SPECS → location=client
                              - validate args against JSON schema
                              - render ack: "Bringing up the exterior view."
                              - client_directives.append({name, arguments})
                            reply_text = ack
                            audio = tts(reply_text)
                            state.messages.append(
                              {role: "assistant",
                               content: "<|tool_call_start|>set_view(view=\"exterior\")<|tool_call_end|>"}
                            )
                          ◄── {reply, audio, client_directives, failed_calls}
◄─────────────────────
executeClientDirectives → router.push("/exterior")
playReplyAudio(audio)
```

## Response JSON Shape

Current:
```json
{"reply": "...", "thinking": "...", "audio": "..."}
```

New (additive, backwards-compatible):
```json
{
  "reply": "...",
  "thinking": "...",
  "audio": "...",
  "client_directives": [{"name": "set_view", "arguments": {"view": "exterior"}}],
  "failed_calls": []
}
```

`client_directives` and `failed_calls` default to `[]` when no tools fire.

## Error Handling

| Failure | Detection | Behavior |
|---|---|---|
| Unknown tool name | Not in `TOOL_SPECS` | Drop call; append to `failed_calls` |
| Invalid args (type / enum / missing required) | `jsonschema.validate` raises | Drop call; append to `failed_calls` |
| Server handler throws (future) | try/except in `dispatch` | Drop; append to `failed_calls` |
| Client handler throws | try/catch in `executeClientDirectives` | `console.warn`; continue other directives |
| Malformed `function_calls` payload (not list, bad shape) | Defensive parsing in `dispatch` | Treat as no tools called; fall through to text-reply path |
| All calls failed | ack composition in `dispatch` | `"I am unable to comply with that request, Ethan."` |
| Mix of valid + invalid | ack composition in `dispatch` | Valid acks, then suffix `"I was unable to comply with one other request."` |

Retry / reprompt is explicitly out of scope (would require two-pass inference).

## Testing

### Server — new file `server/tests/test_tools.py`

Seven pure-function unit tests against `tools.dispatch`:

1. Valid client call → correct directive + rendered ack.
2. Unknown tool name → `failed_calls` entry, generic ack.
3. Invalid enum arg (`set_view("cupola")`) → `failed_calls`, generic ack.
4. Missing required arg → `failed_calls`, generic ack.
5. Two valid calls → both directives in order, acks concatenated.
6. Mix of valid + invalid → valid dispatched; generic suffix appended.
7. Malformed payload (non-list, missing keys) → empty `DispatchResult`.

Runs via `server/.venv/bin/python -m pytest server/tests`. Adds `pytest` as a dev dep. (`jsonschema` is already pulled in as a runtime dep — see Architecture.)

### Client — none in v1

`executeClientDirectives` is ~10 lines; setting up vitest for one util is low-leverage. Manual browser verification instead.

### Cactus integration — manual

Model behavior is slow and nondeterministic on CPU; automated assertions are not worth the wall time. End-to-end covered by the acceptance test below.

### Acceptance test (manual, against running stack)

1. Start on `/`. Say *"HAL, show me the outside."* → navigates to `/exterior`; ack plays.
2. On `/exterior`, say *"Back inside."* → navigates to `/`; interior ack plays.
3. Say *"HAL, show me the cupola."* → stays on current page; generic error line plays.
4. Say *"HAL, what's the O2 level?"* → no navigation; HAL answers from RAG/system prompt as before.

## Open Questions

None blocking implementation. To revisit later:

- **Speaker ID.** Generic error line addresses Ethan by name — acceptable for now, but crew-specific addressing requires speaker identification.
- **Getter tools.** Single-pass + canned ack doesn't support tools whose *result* needs to be incorporated into the reply (e.g., `get_o2` → "Cabin O2 is 20.9%"). When we need them, extend the framework with a two-pass opt-in at the `ToolSpec` level.
- **System-prompt nudge wording.** The exact phrasing to add to `SYSTEM_PROMPT` belongs in the implementation plan, not the design.
