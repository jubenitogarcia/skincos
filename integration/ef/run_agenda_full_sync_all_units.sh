#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

sync_env_file="${EF_AGENDA_SYNC_ENV_FILE:-$HOME/.config/espacofacial/agenda_sync.env}"
if [ -f "$sync_env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$sync_env_file"
  set +a
fi

login_env_file="${EF_LOGIN_ENV_FILE:-$HOME/.config/espacofacial/login.env}"
if [ -f "$login_env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$login_env_file"
  set +a
fi

if [ -x "./.venv/bin/python" ]; then
  PY="./.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY="python3"
elif command -v python >/dev/null 2>&1; then
  PY="python"
else
  echo "ERROR: Python not found. Install Python 3 and try again." >&2
  exit 127
fi

units_raw="${EF_UNITS:-${EF_UNIT_OPTIONS:-BarraShoppingSul,Novo Hamburgo}}"
base_output="${EF_OUTPUT_BASE_DIR:-$(pwd)/report}"

IFS=',' read -r -a units <<< "$units_raw"

if [ "${#units[@]}" -eq 0 ]; then
  echo "ERROR: No units defined. Set EF_UNITS or EF_UNIT_OPTIONS." >&2
  exit 2
fi

if [ -z "${EF_AGENDA_SYNC_URL:-}" ] || [ -z "${EF_AGENDA_SYNC_TOKEN:-}" ]; then
  echo "ERROR: Full sync requires EF_AGENDA_SYNC_URL and EF_AGENDA_SYNC_TOKEN." >&2
  exit 2
fi

for unit in "${units[@]}"; do
  unit="$(echo "$unit" | xargs)"
  if [ -z "$unit" ]; then
    continue
  fi
  safe_unit="$(echo "$unit" | tr ' /' '__' | tr -cd '[:alnum:]_-')"
  if [ -z "$safe_unit" ]; then
    safe_unit="unit"
  fi
  output_dir="${base_output}/${safe_unit}"
  mkdir -p "$output_dir"

  EF_MODE="agenda" \
  EF_NON_INTERACTIVE="${EF_NON_INTERACTIVE:-1}" \
  EF_AGENDA_SYNC_FULL="1" \
  EF_UNIT_NAME="$unit" \
  EF_OUTPUT_DIR="$output_dir" \
  "${PY}" "run_scraper.py"
done
