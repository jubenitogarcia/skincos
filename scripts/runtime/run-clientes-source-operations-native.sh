#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${CLIENTES_SOURCE_OPERATIONS_TARGET:-local}"
MODE="${CRM_CLIENTES_SOURCE_OPS_MODE:-dry-run}"
ENABLED="${CRM_CLIENTES_SOURCE_OPS_ENABLED:-0}"
HOST="${CRM_CLIENTES_SOURCE_OPS_HOST:-127.0.0.1}"

case "$TARGET" in local|staging) ;; *) echo 'CLIENTES_SOURCE_OPERATIONS_TARGET must be local or staging.' >&2; exit 64 ;; esac
case "$MODE" in dry-run|apply) ;; *) echo 'CRM_CLIENTES_SOURCE_OPS_MODE must be dry-run or apply.' >&2; exit 64 ;; esac
case "$ENABLED" in 0|1|true|false|yes|no|on|off) ;; *) echo 'CRM_CLIENTES_SOURCE_OPS_ENABLED is invalid.' >&2; exit 64 ;; esac
case "$HOST" in 127.0.0.1|::1) ;; *) echo 'CRM_CLIENTES_SOURCE_OPS_HOST must be loopback.' >&2; exit 64 ;; esac
[[ -n "${DATABASE_URL:-}" ]] || { echo 'DATABASE_URL is required.' >&2; exit 1; }

if [[ "$MODE" == 'apply' ]]; then
  case "${CRM_CLIENTES_SOURCE_APPLY_CONFIRMED:-0}" in
    1|true|yes|on) ;;
    *) echo 'CRM_CLIENTES_SOURCE_APPLY_CONFIRMED=1 is required for apply mode.' >&2; exit 77 ;;
  esac
fi

exec node "$ROOT_DIR/crm/api/clientes-sources-worker.js"
