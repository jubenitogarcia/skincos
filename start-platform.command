#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

export OPEN_BROWSER=1

echo ""
echo "SKINCOS • Plataforma interna (local)"
echo "Iniciando CRM + WhatsApp + Actual + Agent Zero + Instagram…"
echo ""
echo "Se o browser não abrir automaticamente, acesse:"
echo "  http://localhost:5173/?module=capabilities"
echo ""

exec ./backend/scripts/dev.sh watch

