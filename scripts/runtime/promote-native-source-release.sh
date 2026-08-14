#!/usr/bin/env bash
set -euo pipefail

# The only supported source-pointer promotion.  It holds a fail-closed Livia
# maintenance window, requires every active workflow to be free of mutable
# helper paths, and starts Orb only after the pointer changed.
readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
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
rollback_to_release=''
expected_current=''
mode='promotion'
recover_split=0
timeout_seconds="${ORB_SAFE_RESTART_TIMEOUT_SECONDS:-900}"

usage() {
  cat <<'EOF'
Usage:
  promote-native-source-release.sh --release-id <new-sha> --expected-current-release <previous-sha> [--recover-runtime-split]
  promote-native-source-release.sh --rollback --rollback-to-release <previous-sha> --expected-current-release <failed-new-sha> [--recover-runtime-split]

Both operations select exactly one already staged immutable release and require
the live pointer to resolve to the expected release. A controlled rollback
additionally proves that the failed current release is the direct verified
descendant of the requested prior release. Direct pointer changes are forbidden.
EOF
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-id) release_id="${2:-}"; shift ;;
    --rollback) mode='rollback' ;;
    --rollback-to-release) rollback_to_release="${2:-}"; shift ;;
    --expected-current-release) expected_current="${2:-}"; shift ;;
    --recover-runtime-split) recover_split=1 ;;
    --timeout-seconds) timeout_seconds="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
