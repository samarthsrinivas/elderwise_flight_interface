#!/usr/bin/env bash
# Fetches the on-device ML assets Elderwise needs so that face/iris tracking
# runs fully offline. Run once after `bun install`; outputs are git-ignored.
#
#   bun run models:fetch
#
# - MediaPipe Face Landmarker model (face mesh + iris + blendshapes)
# - MediaPipe tasks-vision WASM runtime (copied from node_modules)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="$ROOT/public/models"
WASM_DIR="$ROOT/public/mediapipe/wasm"
MODEL_URL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

mkdir -p "$MODEL_DIR" "$WASM_DIR"

if [ ! -s "$MODEL_DIR/face_landmarker.task" ]; then
  echo "Downloading face_landmarker.task ..."
  curl -fsSL --retry 3 -o "$MODEL_DIR/face_landmarker.task" "$MODEL_URL"
else
  echo "face_landmarker.task already present"
fi

echo "Copying MediaPipe WASM runtime ..."
cp "$ROOT"/node_modules/@mediapipe/tasks-vision/wasm/* "$WASM_DIR/"

echo "Done. Assets:"
ls -la "$MODEL_DIR" "$WASM_DIR"
