#!/usr/bin/env bash
set -euo pipefail

# Unified E2E entry-point
# Commands:
#   smoke      - start real gateway instances (default 1,2) and run basic checks
#   ci-smoke   - start mock servers on 3001/3002 and assert basic JSON shapes
#   unit-monitor-ci - start crm-api in gateway mode and assert hardening behavior
#   health     - repository health checks (non-failing)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"
. "$ROOT_DIR/backend/scripts/node_pkg.sh"
OFFICIAL_DIR="$ROOT_DIR/backend/apps/whatsapp/official-module"
MOCK_DIR="$ROOT_DIR/backend/apps/whatsapp/gateway"
MOCK="$MOCK_DIR/simple-mock-api.js"

cmd=${1:-help}
shift || true

log() { echo "[e2e] $*"; }

PID_DIR="$VAR_DIR/pids/e2e"
mkdir -p "$PID_DIR" >/dev/null 2>&1 || true

have_jq() { command -v jq >/dev/null 2>&1; }

assert_json_object() {
  local payload="$1"
  if have_jq; then
    echo "$payload" | jq -e 'type=="object"' >/dev/null
  else
    # Best-effort check without jq
    [[ "$payload" =~ ^\{.*\}$ ]]
  fi
}

assert_condition() {
  local expr="$1"; shift
  if ! eval "$expr"; then
    echo "Assertion failed: $*" >&2
    return 1
  fi
}

start_instance() {
  local inst=$1
  local port=$((3000 + inst))
  # Prefer official module
  if [[ -d "$OFFICIAL_DIR" ]]; then
    (
      cd "$OFFICIAL_DIR"
      if [[ ! -d node_modules ]]; then install_node_deps "$OFFICIAL_DIR" install >/dev/null 2>&1 || true; fi
      # Start once via node if not already up
      if ! curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then
        PORT="$port" NO_AUTH=true NODE_ENV=development node official-whatsapp.js >/dev/null 2>&1 &
        echo $! > "$PID_DIR/wa_official_${inst}.pid"
      fi
    )
  else
    # Fallback stub
    (
      cd "$ROOT_DIR/backend/apps/whatsapp/stub"
      PORT="$port" ACCOUNT_ID="$port" node bot_com_api.js >/dev/null 2>&1 &
      echo $! > "$PID_DIR/wa_stub_${inst}.pid"
    )
  fi
  for _ in {1..30}; do
    if curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then
      log "instance $inst UP on :${port}"; return 0
    fi
    sleep 0.3
  done
  echo "[e2e] instance $inst FAILED" >&2; return 1
}

