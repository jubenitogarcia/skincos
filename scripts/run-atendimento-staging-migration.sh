#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
case "$ACTION" in
  --dry-run|--apply|--rollback) ;;
  *) echo "Usage: $0 --dry-run|--apply|--rollback" >&2; exit 1 ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATOR_ENV="/etc/skincos/crm-atendimento-staging-migrator.env"
sudo -n test -f "$MIGRATOR_ENV" || { echo "Missing $MIGRATOR_ENV" >&2; exit 1; }

# The migrator env is root-owned and never exposed to the interactive operator.
# The short-lived root process executes only the checked-out migration runner.
sudo -n bash -c "set -a; . '$MIGRATOR_ENV'; set +a; cd '$ROOT_DIR/crm/api'; exec /usr/bin/node scripts/migrate-atendimento-staging.mjs '$ACTION'"
