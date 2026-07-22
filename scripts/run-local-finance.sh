#!/usr/bin/env bash
set -euo pipefail

# Production-like local Finance runtime. It owns only private WSL state and
# launches the existing CRM Pages shell plus the public gateway Worker.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OPERATOR_ROOT="${CRM_OPERATOR_RUNTIME_ROOT:-/mnt/c/CodexRuntime/operator/admin/skincos}"
RUNTIME_ROOT="${FINANCE_LOCAL_RUNTIME_ROOT:-$OPERATOR_ROOT/runtime/finance-local}"
FRONTEND_RUNTIME_DIR="${FINANCE_CRM_CONSOLE_DIR:-$ROOT_DIR/crm/console}"
INVENTORY_DEPS_DIR="$RUNTIME_ROOT/inventory-deps"
INVENTORY_NODE_MODULES_LINK="$ROOT_DIR/inventory/node_modules"
D1_STATE_DIR="$RUNTIME_ROOT/d1"
PID_FILE="$RUNTIME_ROOT/launcher.pid"
LOG_FILE="$RUNTIME_ROOT/finance-local.log"
STATE_FILE="$RUNTIME_ROOT/current.env"
GATEWAY_ENV_FILE="$RUNTIME_ROOT/gateway.dev.vars"
API_DEV_VARS_LINK="$ROOT_DIR/api/.dev.vars"
CRM_PID_FILE="$RUNTIME_ROOT/crm-launcher.pid"
CRM_LOG_FILE="$RUNTIME_ROOT/crm-local.log"
GATEWAY_PORT="${FINANCE_GATEWAY_PORT:-8792}"
CRM_VITE_PORT="${FINANCE_CRM_VITE_PORT:-5182}"
CRM_PAGES_PORT="${FINANCE_CRM_PAGES_PORT:-8793}"
SCENARIO="${FINANCE_LOCAL_SCENARIO:-both}"
OPEN_BROWSER="${FINANCE_OPEN_BROWSER:-1}"
RUN_SMOKE=0
EXIT_AFTER_SMOKE=0
STOP_ONLY=0
STATUS_ONLY=0
PORTS_ONLY=0

usage() {
  cat <<'EOF'
SKINCOS • Financeiro local production-like

Uso:
  ./scripts/run-local-finance.sh [opções]

Cenários (um usuário local mínimo, sem dados/segredos de produção):
  disabled   flag desligada
  no-module  usuário sem allowedModules.finance
  no-grant   usuário com módulo, sem concessão financeira
  nh         operador somente em Novo Hamburgo
  bss        operador somente em BarraShoppingSul
  both       operador nas duas unidades (padrão)

Opções:
  --scenario NOME       Seleciona um dos cenários acima
  --gateway-port PORT   Porta preferida do gateway Financeiro (padrão 8792)
  --smoke               Executa smoke Playwright headless do cenário
  --exit-after-smoke    Encerra CRM, Worker e D1 local após a smoke
  --browser             Abre a rota Financeiro no navegador
  --no-browser          Apenas informa a rota local
  --status              Mostra URLs, processos e cenário atual
  --ports               Diagnostica as portas do runtime
  --stop                Encerra somente processos pertencentes a este runtime
  -h, --help            Mostra esta ajuda

Exemplos:
  npm run crm:local:finance
  npm run crm:local:finance -- --scenario nh --browser
  npm run codex:crm:finance-smoke -- --scenario no-grant
EOF
}

release_inventory_link() {
  if [[ "${INVENTORY_LINK_CREATED:-0}" == 1 && -L "$INVENTORY_NODE_MODULES_LINK" ]]; then
    rm -f "$INVENTORY_NODE_MODULES_LINK"
  fi
}

release_gateway_env_link() {
  if [[ "${GATEWAY_ENV_LINK_CREATED:-0}" == 1 && -L "$API_DEV_VARS_LINK" ]]; then
    rm -f "$API_DEV_VARS_LINK"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario) shift; SCENARIO="${1:-}" ;;
    --gateway-port) shift; GATEWAY_PORT="${1:-}" ;;
    --smoke) RUN_SMOKE=1 ;;
    --exit-after-smoke) RUN_SMOKE=1; EXIT_AFTER_SMOKE=1 ;;
    --browser) OPEN_BROWSER=1 ;;
    --no-browser) OPEN_BROWSER=0 ;;
    --status) STATUS_ONLY=1 ;;
    --ports) PORTS_ONLY=1 ;;
    --stop) STOP_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; usage; exit 1 ;;
  esac
  shift || true