start_mocks() {
  log "CI mock: starting mock servers on 3001 and 3002"
  mkdir -p "$MOCK_DIR" 2>/dev/null || true
  (PORT=3001 node "$MOCK" >/dev/null 2>&1 & echo $! > "$PID_DIR/mock_3001.pid")
  (PORT=3002 node "$MOCK" >/dev/null 2>&1 & echo $! > "$PID_DIR/mock_3002.pid")
  for _ in {1..30}; do
    if curl -sf "http://localhost:3001/health" >/dev/null 2>&1 && curl -sf "http://localhost:3002/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

start_crm_api_gateway() {
  local port="${1:-8099}"
  local token="${2:-testtoken}"
  local var_dir="${3:-}"
  local out="${PID_DIR}/crm_api_gateway_${port}.out"
  local pidfile="${PID_DIR}/crm_api_gateway_${port}.pid"

  if curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then
    return 0
  fi

  log "Unit Monitor CI: starting crm-api gateway on :${port}"
  (
    cd "$ROOT_DIR"
    if [[ -n "${var_dir:-}" ]]; then
      export VAR_DIR="$var_dir"
    fi
    PORT="$port" \
    CRM_API_PORT="$port" \
    SKINCOS_GATEWAY=1 \
    CRM_UNIT_MONITOR_PROXY_TOKEN="$token" \
    node backend/apps/crm-api/server.js >"$out" 2>&1 &
    echo $! >"$pidfile"
  )

  for _ in {1..60}; do
    if curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done

  echo "[e2e] crm-api gateway FAILED to become healthy on :${port}" >&2
  tail -n 60 "$out" 2>/dev/null || true
  return 1
}

stop_crm_api_gateway() {
  local port="${1:-8099}"
  local pidfile="${PID_DIR}/crm_api_gateway_${port}.pid"
  if [[ ! -f "$pidfile" ]]; then return 0; fi
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  rm -f "$pidfile" >/dev/null 2>&1 || true
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill "$pid" 2>/dev/null || true
  for _ in {1..20}; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.2
  done
  kill -9 "$pid" 2>/dev/null || true
  return 0
}

unit_monitor_ci() {
  local port=8099
  local token="testtoken"
  local var_dir
  var_dir="$(mktemp -d 2>/dev/null || true)"
  trap "stop_crm_api_gateway \"$port\"; [[ -n \"${var_dir:-}\" ]] && rm -rf \"$var_dir\" >/dev/null 2>&1 || true" EXIT

  start_crm_api_gateway "$port" "$token" "$var_dir"

  # 1) /api/unit-monitor requires auth headers in gateway mode
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${port}/api/unit-monitor/health" || true)"
  assert_condition "[[ \"$code\" == \"401\" ]]" "expected 401 without headers (got $code)"

  # 2) /api/health is NOT exposed in gateway mode (fail-closed)
  code="$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${port}/api/health" || true)"
  assert_condition "[[ \"$code\" == \"404\" ]]" "expected 404 for /api/health in gateway mode (got $code)"

  # 3) Valid signed actor headers allow access
  local hdrs
  hdrs="$(TOKEN="$token" node - <<'NODE'
const { createHmac } = require('node:crypto')
const token = process.env.TOKEN || ''
const actor = { id: 'e2e', email: 'e2e@local', name: 'E2E' }
const actorB64 = Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url')
const ts = String(Date.now())
const sig = createHmac('sha256', token).update(`${ts}.${actorB64}`).digest('base64url')
process.stdout.write(
  [
    `-H`, `x-unit-monitor-proxy-token: ${token}`,
    `-H`, `x-skincos-actor: ${actorB64}`,
    `-H`, `x-skincos-actor-ts: ${ts}`,
    `-H`, `x-skincos-actor-sig: ${sig}`,
  ].join('\n')
)
NODE
)"
  # Convert newline-separated args into an array (bash 3 compatible).
  hdr_arr=()
  while IFS= read -r line; do
    [[ -z "${line:-}" ]] && continue
    hdr_arr+=("$line")
  done <<EOF
$hdrs
EOF
  body="$(curl -fsS "${hdr_arr[@]}" "http://localhost:${port}/api/unit-monitor/health" || true)"
  if have_jq; then
    echo "$body" | jq -e '.ok==true' >/dev/null
  else
    assert_condition "[[ \"$body\" == *'\"ok\":true'* ]]" "expected ok response for signed request"
  fi
  log "unit-monitor-ci PASS"
}

cleanup_mocks() {
  for p in "$PID_DIR/mock_3001.pid" "$PID_DIR/mock_3002.pid"; do
    if [[ -f "$p" ]]; then
      pid="$(cat "$p")"
      if [[ "$pid" =~ ^[0-9]+$ ]]; then
        if kill -0 "$pid" 2>/dev/null; then
          kill "$pid" 2>/dev/null || true
        fi
      else
        log "Warning: PID file $p contains invalid PID: '$pid'"
      fi
      rm -f "$p"
    fi
  done
}

smoke_checks() {
  local ports=("$@")
  # Unread counts endpoint
  for port in "${ports[@]}"; do
    curl -sf "http://localhost:${port}/v1/chats/unread-counts" | head -c 400 && echo || true
  done
  # Unified search quick check (empty query)
  local resp
  resp=$(curl -sf "http://localhost:${ports[0]}/v1/search?limit=5") || resp="{}"
  if have_jq; then
    echo "$resp" | jq -e '.meta and (.contacts|type=="array") and (.messages|type=="array")' >/dev/null || true
  fi
  log "smoke done"
}

