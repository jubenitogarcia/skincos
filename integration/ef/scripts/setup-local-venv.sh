#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
VENV_DIR="${EF_SCRAPER_VENV_DIR:-$ROOT_DIR/.venv}"
if [[ "$VENV_DIR" != /* ]]; then
  echo "EF_SCRAPER_VENV_DIR must be an absolute local path." >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is not available in this local POSIX environment." >&2
  exit 1
fi
if [[ ! -f requirements.lock ]]; then
  echo "requirements.lock is missing from $ROOT_DIR." >&2
  exit 1
fi
if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
fi
if [[ ! -x "$VENV_DIR/bin/python" || ! -x "$VENV_DIR/bin/pip" ]]; then
  echo "The local Python environment is incomplete. Inspect EF_SCRAPER_VENV_DIR before setup." >&2
  exit 1
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/pip" install -r requirements.lock
echo "[ef-app] Local Python environment is ready."
