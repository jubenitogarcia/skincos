#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/jubenitogarcia/Automation/skincos"
EVOLUTION_ENV="/Users/jubenitogarcia/Automation/n8n/evolution-api/.env"

if [[ ! -f "$EVOLUTION_ENV" ]]; then
  echo "[crm-api] Missing Evolution env at $EVOLUTION_ENV" >&2
  exit 1
fi

EVOLUTION_API_KEY="$(/usr/bin/grep -E '^AUTHENTICATION_API_KEY=' "$EVOLUTION_ENV" | head -n1 | cut -d= -f2- | tr -d '\r')"
if [[ -z "${EVOLUTION_API_KEY}" ]]; then
  echo "[crm-api] Missing AUTHENTICATION_API_KEY in $EVOLUTION_ENV" >&2
  exit 1
fi

export WA_ORCHESTRATOR_PROVIDER="evolution"
export EVOLUTION_API_URL="http://localhost:8080"
export EVOLUTION_API_KEY
export CRM_PUBLIC_URL="https://crm-api.skincos.com.br"
export CRM_API_PORT="8099"
export PORT="8099"

cd "$ROOT_DIR"
exec node backend/apps/crm-api/server.js
