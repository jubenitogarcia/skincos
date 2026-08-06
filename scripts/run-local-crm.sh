#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/crm-local-persona-runtime.sh"
FRONTEND_DIR="$ROOT_DIR/crm/console"
BACKEND_DIR="$ROOT_DIR/backend"
TIMEKEEPING_DIR="$ROOT_DIR/workforce/timekeeping"
INSUMOS_HELPER="$ROOT_DIR/backend/scripts/insumos.sh"
INSUMOS_EXPORTER="$ROOT_DIR/backend/scripts/insumos-d1-export.cjs"
INSUMOS_SEEDER="$ROOT_DIR/backend/scripts/insumos-seed.sh"
WHATSAPP_ORCHESTRATOR_HELPER="$ROOT_DIR/scripts/run-local-whatsapp-orchestrator.sh"
BUILD_STATE_HELPER="$ROOT_DIR/scripts/crm-local-build-state.mjs"

crm_source_git() {
  if git -C "$ROOT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "$ROOT_DIR" "$@"
    return
  fi
  if command -v git.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
    git.exe -C "$(wslpath -w "$ROOT_DIR")" "$@"
    return
  fi
  return 1
}

CRM_HOST="${CRM_HOST:-127.0.0.1}"
CRM_BIND_HOST="${CRM_BIND_HOST:-127.0.0.1}"
CRM_PUBLIC_HOST="${CRM_PUBLIC_HOST:-localhost}"
if [[ -n "${CRM_VITE_PORT+x}" ]]; then
  CRM_VITE_PORT_EXPLICIT=1
else
  CRM_VITE_PORT_EXPLICIT=0
fi
CRM_VITE_PORT="${CRM_VITE_PORT:-5173}"
CRM_PAGES_PORT="${CRM_PAGES_PORT:-8791}"
CRM_ROUTE="${CRM_ROUTE:-/}"
CRM_MODULE="${CRM_MODULE:-}"
CRM_PROFILE="${CRM_PROFILE:-realistic}"
CRM_RESET_LOCAL_AUTH_ON_START="${CRM_RESET_LOCAL_AUTH_ON_START:-1}"
if [[ -n "${CRM_OPEN_BROWSER+x}" ]]; then
  CRM_OPEN_BROWSER_EXPLICIT=1
else
  CRM_OPEN_BROWSER_EXPLICIT=0
fi
is_codex_app_shell() {
  [[ "${CODEX_SHELL:-}" == "1" || "${CODEX_CI:-}" == "1" || "${CODEX_INTERNAL_ORIGINATOR_OVERRIDE:-}" == "Codex Desktop" ]]
}

if [[ "$CRM_OPEN_BROWSER_EXPLICIT" == "0" ]] && is_codex_app_shell; then
  CRM_OPEN_BROWSER=0
else
  CRM_OPEN_BROWSER="${CRM_OPEN_BROWSER:-1}"
fi
CRM_SMOKE="${CRM_SMOKE:-0}"
CRM_SMOKE_HEADED="${CRM_SMOKE_HEADED:-${HEADED:-0}}"
CRM_EXIT_AFTER_SMOKE="${CRM_EXIT_AFTER_SMOKE:-0}"
if [[ -n "${CRM_GATE_STRICT+x}" ]]; then
  CRM_GATE_STRICT="$CRM_GATE_STRICT"
elif [[ -z "$CRM_MODULE" ]]; then
  CRM_GATE_STRICT=1
else
  CRM_GATE_STRICT=0
fi
if [[ -n "${CRM_BUILD_BEFORE_START+x}" ]]; then
  CRM_BUILD_BEFORE_START="${CRM_BUILD_BEFORE_START}"
elif is_codex_app_shell; then
  CRM_BUILD_BEFORE_START=0
else
  CRM_BUILD_BEFORE_START=1
fi
CRM_META_ADS_SCENARIO="${CRM_META_ADS_SCENARIO:-}"
if [[ -n "${CRM_WITH_INSUMOS+x}" ]]; then
  CRM_WITH_INSUMOS="$CRM_WITH_INSUMOS"
elif [[ -z "$CRM_MODULE" ]]; then
  # The generic shell exposes Insumos, so run its local Worker instead of proxying
  # visible read requests to the shared authenticated backend.
  CRM_WITH_INSUMOS=1
else
  CRM_WITH_INSUMOS=0
fi
CRM_INSUMOS_PORT="${CRM_INSUMOS_PORT:-8787}"
CRM_WITH_WHATSAPP="${CRM_WITH_WHATSAPP:-0}"
CRM_WA_ORCHESTRATOR_PORT="${CRM_WA_ORCHESTRATOR_PORT:-8110}"
if [[ -n "${CRM_WITH_TIMEKEEPING+x}" ]]; then
  CRM_WITH_TIMEKEEPING="$CRM_WITH_TIMEKEEPING"
elif [[ -z "$CRM_MODULE" || "$CRM_MODULE" == "ponto" ]]; then
  CRM_WITH_TIMEKEEPING=1
else
  CRM_WITH_TIMEKEEPING=0
fi
CRM_TIMEKEEPING_PORT="${CRM_TIMEKEEPING_PORT:-8801}"
CRM_TIMEKEEPING_ENV_FILE="${CRM_TIMEKEEPING_ENV_FILE:-}"
PONTO_PAGES_ENV_FILE="${PONTO_PAGES_ENV_FILE:-}"
CRM_INVENTORY_IDENTITY_ENV_FILE="${CRM_INVENTORY_IDENTITY_ENV_FILE:-}"
CRM_TIMEKEEPING_RELEASE_SHA="${CRM_TIMEKEEPING_RELEASE_SHA:-}"
CRM_INSUMOS_SNAPSHOT="${CRM_INSUMOS_SNAPSHOT:-}"
CRM_REFRESH_INSUMOS_SNAPSHOT="${CRM_REFRESH_INSUMOS_SNAPSHOT:-0}"
CRM_LOCAL_LOG_LEVEL="${CRM_LOCAL_LOG_LEVEL:-warn}"
readonly CRM_LOCAL_IDENTITY_VERSION_ID="00000000-0000-4000-8000-000000000001"
PID_FILE="${CRM_PID_FILE:-$ROOT_DIR/.crm-local-dev.pid}"
LOG_FILE="${CRM_LOG_FILE:-$ROOT_DIR/.crm-local-dev.log}"
SNAPSHOT_DEFAULT_PATH="${CRM_INSUMOS_SNAPSHOT_DEFAULT:-$ROOT_DIR/backend/var/local/insumos-snapshot.latest.json}"
if [[ -z "${CRM_TARGET_COMMIT:-}" ]]; then
  CRM_TARGET_COMMIT="$(crm_source_git rev-parse HEAD 2>/dev/null || true)"
fi
crm_persona_runtime_init
CRM_BUILD_LOCK_DIR="${CRM_BUILD_LOCK_DIR:-$CRM_RUNTIME_ROOT/build.lock}"
CRM_DEPENDENCY_STATE_ROOT="${CRM_DEPENDENCY_STATE_ROOT:-$(dirname "$CRM_BUILD_LOCK_DIR")/dependencies}"
CRM_FRONTEND_DEPENDENCY_CACHE_ROOT="${CRM_FRONTEND_DEPENDENCY_CACHE_ROOT:-/home/$(id -un)/.cache/skincos/crm-local/frontend-dependencies}"
CRM_ALLOW_LEGACY_DEPENDENCY_MIGRATION="${CRM_ALLOW_LEGACY_DEPENDENCY_MIGRATION:-0}"
CRM_WRANGLER_REGISTRY_PATH="${CRM_WRANGLER_REGISTRY_PATH:-$CRM_RUNTIME_ROOT/state/wrangler-registry}"
CRM_INSUMOS_PERSIST_DIR="${CRM_INSUMOS_PERSIST_DIR:-$CRM_RUNTIME_ROOT/state/insumos}"
CRM_INSUMOS_DEPENDENCY_ROOT="${CRM_INSUMOS_DEPENDENCY_ROOT:-$CRM_DEPENDENCY_STATE_ROOT/insumos}"
CRM_INSUMOS_DEPENDENCY_STATE_FILE="${CRM_INSUMOS_DEPENDENCY_STATE_FILE:-$CRM_INSUMOS_DEPENDENCY_ROOT/dependency-key.sha256}"
CRM_INSUMOS_DEPENDENCY_LOCK_FILE="${CRM_INSUMOS_DEPENDENCY_LOCK_FILE:-$CRM_INSUMOS_DEPENDENCY_ROOT/install.lock}"
CRM_INSUMOS_DEPENDENCY_CACHE_ROOT="${CRM_INSUMOS_DEPENDENCY_CACHE_ROOT:-$CRM_INSUMOS_DEPENDENCY_ROOT/cache}"
CRM_TIMEKEEPING_PERSIST_DIR="${CRM_TIMEKEEPING_PERSIST_DIR:-$CRM_RUNTIME_ROOT/state/timekeeping}"
R2_PERSIST_DIR="${R2_PERSIST_DIR:-$CRM_RUNTIME_ROOT/state/pages}"
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-0}"
export WRANGLER_REGISTRY_PATH="$CRM_WRANGLER_REGISTRY_PATH"
export CRM_INSUMOS_DEPENDENCY_STATE_FILE
export CRM_INSUMOS_DEPENDENCY_LOCK_FILE
export CRM_INSUMOS_DEPENDENCY_CACHE_ROOT
CRM_TIMEKEEPING_RELEASE_SHA="${CRM_TIMEKEEPING_RELEASE_SHA:-$CRM_TARGET_COMMIT}"
CRM_TIMEKEEPING_PRIVATE_ROOT="${CRM_TIMEKEEPING_PRIVATE_ROOT:-$(dirname "$CRM_RUNTIME_ROOT")/ponto-private}"
CRM_TIMEKEEPING_ENV_FILE="${CRM_TIMEKEEPING_ENV_FILE:-$CRM_TIMEKEEPING_PRIVATE_ROOT/timekeeping.worker.env}"
PONTO_PAGES_ENV_FILE="${PONTO_PAGES_ENV_FILE:-$CRM_TIMEKEEPING_PRIVATE_ROOT/ponto.pages.env}"
CRM_INVENTORY_IDENTITY_ENV_FILE="${CRM_INVENTORY_IDENTITY_ENV_FILE:-$CRM_TIMEKEEPING_PRIVATE_ROOT/inventory.identity.env}"

