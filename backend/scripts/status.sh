#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh" || true

check_port() {
  local port="$1"
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "LISTEN :$port"
  else
    echo "DOWN   :$port"
  fi
}

check_http() {
  local url="$1"
  local label="$2"
  if curl -sf --max-time 1 "$url" >/dev/null 2>&1; then
    echo "OK     $label $url"
  else
    echo "FAIL   $label $url"
  fi
}

echo "[status] Ports"
check_port "${CRM_PORT:-5173}"
check_port "${CRM_API_PORT:-8099}"

INSTANCES_CSV="${INSTANCES:-1}"
IFS=',' read -r -a WA_INSTANCES <<<"$INSTANCES_CSV"
for inst in "${WA_INSTANCES[@]}"; do
  if [[ -n "${inst:-}" ]] && [[ "$inst" =~ ^[0-9]+$ ]]; then
    check_port $((3000 + inst))
  fi
done
check_port "${ACTUAL_PORT:-5006}"
check_port "${SALES_CHART_MESSENGER_PORT:-3200}"
check_port "${AGENT_ZERO_PORT:-${WEB_UI_PORT:-50001}}"
check_port "${INSTAGRAM_PORT:-3103}"
check_port "${META_ADS_API_PORT:-4000}"

echo ""
echo "[status] Health (best-effort)"
check_http "http://localhost:${CRM_API_PORT:-8099}/api/health" "CRM-API"
check_http "http://localhost:${CRM_PORT:-5173}" "CRM-FE"
for inst in "${WA_INSTANCES[@]}"; do
  if [[ -n "${inst:-}" ]] && [[ "$inst" =~ ^[0-9]+$ ]]; then
    check_http "http://localhost:$((3000 + inst))/health" "WA[$inst]"
  fi
done
check_http "http://localhost:${ACTUAL_PORT:-5006}" "ACTUAL"
check_http "http://localhost:${AGENT_ZERO_PORT:-${WEB_UI_PORT:-50001}}/agent-zero/debug/ping" "AGENT-ZERO"
check_http "http://localhost:${INSTAGRAM_PORT:-3103}/health" "INSTAGRAM"
if [[ -x "$ROOT_DIR/backend/config/templates/modules/meta-ads/healthcheck.sh" ]]; then
  if "$ROOT_DIR/backend/config/templates/modules/meta-ads/healthcheck.sh" >/dev/null 2>&1; then
    echo "OK     META-ADS (healthcheck.sh)"
  else
    echo "FAIL   META-ADS (healthcheck.sh)"
  fi
else
  check_http "http://localhost:${META_ADS_API_PORT:-4000}/api/health" "META-ADS"
fi

echo ""
echo "[status] Tips"
echo "- Start stack: ./backend/scripts/dev.sh restart"
echo "- Start WhatsApp official: ./backend/scripts/dev.sh official --instance 1"
echo "- Actual Server sobe junto com a stack; manual: ./backend/scripts/dev.sh actual-server start"
