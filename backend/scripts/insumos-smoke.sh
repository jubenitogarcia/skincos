#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${INSUMOS_SMOKE_BASE_URL:-http://127.0.0.1:8787}}"
WAIT_SECONDS="${INSUMOS_SMOKE_WAIT_SECONDS:-30}"

SMOKE_USER="${INSUMOS_SMOKE_USER:-}"
SMOKE_PASS="${INSUMOS_SMOKE_PASS:-}"

TMP_BODY="$(mktemp -t insumos-smoke-body.XXXXXX)"
TMP_COOKIES="$(mktemp -t insumos-smoke-cookies.XXXXXX)"
cleanup() {
  rm -f "$TMP_BODY" 2>/dev/null || true
  rm -f "$TMP_COOKIES" 2>/dev/null || true
}
trap cleanup EXIT

wait_for_server() {
  local deadline=$((SECONDS + WAIT_SECONDS))
  while (( SECONDS < deadline )); do
    if curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "[smoke] FAIL server not reachable after ${WAIT_SECONDS}s ($BASE_URL)" >&2
  return 1
}

req() {
  local path="$1"
  local url="$BASE_URL$path"
  echo "[smoke] GET $url"
  local status
  status="$(curl -sS -o "$TMP_BODY" -w "%{http_code}" "$url" || true)"
  if [[ "$status" != "200" ]]; then
    echo "[smoke] FAIL $path (status=$status)" >&2
    echo "[smoke] Body:" >&2
    cat "$TMP_BODY" >&2 || true
    exit 1
  fi
  cat "$TMP_BODY"
  echo
}

wait_for_server

req "/health"
req "/metrics"
req "/insumos/health"

if [[ -n "$SMOKE_USER" && -n "$SMOKE_PASS" ]]; then
  echo "[smoke] Auth smoke enabled"
  echo "[smoke] POST $BASE_URL/auth/login"
  status="$(curl -sS -o "$TMP_BODY" -w "%{http_code}" \
    -c "$TMP_COOKIES" \
    -b "$TMP_COOKIES" \
    -H "content-type: application/json" \
    -d "{\"username\":\"$SMOKE_USER\",\"password\":\"$SMOKE_PASS\"}" \
    "$BASE_URL/auth/login" || true)"
  if [[ "$status" != "200" ]]; then
    echo "[smoke] FAIL /auth/login (status=$status)" >&2
    echo "[smoke] Body:" >&2
    cat "$TMP_BODY" >&2 || true
    exit 1
  fi

  req "/auth/me"
  req "/insumos"
else
  echo "[smoke] SKIP auth smoke (set INSUMOS_SMOKE_USER and INSUMOS_SMOKE_PASS)"
fi

echo "[smoke] OK"
