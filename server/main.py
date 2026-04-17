"""HAL 9000 voice loop.

Pipeline per turn:
    mic (push-to-talk) -> Gemma 4 E2B native audio completion -> macOS `say`

Run with:
    agent/.venv/bin/python agent/main.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audio import record_push_to_talk
from cactus_runtime import CactusSession
from config import COMPLETION_OPTIONS, LLM_MODEL, SYSTEM_PROMPT
from tools import TOOL_SCHEMAS, dispatch
from tts import speak


def run_turn(llm: CactusSession, messages: list[dict], pcm_data: bytes | None) -> str:
    result = llm.complete(
        messages, tools=TOOL_SCHEMAS, pcm_data=pcm_data, options=COMPLETION_OPTIONS
    )
    text = result.get("response", "")
    for call in result.get("function_calls") or []:
        name = call.get("name") or call.get("function", {}).get("name")
        args_raw = call.get("arguments", "{}")
        args = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
        tool_output = dispatch(name, args)
        messages.append({"role": "assistant", "content": text, "tool_calls": [call]})
        messages.append(
            {
                "role": "tool",
                "content": json.dumps({"name": name, "content": tool_output}),
            }
        )
        follow_up = llm.complete(messages, tools=TOOL_SCHEMAS, options=COMPLETION_OPTIONS)
        text = follow_up.get("response", text)
    return text


def main() -> None:
    print("Loading Gemma 4 E2B...", flush=True)
    with CactusSession(LLM_MODEL) as llm:
        print("Ready. Ctrl-C to exit.\n", flush=True)

        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

        while True:
            try:
                pcm = record_push_to_talk()
            except KeyboardInterrupt:
                print("\nExiting.")
                return
            if not pcm:
                continue

            messages.append({"role": "user", "content": ""})
            try:
                reply = run_turn(llm, messages, pcm)
            except RuntimeError as e:
                print(f"[error] {e}")
                messages.pop()
                continue
            messages.append({"role": "assistant", "content": reply})
            print(f"HAL: {reply}\n", flush=True)
            speak(reply)


if __name__ == "__main__":
    main()
