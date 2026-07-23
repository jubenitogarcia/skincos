#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_HOME="${CRM_RUNTIME_HOME:-/var/lib/skincos-runtime/crm}"
ENV_FILE="${SKINCOS_CRM_API_ENV_FILE:-/etc/skincos/crm.env}"

mkdir -p "$RUNTIME_HOME/var" "$RUNTIME_HOME/var/logs" "$RUNTIME_HOME/var/pids"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export VAR_DIR="${VAR_DIR:-$RUNTIME_HOME/var}"
export HARMONIA_WORKER=1
exec node "$ROOT_DIR/crm/api/continuous-worker.js"
