#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

cd "$BACKEND_DIR"

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m apps.automations.scheduled_posting.ops.system_status "$@"
fi
exec python -m apps.automations.scheduled_posting.ops.system_status "$@"
