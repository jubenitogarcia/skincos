#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is not available in Ubuntu-24.04." >&2
  exit 1
fi
if [[ ! -f requirements.lock ]]; then
  echo "requirements.lock is missing from $ROOT_DIR." >&2
  exit 1
fi
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
if [[ ! -x .venv/bin/python || ! -x .venv/bin/pip ]]; then
  echo "The Linux Python environment is incomplete. Remove .venv in WSL and run setup again." >&2
  exit 1
fi

./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/pip install -r requirements.lock
echo "[ef-app] Ubuntu Python environment is ready."
