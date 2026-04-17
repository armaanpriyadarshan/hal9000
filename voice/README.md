# HAL 9000 Voice

Piper TTS inference with a pre-trained HAL voice. The ONNX weights
come from [campwill/HAL-9000-Piper-TTS](https://huggingface.co/campwill/HAL-9000-Piper-TTS)
on Hugging Face — no training needed on our side.

## Layout

```
voice/
├── audio/                  96 HAL clips (the original training set,
│                            kept for reference / future retraining)
├── metadata.csv            file_name,text pairs for those clips
├── hal9000_reference.wav   concatenated reference (legacy)
├── preprocess.py           HF CSV → piper1-gpl pipe CSV (optional,
│                            only used if you want to retrain)
├── hal_tts.py              inference — loads hal.onnx, used by server/tts.py
├── requirements.txt        piper-tts, onnxruntime, soundfile
├── hal.onnx                trained weights (gitignored; see below)
└── hal.onnx.json           voice config (gitignored)
```

## Install the weights

On any new machine:

```bash
cd voice
hf download campwill/HAL-9000-Piper-TTS hal.onnx hal.onnx.json --local-dir .
```

(`hf` is the CLI from `huggingface_hub`; `pip install huggingface_hub`
if it's missing.)

Two files land: `hal.onnx` (~61 MB) and `hal.onnx.json`. Both are
gitignored so everyone pulls them from HF rather than bloating the
repo.

## How the server uses it

`server/tts.py` adds this directory to `sys.path` and imports
`hal_tts`. If `hal.onnx` + `hal.onnx.json` are present, every
reply from the backend is synthesised in HAL's voice. If they're
missing, the server logs a one-line fallback and uses macOS `say`
so you can keep developing.

## Standalone check

```bash
python -c "import hal_tts, soundfile as sf; \
  w, sr = hal_tts.synthesize('I am a HAL nine thousand computer.'); \
  sf.write('/tmp/hal.wav', w, sr)"
afplay /tmp/hal.wav
```

The `piper-tts` package needs to be on the Python path — either run
inside `server/.venv` (where it's installed with the other server
deps) or `pip install -r requirements.txt` into a fresh env.

## Retraining (optional, not required)

The dataset in `audio/` + `metadata.csv` is what produced the HF
weights. If you ever want to retrain or fine-tune further, see
[piper1-gpl's TRAINING.md](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/TRAINING.md).
`preprocess.py` can convert our HF-style CSV into the pipe-
delimited format piper1-gpl expects.
