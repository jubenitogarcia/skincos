#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"
BUNDLE_ROOT="${BUNDLE_ROOT:-$N8N_RUNTIME_HOME/backups/migration-bundles}"
N8N_HOME="${N8N_HOME:-$N8N_DATA_HOME}"
CLOUDFLARED_HOME="${CLOUDFLARED_HOME:-$HOME/.cloudflared}"
ORB_TUNNEL_ID="${ORB_TUNNEL_ID:-1fc962f3-41d2-4140-8a03-d10b6f4dc76c}"
FREEZE_MAC_LAUNCHD=0
RESUME_MAC_LAUNCHD=0

usage() {
  cat <<'EOF'
Usage: scripts/prepare-mini-pc-migration-bundle.sh [--freeze-mac-launchd] [--resume-mac-launchd]

Creates a local, ignored migration bundle under migration-bundles/.
The bundle contains secrets and runtime state. Do not commit or upload it.

Environment:
  BUNDLE_ROOT  Destination directory. Use an external disk when local space is low.

Options:
  --freeze-mac-launchd  Stop Mac LaunchAgents before the final backup.
  --resume-mac-launchd  Restart Mac stack after the backup finishes.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --freeze-mac-launchd) FREEZE_MAC_LAUNCHD=1 ;;
    --resume-mac-launchd) RESUME_MAC_LAUNCHD=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
  shift
done

require_file() {
  local file="$1"
  local label="$2"
  if [ ! -f "$file" ]; then
    echo "Missing $label: $file"
    exit 1
  fi
}

stop_mac_launchd() {
  local uid
  uid="$(id -u)"
  local plists=(
    "$HOME/Library/LaunchAgents/com.skincos.cloudflared.orb.plist"
    "$HOME/Library/LaunchAgents/com.skincos.orb-proxy.plist"
    "$HOME/Library/LaunchAgents/com.jubenito.n8n-evolution.plist"
    "$HOME/Library/LaunchAgents/com.skincos.evolution-api.plist"
  )

  for plist in "${plists[@]}"; do
    [ -f "$plist" ] || continue
    launchctl bootout "gui/$uid" "$plist" >/dev/null 2>&1 || true
  done
}

resume_mac_launchd() {
  if [ -x "$ROOT_DIR/scripts/restart-orb-stack.sh" ]; then
    bash "$ROOT_DIR/scripts/restart-orb-stack.sh"
  fi
}

mkdir -p "$BUNDLE_ROOT"

require_file "$N8N_HOME/database.sqlite" "n8n SQLite database"
require_file "$N8N_HOME/config" "n8n config/encryption key"
require_file "$N8N_ENV_FILE" "n8n environment file"
require_file "$EVOLUTION_ENV_FILE" "Evolution API environment file"
require_file "$CLOUDFLARED_HOME/orb-config.yml" "Cloudflare orb tunnel config"
require_file "$CLOUDFLARED_HOME/${ORB_TUNNEL_ID}.json" "Cloudflare orb tunnel credentials"

estimate_required_kb() {
  local total=0
  local path
  for path in \
    "$N8N_HOME/database.sqlite" \
    "$N8N_HOME/config" \
    "$N8N_HOME/storage" \
    "$N8N_HOME/nodes" \
    "$N8N_ENV_FILE" \
    "$EVOLUTION_ENV_FILE" \
    "$EVOLUTION_INSTANCES_DIR" \
    "$EVOLUTION_STORE_DIR" \
    "$CLOUDFLARED_HOME/orb-config.yml" \
    "$CLOUDFLARED_HOME/${ORB_TUNNEL_ID}.json"; do
    [ -e "$path" ] || continue
    size="$(du -sk "$path" 2>/dev/null | awk '{print $1}')"
    total=$((total + ${size:-0}))
  done
  echo "$total"
}

available_kb() {
  df -Pk "$BUNDLE_ROOT" | awk 'NR==2 {print $4}'
}

required_kb="$(estimate_required_kb)"
free_kb="$(available_kb)"
minimum_kb=$((required_kb * 2))

if [ "$free_kb" -lt "$minimum_kb" ]; then
  echo "Not enough free space in BUNDLE_ROOT=$BUNDLE_ROOT"
  echo "Estimated source size: $((required_kb / 1024)) MB"
  echo "Available space:       $((free_kb / 1024)) MB"
  echo "Use an external disk or remote-mounted path, for example:"
  echo "  BUNDLE_ROOT=/Volumes/External/n8n-migration scripts/prepare-mini-pc-migration-bundle.sh"
  exit 1