if [[ "$mode" == 'rollback' ]]; then
  [[ -z "$release_id" ]] || { echo '--rollback does not accept --release-id; use --rollback-to-release.' >&2; exit 2; }
  [[ "$rollback_to_release" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid --rollback-to-release: full 40-character SHA required.' >&2; exit 2; }
  release_id="$rollback_to_release"
else
  [[ -z "$rollback_to_release" ]] || { echo '--rollback-to-release requires --rollback.' >&2; exit 2; }
  [[ "$release_id" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid --release-id: full 40-character SHA required.' >&2; exit 2; }
fi
[[ "$expected_current" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid --expected-current-release: full 40-character SHA required.' >&2; exit 2; }
[[ "$timeout_seconds" =~ ^[1-9][0-9]{0,3}$ ]] && (( timeout_seconds <= 3600 )) || { echo 'Invalid --timeout-seconds.' >&2; exit 2; }

release_base="$(readlink -f "$RELEASE_BASE" 2>/dev/null || true)"
[[ -d "$release_base" ]] || { echo "Native release base is unavailable: $RELEASE_BASE" >&2; exit 1; }

immutable_release_root() {
  local release="$1" role="$2" root resolved
  root="$release_base/$release/source"
  resolved="$(readlink -f "$root" 2>/dev/null || true)"
  [[ "$resolved" == "$root" && -d "$root/orb/engine" ]] || {
    echo "Immutable $role release is unavailable: $root" >&2
    return 1
  }
  for artifact in \
    '.skincos-release-lineage.json' \
    '.skincos-global-coordination-native-runtime.json' \
    '.skincos-release-identity-native-runtime.json'; do
    [[ -f "$root/$artifact" ]] || {
      echo "Immutable $role release is missing required attestation: $artifact" >&2
      return 1
    }
  done
  printf '%s' "$root"
}

validate_release_attestation() {
  local root="$1" release="$2" role="$3"
  if ! node - "$root/.skincos-release-lineage.json" "$root/.skincos-global-coordination-native-runtime.json" "$root/.skincos-release-identity-native-runtime.json" "$release" <<'NODE' >/dev/null 2>&1; then
const crypto = require('crypto');
const fs = require('fs');
const [lineageFile, closureFile, identityFile, release] = process.argv.slice(2);
const fullSha = /^[0-9a-f]{40}$/;
const digest = /^[0-9a-f]{64}$/;
const canonicalJson = (value) => Array.isArray(value)
  ? `[${value.map(canonicalJson).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const lower = (value) => String(value || '').trim().toLowerCase();
const lineage = JSON.parse(fs.readFileSync(lineageFile, 'utf8'));
const closure = JSON.parse(fs.readFileSync(closureFile, 'utf8'));
const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
if (
  lower(lineage.releaseId) !== release
  || !/^[0-9a-f]{7,64}$/.test(lower(lineage.parentReleaseId))
  || lineage.verifiedAncestor !== true
  || lower(closure.module) !== 'native-runtime'
  || lower(closure.sourceCommit) !== release
  || !fullSha.test(lower(closure.sourceTree))
  || !digest.test(lower(closure.digest))
  || !closure.material
  || closure.material.schemaVersion !== 1
  || lower(closure.material.module) !== 'native-runtime'
  || !Array.isArray(closure.material.inputs)
  || closure.material.inputs.length === 0
  || crypto.createHash('sha256').update(canonicalJson(closure.material)).digest('hex') !== lower(closure.digest)
  || identity.schemaVersion !== 1
  || lower(identity.module) !== 'native-runtime'
  || lower(identity.sourceCommit) !== release
  || lower(identity.sourceTree) !== lower(closure.sourceTree)
  || lower(identity.dependencyClosureDigest) !== lower(closure.digest)
  || !Array.isArray(identity.artifacts)
) process.exit(1);
for (const entry of closure.material.inputs) {
  if (!entry || typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.split('/').includes('..') || !fullSha.test(lower(entry.blob))) process.exit(1);
}
const sourceArchive = identity.artifacts.find((artifact) => artifact && artifact.name === 'native-source-archive');
if (!sourceArchive || sourceArchive.id !== `native-source:${release}` || !digest.test(lower(sourceArchive.digest))) process.exit(1);
NODE
    echo "Immutable $role release lineage, closure, or identity is invalid." >&2
    return 1
  fi
}

target="$(immutable_release_root "$release_id" 'target')"
expected_current_target="$(immutable_release_root "$expected_current" 'expected current')"
validate_release_attestation "$target" "$release_id" 'target'
validate_release_attestation "$expected_current_target" "$expected_current" 'expected current'
invocation_root="$(readlink -f "$SCRIPT_ROOT" 2>/dev/null || true)"
[[ "$invocation_root" == "$target" || "$invocation_root" == "$expected_current_target" ]] || {
  echo 'Native source transition must be invoked from one of the two verified immutable release roots.' >&2
  exit 1
}
for coordinator_artifact in \
  'scripts/runtime/global-coordination-mini-pc.sh' \
  'scripts/codex-global-coordination-workflow.mjs'; do
  [[ -f "$invocation_root/$coordinator_artifact" ]] || {
    echo "Verified immutable invocation root lacks coordinator artifact: $coordinator_artifact" >&2
    exit 1
  }
done
lineage_file="$target/.skincos-release-lineage.json"
current_lineage_file="$expected_current_target/.skincos-release-lineage.json"
coordination_closure="$target/.skincos-global-coordination-native-runtime.json"
release_identity="$target/.skincos-release-identity-native-runtime.json"
assert_expected_current_pointer() {
  local observed
  observed="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  [[ "$observed" == "$expected_current_target" ]] || {
    echo "Current pointer changed: expected $expected_current_target, found ${observed:-unresolved}." >&2
    return 1
  }
}

assert_expected_current_pointer || exit 1
current_target="$expected_current_target"
[[ "$release_id" != "$expected_current" ]] || { echo 'Target release is already current.' >&2; exit 1; }
node - "$mode" "$lineage_file" "$current_lineage_file" "$release_id" "$expected_current" <<'NODE' || { echo 'The immutable release lineage does not prove this exact pointer transition.' >&2; exit 1; }
const fs = require('fs');
const [mode, targetFile, currentFile, targetRelease, currentRelease] = process.argv.slice(2);
const target = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
const current = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
const direct = mode === 'rollback'
  ? current.releaseId === currentRelease && current.parentReleaseId === targetRelease && current.verifiedAncestor === true
  : target.releaseId === targetRelease && target.parentReleaseId === currentRelease && target.verifiedAncestor === true;
if (!direct) process.exit(1);
NODE

pid="$(systemctl show "$SERVICE" -p MainPID --value)"
effective_root="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
if [[ "$effective_root" != "$current_target/orb/engine" && "$recover_split" != 1 ]]; then
  echo "Runtime split detected: Orb=$effective_root current=$current_target. Refusing $mode without --recover-runtime-split." >&2
  exit 1
fi

fence_template="$target/ops/runtime/units/$FENCE_SERVICE"
[[ -f "$fence_template" ]] || { echo "Staged release is missing $FENCE_SERVICE template." >&2; exit 1; }

coordination_proof="${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-$RUNTIME_HOME/global-coordination/release-native-runtime-$mode-$release_id-$$.json}"
coordination_acquired=0
coordination_last_renew="$(date +%s)"
coordination_run() {
  "$invocation_root/scripts/runtime/global-coordination-mini-pc.sh" "$@" --proof-file "$coordination_proof"
}
coordination_acquire() {
  coordination_run acquire \
    --resource release:native-runtime --module native-runtime --source "$release_id" --closure-file "$coordination_closure" \
    --operation promotion --release-identity-file "$release_identity" \
    --idempotency-key "mini-pc:release:native-runtime:$mode:$release_id:from:$expected_current:$$"
}
coordination_check() {
  coordination_run check \
    --resource release:native-runtime --module native-runtime --source "$release_id" --closure-file "$coordination_closure"
}
coordination_renew_if_due() {
  local now
  now="$(date +%s)"
  if (( now - coordination_last_renew >= 60 )); then
    coordination_run renew
    coordination_last_renew="$now"
  fi
}
coordination_release() {
  coordination_run release
}

pointer_switched=0
started=0
sidecars_started=0
cleanup() {
  if (( pointer_switched == 1 && (started == 0 || sidecars_started == 0) )); then
    if coordination_check >/dev/null 2>&1 && [[ "$current_target" == "$expected_current_target" ]]; then
      sudo -n systemctl start "$FENCE_SERVICE" || true
      sudo -n ln -sfn "$current_target" "$CURRENT_LINK" || true
      sudo -n systemctl stop "$FENCE_SERVICE" || true
      sudo -n systemctl start "$SERVICE" || true
      for sidecar in "${SOURCE_SERVICES[@]}"; do sudo -n systemctl restart "$sidecar" || true; done
    else
      echo 'Native pointer recovery lost its exact coordination proof or expected current root; shared runtime remains fail-closed.' >&2
    fi
  fi
  sudo -n -u skincos rm -f "$LOCK_FILE" 2>/dev/null || true
  sudo -n -u skincos rmdir "$LOCK_DIR" 2>/dev/null || true
  if (( coordination_acquired == 1 )); then
    coordination_release >/dev/null 2>&1 || echo 'Unable to release the mini-PC global coordination lease; it will expire fail-closed.' >&2
    coordination_acquired=0
  fi
}
trap cleanup EXIT INT TERM
coordination_acquire >/dev/null
coordination_acquired=1

# The pointer check above happened before the shared native lease existed. A
# competing transition can finish in that interval, so never carry a stale
# expected root into the protected maintenance window.
assert_expected_current_pointer || exit 1

if ! systemctl cat "$FENCE_SERVICE" >/dev/null 2>&1; then
  coordination_check >/dev/null
  sudo -n install -m 0644 "$fence_template" "/etc/systemd/system/$FENCE_SERVICE"
  coordination_check >/dev/null
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
  echo "Native source $mode refused: Livia maintenance window already active ($LOCK_FILE)." >&2
  exit 1
fi
sudo -n -u skincos bash -c 'umask 027; printf "reason=%s\nstarted_at=%s\n" "$1" "$2" >"$3"' bash "controlled_native_release_$mode" "$(date --iso-8601=seconds)" "$LOCK_FILE"

deadline=$(( $(date +%s) + timeout_seconds ))
while true; do
  active="$(sudo -n -u postgres psql -d n8n_runtime -Atqc "SELECT count(*) FROM n8n_runtime.execution_entity WHERE \"workflowId\"='$WORKFLOW_ID' AND status IN ('new','running','waiting');")"
  [[ "$active" =~ ^[0-9]+$ ]] || { echo 'Unable to determine active Livia executions.' >&2; exit 1; }
  (( active == 0 )) && break
  (( $(date +%s) < deadline )) || { echo "Native source $mode refused: $active Livia execution(s) still active." >&2; exit 1; }
  coordination_renew_if_due
  sleep 5
done

coordination_check >/dev/null
sudo -n systemctl start "$FENCE_SERVICE"
if sudo -n systemctl --quiet is-active "$SERVICE"; then
  echo "Native source $mode fence did not stop Orb." >&2
  sudo -n systemctl stop "$FENCE_SERVICE" || true
  exit 1
fi
coordination_check >/dev/null
# Recheck while this process still owns the native lease and immediately before
# the sole pointer write. A changed pointer here is an unsafe concurrent
# mutation; leave the runtime fenced rather than overwriting a newer release.
assert_expected_current_pointer || exit 1
sudo -n ln -sfn "$target" "$CURRENT_LINK"
pointer_switched=1
switched_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
[[ "$switched_target" == "$target" ]] || { echo "Native source $mode did not set the exact immutable target pointer." >&2; exit 1; }
coordination_check >/dev/null
sudo -n systemctl stop "$FENCE_SERVICE"
coordination_check >/dev/null
sudo -n systemctl start "$SERVICE"
sudo -n systemctl --quiet is-active "$SERVICE"
new_pid="$(systemctl show "$SERVICE" -p MainPID --value)"
new_root="$(readlink -f "/proc/$new_pid/cwd")"
[[ "$new_root" = "$target/orb/engine" ]] || { echo "Orb restarted from unexpected root: $new_root" >&2; exit 1; }
started=1
for sidecar in "${SOURCE_SERVICES[@]}"; do
  coordination_check >/dev/null
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
printf 'Native source release %s safely: target=%s expected_current=%s\n' "$mode" "$release_id" "$expected_current"
