#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly RUNNER="$ROOT_DIR/crm/api/scripts/run-atendimento-staging-quality-refresh.mjs"
source "$ROOT_DIR/scripts/runtime/global-coordination-native.sh"

SOURCE_SHA="${SKINCOS_GLOBAL_COORDINATION_SOURCE_SHA:-}"
COORDINATION_CLOSURE="${SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE:-}"
ACTION="${1:---apply}"
[[ "$ACTION" == '--apply' || "$ACTION" == '--dry-run' ]] || { echo 'Usage: refresh-atendimento-staging-quality.sh [--dry-run|--apply]' >&2; exit 64; }
if [[ "$ACTION" == '--apply' ]]; then
  [[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'SKINCOS_GLOBAL_COORDINATION_SOURCE_SHA is required for quality refresh apply.' >&2; exit 78; }
  [[ -n "$COORDINATION_CLOSURE" && -f "$COORDINATION_CLOSURE" ]] || { echo 'SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE is required for quality refresh apply.' >&2; exit 78; }
  native_coordination_init deploy:atendimento:staging atendimento "$SOURCE_SHA" "$COORDINATION_CLOSURE" mutation
  coordination_acquired=0
  cleanup_coordination() {
    if [[ "$coordination_acquired" == '1' ]]; then
      native_coordination_cleanup || true
      coordination_acquired=0
    fi
  }
  trap cleanup_coordination EXIT INT TERM
  native_coordination_acquire "mini-pc:deploy:atendimento:staging:quality-refresh:$SOURCE_SHA:$$" >/dev/null
  coordination_acquired=1
  native_coordination_check
fi

# The Node runner has one fixed private env-file path and reads its literal
# DATABASE_URL itself. No sourced configuration or generated shell command can
# execute under sudo.
if [[ "$ACTION" == '--apply' ]]; then
  native_coordination_check
fi
sudo -n /usr/bin/node "$RUNNER" "$ACTION"
