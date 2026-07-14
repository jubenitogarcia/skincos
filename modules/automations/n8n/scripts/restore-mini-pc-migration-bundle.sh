#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"
N8N_HOME="${N8N_HOME:-$N8N_DATA_HOME}"
CLOUDFLARED_HOME="${CLOUDFLARED_HOME:-$HOME/.cloudflared}"
BUNDLE="${1:-}"

if [ -z "$BUNDLE" ] || [ ! -f "$BUNDLE" ]; then
  echo "Usage: scripts/restore-mini-pc-migration-bundle.sh /path/to/n8n-mini-pc-migration-YYYYMMDDTHHMMSSZ.tar.gz"
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user stop mini-pc-watchdog.timer cloudflared-orb.service orb-proxy.service n8n.service evolution-api.service >/dev/null 2>&1 || true
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

tar -C "$tmp_dir" -xzf "$BUNDLE"
payload="$(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [ -z "$payload" ]; then
  echo "Could not find payload directory in bundle."
  exit 1
fi

backup_suffix="$(date -u +"%Y%m%dT%H%M%SZ")"
mkdir -p "$N8N_HOME" "$CLOUDFLARED_HOME" "$ROOT_DIR/evolution-api"
mkdir -p "$(dirname "$N8N_ENV_FILE")" "$(dirname "$EVOLUTION_ENV_FILE")"

backup_if_exists() {
  local target="$1"
  if [ -e "$target" ]; then
    mv "$target" "$target.before-mini-pc-restore.$backup_suffix"
  fi
}

backup_if_exists "$N8N_HOME/database.sqlite"
backup_if_exists "$N8N_HOME/config"
backup_if_exists "$N8N_HOME/storage"
backup_if_exists "$N8N_HOME/nodes"
backup_if_exists "$N8N_ENV_FILE"
backup_if_exists "$EVOLUTION_ENV_FILE"
backup_if_exists "$EVOLUTION_INSTANCES_DIR"
backup_if_exists "$EVOLUTION_STORE_DIR"
backup_if_exists "$CLOUDFLARED_HOME/orb-config.yml"

if [ -d "$payload/cloudflared" ]; then
  while IFS= read -r cloudflared_file; do
    target="$CLOUDFLARED_HOME/$(basename "$cloudflared_file")"
    backup_if_exists "$target"
  done < <(find "$payload/cloudflared" -maxdepth 1 -type f -name '*.json' -print)
fi

cp -p "$payload/n8n/database.sqlite" "$N8N_HOME/database.sqlite"
cp -p "$payload/n8n/config" "$N8N_HOME/config"

if [ -d "$payload/n8n/storage" ]; then
  rsync -a "$payload/n8n/storage/" "$N8N_HOME/storage/"
fi

if [ -d "$payload/n8n/nodes" ]; then
  rsync -a "$payload/n8n/nodes/" "$N8N_HOME/nodes/"
fi

cp -p "$payload/repo/.env" "$N8N_ENV_FILE"
cp -p "$payload/evolution-api/.env" "$EVOLUTION_ENV_FILE"

if [ -d "$payload/evolution-api/instances" ]; then
  mkdir -p "$EVOLUTION_INSTANCES_DIR"
  rsync -a "$payload/evolution-api/instances/" "$EVOLUTION_INSTANCES_DIR/"
fi

if [ -d "$payload/evolution-api/store" ]; then
  mkdir -p "$EVOLUTION_STORE_DIR"
  rsync -a "$payload/evolution-api/store/" "$EVOLUTION_STORE_DIR/"
fi

rsync -a "$payload/cloudflared/" "$CLOUDFLARED_HOME/"

chmod 600 "$N8N_HOME/config" "$N8N_ENV_FILE" "$EVOLUTION_ENV_FILE" "$CLOUDFLARED_HOME"/*.json "$CLOUDFLARED_HOME"/*.yml 2>/dev/null || true

sqlite3 "$N8N_HOME/database.sqlite" "PRAGMA quick_check;"

echo "Restore complete."
echo "Start services with:"
echo "  systemctl --user start n8n.service orb-proxy.service cloudflared-orb.service evolution-api.service mini-pc-watchdog.timer"
