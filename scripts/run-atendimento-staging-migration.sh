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
readonly SERVICE='crm-atendimento-staging.service'
[[ "$RELEASE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || { echo 'Staging release root is invalid.' >&2; exit 64; }
[[ -f "$RUNNER" ]] || { echo 'Fixed staging migration runner is unavailable in the immutable release.' >&2; exit 78; }
[[ -f "$RELEASE_VALIDATOR" ]] || { echo 'Immutable release validator is unavailable.' >&2; exit 78; }
[[ -f "$CONTROL_VALIDATOR" ]] || { echo 'Strict staging control validator is unavailable.' >&2; exit 78; }
[[ -x "$RUNTIME_GRANT_LOCKDOWN" ]] || { echo 'Fixed staging read-only grant lockdown is unavailable.' >&2; exit 78; }

# The Node runner reads one fixed root-owned file as literal key/value data.
# It always resolves dependencies from the immutable release that was already
# checked for lineage; no worktree, source, bash -c, eval, SSH, or command
# string is accepted from the runtime.
run_sudo_clean /usr/bin/node "$RELEASE_VALIDATOR" --source-root "$RELEASE_ROOT" --release-sha "$RELEASE_SHA" >/dev/null
if [[ "$ACTION" != '--dry-run' ]]; then
  control_report="$(run_sudo_clean /usr/bin/node "$CONTROL_VALIDATOR" --release-sha "$RELEASE_SHA")"
  [[ "$control_report" == *'"state":"maintenance"'* ]] || { echo 'Staging migration requires maintenance control state.' >&2; exit 1; }
  if /usr/bin/sudo -n /usr/bin/systemctl is-active --quiet "$SERVICE"; then
    echo 'Staging migration requires the isolated runtime to be inactive.' >&2
    exit 1
  fi
fi
set +e
run_sudo_clean /usr/bin/node "$RUNNER" "$ACTION"
runner_status=$?
set -e

# A migration can grant its normal writable runtime contract while installing a
# schema. Always seal the dedicated staging login afterwards, even when a
# migration reports an error. The unit stays in maintenance until this passes.
if [[ "$ACTION" != '--dry-run' ]]; then
  run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --apply
fi

exit "$runner_status"
