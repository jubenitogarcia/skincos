#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/runtime/install-clientes-source-refresh-service.sh"

bash -n "$SCRIPT"
grep -F -- 'ReadWritePaths entry is absent' "$SCRIPT" >/dev/null
grep -F -- 'install -d -o root -g skincos -m 0750 "$BACKUP_ROOT"' "$SCRIPT" >/dev/null
grep -F -- 'install -d -o skincos -g skincos -m 0750 "$LOG_ROOT/crm-clientes-source-refresh"' "$SCRIPT" >/dev/null
grep -F -- 'systemd-analyze verify "$rendered_service" "$rendered_timer"' "$SCRIPT" >/dev/null

echo 'PASS: source refresh installer provisions sandbox and checkpoint directories.'
