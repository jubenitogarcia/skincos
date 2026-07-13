#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRAPER_DIR="$ROOT_DIR/backend/apps/automations/scraper"
RUNTIME_HOME="${BOOKING_API_RUNTIME_HOME:-/mnt/c/CodexRuntime/booking-api}"
ENV_FILE="${SKINCOS_BOOKING_API_ENV_FILE:-$RUNTIME_HOME/env/booking-api.env}"
VENV_DIR="${EF_SCRAPER_VENV_DIR:-$RUNTIME_HOME/venv}"

mkdir -p \
  "$RUNTIME_HOME/env" \
  "$RUNTIME_HOME/debug" \
  "$RUNTIME_HOME/logs" \
  "$RUNTIME_HOME/report" \
  "$RUNTIME_HOME/chrome-profile"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "[migration] Missing booking-api virtualenv at $VENV_DIR" >&2
  echo "[migration] Run scripts/migration/bootstrap-booking-api-venv.sh first." >&2
  exit 1
fi

export EF_MODE="${EF_MODE:-booking_api}"
export EF_NON_INTERACTIVE="${EF_NON_INTERACTIVE:-1}"
export EF_BOOKING_API_HOST="${EF_BOOKING_API_HOST:-127.0.0.1}"
export EF_BOOKING_API_PORT="${EF_BOOKING_API_PORT:-8765}"
export EF_OUTPUT_DIR="${EF_OUTPUT_DIR:-$RUNTIME_HOME/report}"
export EF_DEBUG_DIR="${EF_DEBUG_DIR:-$RUNTIME_HOME/debug}"
export EF_LOG_DIR="${EF_LOG_DIR:-$RUNTIME_HOME/logs}"
export EF_CHROME_USER_DATA_DIR="${EF_CHROME_USER_DATA_DIR:-$RUNTIME_HOME/chrome-profile}"

cd "$SCRAPER_DIR"
exec "$VENV_DIR/bin/python" run_scraper.py
