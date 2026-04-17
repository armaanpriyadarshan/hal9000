# HAL 9000 Voice

Piper TTS voice trained locally on the 96 HAL 9000 clips in this
directory.

## Layout

```
voice/
├── audio/                  96 source clips (HAL lines from the film)
├── metadata.csv            file_name,text — original HF CSV
├── hal9000_reference.wav   legacy concatenated reference (unused)
├── preprocess.py           metadata.csv → metadata_piper.csv
├── train.sh                kicks off piper1-gpl fine-tune on MPS
├── export.sh               latest checkpoint → hal.onnx
├── hal_tts.py              inference module (used by server/tts.py)
├── requirements.txt        inference deps only (piper-tts, onnxruntime)
├── piper-train/            piper1-gpl clone + its own venv (gitignored)
├── checkpoints/            base Piper checkpoints (gitignored)
├── piper_cache/            training artifacts (gitignored)
├── lightning_logs/         training runs (gitignored)
├── hal.onnx                trained model — produced by export.sh (gitignored)
└── hal.onnx.json           voice config — written during training (gitignored)
```

## Training on this Mac

Prereqs already installed: `espeak-ng`, `cmake`, `ninja`,
`piper1-gpl` in `piper-train/.venv`, monotonic-align cython built,
base checkpoint in `checkpoints/`.

```bash
cd voice
python3.12 preprocess.py                 # writes metadata_piper.csv
source piper-train/.venv/bin/activate
./train.sh
```

`train.sh` runs the Lightning fine-tune from `en_US-lessac-medium`
on Apple MPS (Metal) with batch size 8, up to 3000 epochs. On an
M-series Mac expect somewhere in the **2–6 hour** range before the
voice clearly shifts toward HAL. Monitor the sample WAVs Piper
dumps into `lightning_logs/version_N/` — stop when they sound right.

Kill the run any time with Ctrl-C; Lightning saves a checkpoint on
shutdown. Re-run `./train.sh` to resume from the last checkpoint
(add `--ckpt_path lightning_logs/...` in the script if you want to
resume explicitly instead of re-using the base checkpoint).

## Exporting the trained voice

```bash
source piper-train/.venv/bin/activate
./export.sh
```

Writes `hal.onnx` next to `hal.onnx.json` (the config was already
produced during training). Restart the server; `hal_tts.py` picks
them up on the next synthesis call.

## Inference

Once `hal.onnx` exists in this directory, `server/tts.py` imports
`hal_tts.py` via a shared-path hack, and every reply is spoken in
the trained voice. Until then, the server falls back to macOS `say`
(you'll see a single log line at startup).

Quick standalone test:

```bash
source piper-train/.venv/bin/activate
python -c "import sys; sys.path.insert(0,'.'); import hal_tts, soundfile as sf; \
  w, sr = hal_tts.synthesize('I am a HAL nine thousand computer.'); \
  sf.write('/tmp/hal.wav', w, sr)"
afplay /tmp/hal.wav
```

## Notes

- 96 clips (~2-3 minutes of audio after silence trimming) is very
  small. The Lessac checkpoint does 95% of the work; fine-tuning
  just nudges the voice toward HAL. Expect a *recognisable*
  impression, not a flawless Douglas Rain clone.
- Training on MPS is noticeably slower than a real CUDA GPU. If
  quality isn't converging fast enough, move training to a Colab
  T4/A100 and copy `hal.onnx` + `hal.onnx.json` back into `voice/`.
- The audio is 48 kHz 32-bit float mono; Piper resamples to 22050
  internally to match the medium-quality base checkpoint.
