#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
if [[ "${1:-}" == --dry-run ]]; then N8N_DRY_RUN=1; fi
assert_environment
assert_manifest
require_cmd node
node --version
if command -v psql >/dev/null 2>&1 && [[ -n "${N8N_DB_NAME:-}" ]]; then
  psql -X -v ON_ERROR_STOP=1 -d "$N8N_DB_NAME" -Atc 'select current_setting('"'"'server_version_num'"'"');' | awk '{print "postgresql_server_version_num=" $1}'
else
  info 'PostgreSQL não consultado: defina N8N_DB_NAME no ambiente privado do ensaio.'
fi
if [[ -n "${N8N_RELEASE_SHA:-}" ]]; then
  [[ "$N8N_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'N8N_RELEASE_SHA deve ser SHA de 40 hex.'
  [[ "${N8N_APPROVED_SHA:-$N8N_RELEASE_SHA}" == "$N8N_RELEASE_SHA" ]] || die 'SHA aprovado diverge do release.'
fi
info "manifest target=$(manifest_value environment_policy target_version) current=$(manifest_value environment_policy current_version)"
info 'pré-check somente leitura concluído; nenhum serviço, banco ou workflow foi alterado.'
