#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
INSTALLER="$ROOT_DIR/scripts/runtime/install-atendimento-crm-core-identity-schema-custody.sh"
TEMPLATE="$ROOT_DIR/scripts/runtime/atendimento-crm-core-identity-schema-custody-wrapper.sh.template"
RUNNER="$ROOT_DIR/crm/api/scripts/run-atendimento-crm-core-identity-schema-staging.mjs"
SUDOERS="$ROOT_DIR/ops/runtime/github-actions-runner/skincos-atendimento-crm-core-identity-schema-custody.sudoers"
UNIT="$ROOT_DIR/ops/runtime/units/skincos-native-custody-runner.service"

bash -n "$INSTALLER"
bash -n "$TEMPLATE"
node --check "$RUNNER"
visudo -cf "$SUDOERS" >/dev/null

contract_output="$(bash "$INSTALLER")"
grep -Fx 'atendimento_crm_core_identity_schema_custody_contract=valid helper=/usr/local/sbin/skincos-run-atendimento-crm-core-identity-schema-staging apply=false' <<<"$contract_output" >/dev/null

grep -Fx "readonly HELPER='/usr/local/sbin/skincos-run-atendimento-crm-core-identity-schema-staging'" "$INSTALLER" >/dev/null
grep -Fx "readonly SUDOERS_FILE='/etc/sudoers.d/skincos-atendimento-crm-core-identity-schema-custody'" "$INSTALLER" >/dev/null
grep -Fx "readonly STATE_ROOT='/var/lib/skincos-runtime/crm-core-identity-schema-custody'" "$INSTALLER" >/dev/null
grep -Fx "readonly BACKUP_ROOT='/var/backups/skincos/clientes/staging'" "$INSTALLER" >/dev/null
grep -Fx "readonly RUNNER_UNIT='skincos-native-custody-runner.service'" "$INSTALLER" >/dev/null
grep -Fx 'readonly CONFIG_FILE='\''/etc/skincos/crm-atendimento-staging-migrator.env'\''' "$TEMPLATE" >/dev/null
grep -Fx 'readonly COORDINATION_ENV_FILE='\''/etc/skincos/global-coordination/native-runtime.env'\''' "$TEMPLATE" >/dev/null
grep -Fx 'readonly STATE_ROOT='\''/var/lib/skincos-runtime/crm-core-identity-schema-custody'\''' "$TEMPLATE" >/dev/null
grep -Fx 'readonly BACKUP_ROOT='\''/var/backups/skincos/clientes/staging'\''' "$TEMPLATE" >/dev/null
grep -Fx 'readonly SERVICE='\''crm-atendimento-staging.service'\''' "$TEMPLATE" >/dev/null
grep -Fx 'ReadWritePaths=/var/lib/skincos-runtime/crm-core-identity-schema-custody' "$UNIT" >/dev/null
grep -Fx 'ReadWritePaths=/var/backups/skincos/clientes/staging' "$UNIT" >/dev/null
grep -Fx 'Cmnd_Alias SKINCOS_ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_CUSTODY = /usr/local/sbin/skincos-run-atendimento-crm-core-identity-schema-staging verify, /usr/local/sbin/skincos-run-atendimento-crm-core-identity-schema-staging apply' "$SUDOERS" >/dev/null
grep -Fx 'skincos-actions ALL=(root) NOPASSWD: SKINCOS_ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_CUSTODY' "$SUDOERS" >/dev/null
[[ "$(grep -Fc '/usr/local/sbin/skincos-run-atendimento-crm-core-identity-schema-staging' "$SUDOERS")" == '1' ]]

grep -F 'ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_ACTION_INVALID' "$RUNNER" >/dev/null
grep -F "const ACTIONS = new Set(['verify', 'apply'])" "$RUNNER" >/dev/null
grep -F 'writerInvocation: false' "$RUNNER" >/dev/null
grep -F 'backfillInvocation: false' "$RUNNER" >/dev/null
grep -F 'deliveryInvocation: false' "$RUNNER" >/dev/null
grep -F 'productionMutationAllowed: false' "$RUNNER" >/dev/null
grep -F 'assertAtendimentoStagingMigratorConnectionLimit' "$RUNNER" >/dev/null
grep -F 'acquireAtendimentoStagingMutationLock' "$RUNNER" >/dev/null
grep -F "NODE_ENV)" "$TEMPLATE" >/dev/null
grep -F "Identity schema migrator NODE_ENV must be production" "$TEMPLATE" >/dev/null
grep -F "Identity schema migrator config is missing NODE_ENV=production" "$TEMPLATE" >/dev/null
grep -F 'Identity schema checkpoint root has unsafe metadata' "$TEMPLATE" >/dev/null

