#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[audit] Scanning for deprecated names/paths (best-effort)..."

fail=0

check_rg() {
  local label="$1"
  local pattern="$2"
  shift 2 || true
  local hits
  hits=$(rg -n "$pattern" . "$@" 2>/dev/null | head -n 50 || true)
  if [[ -n "$hits" ]]; then
    echo "[audit] WARN: ${label}"
    echo "$hits"
    fail=1
  fi
}

if ! command -v rg >/dev/null 2>&1; then
  echo "[audit] rg not found; skipping."
  exit 0
fi

# Legacy paths we intentionally removed.
check_rg "Found legacy backend paths (should be migrated)" "backend/(scraper|whatsapp|integrations)\\b" --glob '!.git/**' --glob '!backend/archive/**'
check_rg "Found deprecated automations location (use backend/apps/automations/*)" "backend/automations\\b" --glob '!.git/**' --glob '!backend/archive/**' --glob '!backend/scripts/audit-deprecations.sh'
check_rg "Found deprecated automations module name (use apps.automations.*)" "(^|[^A-Za-z0-9_.])automations\\." --glob '!.git/**' --glob '!backend/archive/**' --glob '!backend/scripts/audit-deprecations.sh'
# Config templates agora são canônicos em backend/config/templates; não alertamos por seu uso.
# Mantemos apenas a verificação para caminhos claramente incorretos (`config_templates` sem barra).
check_rg "Found deprecated config locations (use backend/config/templates/*)" "backend/config_templates\\b" --glob '!.git/**' --glob '!backend/archive/**' --glob '!backend/scripts/audit-deprecations.sh'

if [[ "$fail" -ne 0 ]]; then
  echo "[audit] DONE (warnings above)"
  exit 0
fi

echo "[audit] OK"
