#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
META_DIR="$ROOT_DIR/ads/meta"

usage() {
  cat <<'USAGE'
Meta Ads helper

Usage: meta-ads.sh <start|stop|logs|migrate|seed|health>

Env:
  META_ADS_API_PORT (default: 4000)
USAGE
}

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
  fi
}

ensure_envs() {
  if [[ ! -f "$META_DIR/apps/api/.env" && -f "$ROOT_DIR/backend/config/templates/modules/meta-ads/.env.example" ]]; then
    cp "$ROOT_DIR/backend/config/templates/modules/meta-ads/.env.example" "$META_DIR/apps/api/.env"
    echo "[meta-ads] Seeded apps/api/.env from template"
  fi
  if [[ ! -f "$META_DIR/apps/worker/.env" && -f "$ROOT_DIR/backend/config/templates/modules/meta-ads/.env.example" ]]; then
    cp "$ROOT_DIR/backend/config/templates/modules/meta-ads/.env.example" "$META_DIR/apps/worker/.env"
    echo "[meta-ads] Seeded apps/worker/.env from template"
  fi
}

command -v pnpm >/dev/null 2>&1 || { echo "[meta-ads] pnpm required" >&2; exit 1; }

sub=${1:-start}
shift || true

case "$sub" in
  start)
    "$ROOT_DIR/backend/scripts/dev.sh" meta-ads start
    ;;
  stop)
    "$ROOT_DIR/backend/scripts/dev.sh" meta-ads stop
    ;;
  logs)
    "$ROOT_DIR/backend/scripts/dev.sh" meta-ads logs
    ;;
  migrate)
    ensure_envs
    load_env_file "$META_DIR/apps/api/.env"
    (cd "$META_DIR" && pnpm prisma migrate dev)
    ;;
  seed)
    ensure_envs
    load_env_file "$META_DIR/apps/api/.env"
    (cd "$META_DIR" && pnpm --filter @meta/db seed)
    ;;
  health)
    port="${META_ADS_API_PORT:-4000}"
    if command -v curl >/dev/null 2>&1; then
      curl -sf "http://localhost:$port/api/health" && echo "" && exit 0
    fi
    echo "[meta-ads] Health check failed" >&2
    exit 1
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $sub" >&2
    usage
    exit 1
    ;;
 esac
