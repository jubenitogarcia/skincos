#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FINAL_UNITS=(orb orb-proxy messaging-whatsapp crm booking cloudflare-orb cloudflare-runtime)

usage() {
  cat <<'EOF'
Usage: backend/scripts/dev.sh <command> [args]

Runtime:
  start | stop | restart | status
  messaging-whatsapp <start|stop|restart|status|logs|test>
  e2e <health|ci-smoke|smoke>

Module helpers:
  crm [restart_crm arguments]
  insumos [arguments]
  cloudflare-workers [arguments]
  scraper [arguments]
  actual-server [menu|start]

The production runtime is native systemd. This helper never starts services
from a repository checkout and never creates per-instance browser profiles.
EOF
}

manage_units() {
  local action="$1"
  shift
  local units=("$@")
  local rendered=()
  for unit in "${units[@]}"; do rendered+=("$unit.service"); done
  case "$action" in
    status) systemctl --no-pager --full status "${rendered[@]}" ;;
    start|stop|restart) sudo -n systemctl "$action" "${rendered[@]}" ;;
    *) return 2 ;;
  esac
}

command="${1:-status}"
shift || true
case "$command" in
  start|stop|restart|status)
    manage_units "$command" "${FINAL_UNITS[@]}"
    ;;
  messaging-whatsapp|whatsapp)
    action="${1:-status}"
    case "$action" in
      start|stop|restart|status) manage_units "$action" messaging-whatsapp ;;
      logs) exec journalctl -u messaging-whatsapp.service -n 200 -f ;;
      test) exec npm --prefix "$ROOT_DIR/messaging/channels/whatsapp/engine" test ;;
      *) usage >&2; exit 2 ;;
    esac
    ;;
  crm)
    exec "$ROOT_DIR/crm/console/restart_crm.sh" "$@"
    ;;
  insumos)
    exec "$ROOT_DIR/backend/scripts/insumos.sh" "$@"
    ;;
  cloudflare-workers|workers)
    exec "$ROOT_DIR/backend/scripts/cloudflare-workers.sh" "$@"
    ;;
  scraper)
    scraper_dir="$ROOT_DIR/integration/ef"
    if [[ -x "$scraper_dir/run.sh" ]]; then exec "$scraper_dir/run.sh" "$@"; fi
    if [[ -f "$scraper_dir/main.py" ]]; then exec python3 "$scraper_dir/main.py" "$@"; fi
    echo "No supported scraper entrypoint found in $scraper_dir" >&2
    exit 1
    ;;
  actual-server)
    actual_dir="$ROOT_DIR/backend/apps/actual-server"
    case "${1:-menu}" in
      menu) exec bash "$actual_dir/manage-actual-budget.sh" ;;
      start) exec bash "$actual_dir/start-actual-budget.sh" ;;
      *) usage >&2; exit 2 ;;
    esac
    ;;
  e2e)
    exec "$ROOT_DIR/backend/scripts/e2e.sh" "$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
