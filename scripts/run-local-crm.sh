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

CRM_HOST="${CRM_HOST:-127.0.0.1}"
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
# Local-only values. Production uses separate Pages and Worker secrets.
CRM_TIMEKEEPING_ACTOR_KEY="${CRM_TIMEKEEPING_ACTOR_KEY:-test-actor-key-not-secret}"
CRM_TIMEKEEPING_IDEMPOTENCY_KEY="${CRM_TIMEKEEPING_IDEMPOTENCY_KEY:-test-idempotency-key-not-secret}"
CRM_TIMEKEEPING_TEMPLATES_KEY="${CRM_TIMEKEEPING_TEMPLATES_KEY:-test-template-key-not-secret}"
CRM_INSUMOS_SNAPSHOT="${CRM_INSUMOS_SNAPSHOT:-}"
CRM_REFRESH_INSUMOS_SNAPSHOT="${CRM_REFRESH_INSUMOS_SNAPSHOT:-0}"
CRM_INSUMOS_SEED_TOKEN="${CRM_INSUMOS_SEED_TOKEN:-dev-seed-token}"
CRM_LOCAL_LOG_LEVEL="${CRM_LOCAL_LOG_LEVEL:-warn}"
PID_FILE="${CRM_PID_FILE:-$ROOT_DIR/.crm-local-dev.pid}"
LOG_FILE="${CRM_LOG_FILE:-$ROOT_DIR/.crm-local-dev.log}"
SNAPSHOT_DEFAULT_PATH="${CRM_INSUMOS_SNAPSHOT_DEFAULT:-$ROOT_DIR/backend/var/local/insumos-snapshot.latest.json}"
crm_persona_runtime_init

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
  --insumos-seed-token TOKEN     Token local usado para /admin/seed (default: dev-seed-token)
  --with-whatsapp                Inicia o adaptador local do WhatsApp
  --without-whatsapp             Não inicia o adaptador local do WhatsApp (default)
  --whatsapp-port PORT           Porta do adaptador WhatsApp local (default: 8110)
  CRM_LOCAL_LOG_LEVEL=LEVEL      Nível dos runtimes locais: warn (default), info, debug, error ou none
  CRM_BROWSER_DIAGNOSTICS_LOG=FILE Arquivo privado para diagnósticos conhecidos do Chromium durante smokes
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
    --vite-port) shift; CRM_VITE_PORT="$1" ;;
    --pages-port) shift; CRM_PAGES_PORT="$1" ;;
    --meta-ads-scenario) shift; CRM_META_ADS_SCENARIO="$1" ;;
    --skip-build) CRM_BUILD_BEFORE_START=0 ;;
    --with-insumos) CRM_WITH_INSUMOS=1 ;;
    --insumos-port) shift; CRM_INSUMOS_PORT="$1" ;;
    --insumos-snapshot) shift; CRM_INSUMOS_SNAPSHOT="$1" ;;
    --refresh-insumos-snapshot) CRM_REFRESH_INSUMOS_SNAPSHOT=1 ;;
    --insumos-seed-token) shift; CRM_INSUMOS_SEED_TOKEN="$1" ;;
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

DEFAULT_URL="http://localhost:${CRM_PAGES_PORT}${CRM_ROUTE}"
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
  local descendant_pids
  if ! kill -0 "$target_pid" >/dev/null 2>&1; then
    return 0
  fi
  descendant_pids="$(collect_descendants "$target_pid" | tr '\n' ' ')"
  if [[ -n "$descendant_pids" ]]; then
    kill -TERM $descendant_pids >/dev/null 2>&1 || true
  fi
  kill -TERM "$target_pid" >/dev/null 2>&1 || true
  sleep 2
  if [[ -n "$descendant_pids" ]]; then
    kill -KILL $descendant_pids >/dev/null 2>&1 || true
  fi
  kill -KILL "$target_pid" >/dev/null 2>&1 || true
}

