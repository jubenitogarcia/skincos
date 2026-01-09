#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# SALES CHART MESSENGER (WhatsApp) - Runner
# ============================================================================
# Execução da automação (Google Sheets/Drive -> WhatsApp) com validações básicas

ROOT_DIR="$(cd "$(dirname "$0")/../../../../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

MODULE_DIR="${BACKEND_DIR}/apps/automations/sales_chart_messenger"
SELF="${ROOT_DIR}/backend/apps/automations/sales_chart_messenger/scripts/run.sh"

cd "${BACKEND_DIR}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

print_status() { echo -e "${BLUE}ℹ️  $1${NC}"; }
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_header() { echo -e "${PURPLE}🚀 $1${NC}"; }

show_help() {
  print_header "Sales Chart Messenger (WhatsApp)"
  echo
  echo "Automação: Google Sheets/Drive -> WhatsApp"
  echo
  echo "Uso: ${SELF} [MODO] [TIPO] [OPÇÕES]"
  echo
  echo "Modos disponíveis:"
  echo "  run       - Execução real (padrão)"
  echo "  test      - Execução simulada"
  echo "  diagnose  - Diagnóstico completo"
  echo
  echo "Tipos de execução:"
  echo "  bss       - BarraShoppingSul"
  echo "  nh        - Novo Hamburgo"
  echo
  echo "Exemplos:"
  echo "  ${SELF} test nh              # Teste simulado NH"
  echo "  ${SELF} run bss              # Execução real BSS"
  echo "  ${SELF} diagnose             # Diagnóstico completo"
  echo "  ${SELF} nh                   # (atalho) Executa modo run para NH"
  echo
  echo "Status: ✅ Runner OK"
}

if [[ ${1:-} == "--help" || ${1:-} == "-h" || ${1:-} == "help" ]]; then
  show_help
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  print_error "Python3 não encontrado. Instale Python3 para continuar."
  exit 1
fi

if [[ ! -f "${MODULE_DIR}/main.py" ]]; then
  print_error "Arquivo apps/automations/sales_chart_messenger/main.py não encontrado."
  exit 1
fi

print_success "Módulo Sales Chart Messenger detectado"

mode=${1:-run}
type=${2:-}

# Atalho: permitir `run.sh nh` / `run.sh bss`
case "$mode" in
  nh|bss)
    type="$mode"
    mode="run"
    shift 1 || true
    ;;
  run|test|diagnose)
    shift 1 || true
    if [[ -n "$type" ]]; then
      shift 1 || true
    fi
    ;;
  *)
    # mantém compatibilidade para modos futuros, mas evita confundir com tipos comuns
    shift 1 || true
    if [[ -n "$type" ]]; then
      shift 1 || true
    fi
    ;;
esac

args=(python3 -m apps.automations.sales_chart_messenger --mode "$mode")
if [[ -n "$type" && "$type" != "--"* ]]; then
  args+=("$type")
fi
if [[ $# -gt 0 ]]; then
  args+=("$@")
fi

print_header "Executando Sales Chart Messenger"
print_status "Comando: ${args[*]}"
print_status "Timestamp: $(date)"
echo

exec "${args[@]}"
