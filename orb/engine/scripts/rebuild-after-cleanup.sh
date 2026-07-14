#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/runtime-paths.sh"

ROOT_DIR="$N8N_ROOT"
EVO_DIR="$ROOT_DIR/evolution-api"

cd "$ROOT_DIR"

echo "[1/4] Instalando dependências do projeto raiz..."
npm ci

echo "[2/4] Instalando dependências do evolution-api..."
cd "$EVO_DIR"
npm ci

echo "[3/4] Gerando Prisma Client e build do evolution-api..."
set +e
npm run db:generate
npm run build
BUILD_EXIT=$?
set -e
if [ "$BUILD_EXIT" -ne 0 ]; then
  echo "Build completo falhou, aplicando fallback com tsup..."
  npx tsup
fi

echo "[4/4] Rebuild concluído."
echo "Para subir serviços:"
echo "  $N8N_ROOT/start-n8n.sh restart"
