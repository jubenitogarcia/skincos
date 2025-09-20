#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRM_SCRIPT="$ROOT_DIR/comprehensive-crm-so/scripts/restart_crm.sh"
if [[ ! -x "$CRM_SCRIPT" ]]; then
  echo "[crm-dev] CRM script not found at $CRM_SCRIPT" >&2
  exit 1
fi
exec "$CRM_SCRIPT" "$@"
