# HAL 9000 Voice

Piper TTS inference with the pre-trained HAL voice from
[campwill/HAL-9000-Piper-TTS](https://huggingface.co/campwill/HAL-9000-Piper-TTS).

## Layout

```
voice/
├── hal_tts.py        inference (imported by server/tts.py)
├── requirements.txt  piper-tts, onnxruntime, soundfile
├── hal.onnx          voice weights — ~61 MB, gitignored
├── hal.onnx.json     voice config   — gitignored
└── README.md
```

## Install weights (per machine)

```bash
cd voice
hf download campwill/HAL-9000-Piper-TTS hal.onnx hal.onnx.json --local-dir .
```

`hf` is the `huggingface_hub` CLI (`pip install huggingface_hub` if
missing). Weights are gitignored so each machine pulls them once
from HF rather than bloating the repo.

## How the server uses it

`server/tts.py` adds this directory to `sys.path` and imports
`hal_tts`. If `hal.onnx` + `hal.onnx.json` are present, every
reply from the backend is synthesised in HAL's voice. If they're
missing, the server logs a one-line fallback message and uses
macOS `say` so you can keep developing.

## Standalone test

```bash
../server/.venv/bin/python -c "import sys; sys.path.insert(0,'.'); \
  import hal_tts, soundfile as sf; \
  w, sr = hal_tts.synthesize('I am a HAL nine thousand computer.'); \
  sf.write('/tmp/hal.wav', w, sr)"
afplay /tmp/hal.wav
```
