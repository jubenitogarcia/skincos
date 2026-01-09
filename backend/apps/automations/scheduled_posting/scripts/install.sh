#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

cd "$BACKEND_DIR"

if command -v python3 >/dev/null 2>&1; then
  python3 -m pip install --upgrade pip
  exec python3 -m pip install -r apps/automations/scheduled_posting/requirements.txt
fi

python -m pip install --upgrade pip
exec python -m pip install -r apps/automations/scheduled_posting/requirements.txt
