#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="$ROOT_DIR/scripts/runtime/install-atendimento-crm-core-projection-custody.sh"
CLI="$ROOT_DIR/crm/api/scripts/preflight-atendimento-crm-core-projection-source.mjs"
PREFLIGHT="$ROOT_DIR/crm/api/server/atendimento/projectionSourceMetadataPreflight.js"

bash -n "$INSTALLER"
node --check "$CLI"
node --check "$PREFLIGHT"

contract_output="$(bash "$INSTALLER")"
grep -F -- 'atendimento_crm_core_projection_custody_contract=valid' <<<"$contract_output" >/dev/null
grep -F -- "readonly HELPER='/usr/local/sbin/skincos-preflight-atendimento-crm-core-source-metadata'" "$INSTALLER" >/dev/null
grep -F -- "readonly HELPER_ACTION='preflight-source-metadata'" "$INSTALLER" >/dev/null
grep -F -- "readonly CONFIG_FILE='/etc/skincos/crm-core-projection-exporter.env'" "$INSTALLER" >/dev/null
grep -F -- '/usr/bin/chmod 0700 "$helper_stage"' "$INSTALLER" >/dev/null
grep -F -- '/usr/bin/install -o root -g root -m 0700 "$helper_stage" "$HELPER"' "$INSTALLER" >/dev/null
grep -F -- 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' "$PREFLIGHT" >/dev/null
grep -F -- 'CRM_CORE_PROJECTION_EXPORTER_DATABASE_URL' "$INSTALLER" >/dev/null
grep -F -- 'CRM_CORE_PROJECTION_EXPORTER_DATABASE_URL' "$CLI" >/dev/null
grep -F -- 'CRM projection exporter config must be a regular file' "$INSTALLER" >/dev/null
grep -F -- 'CRM projection custody release is not immutable' "$INSTALLER" >/dev/null
grep -F -- 'Bash variables cannot carry NUL bytes.' "$INSTALLER" >/dev/null
grep -F -- 'sourceReadExecutionAllowed: false' "$PREFLIGHT" >/dev/null
grep -F -- 'deliveryAllowed: false' "$PREFLIGHT" >/dev/null
grep -F -- 'productionMutationAllowed: false' "$PREFLIGHT" >/dev/null
grep -F -- 'publicRouteMutationAllowed: false' "$PREFLIGHT" >/dev/null
grep -F -- 'legacyPublisherMutationAllowed: false' "$PREFLIGHT" >/dev/null

if grep -Fq -- '0755 "$helper_stage"' "$INSTALLER"; then
  echo 'projection custody helper must not be world executable' >&2
  exit 1
fi

if grep -Fq -- 'skincos-prepare-atendimento-crm-core-baseline' "$INSTALLER"; then
  echo 'projection source preflight installer must not replace the staging baseline helper' >&2
  exit 1
fi

if grep -Fq -- "\$'\\\\0'" "$INSTALLER"; then
  echo 'projection custody helper must not test a Bash NUL pattern' >&2
  exit 1
fi

if grep -Eq 'systemctl[[:space:]]+(start|restart|enable|disable)|(^|[[:space:]])(source|\.)[[:space:]].*\.env|eval[[:space:]]|bash[[:space:]]+-c|wrangler|cloudflare|d1[[:space:]]' "$INSTALLER"; then
  echo 'projection custody installer must not start services, evaluate config, or publish infrastructure' >&2
  exit 1
fi

echo 'PASS: CRM Core Atendimento projection custody installer is fixed-action and fail-closed.'
