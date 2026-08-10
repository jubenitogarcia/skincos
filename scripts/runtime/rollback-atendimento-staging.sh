#!/usr/bin/bash -p
set -euo pipefail

# Restore a previously captured *isolated* staging unit and maintenance
# control. The rollback never names, reloads, stops or restarts a shared CRM,
# worker, Orb or Cloudflare service.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/root' 'LANG=C' "$@"
}

readonly RELEASE_BASE='/opt/skincos/releases'
readonly SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly UNIT_DEST='/etc/systemd/system'
readonly CONFIG_ROOT='/etc/skincos'
readonly CONTROL_FILE="$CONFIG_ROOT/atendimento-staging/module-control.json"
readonly UNIT_BACKUP_ROOT='/var/backups/skincos/clientes/staging'
readonly CONTROL_BACKUP_ROOT='/var/backups/skincos/clientes/staging-control'
readonly SERVICE='crm-atendimento-staging.service'
readonly PROTECTED_SERVICES=(
  'crm.service'
  'crm-atendimento-production.service'
  'crm-jobs.service'
  'cloudflare-runtime.service'
  'cloudflare-orb.service'
  'orb.service'
  'orb-proxy.service'
)

TARGET_SHA=''
UNIT_BACKUP_NAME=''
CONTROL_BACKUP_NAME=''
APPLY=0

usage() {
  printf '%s\n' 'Usage: scripts/runtime/rollback-atendimento-staging.sh --to-sha <full-sha> --unit-backup <timestamp-crm-atendimento-staging.unique.service> --control-backup <timestamp-module-control.unique.json> [--apply]'
  printf '%s\n' 'The default is a full verification dry-run. Apply restores only a verified isolated staging unit and a matching maintenance control.'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to-sha) shift; TARGET_SHA="${1:-}" ;;
    --unit-backup) shift; UNIT_BACKUP_NAME="${1:-}" ;;
    --control-backup) shift; CONTROL_BACKUP_NAME="${1:-}" ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--to-sha must be a full lowercase SHA.' >&2; exit 64; }
[[ "$UNIT_BACKUP_NAME" =~ ^[0-9]{8}T[0-9]{6}Z-crm-atendimento-staging\.[A-Za-z0-9]{6}\.service$ ]] || { echo '--unit-backup must be a fixed unique staging unit backup basename.' >&2; exit 64; }
[[ "$CONTROL_BACKUP_NAME" =~ ^[0-9]{8}T[0-9]{6}Z-module-control\.[A-Za-z0-9]{6}\.json$ ]] || { echo '--control-backup must be a fixed unique staging control backup basename.' >&2; exit 64; }

readonly SOURCE_ROOT="$RELEASE_BASE/$TARGET_SHA/source"
readonly UNIT_BACKUP="$UNIT_BACKUP_ROOT/$UNIT_BACKUP_NAME"
readonly CONTROL_BACKUP="$CONTROL_BACKUP_ROOT/$CONTROL_BACKUP_NAME"
readonly UNIT_FILE="$UNIT_DEST/$SERVICE"
readonly RELEASE_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-release.mjs"
readonly CONTROL_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-staging-control.mjs"
readonly CONTROL_BACKUP_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-staging-rollback-control.mjs"
readonly RUNTIME_GRANT_LOCKDOWN="$SOURCE_ROOT/scripts/lockdown-atendimento-staging-runtime.sh"
readonly STAGING_VALIDATOR="$SOURCE_ROOT/scripts/validate-atendimento-staging-readonly.sh"
readonly UNIT_TEMPLATE="$SOURCE_ROOT/ops/runtime/units/$SERVICE"
readonly COORDINATION_CLOSURE="$SOURCE_ROOT/.skincos-global-coordination-atendimento.json"

