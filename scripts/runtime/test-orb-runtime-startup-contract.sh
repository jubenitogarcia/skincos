#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
START_SCRIPT="$ROOT_DIR/orb/engine/scripts/start-n8n-runtime.sh"
UNIT_TEMPLATE="$ROOT_DIR/ops/runtime/units/orb.service"
LAYOUT_SCRIPT="$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh"
CI_SMOKE="$ROOT_DIR/.github/workflows/ci-smoke.yml"

bash -n "$START_SCRIPT"
bash -n "$LAYOUT_SCRIPT"

for pattern in \
  'n8n_user_folder="${N8N_USER_FOLDER:-${N8N_DATA_HOME:-}}"' \
  'N8N state directory is unavailable or not writable:' \
  'N8N user folder is unavailable or not writable:' \
  'exit 78'; do
  grep -F -- "$pattern" "$START_SCRIPT" >/dev/null || {
    echo "Missing Orb startup-state guard: $pattern" >&2
    exit 1
  }
done

grep -F -- '"$STATE_ROOT/orb/n8n-home"' "$LAYOUT_SCRIPT" >/dev/null || {
  echo 'Native lifecycle layout must provision the n8n home before first startup.' >&2
  exit 1
}

for pattern in 'StartLimitIntervalSec=5min' 'StartLimitBurst=5' 'Restart=always'; do
  grep -F -- "$pattern" "$UNIT_TEMPLATE" >/dev/null || {
    echo "Missing Orb restart-loop guard: $pattern" >&2
    exit 1
  }
done

orb_scope="$(grep -F 'orb_runtime="$(changed ' "$CI_SMOKE" || true)"
for path in scripts/runtime/start-n8n-runtime.sh scripts/runtime/prepare-lifecycle-layout.sh scripts/runtime/test-orb-runtime-startup-contract.sh; do
  [[ "$orb_scope" == *"$path"* ]] || {
    echo "Orb CI scope does not execute the startup contract after changes to: $path" >&2
    exit 1
  }
done

echo 'PASS: Orb startup validates writable n8n state and bounds restart loops.'