done

case "$SCENARIO" in disabled|no-module|no-grant|nh|bss|both) ;; *) echo "Cenário inválido: $SCENARIO" >&2; exit 1;; esac
[[ "$GATEWAY_PORT" =~ ^[0-9]+$ ]] || { echo 'gateway-port deve ser numérico.' >&2; exit 1; }

mkdir -p "$RUNTIME_ROOT" "$D1_STATE_DIR"

collect_descendants() { local parent="$1" child; while IFS= read -r child; do [[ -n "$child" ]] && { collect_descendants "$child"; printf '%s\n' "$child"; }; done < <(pgrep -P "$parent" 2>/dev/null || true); }
terminate_tree() { local root="$1" children; kill -0 "$root" >/dev/null 2>&1 || return 0; children="$(collect_descendants "$root" | tr '\n' ' ')"; [[ -n "$children" ]] && kill -TERM $children 2>/dev/null || true; kill -TERM "$root" 2>/dev/null || true; sleep 2; [[ -n "$children" ]] && kill -KILL $children 2>/dev/null || true; kill -KILL "$root" 2>/dev/null || true; }
belongs_to_finance_runtime() { local pid="$1" candidate="$1" args cwd; while [[ "$candidate" =~ ^[0-9]+$ && "$candidate" != 1 ]]; do args="$(ps -p "$candidate" -o args= 2>/dev/null || true)"; cwd="$(readlink "/proc/$candidate/cwd" 2>/dev/null || true)"; if [[ "$args" == *'run-local-finance.sh'* && ( "$args" == *"$ROOT_DIR"* || "$cwd" == "$ROOT_DIR" ) ]]; then return 0; fi; candidate="$(ps -p "$candidate" -o ppid= 2>/dev/null | tr -d ' ' || true)"; done; return 1; }
belongs_to_finance_gateway() { local pid="$1" args; args="$(ps -p "$pid" -o args= 2>/dev/null || true)"; [[ "$args" == *'wrangler dev'* && "$args" == *'api/wrangler.toml'* && "$args" == *"$D1_STATE_DIR"* ]]; }
state_value() { [[ -f "$STATE_FILE" ]] && sed -n "s/^$1=//p" "$STATE_FILE" | head -n 1 || true; }
port_is_free() { ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
select_port() { local preferred="$1" candidate; for ((candidate=preferred; candidate<=preferred+30; candidate++)); do port_is_free "$candidate" && { printf '%s' "$candidate"; return; }; done; echo "Não há porta livre para gateway Financeiro perto de $preferred." >&2; exit 1; }
wait_for_http() { local url="$1" retries="${2:-90}"; while (( retries > 0 )); do curl -fsS --max-time 3 "$url" >/dev/null 2>&1 && return 0; sleep 1; retries=$((retries - 1)); done; return 1; }
wrangler_bin() { printf '%s' "$FRONTEND_RUNTIME_DIR/node_modules/.bin/wrangler"; }

runtime_status() {
  local finance_pid='' crm_url='' actual_port actual_scenario
  [[ -f "$PID_FILE" ]] && finance_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  actual_port="$(state_value gateway_port)"; actual_scenario="$(state_value scenario)"
  crm_url="$(state_value crm_url)"
  printf 'FINANCE_LOCAL_SCENARIO=%s\nFINANCE_LOCAL_GATEWAY=http://127.0.0.1:%s\nFINANCE_LOCAL_CRM_URL=%s\nFINANCE_LOCAL_PID=%s\nFINANCE_LOCAL_LOG=%s\n' "${actual_scenario:-$SCENARIO}" "${actual_port:-$GATEWAY_PORT}" "$crm_url" "$finance_pid" "$LOG_FILE"
}

diagnose_ports() {
  local actual_port crm_port
  actual_port="$(state_value gateway_port)"
  crm_port="$(state_value crm_pages_port)"
  echo "[finance-local] Gateway esperado: ${actual_port:-$GATEWAY_PORT}"
  lsof -nP -iTCP:"${actual_port:-$GATEWAY_PORT}" -sTCP:LISTEN 2>/dev/null || true
  echo "[finance-local] CRM Pages esperado: ${crm_port:-$CRM_PAGES_PORT}"
  lsof -nP -iTCP:"${crm_port:-$CRM_PAGES_PORT}" -sTCP:LISTEN 2>/dev/null || true
}

if [[ "$STATUS_ONLY" == 1 ]]; then runtime_status; exit 0; fi
if [[ "$PORTS_ONLY" == 1 ]]; then diagnose_ports; exit 0; fi
if [[ "$STOP_ONLY" == 1 ]]; then
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && belongs_to_finance_runtime "$pid"; then terminate_tree "$pid"; else echo '[finance-local] PID ausente ou não pertence a este worktree; preservado.'; fi
    rm -f "$PID_FILE"
  fi
  gateway_pid="$(state_value gateway_pid)"
  if [[ "$gateway_pid" =~ ^[0-9]+$ ]] && belongs_to_finance_gateway "$gateway_pid"; then terminate_tree "$gateway_pid"; fi
  rm -f "$STATE_FILE"
  CRM_VITE_PORT="${CRM_VITE_PORT}" CRM_PAGES_PORT="${CRM_PAGES_PORT}" CRM_WITH_INSUMOS=0 CRM_WITH_TIMEKEEPING=0 CRM_WITH_WHATSAPP=0 CRM_PID_FILE="$CRM_PID_FILE" CRM_LOG_FILE="$CRM_LOG_FILE" "$ROOT_DIR/scripts/run-local-crm.sh" --stop || true
  echo 'Financeiro local finalizado.'
  exit 0
fi

if [[ -f "$PID_FILE" ]]; then
  existing="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$existing" =~ ^[0-9]+$ ]] && kill -0 "$existing" >/dev/null 2>&1; then
    echo '[finance-local] Runtime já está ativo; use --status, --ports ou --stop.' >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

