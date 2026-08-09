#!/usr/bin/bash -p
set -euo pipefail

readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/root' 'LANG=C' "$@"
}

ACTION=''
RELEASE_SHA=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|--apply|--rollback)
      [[ -z "$ACTION" ]] || { echo 'Exactly one migration action is required.' >&2; exit 64; }
      ACTION="$1" ;;
    --release-sha) shift; RELEASE_SHA="${1:-}" ;;
    *) echo "Usage: $0 --dry-run|--apply|--rollback --release-sha <full-main-sha>" >&2; exit 64 ;;
  esac
  shift
done

[[ "$ACTION" =~ ^--(dry-run|apply|rollback)$ ]] || { echo 'Exactly one migration action is required.' >&2; exit 64; }
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--release-sha must be a full lowercase SHA.' >&2; exit 64; }

readonly RELEASE_ROOT="/opt/skincos/releases/$RELEASE_SHA/source"
readonly RUNNER="$RELEASE_ROOT/crm/api/scripts/run-atendimento-production-migration.mjs"
readonly RELEASE_VALIDATOR="$RELEASE_ROOT/crm/api/scripts/validate-atendimento-release.mjs"
readonly CONTROL_VALIDATOR="$RELEASE_ROOT/crm/api/scripts/validate-atendimento-production-control.mjs"
readonly RUNTIME_GRANT_LOCKDOWN="$RELEASE_ROOT/scripts/lockdown-atendimento-production-runtime.sh"
readonly BACKUP_SCRIPT="$RELEASE_ROOT/scripts/backup-atendimento-production.sh"
readonly SERVICE='crm-atendimento-production.service'
LOCKDOWN_REQUIRED=0

[[ "$RELEASE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || { echo 'Production release root is invalid.' >&2; exit 64; }
run_sudo_clean /usr/bin/test -f "$RUNNER" || { echo 'Fixed production migration runner is unavailable in immutable release.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -f "$RELEASE_VALIDATOR" || { echo 'Immutable release validator is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -f "$CONTROL_VALIDATOR" || { echo 'Strict production control validator is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -x "$RUNTIME_GRANT_LOCKDOWN" || { echo 'Production grant lockdown is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -x "$BACKUP_SCRIPT" || { echo 'Production backup helper is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/node "$RELEASE_VALIDATOR" --source-root "$RELEASE_ROOT" --release-sha "$RELEASE_SHA" --target production >/dev/null

if [[ "$ACTION" != '--dry-run' ]]; then
  control_report="$(run_sudo_clean /usr/bin/node "$CONTROL_VALIDATOR" --release-sha "$RELEASE_SHA")"
  [[ "$control_report" == *'"state":"maintenance"'* ]] || { echo 'Production migration requires maintenance control state.' >&2; exit 1; }
  if run_sudo_clean /usr/bin/systemctl is-active --quiet "$SERVICE"; then
    echo 'Production migration requires the isolated runtime to be inactive.' >&2
    exit 1
  fi
  run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --dry-run >/dev/null
  backup_report="$(run_sudo_clean /usr/bin/bash -p "$BACKUP_SCRIPT")"
  [[ "$backup_report" =~ ^backup_created=true\ database=skincos_clientes_production\ sha256=[0-9a-f]{64}\ private=true\ unique=true$ ]] || {
    echo 'Production migration backup did not satisfy the private unique artifact contract.' >&2
    exit 70
  }
  printf '%s\n' "$backup_report"
  LOCKDOWN_REQUIRED=1
fi

seal_production_runtime_grants() {
  local exit_status="$?"
  trap - EXIT
  trap '' HUP INT TERM
  if [[ "$LOCKDOWN_REQUIRED" == '1' ]]; then
    set +e
    run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --apply
    local lockdown_status=$?
    set -e
    if [[ "$lockdown_status" -ne 0 ]]; then
      echo 'Production runtime grant lockdown failed; keeping service ineligible.' >&2
      exit 70
    fi
  fi
  exit "$exit_status"
}

if [[ "$LOCKDOWN_REQUIRED" == '1' ]]; then
  trap seal_production_runtime_grants EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
fi

run_sudo_clean /usr/bin/node "$RUNNER" "${ACTION#--}" --release-sha "$RELEASE_SHA"
