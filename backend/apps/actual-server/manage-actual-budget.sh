#!/bin/bash

# Script de gerenciamento do Actual Budget
# Criado em 10 de outubro de 2025

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"

show_menu() {
    clear
    echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║    Actual Budget - Menu de Controle      ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}1)${NC} Iniciar servidor"
    echo -e "${GREEN}2)${NC} Parar servidor"
    echo -e "${GREEN}3)${NC} Verificar status"
    echo -e "${GREEN}4)${NC} Ver logs"
    echo -e "${GREEN}5)${NC} Resetar senha"
    echo -e "${GREEN}6)${NC} Backup de dados"
    echo -e "${GREEN}7)${NC} Restaurar backup"
    echo -e "${GREEN}8)${NC} Atualizar para última versão"
    echo -e "${GREEN}9)${NC} Abrir no navegador"
    echo -e "${RED}0)${NC} Sair"
    echo ""
    echo -n "Escolha uma opção: "
}

check_status() {
    if lsof -Pi :5006 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo -e "${GREEN}✓ Servidor está rodando na porta 5006${NC}"
        PID=$(lsof -Pi :5006 -sTCP:LISTEN -t)
        echo -e "  PID: $PID"
        return 0
    else
        echo -e "${RED}✗ Servidor não está rodando${NC}"
        return 1
    fi
}

start_server() {
    echo -e "${BLUE}Iniciando servidor...${NC}"
    cd "$PROJECT_DIR"

    if check_status; then
        echo -e "${YELLOW}⚠ Servidor já está rodando!${NC}"
        return
    fi

    nohup yarn start > actual-budget.log 2>&1 &
    sleep 3

    if check_status; then
        echo -e "${GREEN}✓ Servidor iniciado com sucesso!${NC}"
        echo -e "${BLUE}Acesse: ${GREEN}http://localhost:5006${NC}"
    else
        echo -e "${RED}✗ Erro ao iniciar servidor. Verifique os logs.${NC}"
    fi
}

stop_server() {
    echo -e "${BLUE}Parando servidor...${NC}"

    if ! check_status; then
        echo -e "${YELLOW}⚠ Servidor não está rodando${NC}"
        return
    fi

    PID=$(lsof -Pi :5006 -sTCP:LISTEN -t)
    kill $PID 2>/dev/null
    sleep 2

    if ! check_status; then
        echo -e "${GREEN}✓ Servidor parado com sucesso!${NC}"
    else
        echo -e "${RED}✗ Erro ao parar servidor. Tentando forçar...${NC}"
        kill -9 $PID 2>/dev/null
    fi
}

view_logs() {
    echo -e "${BLUE}Últimas 50 linhas do log:${NC}"
    echo ""
    if [ -f "$PROJECT_DIR/actual-budget.log" ]; then
        tail -n 50 "$PROJECT_DIR/actual-budget.log"
    else
        echo -e "${YELLOW}Nenhum arquivo de log encontrado${NC}"
    fi
    echo ""
    read -p "Pressione ENTER para continuar..."
}

reset_password() {
    echo -e "${BLUE}Resetando senha...${NC}"
    cd "$PROJECT_DIR"
    yarn reset-password
    read -p "Pressione ENTER para continuar..."
}

backup_data() {
    echo -e "${BLUE}Criando backup...${NC}"
    BACKUP_DIR="$HOME/Automation/actual-backups"
    mkdir -p "$BACKUP_DIR"

    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    BACKUP_FILE="$BACKUP_DIR/actual-backup-$TIMESTAMP.tar.gz"

    cd "$PROJECT_DIR"
    if [ -d "server-files" ]; then
        tar -czf "$BACKUP_FILE" server-files/
        echo -e "${GREEN}✓ Backup criado: $BACKUP_FILE${NC}"
    else
        echo -e "${RED}✗ Diretório server-files não encontrado${NC}"
    fi
    read -p "Pressione ENTER para continuar..."
}

restore_backup() {
    echo -e "${BLUE}Restaurar backup${NC}"
    BACKUP_DIR="$HOME/Automation/actual-backups"

    if [ ! -d "$BACKUP_DIR" ]; then
        echo -e "${RED}✗ Nenhum backup encontrado${NC}"
        read -p "Pressione ENTER para continuar..."
        return
    fi

    echo "Backups disponíveis:"
    ls -1 "$BACKUP_DIR"/*.tar.gz 2>/dev/null | cat -n
    echo ""
    read -p "Digite o nome completo do arquivo de backup: " BACKUP_FILE

    if [ -f "$BACKUP_DIR/$BACKUP_FILE" ]; then
        echo -e "${YELLOW}⚠ ATENÇÃO: Isso irá substituir os dados atuais!${NC}"
        read -p "Tem certeza? (s/N): " CONFIRM
        if [ "$CONFIRM" = "s" ] || [ "$CONFIRM" = "S" ]; then
            cd "$PROJECT_DIR"
            rm -rf server-files
            tar -xzf "$BACKUP_DIR/$BACKUP_FILE"
            echo -e "${GREEN}✓ Backup restaurado com sucesso!${NC}"
        else
            echo -e "${YELLOW}Operação cancelada${NC}"
        fi
    else
        echo -e "${RED}✗ Arquivo de backup não encontrado${NC}"
    fi
    read -p "Pressione ENTER para continuar..."
}

update_version() {
    echo -e "${BLUE}Atualizando para última versão...${NC}"
    cd "$PROJECT_DIR"

    if check_status; then
        echo -e "${YELLOW}⚠ Parando servidor antes de atualizar...${NC}"
        stop_server
        sleep 2
    fi

    git pull origin master
    yarn install

    echo -e "${GREEN}✓ Atualização concluída!${NC}"
    read -p "Deseja iniciar o servidor agora? (S/n): " START
    if [ "$START" != "n" ] && [ "$START" != "N" ]; then
        start_server
    fi
    read -p "Pressione ENTER para continuar..."
}

open_browser() {
    echo -e "${BLUE}Abrindo navegador...${NC}"
    open "http://localhost:5006"
    sleep 1
}

# Loop principal
while true; do
    show_menu
    read OPTION

    case $OPTION in
        1) start_server; sleep 2 ;;
        2) stop_server; sleep 2 ;;
        3) check_status; read -p "Pressione ENTER para continuar..." ;;
        4) view_logs ;;
        5) reset_password ;;
        6) backup_data ;;
        7) restore_backup ;;
        8) update_version ;;
        9) open_browser ;;
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
