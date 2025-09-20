#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_RESTART="$ROOT_DIR/a0/tools/scripts/restart.sh"
if [[ -x "$AGENT_RESTART" ]]; then
  exec "$AGENT_RESTART" --service webui "$@"
fi
# Fallback to run_ui.py
if command -v python3 >/dev/null 2>&1; then
  exec python3 "$ROOT_DIR/a0/run_ui.py" "$@"
else
  exec python "$ROOT_DIR/a0/run_ui.py" "$@"
fi
