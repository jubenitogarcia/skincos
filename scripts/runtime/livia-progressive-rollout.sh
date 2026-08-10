#!/usr/bin/env bash
set -euo pipefail

# Lease-protected, immutable-release rollout controller for Livia AI reel
# covers. It changes only the n8n variable; it never restarts Orb or publishes
# to a social platform. Shadow and active decisions are made by the versioned
# rollout policy and failed activation returns to shadow.
readonly SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly WORKFLOW_ID='WGXr4vYkv9UoJ8zc'
readonly RESOURCE='mutate:livia-reel-cover:production'
readonly CUSTODY_FILE='/etc/skincos/global-coordination/orb-backup.env'
readonly SETTER="$SCRIPT_ROOT/orb/engine/scripts/livia/set-rollout-mode.js"
readonly POLICY="$SCRIPT_ROOT/orb/engine/scripts/livia/rollout-policy.js"
readonly CLOSURE="$SCRIPT_ROOT/.skincos-global-coordination-orb.json"

mode=''
workflow_version=''
release_id=''
evidence_file=''
apply=0

usage() {
  cat <<'EOF'
Usage: livia-progressive-rollout.sh --mode shadow|active|off \
  --workflow-version <uuid> --release-id <full-sha> [--evidence-file <path>] --apply

The command must run from an immutable /opt/skincos/releases/<sha>/source
release. Active requires shadow evidence, functional smoke, and a rollback
target. It never sends a social publication.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) mode="${2:-}"; shift ;;
    --workflow-version) workflow_version="${2:-}"; shift ;;
    --release-id) release_id="${2:-}"; shift ;;
    --evidence-file) evidence_file="${2:-}"; shift ;;
    --apply) apply=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

[[ "$mode" =~ ^(off|shadow|active)$ ]] || { echo 'mode must be off, shadow, or active' >&2; exit 78; }
[[ "$workflow_version" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] || { echo 'workflow version must be a UUID' >&2; exit 78; }
[[ "$release_id" =~ ^[0-9a-f]{40}$ ]] || { echo 'release id must be a full lowercase SHA' >&2; exit 78; }
[[ "$SCRIPT_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || { echo 'Livia rollout requires an immutable native release root' >&2; exit 78; }
[[ "$(basename "$(dirname "$SCRIPT_ROOT")")" = "$release_id" ]] || { echo 'release id does not match the immutable source root' >&2; exit 78; }
[[ -f "$SETTER" && -f "$POLICY" && -f "$CLOSURE" ]] || { echo 'Livia rollout contract is incomplete in the immutable release' >&2; exit 78; }
[[ "$apply" == 1 ]] || { echo '--apply is required for a rollout mutation' >&2; exit 78; }

load_coordination_environment() {
  [[ -f "$CUSTODY_FILE" ]] || { echo 'native coordination custody is unavailable' >&2; exit 78; }
  local file_mode line key value
  file_mode="$(stat -c '%a' "$CUSTODY_FILE")"
  [[ "$file_mode" == 600 || "$file_mode" == 640 ]] || { echo 'native coordination custody mode is invalid' >&2; exit 78; }
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || { echo 'native coordination custody contains an invalid record' >&2; exit 78; }
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    [[ "$key" == SKINCOS_GLOBAL_COORDINATOR_URL || "$key" == SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET ]] || { echo 'native coordination custody contains an unsupported record' >&2; exit 78; }
    export "$key=$value"
  done < "$CUSTODY_FILE"
  [[ -n "${SKINCOS_GLOBAL_COORDINATOR_URL:-}" && -n "${SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET:-}" ]] || { echo 'native coordination custody is incomplete' >&2; exit 78; }
}

json_field() {
  /usr/bin/node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(String(value[process.argv[2]] ?? ""));' "$1" "$2"
}

load_coordination_environment
export GLOBAL_COORDINATION_PROVIDER='mini-pc'
export GLOBAL_COORDINATION_MISSION_ID="${GLOBAL_COORDINATION_MISSION_ID:-mini-pc:livia-reel-cover-rollout}"
export GLOBAL_COORDINATION_THREAD_ID="${GLOBAL_COORDINATION_THREAD_ID:-livia:reel-cover-rollout}"
export GLOBAL_COORDINATION_ACTOR="${GLOBAL_COORDINATION_ACTOR:-native-progressive-rollout}"

# shellcheck disable=SC1091
source "$SCRIPT_ROOT/scripts/runtime/global-coordination-native.sh"
native_coordination_init "$RESOURCE" orb "$release_id" "$CLOSURE" mutation

state_json="$(sudo -n -u postgres env PGUSER=postgres PGHOST=/var/run/postgresql PGDATABASE=n8n_runtime node "$SETTER" --inspect --workflow-version "$workflow_version" --release-id "$release_id")"
current_mode="$(json_field "$state_json" currentMode)"
[[ "$current_mode" =~ ^(off|shadow|active)$ ]] || { echo 'current Livia rollout mode is invalid' >&2; exit 78; }

decision_json=''
evidence_sha256=''
if [[ "$mode" == active ]]; then
  [[ -n "$evidence_file" && "$evidence_file" = /* && -f "$evidence_file" ]] || { echo 'active promotion requires an absolute evidence file' >&2; exit 78; }
  evidence_sha256="$(sha256sum "$evidence_file" | awk '{print $1}')"
  decision_json="$(cat "$evidence_file" | sudo -n -u postgres node "$POLICY" evaluate --from "$current_mode" --to active --evidence-stdin)"
  [[ "$(json_field "$decision_json" allowed)" == true ]] || {
    echo "Livia active promotion denied by objective rollout policy: $(json_field "$decision_json" resultingMode)" >&2
    exit 78
  }
else
  decision_json="$(node -e 'process.stdout.write(JSON.stringify({from:process.argv[1],requestedMode:process.argv[2],allowed:true,resultingMode:process.argv[2],reasons:[]}))' "$current_mode" "$mode")"
fi

coordination_acquired=0
cleanup() {
  if [[ "$coordination_acquired" == 1 ]]; then
    native_coordination_cleanup || echo 'Unable to release the Livia rollout lease; it will expire fail-closed.' >&2
  fi
}
trap cleanup EXIT INT TERM

native_coordination_acquire "mini-pc:livia-reel-cover:$mode:$release_id:$$" >/dev/null
coordination_acquired=1
native_coordination_check
setter_args=(--mode "$mode" --workflow-version "$workflow_version" --release-id "$release_id" --apply)
if [[ -n "$evidence_file" ]]; then setter_args+=(--evidence-sha256 "$evidence_sha256"); fi
apply_json="$(sudo -n -u postgres env PGUSER=postgres PGHOST=/var/run/postgresql PGDATABASE=n8n_runtime node "$SETTER" "${setter_args[@]}")"
native_coordination_check
printf '%s\n' "$(/usr/bin/node -e 'const decision=JSON.parse(process.argv[1]); const applied=JSON.parse(process.argv[2]); process.stdout.write(JSON.stringify({ok:true,workflowId:"WGXr4vYkv9UoJ8zc",decision,applied}))' "$decision_json" "$apply_json")"
