#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/runtime/install-clientes-source-operations-service.sh"
bash -n "$SCRIPT"
grep -F -- 'Environment=CRM_CLIENTES_SOURCE_OPS_ENABLED=0' "$ROOT_DIR/ops/runtime/units/crm-clientes-source-operations.service" >/dev/null
grep -F -- 'Environment=CRM_CLIENTES_SOURCE_OPS_HOST=127.0.0.1' "$ROOT_DIR/ops/runtime/units/crm-clientes-source-operations.service" >/dev/null
grep -F -- 'no worker start was requested' "$SCRIPT" >/dev/null
grep -F -- 'exec node "$ROOT_DIR/crm/api/clientes-sources-worker.js"' "$ROOT_DIR/scripts/runtime/run-clientes-source-operations-native.sh" >/dev/null
if grep -F -- 'eval' "$ROOT_DIR/scripts/runtime/run-clientes-source-operations-native.sh" >/dev/null; then
  echo 'launcher must not use eval' >&2
  exit 1
fi
echo 'PASS: Clientes source operations unit and launcher are fail-closed.'
