#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

MODE=${1:-diagnose}
shift || true

export SCHEDULED_POSTING_CONFIG="${SCHEDULED_POSTING_CONFIG:-$VAR_DIR/scheduled_posting/config.json}"

usage() {
  cat <<EOF
Scheduled Posting runner

Usage: $(basename "$0") [diagnose|test|run] [extra args...]

Environment:
  SCHEDULED_POSTING_CONFIG   Path do config.json (default: \$VAR_DIR/scheduled_posting/config.json)
  VAR_DIR        Base de dados locais (default: backend/var)
EOF
}

case "$MODE" in
  -h|--help|help)
    usage
    exit 0
    ;;
  diagnose|test|run)
    ;;
  *)
    echo "[scheduled-posting] Unknown mode: $MODE" >&2
    usage
    exit 1
    ;;
esac

cd "$BACKEND_DIR"

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m apps.automations.scheduled_posting --mode "$MODE" "$@"
fi
exec python -m apps.automations.scheduled_posting --mode "$MODE" "$@"
