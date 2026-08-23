#!/usr/bin/env bash
set -euo pipefail

# Performs the only supported manual restart of Orb.  Livia observes the lock
# before creating a publish graph; existing Livia executions are allowed to
# reach a terminal state before Orb is fenced and restarted.

readonly SERVICE='orb.service'
readonly FENCE_SERVICE='orb-restart-fence.service'
readonly WORKFLOW_ID='WGXr4vYkv9UoJ8zc'
readonly RUNTIME_HOME="${N8N_RUNTIME_HOME:-/var/lib/skincos-runtime/orb}"
readonly STATE_DIR="$RUNTIME_HOME/state/livia-maintenance"
readonly LOCK_DIR="$STATE_DIR/restart.lock.d"
readonly LOCK_FILE="$STATE_DIR/restart.lock"

timeout_seconds="${ORB_SAFE_RESTART_TIMEOUT_SECONDS:-900}"
poll_seconds="${ORB_SAFE_RESTART_POLL_SECONDS:-5}"

usage() {
  cat <<'EOF'
Usage: scripts/runtime/orb-safe-restart.sh [--timeout-seconds <1..3600>] [--poll-seconds <1..60>]

Creates a fail-closed Livia maintenance window, waits for current Livia
executions to finish, then restarts only orb.service.  It never forces a
restart through an active publication.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout-seconds) timeout_seconds="${2:-}"; shift ;;
    --poll-seconds) poll_seconds="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[[ "$timeout_seconds" =~ ^[1-9][0-9]{0,3}$ ]] && (( timeout_seconds <= 3600 )) || {
  echo '--timeout-seconds must be an integer from 1 through 3600.' >&2; exit 2;
}
[[ "$poll_seconds" =~ ^[1-9][0-9]?$ ]] && (( poll_seconds <= 60 )) || {
  echo '--poll-seconds must be an integer from 1 through 60.' >&2; exit 2;
}

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1" >&2; exit 1; }; }
require_cmd psql
require_cmd systemctl
require_cmd sudo
sudo -n true

sudo -n install -d -o skincos -g skincos -m 0750 "$STATE_DIR"
if ! sudo -n -u skincos mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Orb safe restart refused: an existing Livia maintenance window is active ($LOCK_FILE)." >&2
  exit 1
fi

cleanup() {
  sudo -n -u skincos rm -f "$LOCK_FILE" 2>/dev/null || true
  sudo -n -u skincos rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sudo -n -u skincos bash -c 'umask 027; printf "reason=controlled_orb_restart\\nstarted_at=%s\\n" "$1" >"$2"' \
  bash "$(date --iso-8601=seconds)" "$LOCK_FILE"

active_livia_count() {
  sudo -n -u postgres psql -d n8n_runtime -Atqc \
    "SELECT count(*) FROM n8n_runtime.execution_entity WHERE \"workflowId\"='$WORKFLOW_ID' AND status IN ('new','running','waiting');"
}

deadline=$(( $(date +%s) + timeout_seconds ))
while true; do
  active="$(active_livia_count)"
  [[ "$active" =~ ^[0-9]+$ ]] || { echo 'Unable to determine active Livia executions.' >&2; exit 1; }
  if (( active == 0 )); then
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "Orb safe restart refused: $active Livia execution(s) still active after ${timeout_seconds}s; Orb was not restarted." >&2
    exit 1
  fi
  sleep "$poll_seconds"
done

# RefuseManualStop=yes on orb.service rejects accidental direct stops.  The
# fence creates an indirect, ordered stop only after the drain above; clearing
# it releases the conflict, then Orb is explicitly started again.
sudo -n systemctl start "$FENCE_SERVICE"
if sudo -n systemctl --quiet is-active "$SERVICE"; then
  echo 'Orb restart fence did not stop orb.service.' >&2
  sudo -n systemctl stop "$FENCE_SERVICE" || true
  exit 1
fi
sudo -n systemctl stop "$FENCE_SERVICE"
sudo -n systemctl start "$SERVICE"
sudo -n systemctl --quiet is-active "$SERVICE"
printf 'Orb restarted safely after Livia drain.\n'
