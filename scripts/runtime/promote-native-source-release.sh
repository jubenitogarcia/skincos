#!/usr/bin/env bash
set -euo pipefail

# The only supported source-pointer promotion.  It holds a fail-closed Livia
# maintenance window, requires every active workflow to be free of mutable
# helper paths, and starts Orb only after the pointer changed.
readonly RELEASE_BASE="${SKINCOS_RELEASE_BASE:-/opt/skincos/releases}"
readonly CURRENT_LINK="${SKINCOS_SOURCE_CURRENT_LINK:-/opt/skincos/current/source}"
readonly SERVICE='orb.service'
readonly FENCE_SERVICE='orb-restart-fence.service'
readonly SOURCE_SERVICES=('orb-proxy.service' 'crm.service' 'booking.service')
readonly WORKFLOW_ID='WGXr4vYkv9UoJ8zc'
readonly RUNTIME_HOME="${N8N_RUNTIME_HOME:-/var/lib/skincos-runtime/orb}"
readonly STATE_DIR="$RUNTIME_HOME/state/livia-maintenance"
readonly LOCK_DIR="$STATE_DIR/release-promote.lock.d"
readonly LOCK_FILE="$STATE_DIR/release-promote.lock"

release_id=''
expected_current=''
recover_split=0
timeout_seconds="${ORB_SAFE_RESTART_TIMEOUT_SECONDS:-900}"

usage() {
  cat <<'EOF'
Usage: promote-native-source-release.sh --release-id <sha> --expected-current-release <sha> [--recover-runtime-split]

Promotes an already staged native release after Livia has been pinned to an
immutable workflow runtime manifest. Direct pointer changes are forbidden.
EOF
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-id) release_id="${2:-}"; shift ;;
    --expected-current-release) expected_current="${2:-}"; shift ;;
    --recover-runtime-split) recover_split=1 ;;
    --timeout-seconds) timeout_seconds="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
