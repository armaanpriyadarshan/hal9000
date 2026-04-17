#!/usr/bin/env bash
# Export the latest training checkpoint to voice/hal.onnx + hal.onnx.json
# so server/tts.py can load it.

set -euo pipefail
cd "$(dirname "$0")"

LATEST_CKPT="$(ls -t lightning_logs/version_*/checkpoints/*.ckpt 2>/dev/null | head -1)"
if [ -z "$LATEST_CKPT" ]; then
  echo "No checkpoint found under lightning_logs/. Run train.sh first." >&2
  exit 1
fi
echo "exporting $LATEST_CKPT"

python3 -m piper.train.export_onnx \
  --checkpoint "$LATEST_CKPT" \
  --output-file hal.onnx

echo "wrote hal.onnx + hal.onnx.json (already at voice/hal.onnx.json from training)"
