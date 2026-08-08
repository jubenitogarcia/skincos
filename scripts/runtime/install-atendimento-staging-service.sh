#!/usr/bin/bash -p
set -euo pipefail

readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/root' 'LANG=C' "$@"
}

# This installer deliberately shares the production shape but never receives a
# command, source path or unit destination from an environment variable.
readonly UNIT_DEST='/etc/systemd/system'
readonly STATE_ROOT='/var/lib/skincos-runtime'
readonly CONFIG_ROOT='/etc/skincos'
readonly LOG_ROOT='/var/log/skincos'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/staging'
readonly CONTROL_FILE="$CONFIG_ROOT/atendimento-staging/module-control.json"
readonly SERVICE='crm-atendimento-staging.service'

SOURCE_ROOT=''
APPLY=0

usage() { echo "Usage: $0 --source-root /opt/skincos/releases/<full-sha>/source [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root) shift; SOURCE_ROOT="${1:-}" ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

if [[ ! "$SOURCE_ROOT" =~ ^/opt/skincos/releases/([0-9a-f]{40})/source$ ]]; then
  echo 'SOURCE_ROOT must be an immutable native release path with a full lowercase SHA.' >&2
  exit 64
fi
readonly RELEASE_SHA="${BASH_REMATCH[1]}"
readonly UNIT_SRC="$SOURCE_ROOT/ops/runtime/units/crm-atendimento-staging.service"
readonly RUNTIME_ENTRYPOINT="$SOURCE_ROOT/crm/api/server/atendimentoRuntime.js"
readonly RELEASE_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-release.mjs"
readonly CONTROL_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-staging-control.mjs"
readonly RUNTIME_GRANT_LOCKDOWN="$SOURCE_ROOT/scripts/lockdown-atendimento-staging-runtime.sh"

for command_path in /usr/bin/sudo /usr/bin/sed /usr/bin/systemd-analyze /usr/bin/mktemp /usr/bin/install /usr/bin/node /usr/bin/chmod /usr/bin/rm /usr/bin/rmdir /usr/bin/date /usr/bin/cp /usr/bin/systemctl /usr/bin/test; do
  [[ -x "$command_path" ]] || { echo "Missing $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n true
/usr/bin/sudo -n /usr/bin/test -f "$UNIT_SRC" || { echo 'Isolated unit template is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$RUNTIME_ENTRYPOINT" || { echo 'Isolated runtime entrypoint is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$RELEASE_VALIDATOR" || { echo 'Immutable release validator is unavailable.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$CONTROL_VALIDATOR" || { echo 'Strict staging control validator is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -x "$RUNTIME_GRANT_LOCKDOWN" || { echo 'Staging runtime grant lockdown is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$CONTROL_FILE" || { echo 'Strict staging control file is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/node "$RELEASE_VALIDATOR" --source-root "$SOURCE_ROOT" --release-sha "$RELEASE_SHA" --target staging >/dev/null
run_sudo_clean /usr/bin/node "$CONTROL_VALIDATOR" --release-sha "$RELEASE_SHA" >/dev/null
run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --dry-run >/dev/null

umask 0077
render_dir="$(/usr/bin/mktemp -d /tmp/atendimento-staging-unit.XXXXXX)"
/usr/bin/test -d "$render_dir" -a -O "$render_dir"
rendered="$render_dir/crm-atendimento-staging.service"
trap '/usr/bin/rm -f "$rendered"; /usr/bin/rmdir "$render_dir" 2>/dev/null || true' EXIT
/usr/bin/sed \
  -e "s|__REPO_ROOT__|$SOURCE_ROOT|g" \
  -e "s|__STATE_ROOT__|$STATE_ROOT|g" \
  -e "s|__CONFIG_ROOT__|$CONFIG_ROOT|g" \
  -e "s|__LOG_ROOT__|$LOG_ROOT|g" \
  -e "s|__RELEASE_SHA__|$RELEASE_SHA|g" \
  "$UNIT_SRC" >"$rendered"
/usr/bin/chmod 0644 "$rendered"
/usr/bin/systemd-analyze verify "$rendered"

if [[ "$APPLY" != '1' ]]; then
  printf 'dry_run=true service=crm-atendimento-staging.service release_sha=%s source=%s shared_restart=false\n' "$RELEASE_SHA" "$SOURCE_ROOT"
  exit 0
fi

stamp="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
/usr/bin/sudo -n /usr/bin/install -d -m 0700 -o root -g root "$BACKUP_ROOT"
unit_backup='none'
if /usr/bin/sudo -n /usr/bin/test -f "$UNIT_DEST/$SERVICE"; then
  unit_backup="${stamp}-$SERVICE"
  /usr/bin/sudo -n /usr/bin/cp -p "$UNIT_DEST/$SERVICE" "$BACKUP_ROOT/$unit_backup"
fi
/usr/bin/sudo -n /usr/bin/install -m 0644 "$rendered" "$UNIT_DEST/$SERVICE"
/usr/bin/sudo -n /usr/bin/systemctl daemon-reload
# `enable --now` does not replace an already active legacy instance. Restart
# only this dedicated staging unit after the immutable unit file is installed;
# no shared CRM, worker, Orb or tunnel unit is touched.
/usr/bin/sudo -n /usr/bin/systemctl enable "$SERVICE" >/dev/null
/usr/bin/sudo -n /usr/bin/systemctl restart "$SERVICE"
/usr/bin/sudo -n /usr/bin/systemctl is-active --quiet "$SERVICE"
printf 'installed=true service=%s release_sha=%s unit_backup=%s shared_restart=false\n' "$SERVICE" "$RELEASE_SHA" "$unit_backup"
