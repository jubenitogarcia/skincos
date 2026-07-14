#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PATTERN='Codex|Chrome|Chromium|playwright|xcodebuildmcp|SkyComputerUse|vite|wrangler|crm-api|crm/api|npm run crm:local'
PORTS=(${CODEX_CRM_MEMORY_PORTS:-5173 5174 8100 8791 8787})

echo "Skincos Codex/CRM memory diagnostics"
echo "CWD: $ROOT_DIR"
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

echo "Environment signals:"
printf '  CODEX_SHELL=%s\n' "${CODEX_SHELL:-}"
printf '  CODEX_CI=%s\n' "${CODEX_CI:-}"
printf '  CODEX_INTERNAL_ORIGINATOR_OVERRIDE=%s\n' "${CODEX_INTERNAL_ORIGINATOR_OVERRIDE:-}"
printf '  TERM=%s\n' "${TERM:-}"
echo ""

echo "Relevant processes by RSS:"
ps -axo pid,ppid,%mem,rss,comm,args \
  | grep -Ei "$PATTERN" \
  | grep -Ev 'grep -Ei|codex-memory-crm\.sh' \
  | sort -k4 -nr \
  || true
echo ""

if command -v lsof >/dev/null 2>&1; then
  echo "Local listeners:"
  for port in "${PORTS[@]}"; do
    echo "  :$port"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | sed 's/^/    /' || true
  done
else
  echo "lsof not available; skipping local listeners."
fi
echo ""

echo "Notes:"
echo "  - This command is read-only and does not stop Codex MCP processes."
echo "  - Prefer launcher --stop for CRM/Vite processes started by this repo."
echo "  - Restart Codex App to clean stale MCP/browser-helper processes when needed."
