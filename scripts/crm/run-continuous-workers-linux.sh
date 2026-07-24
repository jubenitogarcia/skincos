#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_HOME="${CRM_RUNTIME_HOME:-/var/lib/skincos-runtime/crm}"
ENV_FILE="${SKINCOS_CRM_API_ENV_FILE:-/etc/skincos/crm.env}"
JOBS_ENV_FILE="${SKINCOS_CRM_JOBS_ENV_FILE:-/etc/skincos/crm-jobs.env}"

mkdir -p "$RUNTIME_HOME/var" "$RUNTIME_HOME/var/logs" "$RUNTIME_HOME/var/pids"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
if [[ -f "$JOBS_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$JOBS_ENV_FILE"
  set +a
fi

if [[ "${CRM_CONTINUOUS_WORKERS_ENABLED:-0}" != "1" ]]; then
  echo "crm-jobs activation refused: set CRM_CONTINUOUS_WORKERS_ENABLED=1 in the private crm-jobs environment file" >&2
  exit 78
fi

export VAR_DIR="${VAR_DIR:-$RUNTIME_HOME/var}"
export HARMONIA_WORKER=1
exec node "$ROOT_DIR/crm/api/continuous-worker.js"
