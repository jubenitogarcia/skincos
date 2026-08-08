#!/usr/bin/env bash
set -euo pipefail

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
[[ "$RELEASE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || { echo 'Staging release root is invalid.' >&2; exit 64; }
[[ -f "$RUNNER" ]] || { echo 'Fixed staging migration runner is unavailable in the immutable release.' >&2; exit 78; }
[[ -f "$RELEASE_VALIDATOR" ]] || { echo 'Immutable release validator is unavailable.' >&2; exit 78; }

# The Node runner reads one fixed root-owned file as literal key/value data.
# It always resolves dependencies from the immutable release that was already
# checked for lineage; no worktree, source, bash -c, eval, SSH, or command
# string is accepted from the runtime.
sudo -n /usr/bin/node "$RELEASE_VALIDATOR" --source-root "$RELEASE_ROOT" --release-sha "$RELEASE_SHA" >/dev/null
exec sudo -n /usr/bin/node "$RUNNER" "$ACTION"
