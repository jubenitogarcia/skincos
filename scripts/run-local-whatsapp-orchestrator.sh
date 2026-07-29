#!/usr/bin/env bash
set -euo pipefail

# Local-only adapter for the CRM Pages shell. It reuses the Evolution credential
# from the protected native runtime without copying it into the checkout, Pages
# bindings, browser, or logs.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${CRM_LOCAL_WA_ORCHESTRATOR_PORT:-8110}"
ENV_FILE="${CRM_LOCAL_WA_NATIVE_ENV_FILE:-/etc/skincos/crm-whatsapp.env}"
RUNTIME_HOME="${CRM_LOCAL_WA_RUNTIME_HOME:-/mnt/c/CodexRuntime/operator/admin/skincos/whatsapp-local-adapter}"
RUN_AS_USER="${CRM_LOCAL_WA_RUN_AS_USER:-admin}"
SOURCE_HOME="${CRM_LOCAL_WA_SOURCE_HOME:-/home/$RUN_AS_USER/.cache/skincos/whatsapp-local-adapter/source}"
# This adapter serves the local Atendimento API as well as the WhatsApp
# endpoints. Keep it on the dedicated local mirror through PostgreSQL peer
# authentication; it never receives a production database URL or password.
DEFAULT_DATABASE_URL="postgresql://${RUN_AS_USER}@/skincos_crm_local?host=/var/run/postgresql"
DATABASE_URL="${CRM_LOCAL_WA_DATABASE_URL:-$DEFAULT_DATABASE_URL}"

if [[ "$DATABASE_URL" != "$DEFAULT_DATABASE_URL" ]]; then
  echo "[whatsapp-local] CRM_LOCAL_WA_DATABASE_URL deve apontar somente para o socket local de skincos_crm_local." >&2
  exit 2
fi

if ! sudo -n -u "$RUN_AS_USER" psql "$DATABASE_URL" -Atqc 'select 1' >/dev/null 2>&1; then
  echo "[whatsapp-local] O banco local skincos_crm_local não está acessível para $RUN_AS_USER." >&2
  exit 2
fi

if ! sudo -n test -f "$ENV_FILE"; then
  echo "[whatsapp-local] Configuração nativa ausente: CRM_LOCAL_WA_NATIVE_ENV_FILE" >&2
  exit 2
fi

if ! sudo -n test -r "$ENV_FILE"; then
  echo "[whatsapp-local] Não foi possível ler a configuração nativa protegida. Configure CRM_LOCAL_WA_NATIVE_ENV_FILE ou a permissão local necessária." >&2
  exit 2
fi

export LOCAL_WA_ADAPTER_ROOT="$ROOT_DIR"
export LOCAL_WA_ADAPTER_ENV_FILE="$ENV_FILE"
export LOCAL_WA_ADAPTER_PORT="$PORT"
export LOCAL_WA_ADAPTER_RUNTIME_HOME="$RUNTIME_HOME"
export LOCAL_WA_ADAPTER_SOURCE_HOME="$SOURCE_HOME"
export LOCAL_WA_ADAPTER_RUN_AS_USER="$RUN_AS_USER"
export LOCAL_WA_ADAPTER_EMAIL="${LOCAL_AUTH_EMAIL:-dev@local.test}"
export LOCAL_WA_ADAPTER_ROLE="${LOCAL_AUTH_ROLE:-GESTOR}"
export LOCAL_WA_ADAPTER_DATABASE_URL="$DATABASE_URL"
export LOCAL_WA_ADAPTER_RUNTIME_DIAGNOSTICS="${CRM_LOCAL_RUNTIME_DIAGNOSTICS:-}"

