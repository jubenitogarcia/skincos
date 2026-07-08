#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBSITE_DIR="$ROOT_DIR/modules/site-public/website"

SYNC_ONLY="${SYNC_ONLY:-0}"
RUN_TYPECHECK="${RUN_TYPECHECK:-0}"

cd "$ROOT_DIR"

if [ ! -d "$WEBSITE_DIR/node_modules" ]; then
  echo "Instalando dependencias do website..."
  npm --prefix "$WEBSITE_DIR" ci
fi

echo "Atualizando snapshot online do site..."
npm run website:sync:online

if [ "$RUN_TYPECHECK" = "1" ]; then
  echo "Executando typecheck do website..."
  npm --prefix "$WEBSITE_DIR" run typecheck
fi

if [ "$SYNC_ONLY" = "1" ]; then
  echo "Snapshot atualizado."
  exit 0
fi

echo "Snapshot atualizado. Se quiser validar localmente:"
echo "  npm run website:local"
