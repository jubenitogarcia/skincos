#!/usr/bin/bash -p
set -euo pipefail

readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE \
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
      ACTION="$1"
      ;;
    --release-sha)
      shift
      RELEASE_SHA="${1:-}"
      ;;
    *) echo "Usage: $0 --dry-run|--apply|--rollback --release-sha <full-main-sha>" >&2; exit 64 ;;
  esac
  shift
done

[[ "$ACTION" =~ ^--(dry-run|apply|rollback)$ ]] || { echo 'Exactly one migration action is required.' >&2; exit 64; }
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--release-sha must be a full lowercase SHA.' >&2; exit 64; }

readonly RELEASE_ROOT="/opt/skincos/releases/$RELEASE_SHA/source"
readonly RUNNER="$RELEASE_ROOT/crm/api/scripts/run-atendimento-staging-migration.mjs"
readonly RELEASE_VALIDATOR="$RELEASE_ROOT/crm/api/scripts/validate-atendimento-release.mjs"
readonly CONTROL_VALIDATOR="$RELEASE_ROOT/crm/api/scripts/validate-atendimento-staging-control.mjs"
readonly RUNTIME_GRANT_LOCKDOWN="$RELEASE_ROOT/scripts/lockdown-atendimento-staging-runtime.sh"
readonly BACKUP_SCRIPT="$RELEASE_ROOT/scripts/backup-atendimento-staging.sh"
readonly SERVICE='crm-atendimento-staging.service'
LOCKDOWN_REQUIRED=0
[[ "$RELEASE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || { echo 'Staging release root is invalid.' >&2; exit 64; }
run_sudo_clean /usr/bin/test -f "$RUNNER" || { echo 'Fixed staging migration runner is unavailable in the immutable release.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -f "$RELEASE_VALIDATOR" || { echo 'Immutable release validator is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -f "$CONTROL_VALIDATOR" || { echo 'Strict staging control validator is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -x "$RUNTIME_GRANT_LOCKDOWN" || { echo 'Fixed staging read-only grant lockdown is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -x "$BACKUP_SCRIPT" || { echo 'Fixed staging backup helper is unavailable in the immutable release.' >&2; exit 78; }

# The Node runner reads one fixed root-owned file as literal key/value data.
# It always resolves dependencies from the immutable release that was already
# checked for lineage; no worktree, source, bash -c, eval, SSH, or command
# string is accepted from the runtime.
run_sudo_clean /usr/bin/node "$RELEASE_VALIDATOR" --source-root "$RELEASE_ROOT" --release-sha "$RELEASE_SHA" --target staging >/dev/null
if [[ "$ACTION" != '--dry-run' ]]; then
  control_report="$(run_sudo_clean /usr/bin/node "$CONTROL_VALIDATOR" --release-sha "$RELEASE_SHA")"
  [[ "$control_report" == *'"state":"maintenance"'* ]] || { echo 'Staging migration requires maintenance control state.' >&2; exit 1; }
  if /usr/bin/sudo -n /usr/bin/systemctl is-active --quiet "$SERVICE"; then
    echo 'Staging migration requires the isolated runtime to be inactive.' >&2
    exit 1
  fi
  # A previous SIGKILL or power loss is not trappable. Refuse to begin another
  # migration until the persisted role is already sealed; the fixed lockdown
  # script is the recovery action and the installer performs the same check.
  run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --dry-run >/dev/null

  # Capture a root-private, unique, verified dump only after every admission
  # gate has passed and immediately before the mutable migration runner. The
  # helper never accepts a caller-controlled destination and exposes only a
  # SHA-256 attestation, not the dump path or its contents.
  backup_report="$(run_sudo_clean /usr/bin/bash -p "$BACKUP_SCRIPT")"
  [[ "$backup_report" =~ ^backup_created=true\ database=skincos_staging\ sha256=[0-9a-f]{64}\ private=true\ unique=true$ ]] || {
    echo 'Staging migration backup did not satisfy the private unique artifact contract.' >&2
    exit 70
  }
  printf '%s\n' "$backup_report"

  # Arm the seal only after all preconditions passed and immediately before the
  # migrator can create its temporary runtime grants. EXIT also covers runner
  # errors and the ordinary signal exits below. SIGKILL/power loss cannot be
  # trapped, so install/validation independently require a passing dry-run
  # seal before any isolated runtime can start.
  LOCKDOWN_REQUIRED=1
fi

seal_staging_runtime_grants() {
  local exit_status="$?"
  trap - EXIT
  # Once a migration has committed, do not let a second ordinary termination
  # signal interrupt the only operation that revokes its temporary grants.
  # SIGKILL/power loss remain covered by the preflight seal on the next run.
  trap '' HUP INT TERM
  if [[ "$LOCKDOWN_REQUIRED" == '1' ]]; then
    set +e
    run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --apply
    local lockdown_status=$?
    set -e
    if [[ "$lockdown_status" -ne 0 ]]; then
      echo 'Staging runtime grant lockdown failed; keeping the isolated service ineligible.' >&2
      exit 70
    fi
  fi
  exit "$exit_status"
}

if [[ "$LOCKDOWN_REQUIRED" == '1' ]]; then
  trap seal_staging_runtime_grants EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
fi

# The runner persists only sanitized migration-evidence rows. Bind each
# mutable invocation to the already-validated immutable release; no caller
# supplied path or environment is retained.
run_sudo_clean /usr/bin/node "$RUNNER" "$ACTION" --release-sha "$RELEASE_SHA"
