#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT=${1:-prod}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../" && pwd)"

DB_NAME="skincos-escala"
ENV_FLAG=""

if [[ "$ENVIRONMENT" == "staging" ]]; then
  DB_NAME="skincos-escala-staging"
  ENV_FLAG="--env staging"
fi

cd "$ROOT_DIR"

echo "[escala-api] Seeding $DB_NAME ($ENVIRONMENT)"
exec npx wrangler d1 execute "$DB_NAME" --remote $ENV_FLAG --file=seed/escala_seed.sql
