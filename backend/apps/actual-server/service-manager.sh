#!/bin/bash

# Script de gerenciamento do serviço Actual Budget via launchd
# Criado em 10 de outubro de 2025

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PLIST_FILE="$HOME/Library/LaunchAgents/com.actualbudget.server.plist"
SERVICE_NAME="com.actualbudget.server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"

show_menu() {
    clear
    echo -e "${BLUE}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║  Actual Budget - Gerenciamento de Serviço       ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}1)${NC} Instalar serviço (inicialização automática)"
    echo -e "${GREEN}2)${NC} Desinstalar serviço"
    echo -e "${GREEN}3)${NC} Iniciar serviço"
    echo -e "${GREEN}4)${NC} Parar serviço"
    echo -e "${GREEN}5)${NC} Reiniciar serviço"
    echo -e "${GREEN}6)${NC} Ver status do serviço"
    echo -e "${GREEN}7)${NC} Ver logs (stdout)"
    echo -e "${GREEN}8)${NC} Ver logs (stderr)"
    echo -e "${GREEN}9)${NC} Limpar logs"
    echo -e "${GREEN}10)${NC} Testar configuração"
    echo -e "${GREEN}11)${NC} Abrir no navegador"
    echo -e "${RED}0)${NC} Sair"
    echo ""
    echo -n "Escolha uma opção: "
}

check_service() {
    if launchctl list | grep -q "$SERVICE_NAME"; then
        return 0
    else
        return 1
    fi
}

install_service() {
    echo -e "${BLUE}Instalando serviço...${NC}"

    if [ ! -f "$PLIST_FILE" ]; then
        echo -e "${RED}✗ Arquivo $PLIST_FILE não encontrado!${NC}"
        return 1
    fi

    # Parar e descarregar se já estiver carregado
    if check_service; then
        echo -e "${YELLOW}⚠ Serviço já está instalado. Reinstalando...${NC}"
        launchctl unload "$PLIST_FILE" 2>/dev/null
    fi

    # Carregar o serviço
    launchctl load "$PLIST_FILE"

    sleep 2

    if check_service; then
        echo -e "${GREEN}✓ Serviço instalado com sucesso!${NC}"
        echo -e "${GREEN}✓ O Actual Budget agora iniciará automaticamente ao ligar o computador${NC}"
        echo ""
        echo -e "${BLUE}Para verificar o status:${NC}"
        echo -e "  launchctl list | grep actualbudget"
    else
        echo -e "${RED}✗ Erro ao instalar serviço${NC}"
    fi
}

uninstall_service() {
    echo -e "${BLUE}Desinstalando serviço...${NC}"

    if ! check_service; then
        echo -e "${YELLOW}⚠ Serviço não está instalado${NC}"
        return
    fi

    launchctl unload "$PLIST_FILE"

    sleep 2

    if ! check_service; then
        echo -e "${GREEN}✓ Serviço desinstalado com sucesso!${NC}"
        read -p "Deseja remover o arquivo plist? (s/N): " REMOVE
        if [ "$REMOVE" = "s" ] || [ "$REMOVE" = "S" ]; then
            rm "$PLIST_FILE"
            echo -e "${GREEN}✓ Arquivo plist removido${NC}"
        fi
    else
        echo -e "${RED}✗ Erro ao desinstalar serviço${NC}"
    fi
}

start_service() {
    echo -e "${BLUE}Iniciando serviço...${NC}"

    if ! check_service; then
        echo -e "${YELLOW}⚠ Serviço não está instalado. Instalando primeiro...${NC}"
        install_service
        return
    fi

    launchctl start "$SERVICE_NAME"
    sleep 2
    echo -e "${GREEN}✓ Serviço iniciado${NC}"
    check_status
}

stop_service() {
    echo -e "${BLUE}Parando serviço...${NC}"

    if ! check_service; then
        echo -e "${YELLOW}⚠ Serviço não está instalado${NC}"
        return
    fi

    launchctl stop "$SERVICE_NAME"
    sleep 2
    echo -e "${GREEN}✓ Serviço parado${NC}"
}

restart_service() {
    echo -e "${BLUE}Reiniciando serviço...${NC}"
    stop_service
    sleep 1
    start_service
}

check_status() {
    echo -e "${BLUE}Status do serviço:${NC}"
    echo ""

    if check_service; then
        echo -e "${GREEN}✓ Serviço está carregado no launchd${NC}"
        launchctl list | grep "$SERVICE_NAME"
    else
        echo -e "${RED}✗ Serviço não está carregado${NC}"
    fi

    echo ""
    echo -e "${BLUE}Verificando porta 5006:${NC}"
    if lsof -Pi :5006 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo -e "${GREEN}✓ Servidor está rodando na porta 5006${NC}"
        PID=$(lsof -Pi :5006 -sTCP:LISTEN -t)
        echo -e "  PID: $PID"
        echo -e "  URL: ${GREEN}http://localhost:5006${NC}"
    else
        echo -e "${RED}✗ Servidor não está respondendo na porta 5006${NC}"
    fi
}

