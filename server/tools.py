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

from telemetry import ShipState


Location = Literal["server", "client"]


# Server-tool handlers may optionally return a string, which overrides
# the ack_template for that call. Procedures use this to speak the
# human-readable result ("Hatches closed. Cabin is sealed.") instead
# of a generic template — the procedure knows exactly what happened.
HandlerReturn = str | None


@dataclass(frozen=True)
class ToolSpec:
    """Registry entry for one tool HAL can call.

    `ack_template` is a Python format-string rendered against the call's
    validated arguments. Every `{placeholder}` in the template must
    correspond to a key that is required (or otherwise guaranteed present)
    by `parameters` — otherwise `dispatch()` will raise KeyError at
    format time. Server-tool handlers may also return a string to
    override the rendered ack for that invocation.
    """

    name: str
    description: str
    parameters: dict[str, Any]
    location: Location
    ack_template: str
    handler: Callable[[dict[str, Any]], HandlerReturn] | None = None


# Module-level reference to the running physics sim, so server-tool
# handlers can mutate state. server.py sets this once in the FastAPI
# lifespan after ShipState is constructed.
_ship_state: ShipState | None = None


def set_ship_state(ship: ShipState | None) -> None:
    global _ship_state
    _ship_state = ship


def _execute_procedure_handler(args: dict[str, Any]) -> HandlerReturn:
    """Dispatch an emergency-response procedure into the physics sim.
    Returns the procedure's confirmation line so HAL speaks the
    situation-specific ack ("Hatches closed. Cabin is sealed.") rather
    than the generic ack_template."""
    # Import here to avoid a circular at module import; procedures
    # depends on telemetry which is fine but keeps this file's
    # imports minimal.
    from procedures import execute as execute_procedure

    if _ship_state is None:
        raise RuntimeError("physics sim not initialised")
    return execute_procedure(_ship_state, args["action"])


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
    ToolSpec(
        name="execute_procedure",
        description=(
            "Execute an on-board emergency-response procedure. Only "
            "call this when the crew has explicitly requested a fix "
            "or confirmed an offer to apply a procedure. The named "
            "action mutates the ship state to reverse the damage of "
            "the corresponding anomaly (closes hatches to stop a "
            "leak, restores CDRA to scrub accumulated CO2, etc.). "
            "Accepts one of:\n"
            "- seal_breach: close hatches, stop cabin leak\n"
            "- recover_cdra: restore CDRA, scrub elevated pCO2\n"
            "- isolate_nh3_loop: shut off leaking external ammonia "
            "loop and halt cabin-side NH3 ingress\n"
            "- suppress_fire: deploy fire suppression, restore "
            "cabin cooling\n"
            "- desaturate_cmgs: execute desaturation burn, zero "
            "stored CMG momentum\n"
        ),
        parameters={
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "seal_breach",
                        "recover_cdra",
                        "isolate_nh3_loop",
                        "suppress_fire",
                        "desaturate_cmgs",
                    ],
                    "description": "Canonical name of the procedure to run.",
                },
            },
            "required": ["action"],
        },
        location="server",
        ack_template="Executing {action}.",  # overridden by handler return
        handler=_execute_procedure_handler,
    ),
    ToolSpec(
        name="navigate_to",
        description=(
            "Fly the interior camera through the station to one of the "
            "pressurised modules. Camera-only — no mesh highlighting. "
            "Auto-switches to the interior view if the crew is currently "
            "outside, so you do NOT need to call set_view first. Map the "
            "crew's natural phrasing to one of the canonical names below:\n"
            "- pmm — PMM, Leonardo, Permanent Multipurpose Module, stowage module\n"
            "- unity — Unity, Node 1, central node\n"
            "- harmony — Harmony, Node 2, forward node\n"
            "- tranquility — Tranquility, Node 3, life-support node\n"
            "- cupola — Cupola, observation dome, the window\n"
            "- destiny — Destiny, US Lab, US Laboratory, main lab\n"
            "- columbus — Columbus, ESA lab, European lab\n"
            "- kibo_jpm — Kibo, JPM, Japanese Pressurised Module, main Japanese lab\n"
            "- kibo_jlp — JLP, Kibo Logistics, Japanese Experiment Logistics Module, Kibo attic\n"
            "- airlock — Quest, airlock, EVA prep, spacewalk prep"
        ),
        parameters={
            "type": "object",
            "properties": {
                "area": {
                    "type": "string",
                    "enum": [
                        "pmm",
                        "unity",
                        "harmony",
                        "tranquility",
                        "cupola",
                        "destiny",
                        "columbus",
                        "kibo_jpm",
                        "kibo_jlp",
                        "airlock",
                    ],
                    "description": "Canonical name of the module to fly to.",
                },
            },
            "required": ["area"],
        },
        location="client",
        ack_template="Navigating to the {area}.",
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
        dynamic_ack: str | None = None
        if spec.location == "server":
            if spec.handler is not None:
                try:
                    dynamic_ack = spec.handler(args)
                except Exception as e:  # noqa: BLE001
                    result.failed_calls.append(
                        {"name": name, "arguments": args, "reason": f"handler error: {e}"}
                    )
                    continue
            # Server tool with no handler is a no-op — still emit the ack.
        else:
            result.client_directives.append({"name": name, "arguments": args})
        ack_line = dynamic_ack if dynamic_ack else spec.ack_template.format(**args)
        result.ack_text = _append(result.ack_text, ack_line)
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
