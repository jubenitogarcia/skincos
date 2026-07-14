#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_HOME="${CRM_RUNTIME_HOME:-/mnt/c/CodexRuntime/crm-api}"
ENV_FILE="${SKINCOS_CRM_API_ENV_FILE:-$RUNTIME_HOME/env/crm-api.env}"

mkdir -p "$RUNTIME_HOME/var" "$RUNTIME_HOME/var/logs" "$RUNTIME_HOME/var/pids"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export ROOT_DIR
export BACKEND_DIR="${BACKEND_DIR:-$ROOT_DIR/backend}"
export FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR/crm/console}"
export CONFIG_DIR="${CONFIG_DIR:-$ROOT_DIR/backend/config}"
export VAR_DIR="${VAR_DIR:-$RUNTIME_HOME/var}"

exec "$ROOT_DIR/crm/api/scripts/run.sh" start --port "${CRM_API_PORT:-${PORT:-8099}}"