prepare_frontend_runtime() {
  if [[ ! -x "$(wrangler_bin)" ]]; then
    echo '[finance-local] Instalando dependências bloqueadas do CRM...'
    npm --prefix "$FRONTEND_RUNTIME_DIR" ci
  fi
}

prepare_inventory_dependencies() {
  if [[ ! -f "$INVENTORY_DEPS_DIR/package.json" || ! -f "$INVENTORY_DEPS_DIR/pnpm-lock.yaml" ]]; then
    mkdir -p "$INVENTORY_DEPS_DIR"
    cp "$ROOT_DIR/inventory/package.json" "$ROOT_DIR/inventory/pnpm-lock.yaml" "$INVENTORY_DEPS_DIR/"
  fi
  if [[ ! -d "$INVENTORY_DEPS_DIR/node_modules/bcryptjs" || ! -d "$INVENTORY_DEPS_DIR/node_modules/qrcode-generator" ]]; then
    echo '[finance-local] Instalando dependências bloqueadas do gateway no runtime privado...'
    corepack pnpm --dir "$INVENTORY_DEPS_DIR" install --frozen-lockfile
  fi

  # The gateway imports the Inventory worker and Wrangler resolves those
  # imports from the source tree. Keep the dependency tree private, exposing it
  # only through an ephemeral symlink while this local runtime is running.
  if [[ -L "$INVENTORY_NODE_MODULES_LINK" ]]; then
    current_target="$(readlink -f "$INVENTORY_NODE_MODULES_LINK" 2>/dev/null || true)"
    expected_target="$(readlink -f "$INVENTORY_DEPS_DIR/node_modules")"
    [[ "$current_target" == "$expected_target" ]] || { echo "inventory/node_modules já pertence a outro runtime; preservado." >&2; exit 1; }
  elif [[ -e "$INVENTORY_NODE_MODULES_LINK" ]]; then
    echo 'inventory/node_modules existe e não é um link do runtime Financeiro; preservado.' >&2
    exit 1
  else
    ln -s "$INVENTORY_DEPS_DIR/node_modules" "$INVENTORY_NODE_MODULES_LINK"
    INVENTORY_LINK_CREATED=1
  fi
}

