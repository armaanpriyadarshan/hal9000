"""Tool definitions for HAL 9000. Currently stubs — wire to real data sources
as you build them out.
"""

from typing import Any

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "lookup_procedure",
            "description": "Look up an emergency procedure or technical checklist by keyword.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Procedure name or symptom"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_telemetry",
            "description": "Read current vehicle telemetry for a subsystem.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subsystem": {
                        "type": "string",
                        "enum": ["life_support", "propulsion", "power", "thermal", "comms"],
                    },
                },
                "required": ["subsystem"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_crew_health",
            "description": "Get the most recent crew health readings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "crew_member": {"type": "string"},
                },
                "required": ["crew_member"],
            },
        },
    },
]


def dispatch(name: str, arguments: dict[str, Any]) -> str:
    """Route a tool call to its handler. Replace stub returns with real
    data sources (RAG over docs, live telemetry bus, medical sensors).
    """
    if name == "lookup_procedure":
        return f"[stub] No procedure index loaded for query: {arguments.get('query')!r}"
    if name == "read_telemetry":
        return f"[stub] Telemetry bus not connected for subsystem: {arguments.get('subsystem')!r}"
    if name == "get_crew_health":
        return f"[stub] Health sensors offline for: {arguments.get('crew_member')!r}"
    return f"[stub] Unknown tool: {name}"
