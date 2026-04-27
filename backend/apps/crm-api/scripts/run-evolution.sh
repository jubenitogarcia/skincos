#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="${ROOT_DIR:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"
WORKSPACE_ENV="$ROOT_DIR/backend/config/workspace.local.env"
if [[ -f "$WORKSPACE_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$WORKSPACE_ENV"
  set +a
fi
DEFAULT_EVOLUTION_ENV_IN_REPO="$ROOT_DIR/backend/apps/whatsapp/evolution-api/.env"
DEFAULT_EVOLUTION_ENV_LEGACY="$HOME/Automation/n8n/evolution-api/.env"
EVOLUTION_ENV="${EVOLUTION_ENV:-$DEFAULT_EVOLUTION_ENV_IN_REPO}"

if [[ ! -f "$EVOLUTION_ENV" && -f "$DEFAULT_EVOLUTION_ENV_LEGACY" ]]; then
  EVOLUTION_ENV="$DEFAULT_EVOLUTION_ENV_LEGACY"
fi

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
export EVOLUTION_API_URL="${EVOLUTION_API_URL:-http://localhost:8080}"
export EVOLUTION_API_KEY
export CRM_PUBLIC_URL="${CRM_PUBLIC_URL:-https://api.skincos.com.br}"
export CRM_API_PORT="${CRM_API_PORT:-8099}"
export PORT="${PORT:-$CRM_API_PORT}"

if [[ -n "${CRM_BASIC_AUTH:-}" ]]; then
  export CRM_BASIC_AUTH
else
  echo "[crm-api] CRM_BASIC_AUTH not set; protected restart/proxy routes may require explicit credentials." >&2
fi

cd "$ROOT_DIR"
exec node backend/apps/crm-api/server.js
