#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
source "$SCRIPT_ROOT/scripts/runtime/global-coordination-native.sh"

shared_units=(
  messaging-whatsapp.service
  booking.service
  cloudflare-runtime.service
)
readonly CRM_SERVICE='crm.service'
readonly ISOLATED_CRM_UNITS=(
  crm-atendimento-staging.service
  crm-atendimento-production.service
)

usage() {
  cat <<'EOF'
Usage: scripts/runtime/manage-native-runtime.sh <status|restart|logs|validate> [lines]

Operates only the final native systemd runtime. It never starts a process from
a checkout, worktree or DrvFS path.
EOF
}

action="${1:-status}"
lines="${2:-200}"

case "$action" in
  status)
    systemctl --no-pager --full status "${shared_units[@]}" "$CRM_SERVICE" "${ISOLATED_CRM_UNITS[@]}"
    ;;
  restart)
    current_source="$(readlink -f /opt/skincos/current/source)"
    [[ "$current_source" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || {
      echo "Invalid native source release: $current_source" >&2
      exit 78
    }
    source_sha="$(basename "$(dirname "$current_source")")"
    coordination_closure="$current_source/.skincos-global-coordination-native-runtime.json"
    [[ -f "$coordination_closure" ]] || {
      echo "Native-runtime coordination closure is unavailable: $coordination_closure" >&2
      exit 78
    }
    native_coordination_init global:native-runtime native-runtime "$source_sha" "$coordination_closure" mutation
    coordination_acquired=0
    cleanup() {
      if [[ "$coordination_acquired" == '1' ]]; then
        native_coordination_cleanup || true
        coordination_acquired=0
      fi
    }
    trap cleanup EXIT INT TERM
    native_coordination_acquire "mini-pc:global:native-runtime:restart:$source_sha:$$" >/dev/null
    coordination_acquired=1
    native_coordination_check
    # crm.service now has a dedicated immutable pointer and its own custody
    # contract. Never restart it under a lease that was derived from the shared
    # source release. The isolated Atendimento services are independently
    # managed by their own runbooks as well.
    for unit in "${shared_units[@]}"; do
      native_coordination_check
      sudo -n systemctl restart "$unit"
    done
    systemctl --quiet is-active "${shared_units[@]}"
    printf 'ACTIVE %s\n' "${shared_units[@]}"
    printf 'NOT_RESTARTED %s (dedicated CRM custody required)\n' "$CRM_SERVICE" "${ISOLATED_CRM_UNITS[@]}"
    ;;
  logs)
    [[ "$lines" =~ ^[1-9][0-9]*$ ]] || { echo 'lines must be a positive integer' >&2; exit 2; }
    journalctl --no-pager -n "$lines" "${shared_units[@]}" "$CRM_SERVICE" "${ISOLATED_CRM_UNITS[@]}"
    ;;
  validate)
    # The old shared-source e2e entrypoint cannot attest the artifact used by
    # crm.service after the pointer split. Retain only a read-only shared-unit
    # check here; a dedicated CRM publisher must later supply release-identity,
    # synthetic health/readiness and rollback readback as one custody-bound run.
    systemctl --quiet is-active "${shared_units[@]}"
    printf 'ACTIVE %s\n' "${shared_units[@]}"
    printf 'NOT_VALIDATED %s (dedicated CRM custody and smoke required)\n' "$CRM_SERVICE" "${ISOLATED_CRM_UNITS[@]}"
    ;;
  -h|--help)
    usage
    ;;
  *)
    echo "Unknown action: $action" >&2
    usage >&2
    exit 2
    ;;
esac
