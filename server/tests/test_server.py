"""Unit tests for server.py helpers (not full-stack integration)."""

import pytest

from server import _clean_response


def test_clean_response_empty():
    assert _clean_response("") == ""


def test_clean_response_no_markers_passes_through():
    assert _clean_response("Hello, crew.") == "Hello, crew."


def test_clean_response_strips_thinking_preamble():
    text = "<|channel|>thought\nThinking Process...\n<|channel|>final\nHello crew."
    assert _clean_response(text) == "Hello crew."


def test_clean_response_strips_single_trailing_marker_with_newline():
    text = "<|channel|>final\nOnly the final reply."
    assert _clean_response(text) == "Only the final reply."


def test_clean_response_strips_marker_without_trailing_newline():
    # Edge case: marker as the last thing in the string, no newline after.
    text = "<|channel|>final"
    assert _clean_response(text) == ""


@pytest.mark.parametrize("whitespace", ["  hello  ", "\nhello\n", "hello"])
def test_clean_response_trims_whitespace(whitespace):
    assert _clean_response(whitespace) == "hello"
