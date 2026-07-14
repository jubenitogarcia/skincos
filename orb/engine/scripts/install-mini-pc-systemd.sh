#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"
UNIT_SRC="$ROOT_DIR/systemd/user"
UNIT_DEST="${UNIT_DEST:-$HOME/.config/systemd/user}"
SYSTEMD_RELOAD="${SYSTEMD_RELOAD:-1}"
SYSTEMD_ENABLE="${SYSTEMD_ENABLE:-1}"
LOGINCTL_ENABLE_LINGER="${LOGINCTL_ENABLE_LINGER:-1}"

sed_escape() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

mkdir -p "$UNIT_DEST"

n8n_root_escaped="$(sed_escape "$N8N_ROOT")"
n8n_runtime_home_escaped="$(sed_escape "$N8N_RUNTIME_HOME")"
n8n_env_file_escaped="$(sed_escape "$N8N_ENV_FILE")"
n8n_data_home_escaped="$(sed_escape "$N8N_DATA_HOME")"
n8n_log_dir_escaped="$(sed_escape "$N8N_LOG_DIR")"
n8n_health_dir_escaped="$(sed_escape "$N8N_HEALTH_DIR")"
n8n_tmp_dir_escaped="$(sed_escape "$N8N_TMP_DIR")"
n8n_binary_data_dir_escaped="$(sed_escape "$N8N_BINARY_DATA_DIR")"
cloudflared_home_escaped="$(sed_escape "$CLOUDFLARED_HOME")"
evolution_env_file_escaped="$(sed_escape "$EVOLUTION_ENV_FILE")"
evolution_instances_dir_escaped="$(sed_escape "$EVOLUTION_INSTANCES_DIR")"
evolution_store_dir_escaped="$(sed_escape "$EVOLUTION_STORE_DIR")"

for unit in \
  n8n.service \
  orb-proxy.service \
  cloudflared-orb.service \
  evolution-api.service \
  mini-pc-watchdog.service \
  mini-pc-watchdog.timer; do
  src_path="$UNIT_SRC/$unit"
  dest_path="$UNIT_DEST/$unit"
  if [[ "$unit" == *.service ]]; then
    sed \
      -e "s|__N8N_ROOT__|$n8n_root_escaped|g" \
      -e "s|__N8N_RUNTIME_HOME__|$n8n_runtime_home_escaped|g" \
      -e "s|__N8N_ENV_FILE__|$n8n_env_file_escaped|g" \
      -e "s|__N8N_DATA_HOME__|$n8n_data_home_escaped|g" \
      -e "s|__N8N_LOG_DIR__|$n8n_log_dir_escaped|g" \
      -e "s|__N8N_HEALTH_DIR__|$n8n_health_dir_escaped|g" \
      -e "s|__N8N_TMP_DIR__|$n8n_tmp_dir_escaped|g" \
      -e "s|__N8N_BINARY_DATA_DIR__|$n8n_binary_data_dir_escaped|g" \
      -e "s|__CLOUDFLARED_HOME__|$cloudflared_home_escaped|g" \
      -e "s|__EVOLUTION_ENV_FILE__|$evolution_env_file_escaped|g" \
      -e "s|__EVOLUTION_INSTANCES_DIR__|$evolution_instances_dir_escaped|g" \
      -e "s|__EVOLUTION_STORE_DIR__|$evolution_store_dir_escaped|g" \
      "$src_path" >"$dest_path"
    chmod 0644 "$dest_path"
  else
    install -m 0644 "$src_path" "$dest_path"
  fi
done

if [[ "$SYSTEMD_RELOAD" == "1" ]] && command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload
fi

if [[ "$LOGINCTL_ENABLE_LINGER" == "1" ]] && command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
fi

if [[ "$SYSTEMD_ENABLE" == "1" ]] && command -v systemctl >/dev/null 2>&1; then
  systemctl --user enable n8n.service orb-proxy.service cloudflared-orb.service evolution-api.service mini-pc-watchdog.timer
fi

echo "Systemd user units installed."
echo "Start order:"
echo "  systemctl --user start n8n.service"
echo "  systemctl --user start orb-proxy.service"
echo "  systemctl --user start cloudflared-orb.service"
echo "  systemctl --user start evolution-api.service"
echo "  systemctl --user start mini-pc-watchdog.timer"
