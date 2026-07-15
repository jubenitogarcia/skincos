#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh"

bash -n "$SCRIPT"
output="$(STATE_ROOT=/tmp/skincos-state CONFIG_ROOT=/tmp/skincos-config LOG_ROOT=/tmp/skincos-log TMP_ROOT=/tmp/skincos-tmp BACKUP_ROOT=/tmp/skincos-backup bash "$SCRIPT")"
grep -F '/tmp/skincos-state/orb' <<<"$output" >/dev/null
grep -F '/tmp/skincos-state/artifacts/booking' <<<"$output" >/dev/null
grep -F '/tmp/skincos-backup/orb/daily' <<<"$output" >/dev/null
! grep -F '/mnt/' <<<"$output" >/dev/null
if bash "$SCRIPT" --final-sync >/dev/null 2>&1; then
  echo 'Retired migration option was unexpectedly accepted.' >&2
  exit 1
fi
echo 'prepare lifecycle native layout test passed'
