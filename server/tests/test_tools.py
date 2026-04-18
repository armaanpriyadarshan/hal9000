"""Unit tests for server/tools.py — registry and dispatch."""

import pytest

from tools import TOOL_SPECS, cactus_tools_json
from tools import DispatchResult, dispatch


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


def test_dispatch_valid_set_view_returns_directive_and_ack():
    calls = [{"name": "set_view", "arguments": {"view": "exterior"}}]
    result = dispatch(calls)
    assert isinstance(result, DispatchResult)
    assert result.ack_text == "Bringing up the exterior view."
    assert result.client_directives == [
        {"name": "set_view", "arguments": {"view": "exterior"}}
    ]
    assert result.failed_calls == []


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


EXPECTED_HIGHLIGHT_PART_ENUM = [
    "solar_arrays",
    "service_module",
    "p6_truss",
    "s0_truss",
    "external_stowage",
    "ams_experiment",
    "main_modules",
]


def test_highlight_part_is_registered():
    spec = next((s for s in TOOL_SPECS if s.name == "highlight_part"), None)
    assert spec is not None, "highlight_part missing from TOOL_SPECS"
    assert spec.location == "client"
    assert spec.parameters["required"] == ["part"]
    enum = spec.parameters["properties"]["part"]["enum"]
    assert list(enum) == EXPECTED_HIGHLIGHT_PART_ENUM


def test_highlight_part_description_covers_every_canonical_name():
    spec = next((s for s in TOOL_SPECS if s.name == "highlight_part"), None)
    assert spec is not None
    for name in EXPECTED_HIGHLIGHT_PART_ENUM:
        assert name in spec.description, f"canonical name {name!r} missing from description"
