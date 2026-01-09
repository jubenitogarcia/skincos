#!/bin/bash
#
# Automação Espaço Facial - Script de Execução
# Sistema completo de coleta de dados e atualização do Google Sheets
# Versão: 3.0
# Data: $(date '+%d/%m/%Y')

# Suprime avisos de MallocStackLogging no macOS
export MallocStackLogging=0
export MallocStackLoggingNoCompact=0
export MallocStackLoggingDirectory=/dev/null
export NSUnbufferedIO=YES
unset DYLD_INSERT_LIBRARIES

# Suprime avisos do Python e Chrome
export PYTHONWARNINGS=ignore
export CHROME_LOG_FILE=/dev/null

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Diretório do script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$SCRIPT_DIR"
while [[ "$ROOT_DIR" != "/" && ! -f "${ROOT_DIR}/backend/scripts/env.sh" ]]; do
    ROOT_DIR="$(cd "${ROOT_DIR}/.." && pwd)"
done
if [[ -f "${ROOT_DIR}/backend/scripts/env.sh" ]]; then
    # shellcheck disable=SC1091
    . "${ROOT_DIR}/backend/scripts/env.sh"
else
    echo "❌ Não foi possível localizar backend/scripts/env.sh a partir de ${SCRIPT_DIR}" >&2
    exit 1
fi
cd "$SCRIPT_DIR"

# Permite importar módulos compartilhados do monorepo (ex.: integrations/*)
export PYTHONPATH="${BACKEND_DIR}:${PYTHONPATH:-}"

# Diretório do ambiente virtual (prefere `backend/var/` para evitar sujeira no repo)
VENV_DIR="${SCRAPER_VENV_DIR:-${VAR_DIR}/venvs/scraper}"

# Função para exibir cabeçalho
show_header() {
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}🚀 AUTOMAÇÃO ESPAÇO FACIAL - EXECUÇÃO${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo -e "📅 Data: $(date '+%d/%m/%Y %H:%M:%S')"
    echo -e "📁 Diretório: $SCRIPT_DIR"
    echo -e "${BLUE}================================================${NC}\n"
}

# Função para mostrar ajuda
show_help() {
    echo "Uso: $0 [opção] [flags]"
    echo ""
    echo "Opções:"
    echo "  all       - Executa automação para todas as unidades"
    echo "  bss       - Executa automação para Barra Shopping Sul"
    echo "  nh        - Executa automação para Novo Hamburgo"
    echo "  rj        - Executa automação para Rio de Janeiro"
    echo "  --test-sheets - Testa conexão com Google Sheets"
    echo "  diagnose  - Executa diagnóstico do sistema"
    echo "  configure - Configura credenciais do sistema"
    echo "  help      - Mostra esta ajuda"
    echo ""
    echo "Flags adicionais:"
    echo "  --headless - Executa em modo invisível"
    echo "  --silent   - Execução silenciosa"
    echo "  --debug    - Modo debug detalhado"
    echo ""
    echo "Exemplos:"
    echo "  $0 all                    # Executa todas as unidades"
    echo "  $0 bss --headless         # Executa BSS em modo invisível"
    echo "  $0 diagnose               # Executa diagnóstico"
    echo "  $0 configure              # Configura credenciais"
    echo ""
}

# Função para mostrar menu interativo
show_menu() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}         MENU PRINCIPAL${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo -e "${GREEN}1.${NC} Executar todas as unidades"
    echo -e "${GREEN}2.${NC} Executar Barra Shopping Sul (BSS)"
    echo -e "${GREEN}3.${NC} Executar Novo Hamburgo (NH)"
    echo -e "${GREEN}4.${NC} Executar Rio de Janeiro (RJ)"
    echo -e "${GREEN}5.${NC} Diagnóstico do sistema"
    echo -e "${GREEN}6.${NC} Configurar credenciais"
    echo -e "${GREEN}0.${NC} Sair"
    echo -e "${BLUE}========================================${NC}"
}

# Função para verificar Python
check_python() {
    echo -e "${YELLOW}🐍 Verificando Python...${NC}"

    if command -v python3 &> /dev/null; then
        PYTHON_CMD="python3"
    elif command -v python &> /dev/null; then
        PYTHON_CMD="python"
    else
        echo -e "${RED}❌ Python não encontrado!${NC}"
        echo -e "${YELLOW}Por favor, instale Python 3.8 ou superior${NC}"
        exit 1
    fi

    VERSION=$($PYTHON_CMD --version 2>&1 | cut -d' ' -f2)
    echo -e "${GREEN}✅ Python encontrado: $VERSION${NC}"
}

