#!/bin/bash
set -euo pipefail

# Script para iniciar o Evolution API
# Carrega as variáveis de ambiente e inicia o serviço

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVOLUTION_API_DIR="${EVOLUTION_API_DIR:-$SCRIPT_DIR}"
cd "$EVOLUTION_API_DIR"

# Node dedicado para o evolution-api (Node 20 via nvm)
NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

if command -v nvm >/dev/null 2>&1; then
  nvm use 20 >/dev/null 2>&1 || nvm install 20 --lts
fi

echo "Usando Node: $(node -v 2>/dev/null || echo 'node não encontrado')"

# Verifica se o arquivo .env existe
if [ ! -f .env ]; then
    echo "Erro: Arquivo .env não encontrado!"
    exit 1
fi

# Carrega as variáveis de ambiente do arquivo .env
set -a
# shellcheck disable=SC1091
source .env
set +a

# Verifica se as dependências estão instaladas
if [ ! -d "node_modules" ]; then
    echo "Instalando dependências do evolution-api..."
    npm install
fi

# Garante que o build exista
if [ ! -d "dist" ]; then
    echo "Construindo projeto evolution-api (npm run build)..."
    npm run build
fi

# Inicia o Evolution API em modo produção
echo "Iniciando Evolution API com Node $(node -v)..."
npm run start:prod
