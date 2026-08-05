#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT_DIR/crm/api"

CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
if [[ -f "$CONFIG_ROOT/crm.env" ]]; then
  # shellcheck disable=SC1091
  . "$CONFIG_ROOT/crm.env"
fi
if [[ -f "$CONFIG_ROOT/crm-jobs.env" ]]; then
  # shellcheck disable=SC1091
  . "$CONFIG_ROOT/crm-jobs.env"
fi

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

cd "$APP_DIR"
if [[ "${CRM_CONTINUOUS_WORKERS_SKIP_DEP_INSTALL:-false}" != "true" ]] && [[ ! -d "$APP_DIR/node_modules/express" ]]; then
  npm install --omit=dev --no-audit --no-fund
fi

export CRM_CONTINUOUS_WORKERS_ENABLED=1
export CRM_CONTINUOUS_WORKERS_MODE="$mode"
exec node continuous-worker.js