# Função para criar/ativar ambiente virtual
setup_venv() {
    echo -e "\n${YELLOW}📦 Configurando ambiente virtual...${NC}"

    if [ ! -d "$VENV_DIR" ]; then
        echo -e "${YELLOW}Criando ambiente virtual...${NC}"
        mkdir -p "$(dirname "$VENV_DIR")" >/dev/null 2>&1 || true
        $PYTHON_CMD -m venv "$VENV_DIR"

        if [ $? -ne 0 ]; then
            echo -e "${RED}❌ Erro ao criar ambiente virtual${NC}"
            exit 1
        fi
    fi

    # Ativa o ambiente virtual
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
        # shellcheck disable=SC1090
        source "$VENV_DIR/Scripts/activate"
    else
        # shellcheck disable=SC1090
        source "$VENV_DIR/bin/activate"
    fi

    echo -e "${GREEN}✅ Ambiente virtual ativado${NC}"
}

# Função para instalar dependências
install_dependencies() {
    echo -e "\n${YELLOW}📥 Verificando dependências...${NC}"

    # Atualiza pip se necessário
    echo -e "${YELLOW}Verificando pip...${NC}"
    pip install --upgrade pip --quiet 2>/dev/null

    # Prioriza `requirements.txt` local (dentro do módulo)
    if [ -f "requirements.txt" ]; then
        echo -e "${YELLOW}📦 Instalando dependências via requirements.txt...${NC}"
        pip install -r requirements.txt --quiet
        echo -e "${GREEN}✅ Dependências instaladas via requirements.txt${NC}"
    else
        echo -e "${RED}❌ Arquivo de dependências não encontrado${NC}"
        echo -e "${YELLOW}Criando requirements.txt padrão...${NC}"
        cat > requirements.txt << 'EOF'
# Automação Espaço Facial - Dependências
selenium==4.15.2
webdriver-manager==4.0.1
google-auth==2.23.4
google-auth-oauthlib==1.1.0
google-auth-httplib2==0.1.1
google-api-python-client==2.108.0
googleapis-common-protos==1.61.0
openpyxl==3.1.2
requests==2.31.0
urllib3>=1.26.0
certifi>=2023.0.0
EOF
        pip install -r requirements.txt --quiet
        echo -e "${GREEN}✅ requirements.txt criado e dependências instaladas${NC}"
    fi
}

# Função para verificar configurações
check_config() {
    echo -e "\n${YELLOW}🔧 Verificando configurações...${NC}"

    CONFIG_FILE="${SCRAPER_CONFIG:-}"
    if [ -z "$CONFIG_FILE" ]; then
        if [ -f "config.local.json" ]; then
            CONFIG_FILE="config.local.json"
        else
            CONFIG_FILE="config.json"
        fi
    fi

    if [ ! -f "$CONFIG_FILE" ]; then
        echo -e "${YELLOW}⚠️  Arquivo de configuração não encontrado: $CONFIG_FILE${NC}"
        read -p "Deseja criar o arquivo de configuração agora? (s/n): " choice
        if [[ "$choice" == "s" || "$choice" == "S" ]]; then
            SCRAPER_CONFIG="$CONFIG_FILE" python main.py --configure
            if [ ! -f "$CONFIG_FILE" ]; then
                echo -e "${RED}❌ Falha ao criar $CONFIG_FILE. Saindo...${NC}"
                exit 1
            fi
        else
            echo -e "${RED}❌ Arquivo de configuração é necessário para continuar. Saindo...${NC}"
            exit 1
        fi
    fi

    echo -e "${GREEN}✅ Arquivo de configuração encontrado: $CONFIG_FILE${NC}"
}

# Função para testar conexão Google Sheets
test_google_service_account() {
    echo -e "\n${YELLOW}🔗 Testando conexão com Google Sheets...${NC}"

    CONFIG_FILE="${SCRAPER_CONFIG:-}"
    if [ -z "$CONFIG_FILE" ]; then
        if [ -f "config.local.json" ]; then
            CONFIG_FILE="config.local.json"
        else
            CONFIG_FILE="config.json"
        fi
    fi

    if [ ! -f "$CONFIG_FILE" ]; then
        echo -e "${RED}❌ Arquivo de configuração não encontrado: $CONFIG_FILE${NC}"
        echo -e "${YELLOW}📋 Por favor, siga as instruções em SETUP_google_service_account.md${NC}"
        exit 1
    fi

    # Executa teste de conexão
    python -c "
import sys
import json
try:
    from main import get_google_service_account_service
    print('🔄 Testando Google Sheets...')
    service = get_google_service_account_service()
    if service:
        print('✅ Conexão com Google Sheets estabelecida com sucesso!')

        # Testa leitura da planilha
        spreadsheet_id = '1E7bFXffT6cyqSP2ocTCTbdpXlXrVKvL3LBAlnLQZ8xE'
        sheet = service.spreadsheets()
        result = sheet.values().get(spreadsheetId=spreadsheet_id, range='Comercial!A1:D2').execute()
        values = result.get('values', [])
        print(f'✅ Planilha acessada com sucesso! Linhas: {len(values)}')

        # Testa escrita
        import datetime
        timestamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        update_range = 'Comercial!A1'
        update_values = [['Teste de conexão', timestamp]]

        body = {'values': update_values}
        result = service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=update_range,
            valueInputOption='RAW',
            body=body
        ).execute()

        print(f'✅ Teste de escrita realizado com sucesso!')
        print('🎉 Google Sheets está configurado corretamente!')
    else:
        print('❌ Falha ao conectar com Google Sheets')
        sys.exit(1)