[[ "$SOURCE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || { echo 'Rollback release root is invalid.' >&2; exit 64; }
for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/node /usr/bin/bash /usr/bin/test /usr/bin/stat /usr/bin/sed /usr/bin/mktemp /usr/bin/chmod /usr/bin/rm /usr/bin/rmdir /usr/bin/cmp /usr/bin/install /usr/bin/systemctl /usr/bin/systemd-analyze; do
  [[ -x "$command_path" ]] || { echo "Missing $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n /usr/bin/true

for path in "$RELEASE_VALIDATOR" "$CONTROL_VALIDATOR" "$CONTROL_BACKUP_VALIDATOR" "$RUNTIME_GRANT_LOCKDOWN" "$STAGING_VALIDATOR" "$UNIT_TEMPLATE" "$COORDINATION_CLOSURE"; do
  run_sudo_clean /usr/bin/test -f "$path" || { echo "Required immutable rollback artifact is unavailable: $path" >&2; exit 78; }
done
run_sudo_clean /usr/bin/test -x "$RUNTIME_GRANT_LOCKDOWN"
run_sudo_clean /usr/bin/test -x "$STAGING_VALIDATOR"
run_sudo_clean /usr/bin/test -d "$CONFIG_ROOT/atendimento-staging" || { echo 'Dedicated staging control directory is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -d "$UNIT_DEST" || { echo 'Dedicated systemd unit directory is unavailable.' >&2; exit 78; }

# The target has to be an immutable, explicitly staged Atendimento release;
# generic legacy source releases and arbitrary source paths cannot be restored.
run_sudo_clean /usr/bin/node "$RELEASE_VALIDATOR" --source-root "$SOURCE_ROOT" --release-sha "$TARGET_SHA" --target staging >/dev/null

for path in "$UNIT_BACKUP" "$CONTROL_BACKUP"; do
  run_sudo_clean /usr/bin/test -f "$path" || { echo "Rollback backup is unavailable: $path" >&2; exit 78; }
  if run_sudo_clean /usr/bin/test -L "$path"; then
    echo "Rollback backup must not be a symbolic link: $path" >&2
    exit 78
  fi
done
unit_metadata="$(run_sudo_clean /usr/bin/stat -c '%U:%G:%a' "$UNIT_BACKUP")"
[[ "$unit_metadata" == 'root:root:644' ]] || { echo 'Rollback unit backup ownership or mode is invalid.' >&2; exit 78; }
control_metadata="$(run_sudo_clean /usr/bin/stat -c '%U:%G:%a' "$CONTROL_BACKUP")"
[[ "$control_metadata" == 'root:skincos:640' ]] || { echo 'Rollback control backup ownership or mode is invalid.' >&2; exit 78; }
run_sudo_clean /usr/bin/node "$CONTROL_BACKUP_VALIDATOR" --release-sha "$TARGET_SHA" --backup-name "$CONTROL_BACKUP_NAME" >/dev/null
run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --dry-run >/dev/null

# The unit backup must be precisely the template rendered for the requested
# immutable release. This rejects a legacy server.js unit even when it happens
# to live under a valid release SHA.
umask 0077
render_dir="$(/usr/bin/mktemp -d /tmp/atendimento-staging-rollback.XXXXXX)"
/usr/bin/test -d "$render_dir" -a -O "$render_dir"
rendered="$render_dir/$SERVICE"
cleanup_render() {
  /usr/bin/rm -f "$rendered"
  /usr/bin/rmdir "$render_dir" 2>/dev/null || true
  if [[ "${coordination_acquired:-0}" == '1' ]]; then
    native_coordination_cleanup || true
    coordination_acquired=0
  fi
}
trap cleanup_render EXIT INT TERM
/usr/bin/sed \
  -e "s|__REPO_ROOT__|$SOURCE_ROOT|g" \
  -e 's|__STATE_ROOT__|/var/lib/skincos-runtime|g' \
  -e 's|__CONFIG_ROOT__|/etc/skincos|g' \
  -e 's|__LOG_ROOT__|/var/log/skincos|g' \
  -e "s|__RELEASE_SHA__|$TARGET_SHA|g" \
  "$UNIT_TEMPLATE" >"$rendered"
/usr/bin/chmod 0644 "$rendered"
/usr/bin/systemd-analyze verify "$rendered"
run_sudo_clean /usr/bin/cmp -s "$rendered" "$UNIT_BACKUP" || { echo 'Rollback unit backup does not match the requested immutable release.' >&2; exit 78; }

snapshot_protected_services() {
  local service main_pid started_at
  for service in "${PROTECTED_SERVICES[@]}"; do
    main_pid="$(run_sudo_clean /usr/bin/systemctl show --property=MainPID --value "$service" 2>/dev/null || true)"
    started_at="$(run_sudo_clean /usr/bin/systemctl show --property=ActiveEnterTimestampMonotonic --value "$service" 2>/dev/null || true)"
    printf '%s|%s|%s\n' "$service" "$main_pid" "$started_at"
  done
}

if [[ "$APPLY" != '1' ]]; then
  printf 'dry_run=true service=%s rollback_sha=%s unit_backup=%s control_backup=%s control_state=maintenance shared_restart=false\n' "$SERVICE" "$TARGET_SHA" "$UNIT_BACKUP_NAME" "$CONTROL_BACKUP_NAME"
  exit 0
fi

protected_before="$(snapshot_protected_services)"
source "$SCRIPT_ROOT/scripts/runtime/global-coordination-native.sh"
native_coordination_init deploy:atendimento:staging atendimento "$TARGET_SHA" "$COORDINATION_CLOSURE" mutation
coordination_acquired=0
native_coordination_acquire "mini-pc:deploy:atendimento:staging:rollback:$TARGET_SHA:$$" >/dev/null
coordination_acquired=1
native_coordination_check
# Install maintenance before changing the unit. A still-running newer process
# then fails closed on its next request because its expected SHA no longer
# matches the restored control.
run_sudo_clean /usr/bin/install -m 0640 -o root -g skincos "$CONTROL_BACKUP" "$CONTROL_FILE"
native_coordination_check
run_sudo_clean /usr/bin/install -m 0644 -o root -g root "$UNIT_BACKUP" "$UNIT_FILE"
native_coordination_check
run_sudo_clean /usr/bin/systemctl daemon-reload
native_coordination_check
run_sudo_clean /usr/bin/systemctl restart "$SERVICE"
run_sudo_clean /usr/bin/systemctl is-active --quiet "$SERVICE"
run_sudo_clean /usr/bin/node "$CONTROL_VALIDATOR" --release-sha "$TARGET_SHA" >/dev/null
run_sudo_clean /usr/bin/bash -p "$STAGING_VALIDATOR" --expected-release-sha "$TARGET_SHA" >/dev/null
protected_after="$(snapshot_protected_services)"
[[ "$protected_before" == "$protected_after" ]] || { echo 'A protected shared service changed during isolated staging rollback.' >&2; exit 1; }
printf 'rollback_restored=true service=%s rollback_sha=%s unit_backup=%s control_backup=%s control_state=maintenance shared_restart=false\n' "$SERVICE" "$TARGET_SHA" "$UNIT_BACKUP_NAME" "$CONTROL_BACKUP_NAME"
