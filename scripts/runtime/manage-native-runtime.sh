#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
source "$SCRIPT_ROOT/scripts/runtime/global-coordination-native.sh"

units=(
  orb.service
  orb-ccg-executor.service
  orb-proxy.service
  messaging-whatsapp.service
  crm.service
  crm-atendimento-staging.service
  crm-atendimento-production.service
  booking.service
  cloudflare-orb.service
  cloudflare-runtime.service
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
    systemctl --no-pager --full status "${units[@]}"
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
    for unit in "${units[@]}"; do
      native_coordination_check
      sudo -n systemctl restart "$unit"
    done
    systemctl --quiet is-active "${units[@]}"
    printf 'ACTIVE %s\n' "${units[@]}"
    ;;
  logs)
    [[ "$lines" =~ ^[1-9][0-9]*$ ]] || { echo 'lines must be a positive integer' >&2; exit 2; }
    journalctl --no-pager -n "$lines" "${units[@]}"
    ;;
  validate)
    source_root="$(readlink -f /opt/skincos/current/source)"
    [[ "$source_root" == /opt/skincos/releases/*/source ]] || {
      echo "Invalid native source release: $source_root" >&2
      exit 1
    }
    "$source_root/backend/scripts/e2e.sh" health
    "$source_root/backend/scripts/e2e.sh" smoke
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