except Exception as e:
    print(f'❌ Erro: {e}')
    print('📋 Verifique o arquivo SETUP_google_service_account.md para instruções')
    sys.exit(1)
" 2>/dev/null

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Teste concluído com sucesso!${NC}"
    else
        echo -e "${RED}❌ Teste falhou - verifique as configurações${NC}"
        exit 1
    fi
}

# Função principal de execução
run_automation() {
    local MODE=$1
    local UNIT=$2
    local HEADLESS=$3

    # Valida unidade se fornecida
    if [ -n "$UNIT" ]; then
        case "$UNIT" in
            "bss"|"nh"|"rj")
                # Unidade válida
                ;;
            *)
                echo -e "${RED}❌ Unidade inválida: $UNIT${NC}"
                exit 1
                ;;
        esac
    fi

    # Constrói comando
    CMD="python main.py"

    if [ -n "$MODE" ]; then
        CMD="$CMD --mode $MODE"
    fi

    if [ -n "$UNIT" ]; then
        CMD="$CMD --unit $UNIT"
    fi

    if [ "$HEADLESS" = "true" ]; then
        CMD="$CMD --headless"
    fi

    # Executa o comando
    echo -e "\n${YELLOW}🚀 Executando: $CMD${NC}"
    eval $CMD 2>&1 | grep -v "MallocStackLogging"

    local EXIT_CODE=${PIPESTATUS[0]}

    if [ $EXIT_CODE -eq 0 ]; then
        echo -e "\n${GREEN}✅ Automação executada com sucesso!${NC}"
    else
        echo -e "\n${RED}❌ Automação falhou com código: $EXIT_CODE${NC}"
        return $EXIT_CODE
    fi
}

# Função para validar argumentos
validate_args() {
    for arg in "$@"; do
        case "$arg" in
            all|bss|nh|rj|diagnose|configure|help|--help|-h|--headless|--silent|--debug|--test-sheets)
                # Argumento válido
                ;;
            *)
                echo -e "${RED}❌ Argumento inválido: $arg${NC}"
                echo -e "${YELLOW}Uso: $0 [all|bss|nh|rj|diagnose|configure|help|--test-sheets] [--headless|--silent|--debug]${NC}"
                exit 1
                ;;
        esac
    done
}

# Função principal
main() {
    # Se for help, mostra ajuda sem executar setup
    if [[ "$1" == "help" || "$1" == "--help" || "$1" == "-h" ]]; then
        show_help
        exit 0
    fi

    # Se for test-sheets, testa conexão Google Sheets
    if [[ "$1" == "--test-sheets" ]]; then
        show_header
        check_python
        setup_venv
        install_dependencies
        test_google_service_account
        exit 0
    fi

    show_header
    check_python
    setup_venv
    install_dependencies
    check_config

    # Se foram passados argumentos, executa diretamente
    if [ $# -gt 0 ]; then
        local HEADLESS_FLAG=""
        local ARGS=("$@")

        # Verifica se há flag --headless
        for arg in "${ARGS[@]}"; do
            if [ "$arg" = "--headless" ]; then
                HEADLESS_FLAG="true"
            fi
        done

        case "$1" in
            "all")
                run_automation "run" "" "$HEADLESS_FLAG"
                ;;
            "bss"|"nh"|"rj")
                run_automation "run" "$1" "$HEADLESS_FLAG"
                ;;
            "diagnose")
                run_automation "diagnose" "" "$HEADLESS_FLAG"
                ;;
            "configure")
                python main.py --configure
                ;;
            *)
                echo -e "${RED}❌ Argumento inválido: $1${NC}"
                echo -e "${YELLOW}Use '$0 help' para ver as opções disponíveis${NC}"
                exit 1
                ;;
        esac
    else
        # Modo interativo
        while true; do
            show_menu
            read -p "Escolha uma opção: " choice

            case $choice in
                1)
                    run_automation "run" "" ""
                    ;;
                2)
                    run_automation "run" "bss" ""
                    ;;
                3)
                    run_automation "run" "nh" ""
                    ;;
                4)
                    run_automation "run" "rj" ""
                    ;;
                5)
                    run_automation "diagnose" "" ""
                    ;;
                6)
                    python main.py --configure
                    ;;
                0)
                    echo -e "\n${GREEN}👋 Saindo...${NC}"
                    exit 0
                    ;;
                *)
                    echo -e "${RED}❌ Opção inválida${NC}"
                    ;;
            esac

            echo -e "\n${YELLOW}Pressione Enter para continuar...${NC}"
            read
        done
    fi
}

# Valida os argumentos antes de executar o script
validate_args "$@"
main "$@"
