#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
[[ "$N8N_UPGRADE_ENV" == staging ]] || die 'regressão OAuth é staging-only por padrão; não tocar banco live.'
DB=${N8N_OAUTH_REGRESSION_DATABASE:-}
if dry_run_notice; then
  info 'regressão OAuth planejada em banco sintético: repetir (userId,clientId), tokens, revoke, reauthorize e restart.'
  exit 0
fi
[[ -n "$DB" ]] || die 'N8N_OAUTH_REGRESSION_DATABASE ausente.'
require_private_path "$DB"
require_cmd psql
psql -X -v ON_ERROR_STOP=1 -d "$DB" -f "$(dirname "$0")/fixtures/oauth-regression.sql"
info 'regressão OAuth concluída em staging; nenhum consentimento live foi escrito/removido.'
