"""Tool registry + dispatch for HAL.

Every tool HAL can call is a `ToolSpec` in `TOOL_SPECS`. `cactus_tools_json()`
renders the registry into the OpenAI-style payload Cactus expects on
`cactus_complete(tools_json=...)`. `dispatch()` validates incoming
function_calls and produces ack text + client directives.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal, TypedDict

from jsonschema import Draft202012Validator, ValidationError


Location = Literal["server", "client"]


@dataclass(frozen=True)
class ToolSpec:
    """Registry entry for one tool HAL can call.

    `ack_template` is a Python format-string rendered against the call's
    validated arguments. Every `{placeholder}` in the template must
    correspond to a key that is required (or otherwise guaranteed present)
    by `parameters` — otherwise `dispatch()` will raise KeyError at
    format time.
    """

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


@dataclass
class DispatchResult:
    ack_text: str = ""
    client_directives: list[ClientDirective] = field(default_factory=list)
    failed_calls: list[FailedCall] = field(default_factory=list)


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
    ToolSpec(
        name="highlight_part",
        description=(
            "Highlight a labeled section of the station on the exterior "
            "view. Auto-switches to the exterior if the crew is currently "
            "inside, so you do NOT need to call set_view first. The crew "
            "may refer to parts using natural language — map their wording "
            "to one of the canonical names below:\n"
            "- solar_arrays — solar arrays, solar panels, wings, arrays\n"
            "- service_module — Zvezda, service module, Russian segment\n"
            "- p6_truss — P6 truss, port truss, far port, port-end truss\n"
            "- s0_truss — S0 truss, center truss, backbone, central truss\n"
            "- external_stowage — ESP, external stowage, stowage platforms\n"
            "- ams_experiment — AMS, AMS-2, magnetic spectrometer, physics experiment\n"
            "- main_modules — main modules, pressurised modules, habitation"
        ),
        parameters={
            "type": "object",
            "properties": {
                "part": {
                    "type": "string",
                    "enum": [
                        "solar_arrays",
                        "service_module",
                        "p6_truss",
                        "s0_truss",
                        "external_stowage",
                        "ams_experiment",
                        "main_modules",
                    ],
                    "description": "Canonical name of the part to highlight.",
                },
            },
            "required": ["part"],
        },
        location="client",
        ack_template="Highlighting the {part}.",
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
        if spec.location == "server":
            if spec.handler is not None:
                try:
                    spec.handler(args)
                except Exception as e:  # noqa: BLE001
                    result.failed_calls.append(
                        {"name": name, "arguments": args, "reason": f"handler error: {e}"}
                    )
                    continue
            # Server tool with no handler is a no-op — still emit the ack.
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
