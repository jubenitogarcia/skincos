#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
source "$SCRIPT_ROOT/scripts/runtime/global-coordination-native.sh"

usage() {
  printf '%s\n' 'Usage: retire-clientes-source-refresh-service.sh --dry-run|--apply' >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 64
fi

case "$1" in
  --dry-run)
    systemctl is-enabled crm-clientes-source-refresh.timer 2>/dev/null || true
    systemctl is-active crm-clientes-source-refresh.timer 2>/dev/null || true
    printf '%s\n' '{"ok":true,"action":"would_disable_legacy_source_refresh"}'
    ;;
  --apply)
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
    native_coordination_acquire "mini-pc:global:native-runtime:retire-clientes-refresh:$source_sha:$$" >/dev/null
    coordination_acquired=1
    native_coordination_check
    sudo -n systemctl disable --now crm-clientes-source-refresh.timer
    native_coordination_check
    sudo -n systemctl reset-failed crm-clientes-source-refresh.service
    printf '%s\n' '{"ok":true,"action":"disabled_legacy_source_refresh"}'
    ;;
  *)
    usage
    exit 64
    ;;
esac
