#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

export CRM_OPEN_BROWSER="${CRM_OPEN_BROWSER:-1}"
export CRM_MODULE="${CRM_MODULE:-site-tracking}"
export CRM_META_ADS_SCENARIO="${CRM_META_ADS_SCENARIO:-connected-ready}"

exec ./scripts/run-local-crm.sh "${1:-/}" --module "$CRM_MODULE" --meta-ads-scenario "$CRM_META_ADS_SCENARIO" "${@:2}"
