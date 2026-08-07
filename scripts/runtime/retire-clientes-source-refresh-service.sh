#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: retire-clientes-source-refresh-service.sh --dry-run|--apply' >&2
}

case "${1:-}" in
  --dry-run)
    systemctl is-enabled crm-clientes-source-refresh.timer 2>/dev/null || true
    systemctl is-active crm-clientes-source-refresh.timer 2>/dev/null || true
    printf '%s\n' '{"ok":true,"action":"would_disable_legacy_source_refresh"}'
    ;;
  --apply)
    sudo -n systemctl disable --now crm-clientes-source-refresh.timer
    sudo -n systemctl reset-failed crm-clientes-source-refresh.service
    printf '%s\n' '{"ok":true,"action":"disabled_legacy_source_refresh"}'
    ;;
  *)
    usage
    exit 64
    ;;
esac
