#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Cloudflare audit (skincos)

Checks (best-effort):
  - Workers scripts exist: skincos-api, skincos-insumos
  - Zone routes point to those scripts
  - Pages project build filters: path_includes=["frontend/**"]

Required env:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID

Optional env:
  CLOUDFLARE_ZONE_NAME (default: skincos.com.br)
  CLOUDFLARE_PAGES_PROJECT (default: skincos)

Example:
  CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... backend/scripts/cloudflare-audit.sh
EOF
}

token="${CLOUDFLARE_API_TOKEN:-}"
account="${CLOUDFLARE_ACCOUNT_ID:-}"
zone_name="${CLOUDFLARE_ZONE_NAME:-skincos.com.br}"
pages_project="${CLOUDFLARE_PAGES_PROJECT:-skincos}"

if [[ -z "$token" || -z "$account" ]]; then
  echo "[cloudflare-audit] Missing CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID" >&2
  usage >&2
  exit 2
fi

cf_get_json() {
  local url="$1"
  curl -fsS -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" "$url"
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "[cloudflare-audit] jq is required" >&2
    exit 2
  fi
}

require_jq

fail=0

echo "[cloudflare-audit] Checking Workers scripts..."
scripts="$(cf_get_json "https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts" | jq -r '.result[].id')"
for s in skincos-api skincos-insumos; do
  if ! echo "$scripts" | rg -q "^${s}$"; then
    echo "[cloudflare-audit] FAIL: missing worker script: $s" >&2
    fail=1
  else
    echo "[cloudflare-audit] OK: worker script exists: $s"
  fi
done

echo "[cloudflare-audit] Checking Zone routes..."
zone_id="$(cf_get_json "https://api.cloudflare.com/client/v4/zones?name=${zone_name}" | jq -r '.result[0].id // empty')"
if [[ -z "$zone_id" ]]; then
  echo "[cloudflare-audit] FAIL: zone not found: ${zone_name}" >&2
  fail=1
else
  routes="$(cf_get_json "https://api.cloudflare.com/client/v4/zones/${zone_id}/workers/routes" | jq -r '.result[] | "\(.pattern) -> \(.script)"')"
  echo "$routes"
  echo "$routes" | rg -q '^api\.skincos\.com\.br/\* -> skincos-api$' || { echo "[cloudflare-audit] FAIL: missing route api.skincos.com.br/* -> skincos-api" >&2; fail=1; }
  echo "$routes" | rg -q '^api\.skincos\.com\.br/insumos/\* -> skincos-insumos$' || { echo "[cloudflare-audit] FAIL: missing route api.skincos.com.br/insumos/* -> skincos-insumos" >&2; fail=1; }
fi

echo "[cloudflare-audit] Checking Pages build filters..."
pi="$(cf_get_json "https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${pages_project}" | jq -r '.result.source.config.path_includes[]?' || true)"
if [[ "$pi" != "frontend/**" ]]; then
  echo "[cloudflare-audit] FAIL: Pages path_includes is not frontend/** (got: ${pi:-<empty>})" >&2
  fail=1
else
  echo "[cloudflare-audit] OK: Pages path_includes=frontend/**"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "[cloudflare-audit] Result: FAIL" >&2
  exit 1
fi
echo "[cloudflare-audit] Result: OK"