stop_existing() {
  local existing_pid

  if [[ -f "$PID_FILE" ]]; then
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "Instância anterior do CRM local detectada (PID $existing_pid). Finalizando..."
      terminate_pid "$existing_pid"
    fi
    rm -f "$PID_FILE"
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
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  line="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -n 1 || true)"
  if [[ -n "$line" ]]; then
    echo "[crm-local] Porta $port já está em uso por outro processo ($label)." >&2
    echo "$line" >&2
    echo "Use --${label}-port para outra porta ou finalize manualmente o processo atual." >&2
    exit 1
  fi
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

open_browser() {
  if command -v open >/dev/null 2>&1; then
    open "$DEFAULT_URL" >/dev/null 2>&1 &
    disown "$!" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$DEFAULT_URL" >/dev/null 2>&1 &
    disown "$!" >/dev/null 2>&1 || true
  fi
}

ensure_frontend_ready() {
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    echo "Dependências do frontend não encontradas. Instalando..."
    npm --prefix "$FRONTEND_DIR" install
  fi
}

ensure_playwright_chromium() {
  if [[ "$CRM_GATE_STRICT" != "1" && "$CRM_SMOKE" != "1" ]]; then
    return 0
  fi

  echo "[crm-local] Garantindo o Chromium do Playwright para o gate local..."
  (
    cd "$FRONTEND_DIR"
    PLAYWRIGHT_BROWSERS_PATH=0 npm exec playwright install chromium
  )
}

ensure_timekeeping_ready() {
  if [[ ! -d "$TIMEKEEPING_DIR" ]]; then
    echo "[crm-local] O domínio Workforce/Timekeeping não foi encontrado em $TIMEKEEPING_DIR." >&2
    exit 1
  fi
  if [[ ! -d "$TIMEKEEPING_DIR/node_modules" ]]; then
    echo "[crm-local] Instalando dependências locais do Timekeeping..."
    npm --prefix "$TIMEKEEPING_DIR" install
  fi
}

start_timekeeping_local() {
  ensure_timekeeping_ready
  echo "[crm-local] Aplicando migrations locais do Timekeeping..."
  (
    cd "$TIMEKEEPING_DIR"
    ./node_modules/.bin/wrangler d1 migrations apply skincos-timekeeping --local --config=wrangler.toml
  ) >>"$LOG_FILE" 2>&1

  echo "[crm-local] Iniciando Workforce/Timekeeping local em :$CRM_TIMEKEEPING_PORT"
  (
    cd "$TIMEKEEPING_DIR"
    ./node_modules/.bin/wrangler dev --local --port "$CRM_TIMEKEEPING_PORT" --config=wrangler.toml \
      --var "PONTO_ACTOR_HMAC_KEY:$CRM_TIMEKEEPING_ACTOR_KEY" \
      --var "PONTO_IDEMPOTENCY_KEY:$CRM_TIMEKEEPING_IDEMPOTENCY_KEY" \
      --var "PONTO_TEMPLATES_KEY:$CRM_TIMEKEEPING_TEMPLATES_KEY"
  ) >>"$LOG_FILE" 2>&1 &
  TIMEKEEPING_PID=$!

  if ! wait_for_http "http://127.0.0.1:${CRM_TIMEKEEPING_PORT}/api/ponto/readiness" 90; then
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

ensure_insumos_seed_config() {
  local insumos_dev_vars="$ROOT_DIR/inventory/.dev.vars"
  if [[ ! -f "$insumos_dev_vars" && -f "$ROOT_DIR/inventory/.dev.vars.example" ]]; then
    cp "$ROOT_DIR/inventory/.dev.vars.example" "$insumos_dev_vars"
  fi
  touch "$insumos_dev_vars"
  if ! grep -qE '^ALLOW_DEV_SEED=' "$insumos_dev_vars"; then
    printf '\nALLOW_DEV_SEED=true\n' >> "$insumos_dev_vars"
  fi
  if ! grep -qE '^INSUMOS_SEED_TOKEN=' "$insumos_dev_vars"; then
    printf 'INSUMOS_SEED_TOKEN=%s\n' "$CRM_INSUMOS_SEED_TOKEN" >> "$insumos_dev_vars"
  fi
  if [[ "$CRM_PROFILE" == "realistic" ]] && ! grep -qE '^ALLOW_DEV_AUTH_BYPASS=' "$insumos_dev_vars"; then
    printf 'ALLOW_DEV_AUTH_BYPASS=true\n' >> "$insumos_dev_vars"
  fi
  if [[ "$CRM_PROFILE" == "realistic" ]] && ! grep -qE '^SESSION_SECRET=' "$insumos_dev_vars"; then
    printf 'SESSION_SECRET=skincos-local-dev-only-session-secret\n' >> "$insumos_dev_vars"
  fi
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
  echo "[crm-local] Aplicando migrations locais do Insumos..."
  (
    cd "$ROOT_DIR"
    ./backend/scripts/insumos.sh migrate --local
  ) >>"$LOG_FILE" 2>&1
}

start_insumos_local() {
  ensure_insumos_seed_config
  ensure_insumos_local_schema
  echo "[crm-local] Iniciando Worker local do Insumos em :$CRM_INSUMOS_PORT"
  (
    cd "$ROOT_DIR"
    PORT="$CRM_INSUMOS_PORT" ./backend/scripts/insumos.sh dev \
      --log-level "$CRM_LOCAL_LOG_LEVEL" \
      --show-interactive-dev-session false \
      --test-scheduled
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
    INSUMOS_SEED_TOKEN="$CRM_INSUMOS_SEED_TOKEN" \
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

if [[ "$STOP_ONLY" == "1" ]]; then
  crm_persona_runtime_stop_manifest_owner
  stop_existing
  stop_owned_port_listener "$CRM_VITE_PORT" "vite"
  stop_owned_port_listener "$CRM_PAGES_PORT" "pages"
  if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then
    stop_owned_port_listener "$CRM_WA_ORCHESTRATOR_PORT" "whatsapp"
  fi
  if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
    stop_owned_port_listener "$CRM_INSUMOS_PORT" "insumos"
  fi
  if [[ "$CRM_WITH_TIMEKEEPING" == "1" ]]; then
    stop_owned_port_listener "$CRM_TIMEKEEPING_PORT" "workforce-timekeeping"
  fi
  crm_persona_runtime_write_manifest stopped
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

if ! command -v npm >/dev/null 2>&1; then
  echo "npm não encontrado no PATH." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl não encontrado no PATH." >&2
  exit 1
fi

mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"
crm_persona_runtime_acquire_lock
bootstrap_cleanup() {
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
crm_persona_runtime_write_manifest starting
rotate_current_log
assert_port_free "$CRM_VITE_PORT" "vite"
assert_port_free "$CRM_PAGES_PORT" "pages"
if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then
  assert_port_free "$CRM_WA_ORCHESTRATOR_PORT" "whatsapp"
fi
ensure_frontend_ready
ensure_playwright_chromium

if [[ "$CRM_BUILD_BEFORE_START" == "1" ]]; then
  echo "[crm-local] Gerando build do frontend para alinhar o shell local ao online..."
  npm --prefix "$FRONTEND_DIR" run build
  crm_persona_runtime_write_build_state
else
  ensure_frontend_dist_ready
fi

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
  if [[ "$CRM_WITH_TIMEKEEPING" == "1" ]]; then
    export PONTO_API_TARGET="http://127.0.0.1:${CRM_TIMEKEEPING_PORT}"
    export PONTO_ACTOR_HMAC_KEY="$CRM_TIMEKEEPING_ACTOR_KEY"
  fi
  if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
    export ALLOW_DEV_AUTH_BYPASS=true
  fi
else
  export LOCAL_AUTH_BYPASS=false
fi

if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then
  start_whatsapp_orchestrator_local
  export LOCAL_WA_ORCHESTRATOR_API_TARGET="http://127.0.0.1:${CRM_WA_ORCHESTRATOR_PORT}"
fi

if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
  export LOCAL_INSUMOS_API_TARGET="http://127.0.0.1:${CRM_INSUMOS_PORT}"
fi

if [[ -n "$CRM_MODULE" ]]; then
  export VITE_LOCAL_CRM_FOCUS_MODULE="$CRM_MODULE"
fi

(
  cd "$FRONTEND_DIR"
  npm run dev:pages
) >>"$LOG_FILE" 2>&1 &
CRM_PID=$!

echo "$$" > "$PID_FILE"

cleanup() {
  if [[ -n "${CRM_PID:-}" ]]; then
    kill "$CRM_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${INSUMOS_PID:-}" ]]; then
    kill "$INSUMOS_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${TIMEKEEPING_PID:-}" ]]; then
    kill "$TIMEKEEPING_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${WHATSAPP_ORCHESTRATOR_PID:-}" ]]; then
    kill "$WHATSAPP_ORCHESTRATOR_PID" >/dev/null 2>&1 || true
  fi
  if [[ -f "$PID_FILE" ]]; then
    local tracked_pid
    tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ "$tracked_pid" == "$$" ]]; then
      rm -f "$PID_FILE"
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

