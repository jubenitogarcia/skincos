#!/usr/bin/env bash
set -euo pipefail

# Smoke test for production routing:
# - Cloudflare Pages (crm.skincos.com.br) same-origin proxy (/api/insumos/*)
# - Cloudflare Worker (api.skincos.com.br/insumos/*)
#
# Usage:
#   ./backend/scripts/crm-smoke.sh
#   CRM_SMOKE_URL=https://crm.skincos.com.br API_SMOKE_URL=https://api.skincos.com.br ./backend/scripts/crm-smoke.sh

CRM_URL="${1:-${CRM_SMOKE_URL:-https://crm.skincos.com.br}}"
API_URL="${2:-${API_SMOKE_URL:-https://api.skincos.com.br}}"

TMP_BODY="$(mktemp -t crm-smoke-body.XXXXXX)"
cleanup() { rm -f "$TMP_BODY" 2>/dev/null || true; }
trap cleanup EXIT

req200_json() {
  local url="$1"
  echo "[crm-smoke] GET $url"
  local status
  status="$(curl -sS -o "$TMP_BODY" -w "%{http_code}" -H "accept: application/json" "$url" || true)"
  if [[ "$status" != "200" ]]; then
    echo "[crm-smoke] FAIL (status=$status): $url" >&2
    echo "[crm-smoke] Body:" >&2
    cat "$TMP_BODY" >&2 || true
    exit 1
  fi
  if ! head -c 1 "$TMP_BODY" | grep -q '{'; then
    echo "[crm-smoke] FAIL (not JSON): $url" >&2
    cat "$TMP_BODY" >&2 || true
    exit 1
  fi
}

echo "[crm-smoke] CRM_URL=$CRM_URL"
echo "[crm-smoke] API_URL=$API_URL"

# Pages function sanity
req200_json "$CRM_URL/api/health"

# Same-origin proxy sanity
req200_json "$CRM_URL/api/insumos/health"

# Worker direct sanity
req200_json "$API_URL/insumos/health"

echo "[crm-smoke] OK"

