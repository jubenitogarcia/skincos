#!/usr/bin/env bash
set -euo pipefail

# Local-only adapter for the CRM Pages shell. It reuses protected native
# runtime configuration without copying it into the checkout, Pages bindings,
# browser, or logs.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${CRM_LOCAL_WA_ORCHESTRATOR_PORT:-8110}"
ENV_FILE="${CRM_LOCAL_WA_NATIVE_ENV_FILE:-/etc/skincos/crm-whatsapp.env}"
RUN_AS_USER="${CRM_LOCAL_WA_RUN_AS_USER:-admin}"
# This is an operator-owned QA adapter, never a native service runtime.
RUNTIME_HOME="${CRM_LOCAL_WA_RUNTIME_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/skincos/crm-local-adapter}"
SOURCE_HOME="${CRM_LOCAL_WA_SOURCE_HOME:-$RUNTIME_HOME/source}"
DATABASE_URL="${CRM_LOCAL_WA_DATABASE_URL:-postgresql:///skincos_crm_local?host=/var/run/postgresql}"

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
export LOCAL_WA_ADAPTER_DATABASE_URL="$DATABASE_URL"
export LOCAL_WA_ADAPTER_EMAIL="${LOCAL_AUTH_EMAIL:-dev@local.test}"
export LOCAL_WA_ADAPTER_ROLE="${LOCAL_AUTH_ROLE:-GESTOR}"

exec sudo -n /usr/bin/env \
  LOCAL_WA_ADAPTER_ROOT="$LOCAL_WA_ADAPTER_ROOT" \
  LOCAL_WA_ADAPTER_ENV_FILE="$LOCAL_WA_ADAPTER_ENV_FILE" \
  LOCAL_WA_ADAPTER_PORT="$LOCAL_WA_ADAPTER_PORT" \
  LOCAL_WA_ADAPTER_RUNTIME_HOME="$LOCAL_WA_ADAPTER_RUNTIME_HOME" \
  LOCAL_WA_ADAPTER_SOURCE_HOME="$LOCAL_WA_ADAPTER_SOURCE_HOME" \
  LOCAL_WA_ADAPTER_RUN_AS_USER="$LOCAL_WA_ADAPTER_RUN_AS_USER" \
  LOCAL_WA_ADAPTER_DATABASE_URL="$LOCAL_WA_ADAPTER_DATABASE_URL" \
  LOCAL_WA_ADAPTER_EMAIL="$LOCAL_WA_ADAPTER_EMAIL" \
  LOCAL_WA_ADAPTER_ROLE="$LOCAL_WA_ADAPTER_ROLE" \
  /bin/bash -c '
  set -euo pipefail
  set -a
  # The file belongs to the native runtime. Never print or persist its values.
  source "$LOCAL_WA_ADAPTER_ENV_FILE"
  set +a

  : "${EVOLUTION_API_URL:?EVOLUTION_API_URL is required in the native WhatsApp environment}"
  : "${EVOLUTION_API_KEY:?EVOLUTION_API_KEY is required in the native WhatsApp environment}"
  : "${LOCAL_WA_ADAPTER_DATABASE_URL:?CRM_LOCAL_WA_DATABASE_URL is required}"

  # Always use the explicitly local CRM mirror. The OS-level admin role is
  # granted only the local PostgreSQL service role, so editable QA code never
  # runs as the native skincos service account.
  export DATABASE_URL="$LOCAL_WA_ADAPTER_DATABASE_URL"

  # Pages deliberately sends an unsigned actor only to this loopback runtime.
  # Do not inherit production actor keys from the native CRM API environment.
  unset ATENDIMENTO_ACTOR_HMAC_KEY CAIXA_ACTOR_HMAC_KEY ESCALA_ACTOR_HMAC_KEY CRM_ESCALA_HMAC_KEY

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
  # This adapter may read the native database only for local CRM QA. It must
  # not claim or process native Harmonia work.
  export HARMONIA_WORKER_ENABLED=false
  export WA_CHANNEL_OWNER_ENFORCED=false
  export WA_ORCHESTRATOR_PROVIDER=evolution
  export CRM_RUNTIME_HOME="$LOCAL_WA_ADAPTER_RUNTIME_HOME"
  export VAR_DIR="$LOCAL_WA_ADAPTER_RUNTIME_HOME/var"
  export CRM_API_PORT="$LOCAL_WA_ADAPTER_PORT"
  export CRM_API_HOST=127.0.0.1
  export PORT="$LOCAL_WA_ADAPTER_PORT"
  export DEV_AUTH_EMAIL="$LOCAL_WA_ADAPTER_EMAIL"
  export DEV_AUTH_ROLE="$LOCAL_WA_ADAPTER_ROLE"
  export EVOLUTION_INSTANCE_PREFIX="${EVOLUTION_INSTANCE_PREFIX:-crm-channel-}"

  # Keep the native credential in the inherited process environment. Do not put
  # it in a command argument, which would expose it through process inspection.
  exec runuser -u "$LOCAL_WA_ADAPTER_RUN_AS_USER" --preserve-environment -- \
    /usr/bin/node "$LOCAL_WA_ADAPTER_SOURCE_HOME/server.js"
'
