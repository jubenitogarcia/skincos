#!/bin/bash
set -euo pipefail

# Script para iniciar o Evolution API.
# Carrega as variaveis de ambiente e inicia o servico.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Node dedicado para o evolution-api (Node 20 via nvm)
NVM_DIR="$HOME/.nvm"
NODE20_BIN="${NODE20_BIN:-$HOME/.nvm/versions/node/v20.19.5/bin}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

if [ -x "$NODE20_BIN/node" ]; then
  export PATH="$NODE20_BIN:$PATH"
elif command -v nvm >/dev/null 2>&1; then
  nvm use 20 >/dev/null 2>&1 || nvm install 20 --lts >/dev/null 2>&1
fi

echo "Usando Node: $(node -v 2>/dev/null || echo 'node não encontrado')"

# Permite overlay privado fora do clone compartilhado.
ENV_FILE="${EVOLUTION_API_ENV_FILE:-.env}"

# Verifica se o arquivo .env existe
if [ ! -f "$ENV_FILE" ]; then
    echo "Erro: Arquivo de ambiente não encontrado em $ENV_FILE"
    exit 1
fi

# Carrega as variáveis de ambiente do arquivo .env
set -a
source "$ENV_FILE"
set +a

# Reduz ruído de logs para operação contínua local.
export LOG_LEVEL="ERROR,WARN"
export LOG_COLOR="false"

# Verifica se as dependências estão instaladas
if [ ! -d "node_modules" ]; then
    echo "Instalando dependências do evolution-api..."
    npm install
fi

# Gera Prisma Client para garantir tipos/client após reinstalação
if [ ! -d "node_modules/.prisma/client" ] || [ ! -d "node_modules/@prisma/client" ]; then
    echo "Gerando Prisma Client (npm run db:generate)..."
    npm run db:generate || true
fi

# Garante que o build reflita overrides recentes de runtime.
# Se o build completo falhar por typecheck, faz fallback com tsup para manter o serviço operacional.
NEEDS_BUILD=0
if [ ! -f "dist/main.js" ]; then
    NEEDS_BUILD=1
elif [ -f "src/config/path.config.ts" ] && [ "src/config/path.config.ts" -nt "dist/main.js" ]; then
    NEEDS_BUILD=1
fi

if [ "$NEEDS_BUILD" -eq 1 ]; then
    echo "Construindo projeto evolution-api (npm run build)..."
    if ! npm run build; then
        echo "Build completo falhou; tentando fallback com tsup..."
        npm run db:generate || true
        npx tsup
    fi
fi

# Inicia o Evolution API em modo produção
echo "Iniciando Evolution API com Node $(node -v)..."
npm run start:prod