# The installed wrapper may source only its immutable coordination adapter; it
# must parse both private env files as data and never evaluate them as shell.
if grep -Eq '(^|[[:space:]])eval([[:space:]]|$)|(^|[[:space:]])\.[[:space:]].*\.env|(^|[[:space:]])source[[:space:]].*\.env' "$TEMPLATE"; then
  echo 'identity schema helper must not evaluate an environment file' >&2
  exit 1
fi
if grep -Eq 'systemctl[[:space:]]+(start|stop|restart|enable|disable)|wrangler|cloudflare|(^|[^A-Za-z])d1([^A-Za-z]|$)|create[[:space:]]+role|grant[[:space:]]|rollback' "$TEMPLATE"; then
  echo 'identity schema helper must not operate services, Cloudflare, roles, or rollback' >&2
  exit 1
fi
if grep -Eq 'wrangler|cloudflare|(^|[^A-Za-z])d1([^A-Za-z]|$)|create[[:space:]]+role|grant[[:space:]]' "$INSTALLER"; then
  echo 'identity schema installer must not operate infrastructure or database privileges' >&2
  exit 1
fi
grep -Fx '  source "$COORDINATION_ADAPTER"' "$TEMPLATE" >/dev/null
grep -F 'native_coordination_acquire "mini-pc:deploy:atendimento:staging:identity-schema:$RELEASE_SHA:$$"' "$TEMPLATE" >/dev/null
grep -F 'Identity schema apply requires matching maintenance control' "$TEMPLATE" >/dev/null
grep -F 'systemctl show --property=LoadState --value "$SERVICE"' "$TEMPLATE" >/dev/null
grep -F 'systemctl show --property=ActiveState --value "$SERVICE"' "$TEMPLATE" >/dev/null
grep -F 'systemctl show --property=SubState --value "$SERVICE"' "$TEMPLATE" >/dev/null
grep -F 'Identity schema apply requires the isolated staging runtime to be loaded and inactive' "$TEMPLATE" >/dev/null
grep -F 'Private custody directory is not a real directory' "$INSTALLER" >/dev/null
grep -F 'Existing identity schema custody target has unsafe metadata' "$INSTALLER" >/dev/null
grep -F 'Native custody runner must already be active before installing the identity schema helper' "$INSTALLER" >/dev/null
grep -F 'restore_target "$HELPER" helper 0700 "$helper_existed"' "$INSTALLER" >/dev/null
grep -F 'restore_target "$SUDOERS_FILE" sudoers 0440 "$sudoers_existed"' "$INSTALLER" >/dev/null
grep -F 'restore_target "/etc/systemd/system/$RUNNER_UNIT" unit 0644 "$unit_existed"' "$INSTALLER" >/dev/null
grep -F 'custody_runner_restarted=true' "$INSTALLER" >/dev/null
grep -F 'backup_created=true\ database=skincos_staging\ sha256=' "$TEMPLATE" >/dev/null

render_root="$(mktemp -d -t skincos-identity-schema-render-XXXXXXXX)"
cleanup() { rm -rf -- "$render_root"; }
trap cleanup EXIT INT TERM
release_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
rendered="$render_root/skincos-run-atendimento-crm-core-identity-schema-staging"
sed \
  -e "s|__RELEASE_SOURCE__|/opt/skincos/releases/$release_sha/source|g" \
  -e "s|__RELEASE_SHA__|$release_sha|g" \
  "$TEMPLATE" > "$rendered"
bash -n "$rendered"
grep -Fx "readonly RELEASE_SOURCE='/opt/skincos/releases/$release_sha/source'" "$rendered" >/dev/null
grep -Fx "readonly RELEASE_SHA='$release_sha'" "$rendered" >/dev/null
! grep -F '__RELEASE_' "$rendered" >/dev/null

echo 'PASS: Atendimento CRM Core identity schema custody installer is fixed-action and staging-only.'
