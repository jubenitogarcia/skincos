#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATOR_ENV="/etc/skincos/crm-atendimento-staging-migrator.env"
sudo -n test -f "$MIGRATOR_ENV" || { echo "Missing $MIGRATOR_ENV" >&2; exit 1; }
sudo -n bash -c "set -a; . '$MIGRATOR_ENV'; set +a; cd '$ROOT_DIR/crm/api'; exec /usr/bin/node scripts/refresh-commercial-data-quality-staging.mjs --apply"
