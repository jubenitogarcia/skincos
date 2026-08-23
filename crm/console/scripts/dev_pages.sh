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
R2_PERSIST_DIR_EXPLICIT="${R2_PERSIST_DIR+x}"
R2_PERSIST_DIR="${R2_PERSIST_DIR:-.wrangler}"
CRM_DIST_DIR="${CRM_DIST_DIR:-$ROOT_DIR/dist}"
CRM_LOCAL_LOG_LEVEL="${CRM_LOCAL_LOG_LEVEL:-warn}"
CRM_LOCAL_ISOLATED="${CRM_LOCAL_ISOLATED:-0}"
COMPAT_DATE="${COMPAT_DATE:-2026-01-13}"

cd "$ROOT_DIR"
if [[ "$CRM_DIST_DIR" != /* ]]; then
  CRM_DIST_DIR="$ROOT_DIR/$CRM_DIST_DIR"
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

PAGES_BINDING_ARGS=()
PAGES_ENV_ARGS=()

add_binding() {
  local key="$1"
  local value="$2"
  PAGES_BINDING_ARGS+=(--binding "${key}=${value}")
}

add_optional_binding() {
  local key="$1"
  local value="${2:-}"
  if [[ -n "$value" ]]; then
    add_binding "$key" "$value"
  fi
}

local_auth_bypass="${LOCAL_AUTH_BYPASS:-false}"
local_auth_role="${LOCAL_AUTH_ROLE:-GESTOR}"
local_auth_test_user_admin="${LOCAL_AUTH_TEST_USER_ADMIN:-true}"
local_auth_username="${LOCAL_AUTH_USERNAME:-dev}"
local_auth_email="${LOCAL_AUTH_EMAIL:-dev@local.test}"
local_auth_name="${LOCAL_AUTH_NAME:-Dev Local}"
local_auth_allowed_modules="${LOCAL_AUTH_ALLOWED_MODULES:-}"
local_auth_allowed_units="${LOCAL_AUTH_ALLOWED_UNITS:-}"
finance_api_target="${LOCAL_FINANCE_API_TARGET:-${FINANCE_API_TARGET:-}}"
auth_path_prefix="${AUTH_PATH_PREFIX:-/insumos/auth}"
escala_api_target="${ESCALA_API_TARGET:-https://escala-api.skincos.com.br}"
local_escala_mock="${LOCAL_ESCALA_MOCK:-false}"
local_escala_shadow_writes="${LOCAL_ESCALA_SHADOW_WRITES:-true}"

if [[ "$CRM_LOCAL_ISOLATED" == "1" ]]; then
  if [[ -z "$R2_PERSIST_DIR_EXPLICIT" || "$R2_PERSIST_DIR" != /* ]]; then
    echo "[dev_pages] CRM_LOCAL_ISOLATED=1 exige R2_PERSIST_DIR absoluto e explícito." >&2
    exit 2
  fi
  mkdir -p "$R2_PERSIST_DIR"
  root_real="$(realpath -m "$ROOT_DIR")"
  persist_real="$(realpath -m "$R2_PERSIST_DIR")"
  if [[ "$persist_real" == "$root_real" || "$persist_real" == "$root_real/"* ]]; then
    echo "[dev_pages] O estado isolado do Pages deve ficar fora da árvore fonte: $persist_real" >&2
    exit 2
  fi
  if [[ ! -f "$CRM_DIST_DIR/index.html" ]]; then
    echo "[dev_pages] O modo isolado exige um dist já construído; nenhum artefato será criado na árvore fonte." >&2
    exit 2
  fi

  # An explicit empty env file prevents Wrangler from loading the mutable
  # .dev.vars shared by another local instance. Every local identity value is
  # supplied to this process only.
  PAGES_ENV_ARGS+=(--env-file /dev/null)
  add_binding "LOCAL_AUTH_BYPASS" "$local_auth_bypass"
  add_binding "LOCAL_AUTH_ROLE" "$local_auth_role"
  add_binding "LOCAL_AUTH_TEST_USER_ADMIN" "$local_auth_test_user_admin"
  add_binding "LOCAL_AUTH_USERNAME" "$local_auth_username"
  add_binding "LOCAL_AUTH_EMAIL" "$local_auth_email"
  add_binding "LOCAL_AUTH_NAME" "$local_auth_name"
  add_binding "LOCAL_AUTH_ALLOWED_MODULES" "$local_auth_allowed_modules"
  add_binding "LOCAL_AUTH_ALLOWED_UNITS" "$local_auth_allowed_units"

  add_optional_binding "AUTH_API_TARGET" "${AUTH_API_TARGET:-}"
  add_binding "AUTH_PATH_PREFIX" "$auth_path_prefix"
  add_optional_binding "CRM_API_TARGET" "${CRM_API_TARGET:-}"
  add_optional_binding "CAIXA_API_TARGET" "${CAIXA_API_TARGET:-}"
  add_optional_binding "TRACKING_API_TARGET" "${TRACKING_API_TARGET:-}"
  add_optional_binding "UNIT_MONITOR_API_TARGET" "${UNIT_MONITOR_API_TARGET:-}"
  add_optional_binding "FINANCE_API_TARGET" "$finance_api_target"
  add_optional_binding "LOCAL_FINANCE_ACTOR" "${LOCAL_FINANCE_ACTOR:-}"
  add_optional_binding "LOCAL_FINANCE_CSRF_TOKEN" "${LOCAL_FINANCE_CSRF_TOKEN:-}"
  add_binding "ESCALA_API_TARGET" "$escala_api_target"
  add_binding "LOCAL_ESCALA_MOCK" "$local_escala_mock"
  add_binding "LOCAL_ESCALA_SHADOW_WRITES" "$local_escala_shadow_writes"
  add_optional_binding "ESCALA_ACTOR_HMAC_KEY" "${ESCALA_ACTOR_HMAC_KEY:-}"
  add_optional_binding "INSTAGRAM_MODULE_TARGET" "${INSTAGRAM_MODULE_TARGET:-}"
else
  if [[ ! -f "$ROOT_DIR/.dev.vars" && -f "$ROOT_DIR/.dev.vars.example" ]]; then
    cp "$ROOT_DIR/.dev.vars.example" "$ROOT_DIR/.dev.vars"
    echo "[dev_pages] .dev.vars não existia; criado a partir de .dev.vars.example"
  fi

  upsert_non_secret_dev_var "LOCAL_AUTH_BYPASS" "$local_auth_bypass"
  upsert_non_secret_dev_var "LOCAL_AUTH_ROLE" "$local_auth_role"
  upsert_non_secret_dev_var "LOCAL_AUTH_TEST_USER_ADMIN" "$local_auth_test_user_admin"
  upsert_non_secret_dev_var "LOCAL_AUTH_USERNAME" "$local_auth_username"
  upsert_non_secret_dev_var "LOCAL_AUTH_EMAIL" "$local_auth_email"
  upsert_non_secret_dev_var "LOCAL_AUTH_NAME" "$local_auth_name"
  upsert_non_secret_dev_var "LOCAL_AUTH_ALLOWED_MODULES" "$local_auth_allowed_modules"
  upsert_non_secret_dev_var "LOCAL_AUTH_ALLOWED_UNITS" "$local_auth_allowed_units"
  if [[ -n "$finance_api_target" ]]; then
    upsert_non_secret_dev_var "FINANCE_API_TARGET" "$finance_api_target"
  fi
  for finance_key in LOCAL_FINANCE_ACTOR LOCAL_FINANCE_CSRF_TOKEN; do
    finance_value="${!finance_key:-}"
    if [[ -n "$finance_value" ]]; then
      upsert_non_secret_dev_var "$finance_key" "$finance_value"
    fi
  done
  ensure_dev_var "ESCALA_API_TARGET" "https://escala-api.skincos.com.br"
  ensure_dev_var "LOCAL_ESCALA_MOCK" "false"
  ensure_dev_var "LOCAL_ESCALA_SHADOW_WRITES" "true"
  ensure_dev_var "ESCALA_ACTOR_HMAC_KEY" "__CONFIGURE_REAL_ESCALA_HMAC_KEY__"
fi

if [[ -n "${LOCAL_INSUMOS_API_TARGET:-}" ]]; then
  add_binding "INSUMOS_API_TARGET" "$LOCAL_INSUMOS_API_TARGET"
elif [[ "$CRM_LOCAL_ISOLATED" == "1" ]]; then
  add_optional_binding "INSUMOS_API_TARGET" "${INSUMOS_API_TARGET:-}"
fi
if [[ -n "${PONTO_API_TARGET:-}" ]]; then
  add_binding "PONTO_API_TARGET" "$PONTO_API_TARGET"
fi
if [[ -n "${PONTO_ACTOR_HMAC_KEY:-}" ]]; then
  add_binding "PONTO_ACTOR_HMAC_KEY" "$PONTO_ACTOR_HMAC_KEY"
fi
if [[ -n "${PONTO_NETWORK_CONTEXT_KEY:-}" ]]; then
  add_binding "PONTO_NETWORK_CONTEXT_KEY" "$PONTO_NETWORK_CONTEXT_KEY"
fi
if [[ -n "${LOCAL_WA_ORCHESTRATOR_API_TARGET:-}" ]]; then
  add_binding "WA_ORCHESTRATOR_API_TARGET" "$LOCAL_WA_ORCHESTRATOR_API_TARGET"
  # The local WhatsApp adapter is a private crm-api instance. It also owns the
  # Atendimento routes, so the local Pages proxy must not fall back to the
  # native service on :8099 (which correctly requires signed production auth).
  add_binding "ATENDIMENTO_API_TARGET" "$LOCAL_WA_ORCHESTRATOR_API_TARGET"
elif [[ "$CRM_LOCAL_ISOLATED" == "1" ]]; then
  add_optional_binding "WA_ORCHESTRATOR_API_TARGET" "${WA_ORCHESTRATOR_API_TARGET:-}"
  add_optional_binding "ATENDIMENTO_API_TARGET" "${ATENDIMENTO_API_TARGET:-}"
fi

# Evita rota API quebrada por _routes.json desatualizado em dist/
if [[ "$CRM_LOCAL_ISOLATED" != "1" && -f "$ROOT_DIR/public/_routes.json" ]]; then
  mkdir -p "$CRM_DIST_DIR"
  cp "$ROOT_DIR/public/_routes.json" "$CRM_DIST_DIR/_routes.json"
fi

echo "[dev_pages] Iniciando Vite em :$VITE_PORT"
npm run dev -- --host 127.0.0.1 --port "$VITE_PORT" --strictPort &
VITE_PID=$!

cleanup() {
  if [[ -n "${VITE_PID:-}" ]]; then
    kill "$VITE_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "[dev_pages] Iniciando Pages Functions (proxy :$VITE_PORT) em :$PAGES_PORT"
npx --no-install wrangler pages dev "$CRM_DIST_DIR" "${PAGES_ENV_ARGS[@]}" --proxy "$VITE_PORT" --port "$PAGES_PORT" --compatibility-date "$COMPAT_DATE" --persist-to "$R2_PERSIST_DIR" --log-level "$CRM_LOCAL_LOG_LEVEL" --show-interactive-dev-session false "${PAGES_BINDING_ARGS[@]}"
