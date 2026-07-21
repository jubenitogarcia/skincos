#!/usr/bin/env bash
set -euo pipefail

# Dev local para Pages Functions (Social/Instagram/Share) + Vite (HMR).
# Uso:
#   ./scripts/dev_pages.sh
# Variáveis opcionais:
#   VITE_PORT=5173 PAGES_PORT=8788 R2_PERSIST_DIR=.wrangler

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VITE_PORT="${VITE_PORT:-5173}"
PAGES_PORT="${PAGES_PORT:-8788}"
R2_PERSIST_DIR="${R2_PERSIST_DIR:-.wrangler}"
CRM_LOCAL_LOG_LEVEL="${CRM_LOCAL_LOG_LEVEL:-warn}"
COMPAT_DATE="${COMPAT_DATE:-2026-01-13}"

cd "$ROOT_DIR"

if [[ ! -f "$ROOT_DIR/.dev.vars" && -f "$ROOT_DIR/.dev.vars.example" ]]; then
  cp "$ROOT_DIR/.dev.vars.example" "$ROOT_DIR/.dev.vars"
  echo "[dev_pages] .dev.vars não existia; criado a partir de .dev.vars.example"
fi

ensure_dev_var() {
  local key="$1"
  local value="$2"
  if [[ ! -f "$ROOT_DIR/.dev.vars" ]]; then
    return
  fi
  if ! grep -qE "^${key}=" "$ROOT_DIR/.dev.vars"; then
    printf '\n%s=%s\n' "$key" "$value" >> "$ROOT_DIR/.dev.vars"
    echo "[dev_pages] ${key} não estava em .dev.vars; adicionado default local"
  fi
}

upsert_non_secret_dev_var() {
  local key="$1"
  local value="$2"
  if [[ ! -f "$ROOT_DIR/.dev.vars" ]]; then
    return
  fi
  if grep -qE "^${key}=" "$ROOT_DIR/.dev.vars"; then
    sed -i -E "s#^${key}=.*#${key}=${value}#" "$ROOT_DIR/.dev.vars"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ROOT_DIR/.dev.vars"
  fi
}

upsert_non_secret_dev_var "LOCAL_AUTH_BYPASS" "${LOCAL_AUTH_BYPASS:-false}"
upsert_non_secret_dev_var "LOCAL_AUTH_ROLE" "${LOCAL_AUTH_ROLE:-GESTOR}"
upsert_non_secret_dev_var "LOCAL_AUTH_TEST_USER_ADMIN" "${LOCAL_AUTH_TEST_USER_ADMIN:-true}"
upsert_non_secret_dev_var "LOCAL_AUTH_EMAIL" "${LOCAL_AUTH_EMAIL:-dev@local.test}"
upsert_non_secret_dev_var "LOCAL_AUTH_NAME" "${LOCAL_AUTH_NAME:-Dev Local}"
ensure_dev_var "ESCALA_API_TARGET" "https://escala-api.skincos.com.br"
ensure_dev_var "LOCAL_ESCALA_MOCK" "false"
ensure_dev_var "LOCAL_ESCALA_SHADOW_WRITES" "true"
ensure_dev_var "ESCALA_ACTOR_HMAC_KEY" "__CONFIGURE_REAL_ESCALA_HMAC_KEY__"

PAGES_BINDING_ARGS=()
if [[ -n "${LOCAL_INSUMOS_API_TARGET:-}" ]]; then
  PAGES_BINDING_ARGS+=(--binding "INSUMOS_API_TARGET=${LOCAL_INSUMOS_API_TARGET}")
fi
if [[ -n "${PONTO_API_TARGET:-}" ]]; then
  PAGES_BINDING_ARGS+=(--binding "PONTO_API_TARGET=${PONTO_API_TARGET}")
fi
if [[ -n "${PONTO_ACTOR_HMAC_KEY:-}" ]]; then
  PAGES_BINDING_ARGS+=(--binding "PONTO_ACTOR_HMAC_KEY=${PONTO_ACTOR_HMAC_KEY}")
fi
if [[ -n "${PONTO_NETWORK_CONTEXT_KEY:-}" ]]; then
  PAGES_BINDING_ARGS+=(--binding "PONTO_NETWORK_CONTEXT_KEY=${PONTO_NETWORK_CONTEXT_KEY}")
fi
if [[ -n "${LOCAL_WA_ORCHESTRATOR_API_TARGET:-}" ]]; then
  PAGES_BINDING_ARGS+=(--binding "WA_ORCHESTRATOR_API_TARGET=${LOCAL_WA_ORCHESTRATOR_API_TARGET}")
fi

# Evita rota API quebrada por _routes.json desatualizado em dist/
if [[ -f "$ROOT_DIR/public/_routes.json" ]]; then
  mkdir -p "$ROOT_DIR/dist"
  cp "$ROOT_DIR/public/_routes.json" "$ROOT_DIR/dist/_routes.json"
fi

echo "[dev_pages] Iniciando Vite em :$VITE_PORT"
npm run dev -- --host 127.0.0.1 --port "$VITE_PORT" &
VITE_PID=$!

cleanup() {
  if [[ -n "${VITE_PID:-}" ]]; then
    kill "$VITE_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "[dev_pages] Iniciando Pages Functions (proxy :$VITE_PORT) em :$PAGES_PORT"
npx --no-install wrangler pages dev "$ROOT_DIR/dist" --proxy "$VITE_PORT" --port "$PAGES_PORT" --compatibility-date "$COMPAT_DATE" --persist-to "$R2_PERSIST_DIR" --log-level "$CRM_LOCAL_LOG_LEVEL" --show-interactive-dev-session false "${PAGES_BINDING_ARGS[@]}"
