#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

action="${1:-status}"
shift || true

units=(
  "$SKINCOS_N8N_SERVICE"
  "$SKINCOS_ORB_PROXY_SERVICE"
  "$SKINCOS_CLOUDFLARED_ORB_SERVICE"
  "$SKINCOS_EVOLUTION_SERVICE"
  "$SKINCOS_WATCHDOG_TIMER"
)

case "$action" in
  status)
    sudo -n systemctl --no-pager --plain status "${units[@]}"
    ;;
  restart)
    sudo -n systemctl restart \
      "$SKINCOS_N8N_SERVICE" \
      "$SKINCOS_ORB_PROXY_SERVICE" \
      "$SKINCOS_CLOUDFLARED_ORB_SERVICE" \
      "$SKINCOS_EVOLUTION_SERVICE"
    sudo -n systemctl restart "$SKINCOS_WATCHDOG_TIMER"
    sudo -n systemctl --no-pager --plain status "${units[@]}"
    ;;
  logs)
    lines="${1:-120}"
    sudo -n journalctl -u "$SKINCOS_N8N_SERVICE" \
      -u "$SKINCOS_ORB_PROXY_SERVICE" \
      -u "$SKINCOS_CLOUDFLARED_ORB_SERVICE" \
      -u "$SKINCOS_EVOLUTION_SERVICE" \
      -u "$SKINCOS_WATCHDOG_SERVICE" \
      -n "$lines" --no-pager -l
    ;;
  *)
    echo "Usage: $0 {status|restart|logs [lines]}"
    exit 1
    ;;
esac