exec sudo -n /usr/bin/env \
  LOCAL_WA_ADAPTER_ROOT="$LOCAL_WA_ADAPTER_ROOT" \
  LOCAL_WA_ADAPTER_ENV_FILE="$LOCAL_WA_ADAPTER_ENV_FILE" \
  LOCAL_WA_ADAPTER_PORT="$LOCAL_WA_ADAPTER_PORT" \
  LOCAL_WA_ADAPTER_RUNTIME_HOME="$LOCAL_WA_ADAPTER_RUNTIME_HOME" \
  LOCAL_WA_ADAPTER_SOURCE_HOME="$LOCAL_WA_ADAPTER_SOURCE_HOME" \
  LOCAL_WA_ADAPTER_RUN_AS_USER="$LOCAL_WA_ADAPTER_RUN_AS_USER" \
  LOCAL_WA_ADAPTER_EMAIL="$LOCAL_WA_ADAPTER_EMAIL" \
  LOCAL_WA_ADAPTER_ROLE="$LOCAL_WA_ADAPTER_ROLE" \
  LOCAL_WA_ADAPTER_DATABASE_URL="$LOCAL_WA_ADAPTER_DATABASE_URL" \
  LOCAL_WA_ADAPTER_RUNTIME_DIAGNOSTICS="$LOCAL_WA_ADAPTER_RUNTIME_DIAGNOSTICS" \
  /bin/bash -c '
  set -euo pipefail
  set -a
  # The file belongs to the native runtime. Never print or persist its values.
  source "$LOCAL_WA_ADAPTER_ENV_FILE"
  set +a

  : "${EVOLUTION_API_URL:?EVOLUTION_API_URL is required in the native WhatsApp environment}"
  : "${EVOLUTION_API_KEY:?EVOLUTION_API_KEY is required in the native WhatsApp environment}"

  install -d -m 0750 -o "$LOCAL_WA_ADAPTER_RUN_AS_USER" -g "$LOCAL_WA_ADAPTER_RUN_AS_USER" \
    "$LOCAL_WA_ADAPTER_RUNTIME_HOME" "$LOCAL_WA_ADAPTER_RUNTIME_HOME/var" \
    "$(dirname "$LOCAL_WA_ADAPTER_SOURCE_HOME")" "$LOCAL_WA_ADAPTER_SOURCE_HOME"

  # Run a private staged copy from the WSL filesystem. The editable source
  # remains the versioned worktree; this cache avoids Windows/WSL file latency.
  runuser -u "$LOCAL_WA_ADAPTER_RUN_AS_USER" -- rsync -a --delete --exclude node_modules \
    "$LOCAL_WA_ADAPTER_ROOT/crm/api/" "$LOCAL_WA_ADAPTER_SOURCE_HOME/"
  if [[ ! -d "$LOCAL_WA_ADAPTER_SOURCE_HOME/node_modules/express" ]]; then
    runuser -u "$LOCAL_WA_ADAPTER_RUN_AS_USER" -- /usr/bin/npm --prefix "$LOCAL_WA_ADAPTER_SOURCE_HOME" ci --omit=dev --no-audit --no-fund
  fi

  export NODE_ENV=development
  export NO_AUTH=true
  export CRM_LOCAL_NO_AUTH=true
  export WA_CHANNEL_OWNER_ENFORCED=false
  export WA_ORCHESTRATOR_PROVIDER=evolution
  export CRM_RUNTIME_HOME="$LOCAL_WA_ADAPTER_RUNTIME_HOME"
  export VAR_DIR="$LOCAL_WA_ADAPTER_RUNTIME_HOME/var"
  export CRM_API_PORT="$LOCAL_WA_ADAPTER_PORT"
  export CRM_API_HOST=127.0.0.1
  export PORT="$LOCAL_WA_ADAPTER_PORT"
  export DEV_AUTH_EMAIL="$LOCAL_WA_ADAPTER_EMAIL"
  export DEV_AUTH_ROLE="$LOCAL_WA_ADAPTER_ROLE"
  export DATABASE_URL="$LOCAL_WA_ADAPTER_DATABASE_URL"
  export CRM_LOCAL_RUNTIME_DIAGNOSTICS="$LOCAL_WA_ADAPTER_RUNTIME_DIAGNOSTICS"
  export EVOLUTION_INSTANCE_PREFIX="${EVOLUTION_INSTANCE_PREFIX:-crm-channel-}"

  # Keep the native credential in the inherited process environment. Do not put
  # it in a command argument, which would expose it through process inspection.
  exec runuser -u "$LOCAL_WA_ADAPTER_RUN_AS_USER" --preserve-environment -- \
    /usr/bin/node "$LOCAL_WA_ADAPTER_SOURCE_HOME/server.js"
'