health_checks() {
  local findings=0
  local prev_dir="$PWD"
  cd "$ROOT_DIR" >/dev/null 2>&1 || return 0
  # 1) Large files (>5MB)
  local LARGE
  LARGE=$(git ls-files -z | xargs -0 du -k 2>/dev/null | awk '$1>5120{print $2 " (" $1/1024 " MB)"}' || true)
  if [ -n "$LARGE" ]; then
    echo "[health] Large files detected (>5MB):"; echo "$LARGE"; findings=1
  fi
  # 2) Merge markers
  local MM
  MM=$(git grep -nE '(^<<<<<<<[[:space:]]|^>>>>>>>[[:space:]]|^=======$)' -- ':!package-lock.json' ':!pnpm-lock.yaml' || true)
  if [ -n "$MM" ]; then
    echo "[health] Merge markers present in files:"; echo "$MM"; findings=1
  fi
  # 3) .gitmodules urls
  if [ -f .gitmodules ]; then
    local URLS
    URLS=$(git config --file=.gitmodules --list | grep '^submodule\..*\.url=' || true)
    if [ -z "$URLS" ]; then echo "[health] .gitmodules exists but has no URLs"; findings=1; fi
  fi
  # 4) Broken symlinks
  if command -v find >/dev/null 2>&1; then
    local broken
    broken=$(find "$ROOT_DIR" -type l ! -exec test -e {} \; -print 2>/dev/null | head -n 50 || true)
    if [ -n "$broken" ]; then
      echo "[health] Broken symlinks detected (first 50):"
      echo "$broken"
      findings=1
    fi
  fi
  # 5) Canonical symlink expectations
  if [[ -x "$ROOT_DIR/backend/scripts/symlinks.sh" ]]; then
    local syms
    syms=$(bash "$ROOT_DIR/backend/scripts/symlinks.sh" check 2>/dev/null || true)
    if [ -n "$syms" ]; then
      echo "[health] Canonical symlink issues:"
      echo "$syms"
      findings=1
    fi
  fi
  # 6) Multiple Node lockfiles in the same directory
  if command -v python3 >/dev/null 2>&1; then
    local lock_dups
    lock_dups=$(python3 - <<'PY' 2>/dev/null || true
import os
from collections import defaultdict

root="backend"
lock_names={"package-lock.json","pnpm-lock.yaml","yarn.lock"}
dirs=defaultdict(list)
for r, _, files in os.walk(root):
    hits=[f for f in files if f in lock_names]
    if len(hits) > 1:
        dirs[r].extend(sorted(hits))
for d in sorted(dirs):
    print(f"{d}: {', '.join(dirs[d])}")
PY
)
    if [ -n "$lock_dups" ]; then
      echo "[health] Multiple Node lockfiles in the same directory (potentially conflicting):"
      echo "$lock_dups"
      findings=1
    fi
  fi
  cd "$prev_dir" >/dev/null 2>&1 || true
  return 0
}

case "$cmd" in
  smoke)
    INSTANCES="${INSTANCES:-1,2}"
    IFS=',' read -r -a arr <<<"$INSTANCES"
    for i in "${arr[@]}"; do start_instance "$i"; done
    ports=()
    for i in "${arr[@]}"; do ports+=("$((3000 + i))"); done
    smoke_checks "${ports[@]}"
    ;;
  ci-smoke)
    trap cleanup_mocks EXIT
    start_mocks
    # Strict assertions when jq is available
    for port in 3001 3002; do
      body=$(curl -sf "http://localhost:${port}/v1/chats/unread-counts")
      if have_jq; then echo "$body" | jq -e 'type=="object"' >/dev/null; else assert_json_object "$body"; fi
    done
    resp=$(curl -sf "http://localhost:3001/v1/search?limit=5")
    if have_jq; then echo "$resp" | jq -e '.meta and (.contacts|type=="array") and (.messages|type=="array")' >/dev/null; fi
    log "ci-smoke PASS"
    ;;
  unit-monitor-ci)
    unit_monitor_ci
    ;;
  health)
    health_checks || true
    ;;
  *)
    cat <<EOF
Usage: $(basename "$0") <command> [options]
Commands:
  smoke          Start real gateway instances (default INSTANCES=1,2) and run basic checks
                 env: INSTANCES=1,2
  ci-smoke       Start mock servers on 3001/3002 and assert JSON shapes; cleans up on exit
  health         Repo health checks (non-failing)
EOF
    ;;
esac