run_gate_smoke() {
  echo "[crm-local] Rodando gate obrigatório do shell local..."
  run_browser_smoke env \
    PLAYWRIGHT_BROWSERS_PATH=0 \
    CRM_URL="$DEFAULT_URL" \
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
    run_browser_smoke env PLAYWRIGHT_BROWSERS_PATH=0 CRM_URL="$DEFAULT_URL" META_ADS_LOCAL_SCENARIO="${CRM_META_ADS_SCENARIO:-connected-ready}" HEADED="$CRM_SMOKE_HEADED" npm run smoke:meta-ads:local
  elif [[ "$CRM_MODULE" == "site-tracking" ]]; then
    echo "[crm-local] Rodando smoke local do Site EF..."
    run_browser_smoke env PLAYWRIGHT_BROWSERS_PATH=0 CRM_URL="$DEFAULT_URL" META_ADS_LOCAL_SCENARIO="${CRM_META_ADS_SCENARIO:-connected-ready}" HEADED="$CRM_SMOKE_HEADED" npm run smoke:site-tracking:local
  else
    echo "[crm-local] Rodando smoke local padrão..."
    run_browser_smoke env PLAYWRIGHT_BROWSERS_PATH=0 CRM_URL="$DEFAULT_URL" HEADED="$CRM_SMOKE_HEADED" node ./scripts/crm-local-smoke.cjs
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
  echo "  - Insumos continua usando o target definido em crm/console/.dev.vars ou crm/console/wrangler.toml."
fi
if [[ -n "$CRM_META_ADS_SCENARIO" && "$CRM_META_ADS_SCENARIO" != "live" ]]; then
  echo "  - Meta Ads/tracking está em cenário local controlado; o fluxo é simulado só em localhost."
fi
echo ""

wait "$CRM_PID"