d1() { "$(wrangler_bin)" d1 "$@" --local --persist-to "$D1_STATE_DIR"; }
apply_finance_migrations() {
  local marker_file marker id combined applied_markers
  d1 execute skincos-db --config "$ROOT_DIR/api/wrangler.toml" --command 'CREATE TABLE IF NOT EXISTS finance_local_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);' >/dev/null
  applied_markers="$(d1 execute skincos-db --config "$ROOT_DIR/api/wrangler.toml" --json --command 'SELECT id FROM finance_local_migrations;' || true)"
  for marker_file in "$ROOT_DIR"/finance/migrations/*.sql; do
    id="$(basename "$marker_file")"
    applied="$(node -e "process.exit(process.argv[1].includes(process.argv[2]) ? 0 : 1)" "$applied_markers" "$id" && echo yes || true)"
    [[ "$applied" == yes ]] && continue
    combined="$RUNTIME_ROOT/${id}.apply.sql"
    { cat "$marker_file"; printf "\nINSERT INTO finance_local_migrations(id,applied_at) VALUES('%s',CURRENT_TIMESTAMP);\n" "$id"; } > "$combined"
    echo "[finance-local] Aplicando $id no D1 local..."
    d1 execute skincos-db --config "$ROOT_DIR/api/wrangler.toml" --file "$combined" >/dev/null
  done
}

prepare_frontend_runtime
prepare_inventory_dependencies
trap 'release_inventory_link; release_gateway_env_link' EXIT
WRANGLER="$(wrangler_bin)"
[[ -x "$WRANGLER" ]] || { echo 'Wrangler não disponível após preparar o runtime.' >&2; exit 1; }

echo '[finance-local] Aplicando migrations CRM mínimas no D1 local...'
"$WRANGLER" d1 migrations apply skincos-db --local --persist-to "$D1_STATE_DIR" --config "$ROOT_DIR/inventory/wrangler.toml" >/dev/null
apply_finance_migrations

fixture_sql="$RUNTIME_ROOT/fixture.sql"
fixture="$(node "$ROOT_DIR/finance/scripts/write-local-fixture.mjs" --scenario "$SCENARIO" --output "$fixture_sql")"
d1 execute skincos-db --config "$ROOT_DIR/api/wrangler.toml" --file "$fixture_sql" >/dev/null

case "$SCENARIO" in
  disabled|no-module) LOCAL_MODULES='' ;;
  *) LOCAL_MODULES='finance' ;;
esac

GATEWAY_PORT="$(select_port "$GATEWAY_PORT")"
CRM_VITE_PORT="$(select_port "$CRM_VITE_PORT")"
CRM_PAGES_PORT="$(select_port "$CRM_PAGES_PORT")"
if [[ "$CRM_PAGES_PORT" == "$GATEWAY_PORT" ]]; then
  CRM_PAGES_PORT="$(select_port "$((CRM_PAGES_PORT + 1))")"
fi
umask 077
{
  printf 'LOCAL_FINANCE_AUTH_BYPASS=true\n'
  printf 'LOCAL_FINANCE_ACTOR=finance-local\n'
  printf 'LOCAL_FINANCE_ALLOWED_MODULES=%s\n' "$LOCAL_MODULES"
  printf 'LOCAL_FINANCE_CSRF_TOKEN=finance-local-csrf\n'
} > "$GATEWAY_ENV_FILE"
if [[ -L "$API_DEV_VARS_LINK" ]]; then
  current_gateway_env="$(readlink -f "$API_DEV_VARS_LINK" 2>/dev/null || true)"
  expected_gateway_env="$(readlink -f "$GATEWAY_ENV_FILE")"
  [[ "$current_gateway_env" == "$expected_gateway_env" ]] || { echo 'api/.dev.vars já pertence a outro runtime; preservado.' >&2; exit 1; }
elif [[ -e "$API_DEV_VARS_LINK" ]]; then
  echo 'api/.dev.vars existe e não é um link do runtime Financeiro; preservado.' >&2
  exit 1
else
  ln -s "$GATEWAY_ENV_FILE" "$API_DEV_VARS_LINK"
  GATEWAY_ENV_LINK_CREATED=1
fi
: > "$LOG_FILE"
echo "[finance-local] Iniciando gateway Financeiro em :$GATEWAY_PORT"
(
  cd "$ROOT_DIR"
  setsid "$WRANGLER" dev --config api/wrangler.toml --local --ip 127.0.0.1 --port "$GATEWAY_PORT" --persist-to "$D1_STATE_DIR" --env-file "$GATEWAY_ENV_FILE" \
    --log-level warn --show-interactive-dev-session false
) >>"$LOG_FILE" 2>&1 &
GATEWAY_PID=$!
echo "$$" > "$PID_FILE"
printf 'scenario=%s\ngateway_port=%s\ngateway_pid=%s\ncrm_vite_port=%s\ncrm_pages_port=%s\n' "$SCENARIO" "$GATEWAY_PORT" "$GATEWAY_PID" "$CRM_VITE_PORT" "$CRM_PAGES_PORT" > "$STATE_FILE"

cleanup() {
  [[ -n "${CRM_PID:-}" ]] && terminate_tree "$CRM_PID"
  [[ -n "${GATEWAY_PID:-}" ]] && terminate_tree "$GATEWAY_PID"
  release_inventory_link
  release_gateway_env_link
  [[ -f "$STATE_FILE" && "$(state_value gateway_pid)" == "${GATEWAY_PID:-}" ]] && rm -f "$STATE_FILE"
  rm -f "$GATEWAY_ENV_FILE"
  [[ -f "$PID_FILE" && "$(cat "$PID_FILE" 2>/dev/null || true)" == "$$" ]] && rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

if ! wait_for_http "http://127.0.0.1:${GATEWAY_PORT}/health"; then echo "Gateway Financeiro não respondeu. Veja $LOG_FILE" >&2; exit 1; fi

case "$SCENARIO" in nh) LOCAL_UNITS='novo-hamburgo';; bss) LOCAL_UNITS='barra-shopping-sul';; both) LOCAL_UNITS='novo-hamburgo,barra-shopping-sul';; *) LOCAL_UNITS='';; esac

echo "[finance-local] Iniciando CRM Pages local para cenário $SCENARIO"
(
  cd "$ROOT_DIR"
  CRM_VITE_PORT="$CRM_VITE_PORT" CRM_PAGES_PORT="$CRM_PAGES_PORT" CRM_PID_FILE="$CRM_PID_FILE" CRM_LOG_FILE="$CRM_LOG_FILE" \
  CRM_WITH_WHATSAPP=0 CRM_WITH_INSUMOS=0 CRM_WITH_TIMEKEEPING=0 CRM_GATE_STRICT=0 CRM_BUILD_BEFORE_START="${FINANCE_CRM_BUILD_BEFORE_START:-1}" \
  LOCAL_AUTH_USERNAME=finance-local LOCAL_AUTH_EMAIL=finance-local@localhost LOCAL_AUTH_NAME='Finance Local' \
  LOCAL_AUTH_ALLOWED_MODULES="$LOCAL_MODULES" LOCAL_AUTH_ALLOWED_UNITS="$LOCAL_UNITS" \
  LOCAL_FINANCE_API_TARGET="http://127.0.0.1:${GATEWAY_PORT}" LOCAL_FINANCE_ACTOR=finance-local LOCAL_FINANCE_CSRF_TOKEN=finance-local-csrf \
  setsid "$ROOT_DIR/scripts/run-local-crm.sh" --module finance --without-whatsapp --no-browser
) >>"$CRM_LOG_FILE" 2>&1 &
CRM_PID=$!

CRM_URL="http://localhost:${CRM_PAGES_PORT}/?module=finance"
wait_for_http "http://localhost:${CRM_PAGES_PORT}/api/auth/me" 120 || { echo "CRM Financeiro não ficou pronto. Veja $CRM_LOG_FILE" >&2; exit 1; }
printf 'crm_url=%s\n' "$CRM_URL" >> "$STATE_FILE"

echo "[finance-local] Pronto: $CRM_URL"
echo "[finance-local] Gateway: http://127.0.0.1:${GATEWAY_PORT}/finance/bootstrap"
echo "[finance-local] Fixture: $fixture"

if [[ "$RUN_SMOKE" == 1 ]]; then
  echo "[finance-local] Executando smoke headless do Financeiro..."
  PLAYWRIGHT_BROWSERS_PATH="${CRM_PLAYWRIGHT_BROWSERS_PATH:-$OPERATOR_ROOT/playwright-browsers}" CRM_URL="$CRM_URL" FINANCE_SCENARIO="$SCENARIO" \
    node "$ROOT_DIR/crm/console/scripts/finance-local-smoke.cjs"
fi

if [[ "$OPEN_BROWSER" == 1 ]]; then
  if command -v powershell.exe >/dev/null 2>&1; then powershell.exe -NoProfile -NonInteractive -Command 'Start-Process -FilePath $args[0]' -- "$CRM_URL" >/dev/null 2>&1 || true; fi
fi
if [[ "$EXIT_AFTER_SMOKE" == 1 ]]; then exit 0; fi
wait "$CRM_PID"
