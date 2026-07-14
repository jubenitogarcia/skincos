#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

require_cmd git
require_cmd systemctl
require_cmd sudo

git config --global --add safe.directory /mnt/c/CodexShared/Projetos/skincos/modules/automations/n8n || true
git config --global --add safe.directory /mnt/c/CodexShared/Projetos/skincos || true

mkdir -p \
  "$N8N_RUNTIME_HOME/env" \
  "$EVOLUTION_INSTANCES_DIR" \
  "$EVOLUTION_STORE_DIR" \
  "$N8N_DATA_HOME" \
  "$CLOUDFLARED_HOME" \
  "$N8N_LOG_DIR" \
  "$N8N_HEALTH_DIR" \
  "$N8N_TMP_DIR" \
  "$N8N_STORAGE_PATH" \
  "$N8N_RUNTIME_HOME/backups"

bash "$ROOT_DIR/scripts/install-mini-pc-system-services.sh"

echo "Bootstrap da conta WSL concluido."
echo "Se o GitHub ainda nao estiver autenticado neste perfil, rode:"
echo "  gh auth login --hostname github.com --git-protocol https --web"
echo
echo "Validacao recomendada:"
echo "  bash /mnt/c/CodexShared/Projetos/skincos/modules/automations/n8n/scripts/validate-mini-pc-system-runtime.sh"
