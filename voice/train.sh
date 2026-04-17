#!/usr/bin/env bash
# Fine-tune Piper (en_US-lessac-medium base) on the HAL dataset,
# on this Mac's MPS (Apple GPU). Produces:
#   voice/piper_cache/            training cache (gitignored)
#   voice/hal.onnx.json           voice config (copied to voice/ after export)
#   voice/lightning_logs/         checkpoints + sample WAVs
#
# Export the trained model to voice/hal.onnx with export.sh after
# training has converged.
#
# Before running:
#   python preprocess.py   # produces metadata_piper.csv
#   (checkpoints/ is populated by the setup step)

set -euo pipefail
cd "$(dirname "$0")"

python3 -m piper.train fit \
  --data.voice_name hal \
  --data.csv_path metadata_piper.csv \
  --data.audio_dir audio/ \
  --model.sample_rate 22050 \
  --data.espeak_voice en-us \
  --data.cache_dir piper_cache/ \
  --data.config_path hal.onnx.json \
  --data.batch_size 8 \
  --trainer.accelerator mps \
  --trainer.devices 1 \
  --trainer.max_epochs 3000 \
  --trainer.default_root_dir . \
  --ckpt_path "checkpoints/en/en_US/lessac/medium/epoch=2164-step=1355540.ckpt" \
  "$@"
