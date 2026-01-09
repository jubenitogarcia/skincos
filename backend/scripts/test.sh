#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") <unit|compile|repo-health>

Commands:
  unit        Run pytest unit tests (backend/tests/unit)
  compile     Python compileall for backend packages
  repo-health Run backend/scripts/e2e.sh health (best-effort)

Notes:
  - Manual scripts live under backend/tests/manual/ (not collected by pytest).
EOF
}

cmd=${1:-}
shift || true

case "$cmd" in
  unit)
    if ! command -v python3 >/dev/null 2>&1; then
      echo "[test] python3 not found" >&2
      exit 2
    fi
    if ! python3 -c "import pytest" >/dev/null 2>&1; then
      echo "[test] pytest not installed. Install dev deps (e.g. python3 -m pip install -r backend/requirements-dev.txt)" >&2
      exit 2
    fi
    exec python3 -m pytest "$BACKEND_DIR/tests/unit" "$@"
    ;;
  compile)
    if ! command -v python3 >/dev/null 2>&1; then
      echo "[test] python3 not found" >&2
      exit 2
    fi
    exec python3 -B -m compileall -q "$BACKEND_DIR"
    ;;
  repo-health)
    exec bash "$BACKEND_DIR/scripts/e2e.sh" health
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "[test] Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
