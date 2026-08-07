#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly RUNNER="$ROOT_DIR/crm/api/scripts/run-atendimento-staging-quality-refresh.mjs"

# The Node runner has one fixed private env-file path and reads its literal
# DATABASE_URL itself. No sourced configuration or generated shell command can
# execute under sudo.
sudo -n /usr/bin/node "$RUNNER" --apply