report_timestamp() {
  date +%Y%m%d-%H%M%S
}

usage() {
  cat <<EOF
SKINCOS • Testar CRM local

Uso:
  $(basename "$0") [rota] [opções]

Perfis:
  realistic (default)  Bypass local do shell CRM + Pages Functions local + Meta/Escala reais quando configurados.
                       Se --with-insumos estiver ativo, usa Worker local de Insumos com snapshot opcional.
  session              Sem bypass local. Exige login manual no localhost para testar a sessão/permite validar auth real.

Opções:
  --profile NAME                 realistic | session
  --module NAME                  Abre o CRM já no módulo informado (ex.: meta-ads, site-tracking)
  --crm-host HOST                Host do Vite (default: 127.0.0.1)
  --vite-port PORT               Porta do Vite (default: 5173)
  --pages-port PORT              Porta do Pages local (default: 8791)
  --meta-ads-scenario NAME       live | disconnected | connected-no-account | connected-ready | unauthorized
                                 Ativa um cenário local controlado do Meta Ads/tracking em localhost.
  --skip-build                   Não roda build do frontend antes de subir o Pages local
  --with-insumos                 Sobe Worker local do Insumos e aponta o CRM para ele
  --insumos-port PORT            Porta do Worker local de Insumos (default: 8787)
  --insumos-snapshot FILE        Faz seed local do Insumos com este snapshot JSON
  --refresh-insumos-snapshot     Exporta um snapshot novo do D1 remoto antes do seed
  --with-whatsapp                Inicia o adaptador local do WhatsApp
  --without-whatsapp             Não inicia o adaptador local do WhatsApp (default)
  --whatsapp-port PORT           Porta do adaptador WhatsApp local (default: 8110)
  CRM_LOCAL_LOG_LEVEL=LEVEL      Nível dos runtimes locais: warn (default), info, debug, error ou none
  CRM_BROWSER_DIAGNOSTICS_LOG=FILE Arquivo privado para diagnósticos conhecidos do Chromium durante smokes
  CRM_TIMEKEEPING_ENV_FILE=FILE Arquivo privado do Worker com todos os bindings críticos do Ponto
  PONTO_PAGES_ENV_FILE=FILE      Arquivo privado com actor/network e a release-probe key derivada para Pages
  --smoke                        Roda uma smoke local do módulo após subir o CRM
  --exit-after-smoke             Encerra o CRM local depois da smoke
  --headed-smoke                 Roda a smoke com janela visível para debug
  --browser                      Abre o navegador automaticamente mesmo durante --smoke
  --no-browser                   Não abre o navegador automaticamente
  --stop                         Encerra a instância atual e sai
  -h, --help                     Mostrar ajuda

Exemplos:
  ./scripts/run-local-crm.sh
  ./scripts/run-local-crm.sh --module meta-ads
  ./scripts/run-local-crm.sh --module site-tracking
  ./scripts/run-local-crm.sh --module meta-ads --meta-ads-scenario live
  ./scripts/run-local-crm.sh --module meta-ads --smoke
  ./scripts/run-local-crm.sh /meta-ads --with-insumos --insumos-snapshot ./tmp/insumos.json
  ./scripts/run-local-crm.sh --profile session
EOF
}

