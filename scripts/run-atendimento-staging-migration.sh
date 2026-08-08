#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
case "$ACTION" in
  --dry-run|--apply|--rollback) ;;
  *) echo "Usage: $0 --dry-run|--apply|--rollback" >&2; exit 64 ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$ROOT_DIR/crm/api/scripts/run-atendimento-staging-migration.mjs"
[[ -f "$RUNNER" ]] || { echo 'Fixed staging migration runner is unavailable.' >&2; exit 78; }

# The Node runner reads one fixed root-owned file as literal key/value data.
# There is no source, bash -c, eval, SSH, or command string from the runtime.
exec sudo -n /usr/bin/node "$RUNNER" "$ACTION"
