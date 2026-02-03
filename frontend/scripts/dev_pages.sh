#!/usr/bin/env bash
set -euo pipefail

# Dev local para Pages Functions (Social/Instagram/Share) + Vite (HMR).
# Uso:
#   ./scripts/dev_pages.sh
# Variáveis opcionais:
#   VITE_PORT=5173 PAGES_PORT=8788 R2_PERSIST_DIR=.wrangler

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VITE_PORT="${VITE_PORT:-5173}"
PAGES_PORT="${PAGES_PORT:-8788}"
R2_PERSIST_DIR="${R2_PERSIST_DIR:-.wrangler}"

cd "$ROOT_DIR"

echo "[dev_pages] Iniciando Vite em :$VITE_PORT"
npm run dev -- --host 127.0.0.1 --port "$VITE_PORT" &
VITE_PID=$!

cleanup() {
  if [[ -n "${VITE_PID:-}" ]]; then
    kill "$VITE_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "[dev_pages] Iniciando Pages Functions (proxy :$VITE_PORT) em :$PAGES_PORT"
npx --yes wrangler@3 pages dev --proxy "$VITE_PORT" --port "$PAGES_PORT" --compatibility-date 2026-01-13 --r2-persist "$R2_PERSIST_DIR"
