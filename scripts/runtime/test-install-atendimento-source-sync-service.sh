#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="$ROOT_DIR/scripts/runtime/install-atendimento-source-sync-service.sh"
UNIT="$ROOT_DIR/ops/runtime/units/crm-atendimento-source-sync.service"
TIMER="$ROOT_DIR/ops/runtime/units/crm-atendimento-source-sync.timer"

bash -n "$INSTALLER"
grep -F -- 'systemd-analyze verify "$rendered_service" "$rendered_timer"' "$INSTALLER" >/dev/null
grep -F -- "readonly UNIT_DEST='/etc/systemd/system'" "$INSTALLER" >/dev/null
grep -F -- "readonly DATA_BACKUP_ROOT='/var/backups/skincos/clientes/production-source-sync'" "$INSTALLER" >/dev/null
grep -F -- 'systemctl enable "$TIMER"' "$INSTALLER" >/dev/null
grep -F -- 'immediate_run=false' "$INSTALLER" >/dev/null
grep -F -- 'crm-atendimento-source-sync.service' "$TIMER" >/dev/null
if grep -Eq 'systemctl (start|restart) (crm\.service|crm-jobs\.service|orb\.service|cloudflare)' "$INSTALLER"; then
  echo 'source-sync installer must not restart shared services' >&2
  exit 1
fi
if grep -Eq '(^|[[:space:]])(source|\.)[[:space:]].*\.env|eval[[:space:]]|bash[[:space:]]+-c' "$INSTALLER"; then
  echo 'source-sync installer must not source or eval private environments' >&2
  exit 1
fi
grep -F -- 'DATABASE_URL' "$UNIT" >/dev/null
grep -F -- 'Environment=CRM_ATENDIMENTO_SOURCE_SYNC_TARGET=production' "$UNIT" >/dev/null
grep -F -- 'UnsetEnvironment=' "$UNIT" >/dev/null
grep -F -- 'ProtectSystem=strict' "$UNIT" >/dev/null

echo 'PASS: Atendimento source-sync installer and units are isolated and fail-closed.'
