#!/bin/bash

# Script para iniciar o Actual Budget Server
# Criado em 10 de outubro de 2025

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Iniciando Actual Budget Server${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Diretório do projeto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
cd "$PROJECT_DIR"

# Verificar se o Node.js está instalado
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js não está instalado!${NC}"
    echo "Por favor, instale o Node.js versão 18 ou superior."
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js $(node --version) detectado"

# Verificar se as dependências estão instaladas
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}📦 Instalando dependências...${NC}"
    yarn install
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Erro ao instalar dependências!${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✓${NC} Dependências verificadas"

# Criar diretório de dados se não existir
if [ ! -d "server-files" ]; then
    mkdir -p server-files
    echo -e "${GREEN}✓${NC} Diretório de dados criado: server-files/"
fi

# Configurar variáveis de ambiente (se necessário)
export NODE_ENV=production
export ACTUAL_PORT=${ACTUAL_PORT:-5006}
export ACTUAL_HOSTNAME=${ACTUAL_HOSTNAME:-0.0.0.0}
export ACTUAL_SERVER_FILES=${ACTUAL_SERVER_FILES:-./server-files}

echo ""
echo -e "${BLUE}📋 Configurações:${NC}"
echo -e "   Porta: ${GREEN}$ACTUAL_PORT${NC}"
echo -e "   Host: ${GREEN}$ACTUAL_HOSTNAME${NC}"
echo -e "   Arquivos: ${GREEN}$ACTUAL_SERVER_FILES${NC}"
echo ""
echo -e "${BLUE}🚀 Iniciando servidor...${NC}"
echo -e "${BLUE}   Acesse em: ${GREEN}http://localhost:$ACTUAL_PORT${NC}"
echo ""
echo -e "${BLUE}   Para parar o servidor, pressione ${RED}Ctrl+C${NC}"
echo ""

# Executar migrações do banco de dados
echo -e "${BLUE}🔄 Executando migrações do banco de dados...${NC}"
yarn db:migrate

# Iniciar o servidor
yarn start
