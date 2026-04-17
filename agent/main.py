"""HAL 9000 voice loop — mic in → Gemma 4 (via Cactus) → `say` TTS out.

Run with the Homebrew Python 3.14 so the Cactus FFI bindings resolve:

    /opt/homebrew/bin/python3.14 agent/main.py

Requires `cactus download google/gemma-4-E2B-it` to have been run first.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audio import record_push_to_talk
from cactus_runtime import CactusSession
from config import MODEL_NAME, SYSTEM_PROMPT, WEIGHTS_ROOT
from tools import TOOL_SCHEMAS, dispatch
from tts import speak


def resolve_weights(model_name: str) -> Path:
    short = model_name.split("/")[-1]
    for candidate in (WEIGHTS_ROOT / short, WEIGHTS_ROOT / model_name):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"Weights for {model_name} not found under {WEIGHTS_ROOT}. "
        f"Run: cactus download {model_name}"
    )


def run_turn(session: CactusSession, messages: list[dict], audio_pcm: bytes | None) -> str:
    result = session.complete(messages, tools=TOOL_SCHEMAS, pcm_data=audio_pcm)
    text = result.get("response", "")
    for call in result.get("function_calls", []) or []:
        name = call.get("name") or call.get("function", {}).get("name")
        args_raw = call.get("arguments", "{}")
        args = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
        tool_result = dispatch(name, args)
        messages.append({"role": "assistant", "content": text, "tool_calls": [call]})
        messages.append({"role": "tool", "name": name, "content": tool_result})
        follow_up = session.complete(messages, tools=TOOL_SCHEMAS)
        text = follow_up.get("response", text)
    return text


def main() -> None:
    weights = resolve_weights(MODEL_NAME)
    print(f"Loading {MODEL_NAME} from {weights}...", flush=True)

    with CactusSession(str(weights)) as session:
        print("Ready. Ctrl-C to exit.", flush=True)
        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

        while True:
            try:
                pcm = record_push_to_talk()
            except KeyboardInterrupt:
                print("\nExiting.")
                return
            if not pcm:
                continue

            messages.append({"role": "user", "content": "(user spoke)"})
            reply = run_turn(session, messages, pcm)
            messages.append({"role": "assistant", "content": reply})
            print(f"HAL: {reply}", flush=True)
            speak(reply)


if __name__ == "__main__":
    main()