view_logs() {
    local LOG_TYPE=$1
    local LOG_FILE=""

    if [ "$LOG_TYPE" = "stdout" ]; then
        LOG_FILE="$PROJECT_DIR/logs/actual-budget-stdout.log"
    else
        LOG_FILE="$PROJECT_DIR/logs/actual-budget-stderr.log"
    fi

    echo -e "${BLUE}Últimas 50 linhas do log ($LOG_TYPE):${NC}"
    echo ""

    if [ -f "$LOG_FILE" ]; then
        tail -n 50 "$LOG_FILE"
        echo ""
        echo -e "${BLUE}Caminho completo: $LOG_FILE${NC}"
    else
        echo -e "${YELLOW}⚠ Arquivo de log não encontrado: $LOG_FILE${NC}"
    fi
}

clear_logs() {
    echo -e "${BLUE}Limpando logs...${NC}"

    if [ -f "$PROJECT_DIR/logs/actual-budget-stdout.log" ]; then
        > "$PROJECT_DIR/logs/actual-budget-stdout.log"
        echo -e "${GREEN}✓ stdout.log limpo${NC}"
    fi

    if [ -f "$PROJECT_DIR/logs/actual-budget-stderr.log" ]; then
        > "$PROJECT_DIR/logs/actual-budget-stderr.log"
        echo -e "${GREEN}✓ stderr.log limpo${NC}"
    fi
}

test_config() {
    echo -e "${BLUE}Testando configuração...${NC}"
    echo ""

    echo -e "${BLUE}1. Verificando arquivo plist:${NC}"
    if [ -f "$PLIST_FILE" ]; then
        echo -e "   ${GREEN}✓${NC} Arquivo plist existe"

        # Validar XML
        if plutil -lint "$PLIST_FILE" > /dev/null 2>&1; then
            echo -e "   ${GREEN}✓${NC} XML válido"
        else
            echo -e "   ${RED}✗${NC} XML inválido"
            plutil -lint "$PLIST_FILE"
        fi
    else
        echo -e "   ${RED}✗${NC} Arquivo plist não encontrado"
    fi

    echo ""
    echo -e "${BLUE}2. Verificando diretório do projeto:${NC}"
    if [ -d "$PROJECT_DIR" ]; then
        echo -e "   ${GREEN}✓${NC} Diretório existe"
    else
        echo -e "   ${RED}✗${NC} Diretório não encontrado"
    fi

    echo ""
    echo -e "${BLUE}3. Verificando yarn:${NC}"
    if command -v yarn &> /dev/null; then
        echo -e "   ${GREEN}✓${NC} Yarn instalado: $(which yarn)"
    else
        echo -e "   ${RED}✗${NC} Yarn não encontrado"
    fi

    echo ""
    echo -e "${BLUE}4. Verificando Node.js:${NC}"
    if command -v node &> /dev/null; then
        echo -e "   ${GREEN}✓${NC} Node.js instalado: $(node --version)"
    else
        echo -e "   ${RED}✗${NC} Node.js não encontrado"
    fi

    echo ""
    echo -e "${BLUE}5. Verificando diretório de logs:${NC}"
    if [ -d "$PROJECT_DIR/logs" ]; then
        echo -e "   ${GREEN}✓${NC} Diretório de logs existe"
    else
        echo -e "   ${YELLOW}⚠${NC} Diretório de logs não existe, criando..."
        mkdir -p "$PROJECT_DIR/logs"
    fi
}

open_browser() {
    echo -e "${BLUE}Abrindo navegador...${NC}"
    open "http://localhost:5006"
}

# Loop principal
while true; do
    show_menu
    read OPTION

    case $OPTION in
        1) install_service; read -p "Pressione ENTER para continuar..." ;;
        2) uninstall_service; read -p "Pressione ENTER para continuar..." ;;
        3) start_service; read -p "Pressione ENTER para continuar..." ;;
        4) stop_service; read -p "Pressione ENTER para continuar..." ;;
        5) restart_service; read -p "Pressione ENTER para continuar..." ;;
        6) check_status; read -p "Pressione ENTER para continuar..." ;;
        7) view_logs "stdout"; read -p "Pressione ENTER para continuar..." ;;
        8) view_logs "stderr"; read -p "Pressione ENTER para continuar..." ;;
        9) clear_logs; read -p "Pressione ENTER para continuar..." ;;
        10) test_config; read -p "Pressione ENTER para continuar..." ;;
        11) open_browser; sleep 1 ;;
        0)
            echo -e "${BLUE}Até logo!${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}Opção inválida!${NC}"
            sleep 1
            ;;
    esac
done
