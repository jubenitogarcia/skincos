#!/usr/bin/env bash
set -euo pipefail

units=(
  orb.service
  orb-proxy.service
  messaging-whatsapp.service
  crm.service
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
    "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/orb-safe-restart.sh"
    # The remaining units do not execute Livia jobs. Keep their existing
    # lifecycle behavior after Orb has completed its guarded restart.
    sudo -n systemctl restart orb-proxy.service messaging-whatsapp.service crm.service booking.service cloudflare-orb.service cloudflare-runtime.service
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
