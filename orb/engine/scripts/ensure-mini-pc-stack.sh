#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/runtime-paths.sh"

LOG_DIR="${LOG_DIR:-$N8N_HEALTH_DIR}"
LOG_FILE="$LOG_DIR/mini-pc-watchdog.log"
N8N_HEALTH_URL="${N8N_HEALTH_URL:-http://127.0.0.1:5678/healthz}"
N8N_AUTH_SURFACE_URL="${N8N_AUTH_SURFACE_URL:-http://127.0.0.1:5678/rest/login}"
ORB_PROXY_HEALTH_URL="${ORB_PROXY_HEALTH_URL:-http://127.0.0.1:8788/meta-review/healthz}"
ORB_PROXY_AUTH_SURFACE_URL="${ORB_PROXY_AUTH_SURFACE_URL:-http://127.0.0.1:8788/rest/login}"
ORB_PUBLIC_HEALTH_URL="${ORB_PUBLIC_HEALTH_URL:-https://orb.skincos.com.br/healthz}"
ORB_PUBLIC_AUTH_SURFACE_URL="${ORB_PUBLIC_AUTH_SURFACE_URL:-https://orb.skincos.com.br/rest/login}"
# Cold DrvFS starts can spend about two minutes rebuilding workflow indexes.
# Keep the watchdog from turning a slow but progressing start into a restart loop.
N8N_STARTUP_GRACE_SECONDS="${N8N_STARTUP_GRACE_SECONDS:-240}"
BACKUP_MARKER="${BACKUP_MARKER:-$N8N_HEALTH_DIR/backup-in-progress}"

mkdir -p "$LOG_DIR"
exec >>"$LOG_FILE" 2>&1

timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

log() {
  echo "$(timestamp) $*"
}

healthy() {
  curl -fsS -o /dev/null --connect-timeout 5 --max-time 10 "$1" >/dev/null 2>&1
}

status_ok() {
  local url="$1"
  shift
  local allowed=("$@")
  local status

  status="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$url" 2>/dev/null || true)"
  for code in "${allowed[@]}"; do
    if [[ "$status" == "$code" ]]; then
      return 0
    fi
  done
  return 1
}

restart_service() {
  local service="$1"
  log "Restarting $service"
  systemctl restart "$service"
}

service_age_seconds() {
  local service="$1"
  local started
  local started_epoch

  started="$(systemctl show "$service" --property=ActiveEnterTimestamp --value 2>/dev/null || true)"
  if [[ -z "$started" || "$started" == "n/a" ]]; then
    echo 999999
    return
  fi

  started_epoch="$(date -d "$started" +%s 2>/dev/null || true)"
  if [[ -z "$started_epoch" ]]; then
    echo 999999
    return
  fi

  echo "$(( $(date +%s) - started_epoch ))"
}

log "watchdog pass"

if [[ -f "$BACKUP_MARKER" ]]; then
  log "Skipping watchdog actions while the n8n backup is in progress"
  exit 0
fi

n8n_in_startup_grace=0
if ! healthy "$N8N_HEALTH_URL" || ! status_ok "$N8N_AUTH_SURFACE_URL" 200 401; then
  n8n_age="$(service_age_seconds "$SKINCOS_N8N_SERVICE")"
  if (( n8n_age < N8N_STARTUP_GRACE_SECONDS )); then
    log "Skipping $SKINCOS_N8N_SERVICE restart: service is still within startup grace (${n8n_age}s/${N8N_STARTUP_GRACE_SECONDS}s)"
    n8n_in_startup_grace=1
  else
    restart_service "$SKINCOS_N8N_SERVICE"
    sleep 10
  fi
fi

if [[ "$n8n_in_startup_grace" == "1" ]]; then
  log "Skipping downstream orb proxy/public tunnel checks while n8n is warming up"
  log "watchdog pass complete"
  exit 0
fi

if ! healthy "$ORB_PROXY_HEALTH_URL" || ! status_ok "$ORB_PROXY_AUTH_SURFACE_URL" 200 401; then
  restart_service "$SKINCOS_ORB_PROXY_SERVICE"
  sleep 5
fi

if ! healthy "$ORB_PUBLIC_HEALTH_URL" || ! status_ok "$ORB_PUBLIC_AUTH_SURFACE_URL" 200 401; then
  restart_service "$SKINCOS_CLOUDFLARED_ORB_SERVICE"
  sleep 10
fi

if systemctl list-unit-files "$SKINCOS_EVOLUTION_SERVICE" >/dev/null 2>&1; then
  if ! systemctl is-active --quiet "$SKINCOS_EVOLUTION_SERVICE"; then
    restart_service "$SKINCOS_EVOLUTION_SERVICE"
  fi
fi

log "watchdog pass complete"

if ! N8N_STORAGE_PATH="$N8N_STORAGE_PATH" node "$SCRIPT_DIR/audit-execution-persistence.js" --quick >/dev/null 2>&1; then
  log "Execution persistence quick audit failed"
fi
