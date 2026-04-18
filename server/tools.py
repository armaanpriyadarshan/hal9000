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
