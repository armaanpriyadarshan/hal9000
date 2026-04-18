"""Unit tests for server/tools.py — registry and dispatch."""

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
