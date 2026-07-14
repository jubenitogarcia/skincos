#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

UNIT_SRC="$ROOT_DIR/systemd/system"
UNIT_DEST="${UNIT_DEST:-/etc/systemd/system}"
SYSTEMD_RELOAD="${SYSTEMD_RELOAD:-1}"
SYSTEMD_ENABLE="${SYSTEMD_ENABLE:-1}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd sudo

sed_escape() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

mkdir -p "$N8N_RUNTIME_HOME" \
  "$N8N_RUNTIME_HOME/env" \
  "$N8N_LOG_DIR" \
  "$N8N_HEALTH_DIR" \
  "$N8N_TMP_DIR" \
  "$N8N_STORAGE_PATH" \
  "$N8N_RUNTIME_HOME/backups/daily" \
  "$N8N_RUNTIME_HOME/locks" \
  "$N8N_DATA_HOME" \
  "$CLOUDFLARED_HOME" \
  "$EVOLUTION_INSTANCES_DIR" \
  "$EVOLUTION_STORE_DIR"

n8n_root_escaped="$(sed_escape "$N8N_ROOT")"
n8n_runtime_home_escaped="$(sed_escape "$N8N_RUNTIME_HOME")"
n8n_env_file_escaped="$(sed_escape "$N8N_ENV_FILE")"
n8n_business_env_file_escaped="$(sed_escape "$N8N_BUSINESS_ENV_FILE")"
n8n_data_home_escaped="$(sed_escape "$N8N_DATA_HOME")"
n8n_log_dir_escaped="$(sed_escape "$N8N_LOG_DIR")"
n8n_health_dir_escaped="$(sed_escape "$N8N_HEALTH_DIR")"
n8n_tmp_dir_escaped="$(sed_escape "$N8N_TMP_DIR")"
n8n_binary_data_dir_escaped="$(sed_escape "$N8N_BINARY_DATA_DIR")"
n8n_storage_path_escaped="$(sed_escape "$N8N_STORAGE_PATH")"
cloudflared_home_escaped="$(sed_escape "$CLOUDFLARED_HOME")"
evolution_env_file_escaped="$(sed_escape "$EVOLUTION_ENV_FILE")"
evolution_instances_dir_escaped="$(sed_escape "$EVOLUTION_INSTANCES_DIR")"
evolution_store_dir_escaped="$(sed_escape "$EVOLUTION_STORE_DIR")"

units=(
  "$SKINCOS_N8N_SERVICE"
  "$SKINCOS_ORB_PROXY_SERVICE"
  "$SKINCOS_CLOUDFLARED_ORB_SERVICE"
  "$SKINCOS_EVOLUTION_SERVICE"
  "$SKINCOS_WATCHDOG_SERVICE"
  "$SKINCOS_WATCHDOG_TIMER"
  "$SKINCOS_BACKUP_SERVICE"
  "$SKINCOS_BACKUP_TIMER"
)

sudo -n mkdir -p "$UNIT_DEST"

for unit in "${units[@]}"; do
  src_path="$UNIT_SRC/$unit"
  dest_path="$UNIT_DEST/$unit"
  if [[ "$unit" == *.service ]]; then
    sed \
      -e "s|__N8N_ROOT__|$n8n_root_escaped|g" \
      -e "s|__N8N_RUNTIME_HOME__|$n8n_runtime_home_escaped|g" \
      -e "s|__N8N_ENV_FILE__|$n8n_env_file_escaped|g" \
      -e "s|__N8N_BUSINESS_ENV_FILE__|$n8n_business_env_file_escaped|g" \
      -e "s|__N8N_DATA_HOME__|$n8n_data_home_escaped|g" \
      -e "s|__N8N_LOG_DIR__|$n8n_log_dir_escaped|g" \
      -e "s|__N8N_HEALTH_DIR__|$n8n_health_dir_escaped|g" \
      -e "s|__N8N_TMP_DIR__|$n8n_tmp_dir_escaped|g" \
      -e "s|__N8N_BINARY_DATA_DIR__|$n8n_binary_data_dir_escaped|g" \
      -e "s|__N8N_STORAGE_PATH__|$n8n_storage_path_escaped|g" \
      -e "s|__CLOUDFLARED_HOME__|$cloudflared_home_escaped|g" \
      -e "s|__EVOLUTION_ENV_FILE__|$evolution_env_file_escaped|g" \
      -e "s|__EVOLUTION_INSTANCES_DIR__|$evolution_instances_dir_escaped|g" \
      -e "s|__EVOLUTION_STORE_DIR__|$evolution_store_dir_escaped|g" \
      "$src_path" | sudo -n tee "$dest_path" >/dev/null
    sudo -n chmod 0644 "$dest_path"
  else
    sudo -n install -m 0644 "$src_path" "$dest_path"
  fi
done

if [[ "$SYSTEMD_RELOAD" == "1" ]]; then
  sudo -n systemctl daemon-reload
fi

if [[ "$SYSTEMD_ENABLE" == "1" ]]; then
  sudo -n systemctl enable \
    "$SKINCOS_N8N_SERVICE" \
    "$SKINCOS_ORB_PROXY_SERVICE" \
    "$SKINCOS_CLOUDFLARED_ORB_SERVICE" \
    "$SKINCOS_EVOLUTION_SERVICE" \
    "$SKINCOS_WATCHDOG_TIMER" \
    "$SKINCOS_BACKUP_TIMER" >/dev/null
fi

echo "Systemd system units installed."
echo "Managed units:"
printf '  %s\n' "${units[@]}"
