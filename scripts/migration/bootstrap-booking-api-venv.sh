#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRAPER_DIR="$ROOT_DIR/backend/apps/automations/scraper"
RUNTIME_HOME="${BOOKING_API_RUNTIME_HOME:-/mnt/c/CodexRuntime/booking-api}"
VENV_DIR="${EF_SCRAPER_VENV_DIR:-$RUNTIME_HOME/venv}"
REQUIREMENTS_FILE="${BOOKING_API_REQUIREMENTS_FILE:-$SCRAPER_DIR/requirements.lock}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found in WSL." >&2
  exit 1
fi

mkdir -p "$RUNTIME_HOME"

if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install -r "$REQUIREMENTS_FILE"

echo "booking-api virtualenv ready at $VENV_DIR"
