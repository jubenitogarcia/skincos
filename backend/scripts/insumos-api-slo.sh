#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${INSUMOS_SLO_BASE_URL:-https://crm.skincos.com.br}"
USERNAME="${INSUMOS_SLO_USERNAME:-}"
PASSWORD="${INSUMOS_SLO_PASSWORD:-}"
UNIDADE="${INSUMOS_SLO_UNIDADE:-novo-hamburgo}"
TIMEOUT_SEC="${INSUMOS_SLO_TIMEOUT_SEC:-15}"
MAX_LATENCY_MS="${INSUMOS_SLO_MAX_LATENCY_MS:-1500}"

if [[ -z "${USERNAME}" || -z "${PASSWORD}" ]]; then
  echo "[insumos-slo] Missing credentials (INSUMOS_SLO_USERNAME / INSUMOS_SLO_PASSWORD)." >&2
  exit 2
fi

if [[ "${BASE_URL}" != http://* && "${BASE_URL}" != https://* ]]; then
  echo "[insumos-slo] Invalid INSUMOS_SLO_BASE_URL: ${BASE_URL}" >&2
  exit 2
fi

TMP_BODY="$(mktemp -t insumos-slo-body.XXXXXX)"
TMP_COOKIES="$(mktemp -t insumos-slo-cookies.XXXXXX)"
cleanup() {
  rm -f "$TMP_BODY" 2>/dev/null || true
  rm -f "$TMP_COOKIES" 2>/dev/null || true
}
trap cleanup EXIT

today_utc() {
  date -u +%F
}

days_ago_utc() {
  local days="$1"
  if date -u -d "${days} days ago" +%F >/dev/null 2>&1; then
    date -u -d "${days} days ago" +%F
    return 0
  fi
  if date -u -v-"${days}"d +%F >/dev/null 2>&1; then
    date -u -v-"${days}"d +%F
    return 0
  fi
  today_utc
}

TODAY="$(today_utc)"
FROM_30D="$(days_ago_utc 30)"

if [[ -n "${INSUMOS_SLO_ENDPOINTS:-}" ]]; then
  ENDPOINTS="${INSUMOS_SLO_ENDPOINTS}"
else
  ENDPOINTS="/api/insumos/health,\
/api/insumos/auth/me,\
/api/insumos/insumos?unidade=${UNIDADE}&pagina=1&limite=50,\
/api/insumos/movimentacoes?unidade=${UNIDADE}&pagina=1&limite=80,\
/api/insumos/analytics/overview?unidade=${UNIDADE}&de=${FROM_30D}&ate=${TODAY}&days=30&limitIssues=120,\
/api/insumos/analytics/insights?unidade=${UNIDADE}&groupBy=day&from=${FROM_30D}&to=${TODAY}&days=30"
fi

echo "[insumos-slo] BASE_URL=${BASE_URL}"
echo "[insumos-slo] UNIDADE=${UNIDADE}"
echo "[insumos-slo] TIMEOUT_SEC=${TIMEOUT_SEC} MAX_LATENCY_MS=${MAX_LATENCY_MS}"

login_status="$(curl -sS -o "$TMP_BODY" -w "%{http_code}" \
  -c "$TMP_COOKIES" \
  -b "$TMP_COOKIES" \
  --max-time "$TIMEOUT_SEC" \
  -H "accept: application/json" \
  -H "content-type: application/json" \
  -X POST \
  -d "{\"email\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}" \
  "${BASE_URL}/api/insumos/auth/login" || true)"

if [[ "${login_status}" != "200" ]]; then
  echo "[insumos-slo] FAIL /api/insumos/auth/login status=${login_status}" >&2
  cat "$TMP_BODY" >&2 || true
  exit 1
fi

failures=0
checks=0
IFS=',' read -ra paths <<< "$ENDPOINTS"
for raw in "${paths[@]}"; do
  path="$(echo "$raw" | xargs)"
  [[ -z "$path" ]] && continue
  checks=$((checks + 1))
  url="${BASE_URL}${path}"
  out="$(curl -sS -o "$TMP_BODY" -w "%{http_code} %{time_total}" \
    -b "$TMP_COOKIES" \
    -c "$TMP_COOKIES" \
    --max-time "$TIMEOUT_SEC" \
    -H "accept: application/json" \
    "$url" || true)"
  code="$(echo "$out" | awk '{print $1}')"
  time_s="$(echo "$out" | awk '{print $2}')"
  latency_ms="$(awk -v t="${time_s:-0}" 'BEGIN{printf "%.0f", t*1000}')"
  echo "[insumos-slo] path=${path} status=${code} latency_ms=${latency_ms}"

  if [[ -z "$code" || "$code" -lt 200 || "$code" -ge 300 ]]; then
    echo "[insumos-slo] ERROR status=${code} path=${path}" >&2
    cat "$TMP_BODY" >&2 || true
    failures=$((failures + 1))
    continue
  fi

  if [[ "$latency_ms" -gt "$MAX_LATENCY_MS" ]]; then
    echo "[insumos-slo] ERROR latency=${latency_ms}ms budget=${MAX_LATENCY_MS}ms path=${path}" >&2
    failures=$((failures + 1))
  fi
done

echo "[insumos-slo] checks=${checks} failures=${failures}"
if [[ "$failures" -gt 0 ]]; then
  exit 1
fi
