#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="$ROOT_DIR/scripts/runtime/install-continuous-worker-service.sh"
LAUNCHER="$ROOT_DIR/scripts/crm/run-continuous-workers-linux.sh"
UNIT="$ROOT_DIR/ops/runtime/units/crm-jobs.service"

bash -n "$INSTALLER" "$LAUNCHER"
grep -F -- 'systemd-analyze verify "$rendered"' "$INSTALLER" >/dev/null
grep -F -- 'Environment=CRM_CONTINUOUS_WORKER_HOST=127.0.0.1' "$UNIT" >/dev/null
grep -F -- 'Environment=CRM_CONTINUOUS_JOBS_STATE_PATH=__STATE_ROOT__/crm/continuous-jobs-state.json' "$UNIT" >/dev/null
if grep -Eq '(^|[[:space:]])(source|\.)[[:space:]].*crm(-jobs)?\.env|npm[[:space:]]+install' "$LAUNCHER"; then
  echo 'continuous worker launcher must not source shell or install dependencies' >&2
  exit 1
fi

echo 'PASS: continuous worker installer, launcher and systemd template are fail-closed.'
