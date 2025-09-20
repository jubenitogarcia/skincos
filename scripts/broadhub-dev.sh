#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BH_DIR="$ROOT_DIR/broadhub"
cd "$BH_DIR"
if [[ -f "run.sh" ]]; then
  exec bash run.sh
fi
if [[ -f "main.py" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    exec python3 main.py
  else
    exec python main.py
  fi
fi
echo "[broadhub-dev] Could not find run.sh or main.py" >&2
exit 1