case "$CRM_ROUTE" in
  /*) ;;
  *) CRM_ROUTE="/$CRM_ROUTE" ;;
esac

STOP_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) shift; CRM_PROFILE="$1" ;;
    --module) shift; CRM_MODULE="$1" ;;
    --crm-host) shift; CRM_HOST="$1" ;;
    --vite-port) shift; CRM_VITE_PORT="$1"; CRM_VITE_PORT_EXPLICIT=1 ;;
    --pages-port) shift; CRM_PAGES_PORT="$1" ;;
    --meta-ads-scenario) shift; CRM_META_ADS_SCENARIO="$1" ;;
    --skip-build) CRM_BUILD_BEFORE_START=0 ;;
    --with-insumos) CRM_WITH_INSUMOS=1 ;;
    --insumos-port) shift; CRM_INSUMOS_PORT="$1" ;;
    --insumos-snapshot) shift; CRM_INSUMOS_SNAPSHOT="$1" ;;
    --refresh-insumos-snapshot) CRM_REFRESH_INSUMOS_SNAPSHOT=1 ;;
    --with-whatsapp) CRM_WITH_WHATSAPP=1 ;;
    --without-whatsapp) CRM_WITH_WHATSAPP=0 ;;
    --whatsapp-port) shift; CRM_WA_ORCHESTRATOR_PORT="$1" ;;
    --smoke) CRM_SMOKE=1 ;;
    --exit-after-smoke) CRM_EXIT_AFTER_SMOKE=1 ;;
    --headed-smoke) CRM_SMOKE_HEADED=1 ;;
    --browser) CRM_OPEN_BROWSER=1; CRM_OPEN_BROWSER_EXPLICIT=1 ;;
    --no-browser) CRM_OPEN_BROWSER=0; CRM_OPEN_BROWSER_EXPLICIT=1 ;;
    --stop) STOP_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      if [[ "$1" == /* && "$CRM_ROUTE" == "/" ]]; then
        CRM_ROUTE="$1"
      else
        echo "Opção desconhecida: $1" >&2
        usage
        exit 1
      fi
      ;;
  esac
  shift || true
done

if [[ "$CRM_SMOKE" == "1" && "$CRM_OPEN_BROWSER_EXPLICIT" == "0" ]]; then
  CRM_OPEN_BROWSER=0
fi

if [[ "$CRM_EXIT_AFTER_SMOKE" == "1" ]]; then
  CRM_SMOKE=1
fi

append_query_param() {
  local url="$1"
  local key="$2"
  local value="$3"
  if [[ "$url" == *\?* ]]; then
    printf '%s&%s=%s' "$url" "$key" "$value"
  else
    printf '%s?%s=%s' "$url" "$key" "$value"
  fi
}

if [[ -n "$CRM_MODULE" ]]; then
  CRM_ROUTE="$(append_query_param "$CRM_ROUTE" "module" "$CRM_MODULE")"
fi

if [[ "$CRM_PROFILE" == "realistic" && "$CRM_RESET_LOCAL_AUTH_ON_START" != "0" ]]; then
  CRM_ROUTE="$(append_query_param "$CRM_ROUTE" "localAuthReset" "1")"
fi

if [[ ( -z "$CRM_MODULE" || "$CRM_MODULE" == "meta-ads" || "$CRM_MODULE" == "site-tracking" ) && -z "$CRM_META_ADS_SCENARIO" && "$CRM_PROFILE" == "realistic" ]]; then
  CRM_META_ADS_SCENARIO="connected-ready"
fi

if [[ -n "$CRM_META_ADS_SCENARIO" && "$CRM_META_ADS_SCENARIO" != "live" ]]; then
  CRM_ROUTE="$(append_query_param "$CRM_ROUTE" "metaAdsLocalScenario" "$CRM_META_ADS_SCENARIO")"
fi

DEFAULT_URL="http://${CRM_PUBLIC_HOST}:${CRM_PAGES_PORT}${CRM_ROUTE}"
NETWORK_URL="http://${CRM_HOST}:${CRM_PAGES_PORT}${CRM_ROUTE}"

collect_descendants() {
  local parent_pid="$1"
  local child_pid
  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi
  while IFS= read -r child_pid; do
    [[ -n "$child_pid" ]] || continue
    collect_descendants "$child_pid"
    echo "$child_pid"
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)
}

terminate_pid() {
  local target_pid="$1"
  local target_ticks
  local descendant_pid
  local descendant_ticks
  local descendant_identities=""
  if ! kill -0 "$target_pid" >/dev/null 2>&1; then
    return 0
  fi
  target_ticks="$(crm_runtime_pid_start_ticks "$target_pid" 2>/dev/null || true)"
  [[ "$target_ticks" =~ ^[0-9]+$ ]] || return 0

  while IFS= read -r descendant_pid; do
    [[ -n "$descendant_pid" ]] || continue
    descendant_ticks="$(crm_runtime_pid_start_ticks "$descendant_pid" 2>/dev/null || true)"
    if [[ "$descendant_ticks" =~ ^[0-9]+$ ]]; then
      descendant_identities+="${descendant_pid}:${descendant_ticks}"$'\n'
    fi
  done < <(collect_descendants "$target_pid")

  while IFS=: read -r descendant_pid descendant_ticks; do
    [[ -n "$descendant_pid" ]] || continue
    if crm_runtime_pid_identity_matches "$descendant_pid" "$descendant_ticks"; then
      kill -TERM "$descendant_pid" >/dev/null 2>&1 || true
    fi
  done <<< "$descendant_identities"
  if crm_runtime_pid_identity_matches "$target_pid" "$target_ticks"; then
    kill -TERM "$target_pid" >/dev/null 2>&1 || true
  fi

  local attempt
  local any_alive
  for attempt in {1..40}; do
    any_alive=0
    if crm_runtime_pid_identity_matches "$target_pid" "$target_ticks"; then
      any_alive=1
    fi
    while IFS=: read -r descendant_pid descendant_ticks; do
      [[ -n "$descendant_pid" ]] || continue
      if crm_runtime_pid_identity_matches "$descendant_pid" "$descendant_ticks"; then
        any_alive=1
      fi
    done <<< "$descendant_identities"
    if [[ "$any_alive" == "0" ]]; then
      return 0
    fi
    sleep 0.25
  done

  while IFS=: read -r descendant_pid descendant_ticks; do
    [[ -n "$descendant_pid" ]] || continue
    if crm_runtime_pid_identity_matches "$descendant_pid" "$descendant_ticks"; then
      kill -KILL "$descendant_pid" >/dev/null 2>&1 || true
    fi
  done <<< "$descendant_identities"
  if crm_runtime_pid_identity_matches "$target_pid" "$target_ticks"; then
    kill -KILL "$target_pid" >/dev/null 2>&1 || true
  fi
}

stop_existing() {
  local existing_pid
  local existing_ticks
  local existing_runtime_id

  if [[ -f "$PID_FILE" ]]; then
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    existing_ticks="$(cat "${PID_FILE}.start-ticks" 2>/dev/null || true)"
    existing_runtime_id="$(cat "${PID_FILE}.runtime-id" 2>/dev/null || true)"
    if crm_runtime_pid_identity_matches "$existing_pid" "$existing_ticks" && [[ "$existing_runtime_id" == "$CRM_RUNTIME_ID" ]]; then
      echo "Instância anterior $CRM_RUNTIME_ID detectada (PID $existing_pid). Finalizando..."
      terminate_pid "$existing_pid"
    elif [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "[crm-local] PID $existing_pid não possui a identidade esperada de $CRM_RUNTIME_ID; ele não será encerrado." >&2
    fi
    rm -f "$PID_FILE" "${PID_FILE}.start-ticks" "${PID_FILE}.runtime-id"
  fi
}

rotate_current_log() {
  local log_dir
  local log_name
  local log_stem
  local archive_path
  local archives=()
  local index

  log_dir="$(dirname "$LOG_FILE")"
  log_name="$(basename "$LOG_FILE")"
  log_stem="${log_name%.log}"

  if [[ -s "$LOG_FILE" ]]; then
    archive_path="$log_dir/${log_stem}-$(report_timestamp)-$$.log"
    mv "$LOG_FILE" "$archive_path"
  else
    rm -f "$LOG_FILE"
  fi

  mapfile -t archives < <(ls -1t "$log_dir/${log_stem}-"*.log 2>/dev/null || true)
  for ((index = 10; index < ${#archives[@]}; index += 1)); do
    rm -f -- "${archives[$index]}"
  done

  touch "$LOG_FILE"
}

stop_owned_port_listener() {
  local port="$1"
  local label="$2"
  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi
  local pid
  for pid in $pids; do
    local candidate_pid="$pid"
    local owned=0
    while [[ -n "$candidate_pid" && "$candidate_pid" != "1" ]]; do
      local args
      args="$(ps -p "$candidate_pid" -o args= 2>/dev/null || true)"
      if [[ "$args" == *"$ROOT_DIR"* ]] && [[ "$args" == *"vite"* || "$args" == *"wrangler"* || "$args" == *"workerd"* || "$args" == *"dev_pages.sh"* || "$args" == *"insumos.sh"* ]]; then
        owned=1
        break
      fi
      candidate_pid="$(ps -p "$candidate_pid" -o ppid= 2>/dev/null | tr -d ' ' || true)"
    done
    if [[ "$owned" == "1" ]]; then
      echo "[crm-local] Encerrando $label preso na porta $port (pid: $pid)"
      terminate_pid "$pid"
    fi
  done
}

assert_port_free() {
  local port="$1"
  local label="$2"
  local line
  if crm_runtime_port_is_free "$port"; then
    return 0
  fi
  line="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -n 1 || true)"
  if [[ -n "$line" ]]; then
    echo "[crm-local] Porta $port já está em uso por outro processo ($label)." >&2
    echo "$line" >&2
  fi
  if [[ -z "$line" ]]; then
    echo "[crm-local] Porta $port já responde no loopback por um listener externo ao WSL ($label)." >&2
  fi
  echo "Use --${label}-port para outra porta ou finalize manualmente o processo atual." >&2
  exit 1
}

select_available_vite_port() {
  if crm_runtime_port_is_free "$CRM_VITE_PORT"; then
    return 0
  fi
  if [[ "$CRM_VITE_PORT_EXPLICIT" == "1" ]]; then
    assert_port_free "$CRM_VITE_PORT" "vite"
  fi

  local preferred="$CRM_VITE_PORT"
  local candidate="$preferred"
  while (( candidate < preferred + 20 )); do
    candidate=$((candidate + 1))
    if crm_runtime_port_is_free "$candidate"; then
      echo "[crm-local] Porta Vite padrão $preferred ocupada; usando $candidate." >&2
      CRM_VITE_PORT="$candidate"
      return 0
    fi
  done
  echo "[crm-local] Nenhuma porta Vite livre encontrada entre $preferred e $((preferred + 20))." >&2
  exit 1
}

wait_for_http() {
  local url="$1"
  local retries="${2:-90}"
  while [[ "$retries" -gt 0 ]]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done
  return 1
}

wait_for_crm_api() {
  local url="$1"
  local retries="${2:-90}"
  local body
  while [[ "$retries" -gt 0 ]]; do
    body="$(curl -fsS "$url" 2>/dev/null || true)"
    if [[ "$body" == *'"ok":true'* || "$body" == *'"error":"UNAUTHORIZED"'* || "$body" == *'"error": "UNAUTHORIZED"'* ]]; then
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done
  return 1
}

wait_for_timekeeping_readiness() {
  local retries="${1:-90}"
  local body
  while [[ "$retries" -gt 0 ]]; do
    body="$(curl -fsS --max-time 5 \
      -H "x-skincos-gateway-release-sha: $CRM_TIMEKEEPING_RELEASE_SHA" \
      -H 'x-skincos-gateway-environment: local' \
      "http://127.0.0.1:${CRM_TIMEKEEPING_PORT}/api/ponto/readiness" 2>/dev/null || true)"
    if [[ -n "$body" ]] && PONTO_EXPECTED_SHA="$CRM_TIMEKEEPING_RELEASE_SHA" node -e '
      const payload = JSON.parse(process.argv[1])
      if (
        payload.ok !== true
        || payload.ready !== true
        || payload.version !== process.env.PONTO_EXPECTED_SHA
        || payload.environment !== "local"
        || payload.availability?.state !== "active"
      ) process.exit(1)
    ' "$body" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done
  return 1
}

local_timekeeping_requested() {
  [[ "$CRM_WITH_TIMEKEEPING" == "1" ]] && return 0
  [[ "${PONTO_API_TARGET:-}" =~ ^http://(127\.0\.0\.1|localhost|\[::1\]):[0-9]+/?$ ]]
}

validate_local_timekeeping_configuration() {
  if ! local_timekeeping_requested; then
    return 0
  fi
  if [[ "$CRM_PROFILE" != "realistic" ]]; then
    echo "[crm-local] Ponto local direto exige profile realistic e LOCAL_AUTH_BYPASS explícito." >&2
    exit 1
  fi
  if [[ ! "$CRM_TIMEKEEPING_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[crm-local] CRM_TIMEKEEPING_RELEASE_SHA deve ser um SHA Git completo de 40 caracteres." >&2
    exit 1
  fi
  if [[ "$CRM_TIMEKEEPING_RELEASE_SHA" != "$CRM_TARGET_COMMIT" ]]; then
    echo "[crm-local] O release local do Ponto deve coincidir exatamente com CRM_TARGET_COMMIT." >&2
    exit 1
  fi
  if [[ "$CRM_SOURCE_FINGERPRINT" != "commit:$CRM_TARGET_COMMIT" ]]; then
    echo "[crm-local] Ponto local recusou snapshot ou fonte mutável; use um worktree limpo no commit-alvo." >&2
    exit 1
  fi
  local source_head
  source_head="$(crm_source_git rev-parse HEAD 2>/dev/null || true)"
  if [[ "$source_head" != "$CRM_TARGET_COMMIT" ]]; then
    echo "[crm-local] CRM_TARGET_COMMIT não corresponde ao HEAD da fonte local." >&2
    exit 1
  fi

  local validator_args=(
    "$CRM_TIMEKEEPING_ENV_FILE"
    "$PONTO_PAGES_ENV_FILE"
    "$ROOT_DIR"
  )
  if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
    validator_args+=("$CRM_INVENTORY_IDENTITY_ENV_FILE")
  fi
  node "$ROOT_DIR/scripts/validate-local-timekeeping-env.mjs" "${validator_args[@]}" >/dev/null

  if [[ -n "$(crm_source_git status --porcelain --untracked-files=all 2>/dev/null || printf source-unavailable)" ]]; then
    echo "[crm-local] Ponto local exige uma fonte limpa para preservar afinidade imutável com o SHA." >&2
    exit 1
  fi
  CRM_TIMEKEEPING_ENV_FILE="$(realpath "$CRM_TIMEKEEPING_ENV_FILE")"
  PONTO_PAGES_ENV_FILE="$(realpath "$PONTO_PAGES_ENV_FILE")"
  if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
    CRM_INVENTORY_IDENTITY_ENV_FILE="$(realpath "$CRM_INVENTORY_IDENTITY_ENV_FILE")"
  fi
  export CRM_TIMEKEEPING_ENV_FILE PONTO_PAGES_ENV_FILE CRM_INVENTORY_IDENTITY_ENV_FILE
}

reject_shared_dev_vars() {
  local shared_dev_vars
  for shared_dev_vars in "$ROOT_DIR/inventory/.dev.vars" "$FRONTEND_DIR/.dev.vars"; do
    if [[ -e "$shared_dev_vars" ]]; then
      echo "[crm-local] Arquivo .dev.vars proibido na árvore compartilhada: $shared_dev_vars" >&2
      echo "[crm-local] Use os env-files privados validados fora de C:\\CodexShared." >&2
      exit 1
    fi
  done
}

validate_local_inventory_configuration() {
  if [[ "$CRM_WITH_INSUMOS" != "1" ]] || local_timekeeping_requested; then
    return 0
  fi
  node "$ROOT_DIR/scripts/validate-local-timekeeping-env.mjs" \
    --inventory-only "$CRM_INVENTORY_IDENTITY_ENV_FILE" "$ROOT_DIR" >/dev/null
  CRM_INVENTORY_IDENTITY_ENV_FILE="$(realpath "$CRM_INVENTORY_IDENTITY_ENV_FILE")"
  export CRM_INVENTORY_IDENTITY_ENV_FILE
}

open_browser() {
  local browser_log="${CRM_BROWSER_OPEN_LOG:-${LOG_FILE}.browser.log}"
  mkdir -p "$(dirname "$browser_log")"
  if [[ -n "${CRM_BROWSER_SCRIPT:-}" && -n "${CRM_BROWSER_PROFILE_DIR:-}" ]] && command -v powershell.exe >/dev/null 2>&1; then
    local browser_script_windows
    local browser_profile_windows
    browser_script_windows="$(wslpath -w "$CRM_BROWSER_SCRIPT")"
    browser_profile_windows="$(wslpath -w "$CRM_BROWSER_PROFILE_DIR")"
    if ! powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$browser_script_windows" \
      -Url "$DEFAULT_URL" -ProfilePath "$browser_profile_windows" >>"$browser_log" 2>&1; then
      echo "[crm-local] Não foi possível abrir o navegador isolado. Consulte $browser_log." >&2
      return 1
    fi
  elif command -v open >/dev/null 2>&1; then
    if ! open "$DEFAULT_URL" >>"$browser_log" 2>&1; then
      echo "[crm-local] Não foi possível abrir o navegador. Consulte $browser_log." >&2
      return 1
    fi
  elif command -v xdg-open >/dev/null 2>&1; then
    if ! xdg-open "$DEFAULT_URL" >>"$browser_log" 2>&1; then
      echo "[crm-local] Não foi possível abrir o navegador. Consulte $browser_log." >&2
      return 1
    fi
  else
    echo "[crm-local] Nenhum abridor de navegador compatível foi encontrado." >&2
    return 1
  fi
}

ensure_frontend_ready() {
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    echo "Dependências do frontend não encontradas. Instalando a árvore travada..."
    npm --prefix "$FRONTEND_DIR" ci --no-audit --no-fund
  fi
}

ensure_frontend_dependencies() {
  local lockfile_fingerprint="$1"
  if [[ "${CRM_ISOLATED_RUNTIME:-0}" != "1" ]]; then
    npm --prefix "$FRONTEND_DIR" ci --no-audit --no-fund
    return
  fi
  if ! command -v flock >/dev/null 2>&1; then
    echo "[crm-local] flock não está disponível para preparar o cache de dependências do frontend." >&2
    return 1
  fi

  local dependency_key="${lockfile_fingerprint#sha256:}"
  if [[ ! "$dependency_key" =~ ^[a-f0-9]{64}$ ]]; then
    echo "[crm-local] Impressão inválida do lockfile do frontend." >&2
    return 1
  fi
  local cache_root="$CRM_FRONTEND_DEPENDENCY_CACHE_ROOT"
  local cache_dir="$cache_root/$dependency_key"
  local ready_file="$cache_dir/.skincos-lockfile.sha256"
  local lock_file="$cache_root/$dependency_key.lock"
  mkdir -p "$cache_root"

  if [[ -e "$FRONTEND_DIR/node_modules" || -L "$FRONTEND_DIR/node_modules" ]]; then
    if [[ -L "$FRONTEND_DIR/node_modules" &&
          "$(readlink -f "$FRONTEND_DIR/node_modules" 2>/dev/null || true)" == "$cache_dir/node_modules" &&
          -d "$cache_dir/node_modules" &&
          -f "$ready_file" &&
          "$(tr -d '\r\n' < "$ready_file")" == "$dependency_key" ]]; then
      return 0
    fi
    if [[ "$CRM_ALLOW_LEGACY_DEPENDENCY_MIGRATION" == "1" &&
          -L "$FRONTEND_DIR/node_modules" ]]; then
      local resolved_source
      local resolved_cache_root
      local existing_dependency_target
      local existing_dependency_relative
      resolved_source="$(readlink -f "$ROOT_DIR")"
      case "$resolved_source" in
        /mnt/c/CodexRuntime/operator/admin/skincos/source/crm-local-gestor-main|\
        /mnt/c/CodexRuntime/operator/admin/skincos/source/crm-local-gestor-main-*) ;;
        *)
          echo "[crm-local] Realinhamento de dependências legadas recusado fora da fonte privada do CRM completo: $resolved_source" >&2
          return 1
          ;;
      esac
      resolved_cache_root="$(readlink -f "$cache_root")"
      existing_dependency_target="$(readlink -f "$FRONTEND_DIR/node_modules" 2>/dev/null || true)"
      existing_dependency_relative="${existing_dependency_target#"$resolved_cache_root"/}"
      if [[ "$existing_dependency_target" != "$resolved_cache_root/"* ||
            ! "$existing_dependency_relative" =~ ^[a-f0-9]{64}/node_modules$ ]]; then
        echo "[crm-local] O symlink legado de node_modules não pertence ao cache privado autorizado; ele não será removido." >&2
        return 1
      fi
      rm -- "$FRONTEND_DIR/node_modules"
      echo "[crm-local] Symlink legado de node_modules removido para alinhar o novo lockfile."
    fi
    if [[ "$CRM_ALLOW_LEGACY_DEPENDENCY_MIGRATION" == "1" &&
          -d "$FRONTEND_DIR/node_modules" &&
          ! -L "$FRONTEND_DIR/node_modules" ]]; then
      local resolved_source
      local migration_root
      local migration_target
      resolved_source="$(readlink -f "$ROOT_DIR")"
      case "$resolved_source" in
        /mnt/c/CodexRuntime/operator/admin/skincos/source/crm-local-gestor-main|\
        /mnt/c/CodexRuntime/operator/admin/skincos/source/crm-local-gestor-main-*) ;;
        *)
          echo "[crm-local] Migração de dependências legadas recusada fora da fonte privada do CRM completo: $resolved_source" >&2
          return 1
          ;;
      esac
      migration_root="$CRM_RUNTIME_ROOT/state/legacy-dependencies"
      migration_target="$migration_root/node_modules.$(date +%Y%m%d-%H%M%S).$$"
      mkdir -p "$migration_root"
      if ! mv -- "$FRONTEND_DIR/node_modules" "$migration_target"; then
        echo "[crm-local] Não foi possível preservar node_modules legado em $migration_target." >&2
        return 1
      fi
      echo "[crm-local] node_modules legado preservado em $migration_target antes de vincular o cache isolado."
    fi
  fi

  if [[ -e "$FRONTEND_DIR/node_modules" || -L "$FRONTEND_DIR/node_modules" ]]; then
    echo "[crm-local] node_modules da fonte imutável não aponta para o cache esperado; ele não será substituído." >&2
    return 1
  fi

  exec 7>"$lock_file"
  flock 7
  local recorded=""
  if [[ -f "$ready_file" ]]; then
    recorded="$(tr -d '\r\n' < "$ready_file")"
  fi
  if [[ -e "$cache_dir" && ( ! -d "$cache_dir/node_modules" || "$recorded" != "$dependency_key" ) ]]; then
    echo "[crm-local] Cache de dependências incompleto em $cache_dir; ele não será substituído enquanto outro runtime pode utilizá-lo." >&2
    flock -u 7
    exec 7>&-
    return 1
  fi
  if [[ ! -d "$cache_dir/node_modules" ]]; then
    local temporary
    temporary="$(mktemp -d "$cache_root/.${dependency_key}.XXXXXX")"
    if ! cp "$FRONTEND_DIR/package.json" "$FRONTEND_DIR/package-lock.json" "$temporary/" ||
       ! npm --prefix "$temporary" ci --no-audit --no-fund; then
      rm -rf -- "$temporary"
      flock -u 7
      exec 7>&-
      return 1
    fi
    printf '%s\n' "$dependency_key" > "$temporary/.skincos-lockfile.sha256"
    mv "$temporary" "$cache_dir"
  fi
  if ! ln -s "$cache_dir/node_modules" "$FRONTEND_DIR/node_modules" 2>/dev/null; then
    if [[ ! -L "$FRONTEND_DIR/node_modules" ||
          "$(readlink -f "$FRONTEND_DIR/node_modules" 2>/dev/null || true)" != "$cache_dir/node_modules" ]]; then
      echo "[crm-local] Outra execução publicou um node_modules incompatível na fonte imutável." >&2
      flock -u 7
      exec 7>&-
      return 1
    fi
  fi
  flock -u 7
  exec 7>&-
}

inspect_frontend_build() {
  node "$BUILD_STATE_HELPER" inspect --root "$ROOT_DIR" --state "$CRM_BUILD_STATE_FILE"
}

build_descriptor_field() {
  local descriptor="$1"
  local field="$2"
  printf '%s' "$descriptor" | node -e '
const fs = require("fs")
const value = JSON.parse(fs.readFileSync(0, "utf8"))[process.argv[1]]
if (value !== null && value !== undefined) process.stdout.write(String(value))
' "$field"
}

recorded_build_lockfile_fingerprint() {
  node - "$CRM_BUILD_STATE_FILE" <<'NODE'
const fs = require('fs')
try {
  const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  if (typeof value.lockfileFingerprint === 'string') process.stdout.write(value.lockfileFingerprint)
} catch {}
NODE
}

acquire_frontend_build_lock() {
  local attempt=0
  local result=""
  local status=0
  while (( attempt < 600 )); do
    status=0
    result="$(node "$BUILD_STATE_HELPER" lock-acquire --lock-dir "$CRM_BUILD_LOCK_DIR" --owner-pid "$$" --json 2>/dev/null)" || status=$?
    if [[ "$status" == "0" ]]; then
      CRM_BUILD_LOCK_TOKEN="$(printf '%s' "$result" | node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(0,"utf8")).owner.token)')"
      export CRM_BUILD_LOCK_TOKEN
      return 0
    fi
    if [[ "$status" != "73" ]]; then
      echo "[crm-local] Falha ao adquirir o lock global de build." >&2
      return "$status"
    fi
    if (( attempt == 0 )); then
      echo "[crm-local] Outro runtime está preparando o mesmo build; aguardando sem iniciar um build concorrente..."
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  echo "[crm-local] Tempo limite ao aguardar o lock global de build." >&2
  return 1
}

release_frontend_build_lock() {
  if [[ -z "${CRM_BUILD_LOCK_TOKEN:-}" ]]; then
    return 0
  fi
  node "$BUILD_STATE_HELPER" lock-release --lock-dir "$CRM_BUILD_LOCK_DIR" --token "$CRM_BUILD_LOCK_TOKEN" --json >/dev/null
  CRM_BUILD_LOCK_TOKEN=""
}

refresh_frontend_build_fingerprints() {
  local descriptor
  descriptor="$(inspect_frontend_build)"
  CRM_BUILD_INPUT_FINGERPRINT="$(build_descriptor_field "$descriptor" inputFingerprint)"
  CRM_BUILD_LOCKFILE_FINGERPRINT="$(build_descriptor_field "$descriptor" lockfileFingerprint)"
  CRM_BUILD_ARTIFACT_FINGERPRINT="$(build_descriptor_field "$descriptor" artifactFingerprint)"
  CRM_BUILD_COMMIT="$CRM_TARGET_COMMIT"
  export CRM_BUILD_INPUT_FINGERPRINT CRM_BUILD_LOCKFILE_FINGERPRINT
  export CRM_BUILD_ARTIFACT_FINGERPRINT CRM_BUILD_COMMIT
}

prepare_frontend_artifact_locked() {
  local descriptor
  local state_valid
  local current_lockfile
  local recorded_lockfile
  descriptor="$(inspect_frontend_build)"
  state_valid="$(build_descriptor_field "$descriptor" stateValid)"
  current_lockfile="$(build_descriptor_field "$descriptor" lockfileFingerprint)"
  recorded_lockfile="$(recorded_build_lockfile_fingerprint)"

  if [[ ! -d "$FRONTEND_DIR/node_modules" || "$recorded_lockfile" != "$current_lockfile" ]]; then
    echo "[crm-local] Alinhando dependências do frontend ao lockfile atual..."
    if ! ensure_frontend_dependencies "$current_lockfile"; then
      return 1
    fi
  fi

  if [[ "$CRM_BUILD_BEFORE_START" == "auto" && "$state_valid" == "true" ]]; then
    echo "[crm-local] Build reutilizado: insumos e artefato permanecem idênticos."
    refresh_frontend_build_fingerprints
    return 0
  fi

  if [[ "$CRM_BUILD_BEFORE_START" == "0" ]]; then
    ensure_frontend_dist_ready
    refresh_frontend_build_fingerprints
    return 0
  fi

  echo "[crm-local] Gerando build do frontend para os insumos atuais..."
  if ! npm --prefix "$FRONTEND_DIR" run build; then
    return 1
  fi
  if ! node "$BUILD_STATE_HELPER" state-write \
    --state-file "$CRM_BUILD_STATE_FILE" \
    --console-dir "$FRONTEND_DIR" \
    --json >/dev/null; then
    return 1
  fi
  refresh_frontend_build_fingerprints || return 1
}

prepare_frontend_artifact() {
  if [[ ! -x "$BUILD_STATE_HELPER" && ! -f "$BUILD_STATE_HELPER" ]]; then
    echo "[crm-local] Helper determinístico de build ausente: $BUILD_STATE_HELPER" >&2
    return 1
  fi
  acquire_frontend_build_lock
  local status=0
  set +e
  prepare_frontend_artifact_locked
  status=$?
  set -e
  release_frontend_build_lock || {
    echo "[crm-local] Não foi possível liberar o lock global de build com segurança." >&2
    return 1
  }
  return "$status"
}

ensure_playwright_chromium() {
  if [[ "$CRM_GATE_STRICT" != "1" && "$CRM_SMOKE" != "1" ]]; then
    return 0
  fi

  echo "[crm-local] Garantindo o Chromium do Playwright para o gate local..."
  (
    cd "$FRONTEND_DIR"
    PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" npm exec playwright install chromium
  )
}

ensure_timekeeping_ready() {
  if [[ ! -d "$TIMEKEEPING_DIR" ]]; then
    echo "[crm-local] O domínio Workforce/Timekeeping não foi encontrado em $TIMEKEEPING_DIR." >&2
    exit 1
  fi
  if [[ ! -f "$TIMEKEEPING_DIR/package-lock.json" ]]; then
    echo "[crm-local] O lockfile do Timekeeping não foi encontrado." >&2
    exit 1
  fi
  if ! command -v flock >/dev/null 2>&1; then
    echo "[crm-local] flock não está disponível para serializar as dependências do Timekeeping." >&2
    exit 1
  fi

  mkdir -p "$CRM_DEPENDENCY_STATE_ROOT"
  local lock_file="$CRM_DEPENDENCY_STATE_ROOT/timekeeping.lock"
  local state_file="$CRM_DEPENDENCY_STATE_ROOT/timekeeping-package-lock.sha256"
  local current_hash
  local recorded_hash=""
  current_hash="$(sha256sum "$TIMEKEEPING_DIR/package-lock.json" | awk '{print $1}')"
  exec 8>"$lock_file"
  flock 8
  if [[ -f "$state_file" ]]; then
    recorded_hash="$(tr -d '\r\n' < "$state_file")"
  fi
  if [[ ! -d "$TIMEKEEPING_DIR/node_modules/wrangler" || "$current_hash" != "$recorded_hash" ]]; then
    echo "[crm-local] Alinhando dependências locais do Timekeeping ao lockfile..."
    npm --prefix "$TIMEKEEPING_DIR" ci --no-audit --no-fund
    local state_tmp="${state_file}.tmp.$$"
    printf '%s\n' "$current_hash" > "$state_tmp"
    mv -f "$state_tmp" "$state_file"
  fi
  flock -u 8
  exec 8>&-
}

start_timekeeping_local() {
  ensure_timekeeping_ready
  mkdir -p "$CRM_TIMEKEEPING_PERSIST_DIR"
  echo "[crm-local] Aplicando migrations locais do Timekeeping..."
  (
    cd "$TIMEKEEPING_DIR"
    ./node_modules/.bin/wrangler d1 migrations apply skincos-timekeeping --local --config=wrangler.toml \
      --persist-to "$CRM_TIMEKEEPING_PERSIST_DIR"
  ) >>"$LOG_FILE" 2>&1

  local control_payload emergency_latch_payload
  control_payload="$(PONTO_RELEASE_SHA="$CRM_TIMEKEEPING_RELEASE_SHA" node -e '
    process.stdout.write(JSON.stringify({
      schemaVersion: 2,
      state: "active",
      message: "Controle local explícito",
      changedAt: new Date().toISOString(),
      changedBy: "crm-local-launcher",
      rolloutStage: "local",
      releaseSha: process.env.PONTO_RELEASE_SHA,
    }))
  ')"
  emergency_latch_payload="$(node -e '
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      module: "timekeeping",
      target: "local",
      latched: false,
      changedAt: new Date().toISOString(),
      changedBy: "crm-local-launcher",
      syntheticLocalOnly: true,
    }))
  ')"
  echo "[crm-local] Gravando controle e overlay explícitos apenas no KV local privado..."
  (
    cd "$TIMEKEEPING_DIR"
    ./node_modules/.bin/wrangler kv key put "module-control:timekeeping:emergency-latch" "$emergency_latch_payload" \
      --binding MODULE_CONTROL --local --persist-to "$CRM_TIMEKEEPING_PERSIST_DIR" \
      --config=wrangler.toml
    ./node_modules/.bin/wrangler kv key put "module-control:timekeeping" "$control_payload" \
      --binding MODULE_CONTROL --local --persist-to "$CRM_TIMEKEEPING_PERSIST_DIR" \
      --config=wrangler.toml
  ) >>"$LOG_FILE" 2>&1

  echo "[crm-local] Iniciando Workforce/Timekeeping local em :$CRM_TIMEKEEPING_PORT"
  (
    cd "$TIMEKEEPING_DIR"
    ./node_modules/.bin/wrangler dev --local --port "$CRM_TIMEKEEPING_PORT" --config=wrangler.toml \
      --persist-to "$CRM_TIMEKEEPING_PERSIST_DIR" \
      --env-file "$CRM_TIMEKEEPING_ENV_FILE" \
      --var "APP_VERSION:$CRM_TIMEKEEPING_RELEASE_SHA" \
      --var "ENVIRONMENT:local"
  ) >>"$LOG_FILE" 2>&1 &
  TIMEKEEPING_PID=$!

  if ! wait_for_timekeeping_readiness 90; then
    echo "[crm-local] Workforce/Timekeeping não respondeu em tempo hábil." >&2
    exit 1
  fi
}

ensure_frontend_dist_ready() {
  if [[ -f "$FRONTEND_DIR/dist/index.html" ]]; then
    return 0
  fi
  echo "[crm-local] Build local do frontend ausente; gerando dist inicial para o Pages local..."
  npm --prefix "$FRONTEND_DIR" run build
}

refresh_insumos_snapshot_if_needed() {
  if [[ "$CRM_REFRESH_INSUMOS_SNAPSHOT" != "1" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$SNAPSHOT_DEFAULT_PATH")"
  local out_path="${CRM_INSUMOS_SNAPSHOT:-$SNAPSHOT_DEFAULT_PATH}"
  echo "[crm-local] Exportando snapshot remoto de Insumos para $out_path"
  node "$INSUMOS_EXPORTER" "$out_path"
  CRM_INSUMOS_SNAPSHOT="$out_path"
}

ensure_insumos_local_schema() {
  mkdir -p "$CRM_INSUMOS_PERSIST_DIR"
  echo "[crm-local] Aplicando migrations locais do Insumos..."
  (
    cd "$ROOT_DIR"
    ./backend/scripts/insumos.sh migrate --local --persist-to "$CRM_INSUMOS_PERSIST_DIR"
  ) >>"$LOG_FILE" 2>&1
}

start_insumos_local() {
  ensure_insumos_local_schema
  echo "[crm-local] Iniciando Worker local do Insumos em :$CRM_INSUMOS_PORT"
  # The local Worker reads this flag at process start. Export it before
  # spawning Wrangler so the Pages local-auth proxy and Insumos agree on the
  # scoped Gestor test identity.
  local auth_bypass="${ALLOW_DEV_AUTH_BYPASS:-}"
  if [[ "$CRM_PROFILE" == "realistic" ]]; then
    auth_bypass=true
  fi
  local insumos_args=(
    --log-level "$CRM_LOCAL_LOG_LEVEL"
    --show-interactive-dev-session false
    --test-scheduled
    --persist-to "$CRM_INSUMOS_PERSIST_DIR"
    --env-file "$CRM_INVENTORY_IDENTITY_ENV_FILE"
    --var "ALLOW_DEV_SEED:true"
    --var "ALLOW_DEV_AUTH_BYPASS:$auth_bypass"
  )
  if local_timekeeping_requested; then
    insumos_args+=(
      --var "APP_VERSION:$CRM_TIMEKEEPING_RELEASE_SHA"
      --var "ENVIRONMENT:local"
      --var "LOCAL_IDENTITY_VERSION_ID:$CRM_LOCAL_IDENTITY_VERSION_ID"
    )
  fi
  (
    cd "$ROOT_DIR"
    ALLOW_DEV_AUTH_BYPASS="$auth_bypass" ./backend/scripts/insumos.sh dev \
      --ip "$CRM_BIND_HOST" \
      --port "$CRM_INSUMOS_PORT" \
      "${insumos_args[@]}"
  ) >>"$LOG_FILE" 2>&1 &
  INSUMOS_PID=$!

  if ! wait_for_http "http://127.0.0.1:${CRM_INSUMOS_PORT}/insumos/health" 90; then
    echo "[crm-local] Worker local do Insumos não respondeu em tempo hábil." >&2
    exit 1
  fi

  if [[ -n "$CRM_INSUMOS_SNAPSHOT" ]]; then
    if [[ ! -f "$CRM_INSUMOS_SNAPSHOT" ]]; then
      echo "[crm-local] Snapshot do Insumos não encontrado: $CRM_INSUMOS_SNAPSHOT" >&2
      exit 1
    fi
    echo "[crm-local] Aplicando seed de Insumos com $CRM_INSUMOS_SNAPSHOT"
    local seed_token
    seed_token="$(sed -nE 's/^[[:space:]]*INSUMOS_SEED_TOKEN[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$/\1/p' "$CRM_INVENTORY_IDENTITY_ENV_FILE" | head -n 1)"
    if [[ "$seed_token" == \"*\" && "$seed_token" == *\" ]]; then
      seed_token="${seed_token:1:${#seed_token}-2}"
    elif [[ "$seed_token" == \'*\' && "$seed_token" == *\' ]]; then
      seed_token="${seed_token:1:${#seed_token}-2}"
    fi
    if [[ -z "$seed_token" ]]; then
      echo "[crm-local] INSUMOS_SEED_TOKEN ausente no env-file privado validado." >&2
      exit 1
    fi
    INSUMOS_SEED_TOKEN="$seed_token" \
      INSUMOS_API_URL="http://127.0.0.1:${CRM_INSUMOS_PORT}/insumos" \
      "$INSUMOS_SEEDER" "$CRM_INSUMOS_SNAPSHOT" >>"$LOG_FILE" 2>&1
  fi
}

start_whatsapp_orchestrator_local() {
  if [[ ! -x "$WHATSAPP_ORCHESTRATOR_HELPER" ]]; then
    echo "[crm-local] Adaptador WhatsApp local não está executável: $WHATSAPP_ORCHESTRATOR_HELPER" >&2
    exit 1
  fi
  echo "[crm-local] Iniciando adaptador local do WhatsApp em :$CRM_WA_ORCHESTRATOR_PORT"
  (
    CRM_LOCAL_WA_ORCHESTRATOR_PORT="$CRM_WA_ORCHESTRATOR_PORT" \
      LOCAL_AUTH_EMAIL="${LOCAL_AUTH_EMAIL:-dev@local.test}" \
      LOCAL_AUTH_ROLE="${LOCAL_AUTH_ROLE:-GESTOR}" \
      "$WHATSAPP_ORCHESTRATOR_HELPER"
  ) >>"$LOG_FILE" 2>&1 &
  WHATSAPP_ORCHESTRATOR_PID=$!

  if ! wait_for_http "http://127.0.0.1:${CRM_WA_ORCHESTRATOR_PORT}/health" 60; then
    echo "[crm-local] Adaptador local do WhatsApp não respondeu em tempo hábil." >&2
    exit 1
  fi
}

warm_atendimento_api() {
  # The adapter reports /health before its first PostgreSQL connection has
  # necessarily completed.  Pages then opens the Atendimento screen with a
  # small burst of requests, and the per-request proxy timeout could turn that
  # first connection into intermittent 500s.  Prime every route exercised by
  # the local gate before exposing the Pages shell.
  local actor_header='x-crm-user: eyJpZCI6ImNybS1sb2NhbC1nYXRlIiwicm9sZSI6IkdFU1RPUiJ9'
  local endpoint
  local attempt
  local status
  local endpoints=(
    '/api/atendimento/local-mirror/status'
    '/api/atendimento/management/catalog'
    '/api/atendimento/doctor-suggestion?unit=novo-hamburgo&date=2026-07-28'
    '/api/atendimento/attendances?from=2026-07-01&to=2026-07-28&limit=50'
    '/api/atendimento/management/finance'
  )

  echo '[crm-local] Aquecendo as rotas locais de Atendimento...'
  for endpoint in "${endpoints[@]}"; do
    attempt=0
    status='000'
    while [[ "$attempt" -lt 12 ]]; do
      status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 -H "$actor_header" \
        "http://127.0.0.1:${CRM_WA_ORCHESTRATOR_PORT}${endpoint}" || true)"
      if [[ "$status" == '200' ]]; then
        break
      fi
      attempt=$((attempt + 1))
      sleep 1
    done
    if [[ "$status" != '200' ]]; then
      echo "[crm-local] A rota local de Atendimento não ficou pronta (${endpoint}; HTTP ${status})." >&2
      exit 1
    fi
  done
}

verify_atendimento_proxy() {
  # Authentication is established at the local Pages boundary.  A direct
  # adapter request without the actor header must remain unauthorized; this
  # check proves the supported proxy path forwards the local identity and does
  # not surface an intermittent 401 or 503 after the adapter warm-up.
  local endpoint
  local attempt
  local status
  local endpoints=(
    '/api/atendimento/local-mirror/status'
    '/api/atendimento/management/finance'
  )

  echo '[crm-local] Verificando proxy autenticado de Atendimento...'
  for endpoint in "${endpoints[@]}"; do
    attempt=0
    status='000'
    while [[ "$attempt" -lt 12 ]]; do
      status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 \
        "http://127.0.0.1:${CRM_PAGES_PORT}${endpoint}" || true)"
      if [[ "$status" == '200' ]]; then
        break
      fi
      attempt=$((attempt + 1))
      sleep 1
    done
    if [[ "$status" != '200' ]]; then
      echo "[crm-local] O proxy autenticado de Atendimento não ficou pronto (${endpoint}; HTTP ${status})." >&2
      exit 1
    fi
  done
}

if [[ "$STOP_ONLY" == "1" ]]; then
  crm_persona_runtime_stop_manifest_owner
  stop_lock_status=0
  crm_persona_runtime_acquire_lock || stop_lock_status=$?
  if [[ "$stop_lock_status" == "2" || "$stop_lock_status" == "3" || "$stop_lock_status" == "4" ]]; then
    echo "[crm-local] Outro launcher tornou-se owner de $CRM_RUNTIME_ID durante a parada; seu manifesto não será sobrescrito."
    exit 0
  fi
  if [[ "$stop_lock_status" != "0" ]]; then
    echo "[crm-local] Não foi possível serializar a parada de $CRM_RUNTIME_ID." >&2
    exit "$stop_lock_status"
  fi
  crm_persona_runtime_write_manifest stopped
  crm_persona_runtime_release_lock
  echo "CRM local finalizado."
  exit 0
fi

if [[ "$CRM_PROFILE" != "realistic" && "$CRM_PROFILE" != "session" ]]; then
  echo "Perfil inválido: $CRM_PROFILE" >&2
  usage
  exit 1
fi

case "$CRM_LOCAL_LOG_LEVEL" in
  warn|info|debug|error|none) ;;
  *)
    echo "CRM_LOCAL_LOG_LEVEL inválido: $CRM_LOCAL_LOG_LEVEL" >&2
    echo "Use warn, info, debug, error ou none." >&2
    exit 1
    ;;
esac

case "$CRM_BUILD_BEFORE_START" in
  0|1|auto) ;;
  *)
    echo "CRM_BUILD_BEFORE_START inválido: $CRM_BUILD_BEFORE_START (use 0, 1 ou auto)." >&2
    exit 1
    ;;
esac

case "$CRM_ALLOW_LEGACY_DEPENDENCY_MIGRATION" in
  0|1) ;;
  *)
    echo "CRM_ALLOW_LEGACY_DEPENDENCY_MIGRATION inválido: $CRM_ALLOW_LEGACY_DEPENDENCY_MIGRATION (use 0 ou 1)." >&2
    exit 1
    ;;
esac

if ! command -v npm >/dev/null 2>&1; then
  echo "npm não encontrado no PATH." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl não encontrado no PATH." >&2
  exit 1
fi

reject_shared_dev_vars
validate_local_timekeeping_configuration
validate_local_inventory_configuration

mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"
runtime_lock_status=0
crm_persona_runtime_acquire_lock || runtime_lock_status=$?
if [[ "$runtime_lock_status" == "2" ]]; then
  echo "[crm-local] Aguardando o gate completo do runtime existente de $CRM_PERSONA..."
  if crm_persona_runtime_wait_ready 360 &&
     wait_for_crm_api "http://127.0.0.1:${CRM_PAGES_PORT}/api/auth/me" 10 &&
     wait_for_http "$DEFAULT_URL" 10; then
    if [[ "$CRM_OPEN_BROWSER" == "1" ]]; then
      open_browser
    fi
    echo "[crm-local] Runtime existente de $CRM_PERSONA reutilizado após manifesto ready e gate verde em $DEFAULT_URL."
    exit 0
  fi
  echo "[crm-local] O runtime existente de $CRM_PERSONA não publicou manifesto ready exato dentro do tempo esperado." >&2
  exit 1
fi
if [[ "$runtime_lock_status" != "0" ]]; then
  echo "[crm-local] Não foi possível adquirir o lock de $CRM_PERSONA." >&2
  exit "$runtime_lock_status"
fi
bootstrap_cleanup() {
  # Dependencies start before the long-lived Pages supervisor is registered.
  # If any readiness check fails in that window, terminate every child already
  # acquired by this launcher so a retry cannot inherit an orphaned listener.
  local child_pid
  for child_pid in \
    "${CRM_PID:-}" \
    "${INSUMOS_PID:-}" \
    "${TIMEKEEPING_PID:-}" \
    "${WHATSAPP_ORCHESTRATOR_PID:-}"; do
    if [[ -n "$child_pid" ]]; then
      terminate_pid "$child_pid"
    fi
  done
  crm_persona_runtime_write_manifest failed 2>/dev/null || true
  crm_persona_runtime_release_lock
}
trap bootstrap_cleanup EXIT

GATE_REPORT_FILE="${CRM_GATE_REPORT_FILE:-$(dirname "$LOG_FILE")/crm-local-gate-$(report_timestamp).json}"
GATE_ARTIFACT_DIR="${CRM_SMOKE_ARTIFACT_DIR:-$(dirname "$LOG_FILE")/crm-local-smoke-artifacts}"
BROWSER_DIAGNOSTICS_LOG="${CRM_BROWSER_DIAGNOSTICS_LOG:-$(dirname "$LOG_FILE")/crm-local-browser-diagnostics-$(report_timestamp).log}"
mkdir -p "$GATE_ARTIFACT_DIR"

refresh_insumos_snapshot_if_needed

echo ""
echo "SKINCOS • Testar CRM local"
echo "Perfil: $CRM_PROFILE"
echo "Rota inicial: $CRM_ROUTE"
if [[ -n "$CRM_MODULE" ]]; then
  echo "Módulo inicial: $CRM_MODULE"
fi
if [[ -n "$CRM_META_ADS_SCENARIO" ]]; then
  echo "Cenário local de tracking: $CRM_META_ADS_SCENARIO"
fi
echo "URLs:"
echo "  Local  : $DEFAULT_URL"
echo "  Rede   : $NETWORK_URL"
if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
  echo "Insumos local: http://127.0.0.1:${CRM_INSUMOS_PORT}/insumos"
  if [[ -n "$CRM_INSUMOS_SNAPSHOT" ]]; then
    echo "Snapshot Insumos: $CRM_INSUMOS_SNAPSHOT"
  fi
fi
if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then
  echo "WhatsApp local: http://127.0.0.1:${CRM_WA_ORCHESTRATOR_PORT}"
fi
echo "Log: $LOG_FILE"
echo ""

stop_existing
rotate_current_log
select_available_vite_port
crm_persona_runtime_write_manifest starting
assert_port_free "$CRM_VITE_PORT" "vite"
assert_port_free "$CRM_PAGES_PORT" "pages"
if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then
  assert_port_free "$CRM_WA_ORCHESTRATOR_PORT" "whatsapp"
fi
prepare_frontend_artifact
ensure_playwright_chromium

INSUMOS_PID=""
WHATSAPP_ORCHESTRATOR_PID=""
if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
  assert_port_free "$CRM_INSUMOS_PORT" "insumos"
  start_insumos_local
fi

TIMEKEEPING_PID=""
if [[ "$CRM_WITH_TIMEKEEPING" == "1" ]]; then
  assert_port_free "$CRM_TIMEKEEPING_PORT" "workforce-timekeeping"
  start_timekeeping_local
fi

export VITE_PORT="$CRM_VITE_PORT"
export PAGES_PORT="$CRM_PAGES_PORT"

if [[ "$CRM_PROFILE" == "realistic" ]]; then
  export LOCAL_AUTH_BYPASS=true
  export LOCAL_AUTH_ROLE="${LOCAL_AUTH_ROLE:-GESTOR}"
  export LOCAL_AUTH_TEST_USER_ADMIN="${LOCAL_AUTH_TEST_USER_ADMIN:-true}"
  export LOCAL_AUTH_EMAIL="${LOCAL_AUTH_EMAIL:-dev@local.test}"
  export LOCAL_AUTH_NAME="${LOCAL_AUTH_NAME:-Teste CRM Local}"
  export LOCAL_AUTH_ALLOWED_HOSTS="${LOCAL_AUTH_ALLOWED_HOSTS:-}"
  if local_timekeeping_requested; then
    if [[ "$CRM_WITH_TIMEKEEPING" == "1" ]]; then
      export PONTO_API_TARGET="http://127.0.0.1:${CRM_TIMEKEEPING_PORT}"
    fi
    export SKINCOS_DEPLOYMENT_ENV=local
    export PONTO_RELEASE_SHA="$CRM_TIMEKEEPING_RELEASE_SHA"
    export PONTO_ROLLOUT_STAGE=local
    export PONTO_ALLOW_LOCAL_DIRECT_TIMEKEEPING=true
  fi
  if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
    export ALLOW_DEV_AUTH_BYPASS=true
  fi
else
  export LOCAL_AUTH_BYPASS=false
fi

if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then
  start_whatsapp_orchestrator_local
  warm_atendimento_api
  export LOCAL_WA_ORCHESTRATOR_API_TARGET="http://127.0.0.1:${CRM_WA_ORCHESTRATOR_PORT}"
fi

if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
  export LOCAL_INSUMOS_API_TARGET="http://127.0.0.1:${CRM_INSUMOS_PORT}"
fi

if [[ -n "$CRM_MODULE" ]]; then
  export LOCAL_CRM_FOCUS_MODULE="$CRM_MODULE"
fi

(
  cd "$FRONTEND_DIR"
  npm run dev:pages
) >>"$LOG_FILE" 2>&1 &
CRM_PID=$!

echo "$$" > "$PID_FILE"
crm_runtime_pid_start_ticks "$$" > "${PID_FILE}.start-ticks"
printf '%s\n' "$CRM_RUNTIME_ID" > "${PID_FILE}.runtime-id"
crm_persona_runtime_write_manifest starting

cleanup() {
  if [[ -n "${CRM_PID:-}" ]]; then
    terminate_pid "$CRM_PID"
  fi
  if [[ -n "${INSUMOS_PID:-}" ]]; then
    terminate_pid "$INSUMOS_PID"
  fi
  if [[ -n "${TIMEKEEPING_PID:-}" ]]; then
    terminate_pid "$TIMEKEEPING_PID"
  fi
  if [[ -n "${WHATSAPP_ORCHESTRATOR_PID:-}" ]]; then
    terminate_pid "$WHATSAPP_ORCHESTRATOR_PID"
  fi
  if [[ -f "$PID_FILE" ]]; then
    local tracked_pid
    tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ "$tracked_pid" == "$$" ]]; then
      rm -f "$PID_FILE"
      rm -f "${PID_FILE}.start-ticks" "${PID_FILE}.runtime-id"
    fi
  fi
  crm_persona_runtime_write_manifest stopped 2>/dev/null || true
  crm_persona_runtime_release_lock
}

trap cleanup EXIT INT TERM

if ! wait_for_crm_api "http://127.0.0.1:${CRM_PAGES_PORT}/api/auth/me" 120; then
  echo "[crm-local] O CRM não respondeu para o preflight em tempo hábil." >&2
  exit 1
fi

if ! wait_for_http "$DEFAULT_URL" 60; then
  echo "[crm-local] O shell do CRM não respondeu em $DEFAULT_URL dentro do tempo esperado." >&2
  exit 1
fi

if [[ "$CRM_MODULE" == 'atendimento' && "$CRM_WITH_WHATSAPP" == '1' ]]; then
  verify_atendimento_proxy
fi

run_gate_smoke() {
  echo "[crm-local] Rodando gate obrigatório do shell local..."
  run_browser_smoke env \
    PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" \
    CRM_URL="$DEFAULT_URL" \
    CRM_SMOKE_MODULES="${CRM_GATE_MODULES:-}" \
    HEADED=0 \
    TIMEOUT_MS="${CRM_GATE_TIMEOUT_MS:-120000}" \
    CRM_SMOKE_REPORT_FILE="$GATE_REPORT_FILE" \
    SMOKE_ARTIFACT_DIR="$GATE_ARTIFACT_DIR" \
    npm run smoke:crm-shell:local
}

is_known_browser_diagnostic() {
  local line="$1"
  case "$line" in
    *"/org/freedesktop/UPower/devices/DisplayDevice"*"org.freedesktop.DBus.Error.ServiceUnknown"*|\
    *"ContextResult::kTransientFailure: Failed to send GpuControl.CreateCommandBuffer."*|\
    *"Created TensorFlow Lite XNNPACK delegate for CPU."*|\
    *"Registration response error message: DEPRECATED_ENDPOINT"*)
      return 0
      ;;
  esac
  return 1
}

filter_browser_smoke_stderr() {
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if is_known_browser_diagnostic "$line"; then
      printf '%s\n' "$line" >> "$BROWSER_DIAGNOSTICS_LOG"
    else
      printf '%s\n' "$line" >&2
    fi
  done
}

run_browser_smoke() {
  : > "$BROWSER_DIAGNOSTICS_LOG"

  local stderr_file
  if ! stderr_file="$(mktemp "${BROWSER_DIAGNOSTICS_LOG}.tmp.XXXXXX")"; then
    echo "[crm-local] Não foi possível preparar o diagnóstico do Chromium." >&2
    return 1
  fi

  local status=0
  (
    cd "$FRONTEND_DIR"
    "$@"
  ) 2> "$stderr_file" || status=$?

  local filter_status=0
  filter_browser_smoke_stderr < "$stderr_file" || filter_status=$?
  rm -f "$stderr_file"

  if [[ "$filter_status" != "0" ]]; then
    echo "[crm-local] O filtro de diagnósticos do Chromium falhou." >&2
    return "$filter_status"
  fi

  if [[ -s "$BROWSER_DIAGNOSTICS_LOG" ]]; then
    local diagnostic_count
    diagnostic_count="$(wc -l < "$BROWSER_DIAGNOSTICS_LOG" | tr -d '[:space:]')"
    echo "[crm-local] ${diagnostic_count} diagnóstico(s) conhecido(s) do Chromium arquivado(s) em $BROWSER_DIAGNOSTICS_LOG"
  fi

  return "$status"
}

print_gate_failure_summary() {
  local report_file="$1"
  if [[ ! -f "$report_file" ]]; then
    echo "[crm-local] Gate falhou, mas o relatório não foi gerado." >&2
    return 0
  fi
  node - "$report_file" <<'NODE'
const fs = require('fs')
const reportPath = process.argv[2]
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
if (report.bootstrapError) {
  console.error(`[crm-local] Gate falhou antes da varredura: ${report.bootstrapError}`)
} else {
  console.error(`[crm-local] Gate falhou: ${report.failingModules}/${report.totalModules} módulos com erro estrutural.`)
  for (const item of (report.modules || []).filter((entry) => !entry.ok)) {
    const firstApi = Array.isArray(item.apiErrors) && item.apiErrors[0]
    const firstConsole = Array.isArray(item.consoleErrors) && item.consoleErrors[0]
    const firstPage = Array.isArray(item.pageErrors) && item.pageErrors[0]
    const firstStorm = Array.isArray(item.requestStorms) && item.requestStorms[0]
    const detail = firstApi
      ? `${firstApi.status} ${firstApi.url}`
      : (firstConsole || firstPage || (firstStorm ? `${firstStorm.count}x ${firstStorm.endpoint}` : 'erro estrutural'))
    console.error(`  - ${item.label} (${item.key}): ${detail}`)
    console.error(`    diagnostico: ${item.diagnosis}`)
    console.error(`    acao: ${item.recommendation}`)
  }
}
console.error(`[crm-local] Relatório: ${reportPath}`)
NODE
}

if [[ "$CRM_GATE_STRICT" == "1" ]]; then
  if ! run_gate_smoke; then
    print_gate_failure_summary "$GATE_REPORT_FILE"
    exit 1
  fi
fi

if [[ "$CRM_SMOKE" == "1" ]]; then
  if [[ "$CRM_MODULE" == "meta-ads" ]]; then
    echo "[crm-local] Rodando smoke local do Meta Ads..."
    run_browser_smoke env PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" CRM_URL="$DEFAULT_URL" META_ADS_LOCAL_SCENARIO="${CRM_META_ADS_SCENARIO:-connected-ready}" HEADED="$CRM_SMOKE_HEADED" npm run smoke:meta-ads:local
  elif [[ "$CRM_MODULE" == "site-tracking" ]]; then
    echo "[crm-local] Rodando smoke local do Site EF..."
    run_browser_smoke env PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" CRM_URL="$DEFAULT_URL" META_ADS_LOCAL_SCENARIO="${CRM_META_ADS_SCENARIO:-connected-ready}" HEADED="$CRM_SMOKE_HEADED" npm run smoke:site-tracking:local
  else
    echo "[crm-local] Rodando smoke local padrão..."
    run_browser_smoke env PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" CRM_URL="$DEFAULT_URL" HEADED="$CRM_SMOKE_HEADED" node ./scripts/crm-local-smoke.cjs
  fi

  if [[ "$CRM_EXIT_AFTER_SMOKE" == "1" ]]; then
    echo "[crm-local] Smoke concluída; encerrando CRM local."
    exit 0
  fi
fi

if [[ "$CRM_OPEN_BROWSER" == "1" ]]; then
  open_browser
fi

crm_persona_runtime_write_manifest ready

echo "Notas:"
  echo "  - O shell do CRM local usa Pages Functions reais."
if [[ "$CRM_GATE_STRICT" == "1" ]]; then
  echo "  - Gate rígido do shell local validado com relatório em $GATE_REPORT_FILE."
fi
if [[ "$CRM_PROFILE" == "realistic" ]]; then
  echo "  - Auth local bypass está ligado apenas para localhost."
else
  echo "  - Auth local bypass está desligado; faça login manual no localhost."
fi
if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
  echo "  - Insumos está apontando para o worker local, sem risco de gravar na produção."
else
  echo "  - Insumos continua usando o target não sensível definido no runtime ou em crm/console/wrangler.toml."
fi
if [[ -n "$CRM_META_ADS_SCENARIO" && "$CRM_META_ADS_SCENARIO" != "live" ]]; then
  echo "  - Meta Ads/tracking está em cenário local controlado; o fluxo é simulado só em localhost."
fi
echo ""

wait "$CRM_PID"
