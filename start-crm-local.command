#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

export CRM_OPEN_BROWSER="${CRM_OPEN_BROWSER:-1}"

exec ./scripts/run-local-crm.sh "${1:-/}"
