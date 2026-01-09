#!/usr/bin/env bash
# ============================================================================
# SALES CHART MESSENGER (WhatsApp) - Setup
# ============================================================================
# Script para configuração automática do ambiente da automação de gráficos
# Inclui validações, instalação de dependências e verificação de configurações

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

MODULE_DIR="${BACKEND_DIR}/apps/automations/sales_chart_messenger"

cd "${BACKEND_DIR}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

echo "============================================================================"
echo "🚀 Sales Chart Messenger (WhatsApp) - Setup"
echo "============================================================================"

# Check if we're in the correct directory
if [ ! -f "${MODULE_DIR}/main.py" ] || [ ! -f "${BACKEND_DIR}/requirements.txt" ]; then
    print_error "Estrutura inválida: esperado backend/requirements.txt e backend/apps/automations/sales_chart_messenger/main.py"
    exit 1
fi

print_status "Verificando dependências do sistema..."

# Check Python 3
if ! command -v python3 &> /dev/null; then
    print_error "Python 3 não encontrado. Instale Python 3.8+ para continuar"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
print_success "Python $PYTHON_VERSION encontrado"

# Check Git
if ! command -v git &> /dev/null; then
    print_warning "Git não encontrado. Recomendado para versionamento"
else
    print_success "Git encontrado"
fi

# Check Tesseract (optional for pytesseract)
if ! command -v tesseract &> /dev/null; then
    print_warning "Tesseract não encontrado. Para usar OCR em gráficos:"
    print_warning "  macOS: brew install tesseract"
    print_warning "  Linux: sudo apt-get install tesseract-ocr"
else
    TESSERACT_VERSION=$(tesseract --version | head -n1)
    print_success "Tesseract encontrado: $TESSERACT_VERSION"
fi

print_status "Instalando dependências do Python..."
if [ -f "requirements.txt" ]; then
    python3 -m pip install -r requirements.txt
    print_success "Dependências instaladas com sucesso"
else
    print_error "Arquivo requirements.txt não encontrado"
    exit 1
fi

print_status "Verificando instalação das dependências..."

# Check critical dependencies
CRITICAL_REQUIREMENTS=("google-api-python-client" "google-auth" "selenium" "pillow" "requests")
for dep in "${CRITICAL_REQUIREMENTS[@]}"; do
    if python3 -m pip show "$dep" > /dev/null 2>&1; then
        print_success "$dep instalado"
    else
        print_error "$dep NÃO instalado"
    fi
done

print_status "Verificando arquivos de configuração..."

# Check config.json (Sales Chart Messenger usa backend/config.json)
if [ -f "${BACKEND_DIR}/config.json" ]; then
    print_success "config.json encontrado"

    # Validate JSON structure
    python3 -c "
import json
with open('${BACKEND_DIR}/config.json', 'r') as f:
    config = json.load(f)

# Check required sections
required_sections = ['google_service_account', 'whatsapp_config', 'spreadsheet_id', 'units']
missing_sections = [section for section in required_sections if section not in config]

if missing_sections:
    print(f'⚠️ Seções ausentes no config.json: {missing_sections}')
else:
    print('✅ Estrutura do config.json validada')

# Check Google service account structure
if 'google_service_account' in config:
    sa = config['google_service_account']
    required_fields = ['type', 'project_id', 'private_key_id']
    missing_fields = [field for field in required_fields if field not in sa]
    if missing_fields:
        print(f'⚠️ Campos ausentes em google_service_account: {missing_fields}')

    # Check for placeholder values
    if 'private_key' in sa and 'PLACEHOLDER' in sa['private_key']:
        print('⚠️ private_key contém PLACEHOLDER - substitua com a chave real')
    if 'client_email' in sa and 'PLACEHOLDER' in sa['client_email']:
        print('⚠️ client_email contém PLACEHOLDER - substitua com o email real')
"
else
    if [ -f "${BACKEND_DIR}/config/templates/modules/whatsapp-sales-charts/config.example.json" ]; then
        print_warning "config.json não encontrado. Criando a partir do template..."
        cp "${BACKEND_DIR}/config/templates/modules/whatsapp-sales-charts/config.example.json" "${BACKEND_DIR}/config.json"
        print_warning "Template criado em backend/config.json (edite com suas credenciais)"
    else
        print_warning "config.json não encontrado e template não existe em config/templates/modules/whatsapp-sales-charts/config.example.json"
        print_warning "Crie backend/config.json manualmente seguindo backend/config/templates/modules/whatsapp-sales-charts/config.example.json"
    fi
fi

# Create runtime directories (prefer VAR_DIR to avoid writing into the repo tree)
mkdir -p "${VAR_DIR}/logs/whatsapp/sales_chart_messenger" >/dev/null 2>&1 || true
mkdir -p "${VAR_DIR}/whatsapp/sales_chart_messenger/downloads" >/dev/null 2>&1 || true
print_success "Diretórios runtime OK (VAR_DIR=${VAR_DIR})"

print_status "Executando teste básico do sistema..."

# Test basic import
if python3 -c "
import sys
sys.path.insert(0,'${BACKEND_DIR}')
import apps.automations.sales_chart_messenger  # noqa: F401
print('✅ Importação do módulo OK')
" 2>/dev/null; then
    print_success "Sistema pronto para uso"
else
    print_error "Erro ao importar módulo principal"
fi

echo
echo "============================================================================"
echo "🎉 Setup concluído!"
echo "============================================================================"
echo
echo "📝 Próximos passos:"
echo "1. Configure suas credenciais em backend/config.json (se ainda não configurado)"
echo "2. Execute ./backend/apps/automations/sales_chart_messenger/scripts/run.sh para iniciar a automação"
echo "3. Use ./backend/apps/automations/sales_chart_messenger/scripts/run.sh --help para ver opções disponíveis"
echo
echo "💡 Comandos úteis:"
echo "   ./backend/apps/automations/sales_chart_messenger/scripts/run.sh test nh        # Teste simulado NH"
echo "   ./backend/apps/automations/sales_chart_messenger/scripts/run.sh run bss        # Execução real BSS"
echo "   ./backend/apps/automations/sales_chart_messenger/scripts/run.sh diagnose       # Diagnóstico completo"
echo