[[ "$release_id" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid --release-id: full 40-character SHA required.' >&2; exit 2; }
[[ "$expected_current" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid --expected-current-release: full 40-character SHA required.' >&2; exit 2; }
[[ "$timeout_seconds" =~ ^[1-9][0-9]{0,3}$ ]] && (( timeout_seconds <= 3600 )) || { echo 'Invalid --timeout-seconds.' >&2; exit 2; }

target="$RELEASE_BASE/$release_id/source"
[[ -d "$target/orb/engine" ]] || { echo "Staged release is missing: $target" >&2; exit 1; }
lineage_file="$target/.skincos-release-lineage.json"
[[ -f "$lineage_file" ]] || { echo 'Staged release has no immutable lineage manifest.' >&2; exit 1; }
current_target="$(readlink -f "$CURRENT_LINK")"
current_release="$(basename "$(dirname "$current_target")")"
[[ "$current_release" = "$expected_current" ]] || { echo "Current release changed: expected $expected_current, found $current_release." >&2; exit 1; }
[[ "$release_id" != "$current_release" ]] || { echo 'Target release is already current.' >&2; exit 1; }
node - "$lineage_file" "$release_id" "$current_release" <<'NODE' || { echo 'Candidate is not a verified descendant of the effective release.' >&2; exit 1; }
const fs = require('fs');
const [file, releaseId, currentRelease] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
if (value.releaseId !== releaseId || value.parentReleaseId !== currentRelease || value.verifiedAncestor !== true) process.exit(1);
NODE

pid="$(systemctl show "$SERVICE" -p MainPID --value)"
effective_root="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
if [[ "$effective_root" != "$current_target/orb/engine" && "$recover_split" != 1 ]]; then
  echo "Runtime split detected: Orb=$effective_root current=$current_target. Refusing promotion without --recover-runtime-split." >&2
  exit 1
fi

fence_template="$target/ops/runtime/units/$FENCE_SERVICE"
[[ -f "$fence_template" ]] || { echo "Staged release is missing $FENCE_SERVICE template." >&2; exit 1; }
if ! systemctl cat "$FENCE_SERVICE" >/dev/null 2>&1; then
  sudo -n install -m 0644 "$fence_template" "/etc/systemd/system/$FENCE_SERVICE"
  sudo -n systemctl daemon-reload
fi

sudo -n -u skincos env LIVIA_BUILD_JOB_GRAPH_SOURCE="$target/orb/engine/compose2-current.js" \
  N8N_RUNTIME_HOME="$RUNTIME_HOME" node "$target/orb/engine/scripts/livia/build-platform-job-graph.js" --assert-runtime-compatibility >/dev/null
sudo -n -u skincos env LIVIA_BUILD_JOB_GRAPH_SOURCE="$target/orb/engine/compose2-current.js" \
  N8N_RUNTIME_HOME="$RUNTIME_HOME" node "$target/orb/engine/scripts/livia/build-platform-job-graph.js" --assert-output-contract >/dev/null
sudo -n -u skincos env LIVIA_BUILD_JOB_GRAPH_SOURCE="$target/orb/engine/compose2-current.js" \
  N8N_RUNTIME_HOME="$RUNTIME_HOME" node "$target/orb/engine/scripts/livia/build-platform-job-graph.js" --assert-job-graph-contracts >/dev/null
sudo -n -u postgres env PGUSER=postgres PGHOST=/var/run/postgresql PGDATABASE=n8n_runtime \
  node "$target/orb/engine/scripts/workflow-runtime-manifest.js" audit-live >/dev/null

sudo -n install -d -o skincos -g skincos -m 0750 "$STATE_DIR"
if ! sudo -n -u skincos mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Release promotion refused: Livia maintenance window already active ($LOCK_FILE)." >&2
  exit 1
fi
promoted=0
started=0
sidecars_started=0
cleanup() {
  if (( promoted == 1 && (started == 0 || sidecars_started == 0) )); then
    sudo -n systemctl start "$FENCE_SERVICE" || true
    sudo -n ln -sfn "$current_target" "$CURRENT_LINK" || true
    sudo -n systemctl stop "$FENCE_SERVICE" || true
    sudo -n systemctl start "$SERVICE" || true
    for sidecar in "${SOURCE_SERVICES[@]}"; do sudo -n systemctl restart "$sidecar" || true; done
  fi
  sudo -n -u skincos rm -f "$LOCK_FILE" 2>/dev/null || true
  sudo -n -u skincos rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
sudo -n -u skincos bash -c 'umask 027; printf "reason=controlled_native_release_promotion\nstarted_at=%s\n" "$1" >"$2"' bash "$(date --iso-8601=seconds)" "$LOCK_FILE"

deadline=$(( $(date +%s) + timeout_seconds ))
while true; do
  active="$(sudo -n -u postgres psql -d n8n_runtime -Atqc "SELECT count(*) FROM n8n_runtime.execution_entity WHERE \"workflowId\"='$WORKFLOW_ID' AND status IN ('new','running','waiting');")"
  [[ "$active" =~ ^[0-9]+$ ]] || { echo 'Unable to determine active Livia executions.' >&2; exit 1; }
  (( active == 0 )) && break
  (( $(date +%s) < deadline )) || { echo "Release promotion refused: $active Livia execution(s) still active." >&2; exit 1; }
  sleep 5
done

sudo -n systemctl start "$FENCE_SERVICE"
if sudo -n systemctl --quiet is-active "$SERVICE"; then
  echo 'Release promotion fence did not stop Orb.' >&2
  sudo -n systemctl stop "$FENCE_SERVICE" || true
  exit 1
fi
sudo -n ln -sfn "$target" "$CURRENT_LINK"
promoted=1
sudo -n systemctl stop "$FENCE_SERVICE"
sudo -n systemctl start "$SERVICE"
sudo -n systemctl --quiet is-active "$SERVICE"
new_pid="$(systemctl show "$SERVICE" -p MainPID --value)"
new_root="$(readlink -f "/proc/$new_pid/cwd")"
[[ "$new_root" = "$target/orb/engine" ]] || { echo "Orb restarted from unexpected root: $new_root" >&2; exit 1; }
started=1
for sidecar in "${SOURCE_SERVICES[@]}"; do
  sudo -n systemctl restart "$sidecar"
  sudo -n systemctl --quiet is-active "$sidecar"
  sidecar_pid="$(systemctl show "$sidecar" -p MainPID --value)"
  sidecar_root="$(readlink -f "/proc/$sidecar_pid/cwd")"
  case "$sidecar" in
    orb-proxy.service) expected_root="$target/orb/engine" ;;
    crm.service) expected_root="$target/crm/api" ;;
    booking.service) expected_root="$target/integration/ef" ;;
  esac
  sidecar_deadline=$(( $(date +%s) + 30 ))
  while [[ "$sidecar_root" != "$expected_root" && $(date +%s) -lt $sidecar_deadline ]]; do
    sleep 1
    sidecar_pid="$(systemctl show "$sidecar" -p MainPID --value)"
    sidecar_root="$(readlink -f "/proc/$sidecar_pid/cwd")"
  done
  [[ "$sidecar_root" = "$expected_root" ]] || { echo "$sidecar restarted from unexpected root: $sidecar_root" >&2; exit 1; }
done
sidecars_started=1
printf 'Native source release promoted safely: %s\n' "$release_id"
