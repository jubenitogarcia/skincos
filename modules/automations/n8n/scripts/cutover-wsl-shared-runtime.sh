#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

LEGACY_ROOT="${LEGACY_ROOT:-$HOME/Automation/n8n}"
ORB_TUNNEL_ID="${ORB_TUNNEL_ID:-1fc962f3-41d2-4140-8a03-d10b6f4dc76c}"
APPLY=0
START_SERVICES=0

usage() {
  cat <<'EOF'
Usage: scripts/cutover-wsl-shared-runtime.sh [--apply] [--start-services]

Copies the live runtime out of the legacy WSL clone into the machine-shared
runtime under C:\CodexRuntime\n8n, installs systemd units pointing at the
shared clone, and keeps secrets/state outside C:\CodexShared.

Options:
  --apply           Perform the cutover. Without this flag the script prints the plan only.
  --start-services  Start services after installing the shared-root systemd units.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --start-services) START_SERVICES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
  shift
done

backup_if_exists() {
  local target="$1"
  if [[ -e "$target" ]]; then
    mv "$target" "$target.before-shared-cutover.$backup_suffix"
  fi
}

copy_private_file() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  backup_if_exists "$dest"
  cp -p "$src" "$dest"
}

copy_private_dir() {
  local src="$1"
  local dest="$2"
  if [[ ! -d "$src" ]]; then
    return 0
  fi
  backup_if_exists "$dest"
  mkdir -p "$dest"
  rsync -a "$src/" "$dest/"
}

upsert_env_line() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped_value
  escaped_value="$(printf '%s' "$value" | sed 's/[&|]/\\&/g')"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${escaped_value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

echo "== target layout =="
echo "shared_root=$ROOT_DIR"
echo "legacy_root=$LEGACY_ROOT"
echo "runtime_home=$N8N_RUNTIME_HOME"
echo "n8n_env_file=$N8N_ENV_FILE"
echo "evolution_env_file=$EVOLUTION_ENV_FILE"
echo "evolution_instances_dir=$EVOLUTION_INSTANCES_DIR"
echo "evolution_store_dir=$EVOLUTION_STORE_DIR"
echo "n8n_data_home=$N8N_DATA_HOME"
echo "n8n_state_home=$N8N_STATE_HOME"
echo "n8n_binary_data_dir=$N8N_BINARY_DATA_DIR"
echo "cloudflared_home=$CLOUDFLARED_HOME"

if [[ "$APPLY" != "1" ]]; then
  echo
  echo "Dry run only. Planned actions:"
  echo "1. Validate preflight from WSL."
  echo "2. Create machine runtime dirs under $N8N_RUNTIME_HOME."
  echo "3. Copy $LEGACY_ROOT/.env -> $N8N_ENV_FILE and rewrite runtime paths."
  echo "4. Copy $LEGACY_ROOT/evolution-api/.env -> $EVOLUTION_ENV_FILE."
  echo "5. Copy legacy evolution-api runtime dirs, ~/.n8n and ~/.cloudflared into $N8N_RUNTIME_HOME."
  echo "6. Reinstall systemd user units pointing to $ROOT_DIR."
  echo "7. Optionally start services and run validation."
  echo
  echo "Run again with --apply to execute."
  exit 0
fi

bash "$ROOT_DIR/scripts/preflight-wsl-shared-runtime.sh" --strict-live

backup_suffix="$(date -u +"%Y%m%dT%H%M%SZ")"
rollback_root="$N8N_RUNTIME_HOME/rollback/shared-cutover-$backup_suffix"

mkdir -p \
  "$N8N_RUNTIME_HOME/env" \
  "$N8N_RUNTIME_HOME/evolution-api" \
  "$N8N_RUNTIME_HOME/n8n-home" \
  "$N8N_RUNTIME_HOME/cloudflared" \
  "$N8N_RUNTIME_HOME/logs" \
  "$N8N_RUNTIME_HOME/health" \
  "$N8N_RUNTIME_HOME/tmp" \
  "$N8N_RUNTIME_HOME/binary-data" \
  "$rollback_root"

if command -v systemctl >/dev/null 2>&1; then
  mkdir -p "$rollback_root/systemd-user"
  cp -p "$HOME/.config/systemd/user/"{n8n.service,orb-proxy.service,cloudflared-orb.service,evolution-api.service,mini-pc-watchdog.service,mini-pc-watchdog.timer} "$rollback_root/systemd-user/" 2>/dev/null || true
  systemctl --user stop mini-pc-watchdog.timer cloudflared-orb.service orb-proxy.service n8n.service evolution-api.service >/dev/null 2>&1 || true
fi

copy_private_file "$LEGACY_ROOT/.env" "$N8N_ENV_FILE"
copy_private_file "$LEGACY_ROOT/evolution-api/.env" "$EVOLUTION_ENV_FILE"
copy_private_dir "$LEGACY_ROOT/evolution-api/instances" "$EVOLUTION_INSTANCES_DIR"
copy_private_dir "$LEGACY_ROOT/evolution-api/store" "$EVOLUTION_STORE_DIR"
copy_private_dir "$LEGACY_ROOT/binary-data" "$N8N_BINARY_DATA_DIR"
copy_private_dir "$HOME/.n8n" "$N8N_STATE_HOME"
copy_private_dir "$HOME/.cloudflared" "$CLOUDFLARED_HOME"

upsert_env_line "$N8N_ENV_FILE" "N8N_USER_FOLDER" "$N8N_DATA_HOME"
upsert_env_line "$N8N_ENV_FILE" "N8N_RESTRICT_FILE_ACCESS_TO" "$N8N_TMP_DIR"
upsert_env_line "$N8N_ENV_FILE" "N8N_STORAGE_PATH" "$N8N_STORAGE_PATH"
sed -i '/^N8N_BINARY_DATA_FILE_PATH=/d' "$N8N_ENV_FILE"

if [[ -f "$CLOUDFLARED_HOME/orb-config.yml" ]]; then
  sed -i "s|^credentials-file:.*|credentials-file: $CLOUDFLARED_HOME/${ORB_TUNNEL_ID}.json|" "$CLOUDFLARED_HOME/orb-config.yml"
fi

chmod 600 \
  "$N8N_ENV_FILE" \
  "$EVOLUTION_ENV_FILE" \
  "$CLOUDFLARED_HOME"/*.json \
  "$CLOUDFLARED_HOME"/*.yml 2>/dev/null || true

bash "$ROOT_DIR/scripts/install-mini-pc-systemd.sh"

echo "Machine-shared runtime copied and systemd units rendered for shared runtime."
echo "Legacy clone kept in place for rollback: $LEGACY_ROOT"
echo "Rollback checkpoint: $rollback_root"

if [[ "$START_SERVICES" == "1" ]] && command -v systemctl >/dev/null 2>&1; then
  systemctl --user start n8n.service
  systemctl --user start orb-proxy.service
  systemctl --user start cloudflared-orb.service
  systemctl --user start evolution-api.service
  systemctl --user start mini-pc-watchdog.timer
  bash "$ROOT_DIR/scripts/validate-mini-pc-stack.sh"
else
  echo "Start services manually when ready:"
  echo "  systemctl --user start n8n.service"
  echo "  systemctl --user start orb-proxy.service"
  echo "  systemctl --user start cloudflared-orb.service"
  echo "  systemctl --user start evolution-api.service"
  echo "  systemctl --user start mini-pc-watchdog.timer"
fi
