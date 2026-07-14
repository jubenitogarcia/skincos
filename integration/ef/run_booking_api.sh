#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export EF_MODE="${EF_MODE:-booking_api}"
export EF_NON_INTERACTIVE="${EF_NON_INTERACTIVE:-1}"

exec ./.venv/bin/python run_scraper.py
