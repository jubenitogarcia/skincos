#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="$ROOT_DIR/scripts/runtime/install-continuous-worker-service.sh"
LAUNCHER="$ROOT_DIR/scripts/crm/run-continuous-workers-linux.sh"
UNIT="$ROOT_DIR/ops/runtime/units/crm-jobs.service"

bash -n "$INSTALLER" "$LAUNCHER"
grep -F -- 'systemd-analyze verify "$rendered"' "$INSTALLER" >/dev/null
grep -F -- 'UNIT_DEST="/etc/systemd/system"' "$INSTALLER" >/dev/null
grep -F -- '--apply requires an immutable /opt/skincos/releases/<40-hex-sha>/source path' "$INSTALLER" >/dev/null
if grep -Eq 'SOURCE_ROOT="\$\{SOURCE_ROOT:-|UNIT_DEST="\$\{UNIT_DEST:-|CONFIG_ROOT="\$\{CONFIG_ROOT:-' "$INSTALLER"; then
  echo 'continuous worker installer must not accept systemd paths from environment variables' >&2
  exit 1
fi
if "$INSTALLER" --apply >/dev/null 2>&1; then
  echo 'continuous worker installer must reject apply without an immutable release path' >&2
  exit 1
fi
grep -F -- 'Environment=CRM_CONTINUOUS_WORKER_HOST=127.0.0.1' "$UNIT" >/dev/null
grep -F -- 'Environment=CRM_CONTINUOUS_JOBS_STATE_PATH=__STATE_ROOT__/crm/continuous-jobs-state.json' "$UNIT" >/dev/null
if grep -Eq '(^|[[:space:]])(source|\.)[[:space:]].*crm(-jobs)?\.env|npm[[:space:]]+install' "$LAUNCHER"; then
  echo 'continuous worker launcher must not source shell or install dependencies' >&2
  exit 1
fi

echo 'PASS: continuous worker installer, launcher and systemd template are fail-closed.'
