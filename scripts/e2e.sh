#!/usr/bin/env bash
set -euo pipefail

# Unified E2E entry-point
# Commands:
#   smoke      - start real gateway instances (default 1,2) and run basic checks
#   ci-smoke   - start mock servers on 3001/3002 and assert basic JSON shapes
#   health     - repository health checks (non-failing)

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OFFICIAL_DIR="$ROOT_DIR/whatsapp/official-module"
MOCK="$ROOT_DIR/whatsapp/gateway/simple-mock-api.js"
if [ ! -f "$MOCK" ]; then
  MOCK="$ROOT_DIR/whatsapp-gateway/simple-mock-api.js"
fi

cmd=${1:-help}
shift || true

log() { echo "[e2e] $*"; }

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
      if [[ ! -d node_modules ]]; then npm install --no-audit --no-fund >/dev/null 2>&1 || true; fi
      # Start once via node if not already up
      if ! curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then
        PORT="$port" NO_AUTH=true NODE_ENV=development node official-whatsapp.js >/dev/null 2>&1 &
        echo $! > ".e2e_${inst}.pid"
      fi
    )
  else
    # Fallback stub
    (
      cd "$ROOT_DIR/whatsapp/backup"
      PORT="$port" ACCOUNT_ID="$port" node bot_com_api.js >/dev/null 2>&1 &
      echo $! > ".e2e_stub_${inst}.pid"
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
  (PORT=3001 node "$MOCK" >/dev/null 2>&1 & echo $! > "$ROOT_DIR/whatsapp/gateway/.mock_3001.pid")
  (PORT=3002 node "$MOCK" >/dev/null 2>&1 & echo $! > "$ROOT_DIR/whatsapp/gateway/.mock_3002.pid")
  for _ in {1..30}; do
    if curl -sf "http://localhost:3001/health" >/dev/null 2>&1 && curl -sf "http://localhost:3002/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

cleanup_mocks() {
  for p in "$ROOT_DIR/whatsapp/gateway/.mock_3001.pid" "$ROOT_DIR/whatsapp/gateway/.mock_3002.pid"; do
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
  # 1) Large files (>5MB)
  local LARGE
  LARGE=$(git ls-files -z | xargs -0 du -k 2>/dev/null | awk '$1>5120{print $2 " (" $1/1024 " MB)"}' || true)
  if [ -n "$LARGE" ]; then
    echo "[health] Large files detected (>5MB):"; echo "$LARGE"; findings=1
  fi
  # 2) Merge markers
  local MM
  MM=$(git grep -nE '<<<<<<< |=======|>>>>>>> ' -- ':!package-lock.json' ':!pnpm-lock.yaml' || true)
  if [ -n "$MM" ]; then
    echo "[health] Merge markers present in files:"; echo "$MM"; findings=1
  fi
  # 3) .gitmodules urls
  if [ -f .gitmodules ]; then
    local URLS
    URLS=$(git config --file=.gitmodules --list | grep '^submodule\..*\.url=' || true)
    if [ -z "$URLS" ]; then echo "[health] .gitmodules exists but has no URLs"; findings=1; fi
  fi
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