fi

if [ "$FREEZE_MAC_LAUNCHD" -eq 1 ]; then
  echo "Stopping Mac LaunchAgents for final freeze..."
  stop_mac_launchd
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
payload="$tmp_dir/n8n-mini-pc-migration-$timestamp"
mkdir -p "$payload/n8n" "$payload/repo" "$payload/evolution-api" "$payload/cloudflared" "$payload/baseline"

echo "Creating consistent SQLite backup..."
sqlite3 "$N8N_HOME/database.sqlite" ".backup '$payload/n8n/database.sqlite'"
cp -p "$N8N_HOME/config" "$payload/n8n/config"

if [ -d "$N8N_HOME/storage" ]; then
  rsync -a "$N8N_HOME/storage/" "$payload/n8n/storage/"
fi

if [ -d "$N8N_HOME/nodes" ]; then
  rsync -a "$N8N_HOME/nodes/" "$payload/n8n/nodes/"
fi

cp -p "$N8N_ENV_FILE" "$payload/repo/.env"
cp -p "$EVOLUTION_ENV_FILE" "$payload/evolution-api/.env"

if [ -d "$EVOLUTION_INSTANCES_DIR" ]; then
  rsync -a "$EVOLUTION_INSTANCES_DIR/" "$payload/evolution-api/instances/"
fi

if [ -d "$EVOLUTION_STORE_DIR" ]; then
  rsync -a "$EVOLUTION_STORE_DIR/" "$payload/evolution-api/store/"
fi

cp -p "$CLOUDFLARED_HOME/orb-config.yml" "$payload/cloudflared/orb-config.yml"
cp -p "$CLOUDFLARED_HOME/${ORB_TUNNEL_ID}.json" "$payload/cloudflared/${ORB_TUNNEL_ID}.json"

sqlite3 "$payload/n8n/database.sqlite" <<'SQL' > "$payload/baseline/n8n-counts.txt"
PRAGMA quick_check;
SELECT 'workflows', count(*) FROM workflow_entity;
SELECT 'active_workflows', count(*) FROM workflow_entity WHERE active=1;
SELECT 'credentials', count(*) FROM credentials_entity;
SELECT 'recent_7d_executions', count(*) FROM execution_entity WHERE startedAt >= datetime('now','-7 days');
SQL

sqlite3 -header -separator $'\t' "$payload/n8n/database.sqlite" <<'SQL' > "$payload/baseline/active-workflows.tsv"
SELECT id, name, active, updatedAt FROM workflow_entity WHERE active=1 ORDER BY name;
SQL

{
  echo "created_utc=$timestamp"
  echo "source_host=$(hostname)"
  echo "repo_path=$ROOT_DIR"
  echo "n8n_env_file=$N8N_ENV_FILE"
  echo "evolution_env_file=$EVOLUTION_ENV_FILE"
  echo "evolution_instances_dir=$EVOLUTION_INSTANCES_DIR"
  echo "evolution_store_dir=$EVOLUTION_STORE_DIR"
  echo "n8n_home=$N8N_HOME"
  echo "orb_tunnel_id=$ORB_TUNNEL_ID"
  git -C "$ROOT_DIR" rev-parse --short HEAD | sed 's/^/git_commit=/'
  if command -v n8n >/dev/null 2>&1; then n8n --version | sed 's/^/n8n_version=/'; fi
  if command -v node >/dev/null 2>&1; then node --version | sed 's/^/node_version=/'; fi
  if command -v cloudflared >/dev/null 2>&1; then cloudflared --version | sed 's/^/cloudflared_version=/'; fi
} > "$payload/manifest.env"

bundle="$BUNDLE_ROOT/n8n-mini-pc-migration-$timestamp.tar.gz"
tar -C "$tmp_dir" -czf "$bundle" "$(basename "$payload")"
chmod 600 "$bundle"

echo "Bundle created: $bundle"
echo "Baseline:"
cat "$payload/baseline/n8n-counts.txt"

if [ "$RESUME_MAC_LAUNCHD" -eq 1 ]; then
  echo "Resuming Mac stack..."
  resume_mac_launchd
fi
