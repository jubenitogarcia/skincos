#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
if dry_run_notice; then
  info 'rollback planejado: parar apenas Orb afetado, repor binário 2.8.3, restaurar configurações e banco de backup verificado, validar 43 workflows e MCP.'
  exit 0
fi
assert_apply_gate
[[ "${N8N_ROLLBACK_APPROVED:-}" == YES ]] || die 'rollback exige N8N_ROLLBACK_APPROVED=YES.'
[[ "${N8N_BACKUP_VERIFIED:-}" == YES ]] || die 'rollback exige backup previamente restore-verified.'
PREVIOUS=${N8N_PREVIOUS_INSTALL_ROOT:-}
[[ -n "$PREVIOUS" && -d "$PREVIOUS" ]] || die 'N8N_PREVIOUS_INSTALL_ROOT ausente.'
require_private_path "$PREVIOUS"
info 'rollback apply não é executado sem runbook, checkpoint e identificação explícita do banco restaurado.'
die 'modo de restauração de banco não implementa downgrade de schema; forneça restore verificado e aprovação operacional.'
