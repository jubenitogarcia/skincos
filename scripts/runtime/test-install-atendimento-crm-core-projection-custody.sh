#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="$ROOT_DIR/scripts/runtime/install-atendimento-crm-core-projection-custody.sh"
CLI="$ROOT_DIR/crm/api/scripts/preflight-atendimento-crm-core-projection-source.mjs"
PREFLIGHT="$ROOT_DIR/crm/api/server/atendimento/projectionSourceMetadataPreflight.js"
SOURCE_CONTRACT="$ROOT_DIR/shared/crm-auth/atendimentoCrmCoreProjectionSourceContract.js"
STAGING_RELEASE_PREPARER="$ROOT_DIR/scripts/runtime/prepare-atendimento-staging-release.sh"

bash -n "$INSTALLER"
node --check "$CLI"
node --check "$PREFLIGHT"
node --check "$SOURCE_CONTRACT"

contract_output="$(bash "$INSTALLER")"
grep -F -- 'atendimento_crm_core_projection_custody_contract=valid' <<<"$contract_output" >/dev/null
grep -F -- "readonly HELPER='/usr/local/sbin/skincos-preflight-atendimento-crm-core-source-metadata'" "$INSTALLER" >/dev/null
grep -F -- "readonly HELPER_ACTION='preflight-source-metadata'" "$INSTALLER" >/dev/null
grep -F -- "readonly CONFIG_FILE='/etc/skincos/crm-core-projection-exporter.env'" "$INSTALLER" >/dev/null
grep -F -- 'readonly SOURCE_CONTRACT_MODULE="$SOURCE_ROOT/shared/crm-auth/atendimentoCrmCoreProjectionSourceContract.js"' "$INSTALLER" >/dev/null
grep -F -- '"$SOURCE_CONTRACT_MODULE"' "$INSTALLER" >/dev/null
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

# The normal immutable staging preparer uses root:skincos so the service can
# read/traverse the release. The custody installer must accept that form only
# because source ownership remains root and the group/other write bits are
# still denied; do not reintroduce a GID-0 requirement.
if grep -Fq -- '"$gid" ==' "$INSTALLER" || grep -Fq -- '"$release_gid" ==' "$INSTALLER" || grep -Fq -- '"$cli_gid" ==' "$INSTALLER"; then
  echo 'projection custody installer must not require source GID 0' >&2
  exit 1
fi
grep -F -- 'mode_is_non_writable() {' "$INSTALLER" >/dev/null
grep -F -- '"${mode: -2:1}" != [2367]' "$INSTALLER" >/dev/null
if grep -Fq -- '8#$' "$INSTALLER"; then
  echo 'projection custody installer must not use an invalid dynamic octal prefix' >&2
  exit 1
fi
mode_is_non_writable() {
  local mode="$1"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  [[ "${mode: -2:1}" != [2367] && "${mode: -1}" != [2367] ]]
}
for allowed_mode in 0640 0750; do
  mode_is_non_writable "$allowed_mode" || { echo "expected non-writable source mode was rejected: $allowed_mode" >&2; exit 1; }
done
for rejected_mode in 0660 0760; do
  ! mode_is_non_writable "$rejected_mode" || { echo "expected writable source mode was accepted: $rejected_mode" >&2; exit 1; }
done
grep -F -- 'run_sudo_clean /usr/bin/chown -R root:skincos "$STAGING"' "$STAGING_RELEASE_PREPARER" >/dev/null
grep -F -- 'run_sudo_clean /usr/bin/find "$STAGING" -type d -exec /usr/bin/chmod 0750 {} +' "$STAGING_RELEASE_PREPARER" >/dev/null
grep -F -- 'run_sudo_clean /usr/bin/find "$STAGING" -type f -exec /usr/bin/chmod 0640 {} +' "$STAGING_RELEASE_PREPARER" >/dev/null

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
