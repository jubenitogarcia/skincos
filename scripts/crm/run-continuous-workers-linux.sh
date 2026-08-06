#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT_DIR/crm/api"

enabled="${CRM_CONTINUOUS_WORKERS_ENABLED:-0}"
if [[ "$enabled" != "1" ]]; then
  echo "[crm-continuous-workers] disabled; set CRM_CONTINUOUS_WORKERS_ENABLED=1 in the private runtime environment" >&2
  exit 78
fi

mode="${CRM_CONTINUOUS_WORKERS_MODE:-observe}"
case "${mode,,}" in
  disabled|observe) ;;
  assisted)
    if [[ "${CRM_CONTINUOUS_WORKERS_ASSISTED_CONFIRMED:-0}" != "1" ]]; then
      echo "[crm-continuous-workers] assisted mode requires CRM_CONTINUOUS_WORKERS_ASSISTED_CONFIRMED=1" >&2
      exit 78
    fi
    ;;
  *)
    echo "[crm-continuous-workers] invalid mode: $mode (expected disabled, observe or assisted)" >&2
    exit 64
    ;;
esac

case "${CRM_CONTINUOUS_WORKER_HOST:-127.0.0.1}" in
  127.0.0.1|::1) ;;
  *)
    echo "[crm-continuous-workers] health host must be loopback-only" >&2
    exit 64
    ;;
esac

cd "$APP_DIR"
if [[ ! -d "$APP_DIR/node_modules/express" ]]; then
  echo "[crm-continuous-workers] dependencies are not provisioned; refusing runtime installation" >&2
  exit 78
fi

export CRM_CONTINUOUS_WORKERS_ENABLED=1
export CRM_CONTINUOUS_WORKERS_MODE="$mode"
exec node continuous-worker.js
