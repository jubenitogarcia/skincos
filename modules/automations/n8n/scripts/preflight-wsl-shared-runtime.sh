#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

STRICT_LIVE=0
SHARED_ONLY=0
legacy_patterns=(
  "/home/julia"
  "/srv/skincos"
  "/etc/skincos"
  "systemctl --user"
)

usage() {
  cat <<'EOF'
Usage: scripts/preflight-wsl-shared-runtime.sh [--strict-live] [--shared-only]

Validates whether the WSL runtime matches the shared multi-user model:
- code in C:\CodexShared\Projetos\skincos
- runtime in C:\CodexRuntime\n8n
- Linux system services under User=skincos
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict-live) STRICT_LIVE=1 ;;
    --shared-only) SHARED_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
  shift
done

require_dir() {
  local path="$1"
  local label="$2"
  if [[ ! -d "$path" ]]; then
    echo "Missing $label: $path"
    exit 1
  fi
}

require_file() {
  local path="$1"
  local label="$2"
  if [[ ! -f "$path" ]]; then
    echo "Missing $label: $path"
    exit 1
  fi
}

check_live() {
  local label="$1"
  local url="$2"
  if curl -fsS --max-time 10 "$url" >/dev/null 2>&1; then
    echo "live_ok $label $url"
    return 0
  fi
  if [[ "$STRICT_LIVE" == "1" ]]; then
    echo "Live check failed: $label $url"
    exit 1
  fi
  echo "live_warn $label $url"
}

check_no_legacy_patterns() {
  local label="$1"
  shift
  local paths=("$@")
  local found=0
  local pattern

  for pattern in "${legacy_patterns[@]}"; do
    if grep -R -n -F "$pattern" "${paths[@]}" >/dev/null 2>&1; then
      echo "Legacy reference detected in $label: $pattern"
      grep -R -n -F "$pattern" "${paths[@]}" || true
      found=1
    fi
  done

  if [[ "$found" == "1" ]]; then
    exit 1
  fi
}

echo "== environment =="
echo "shared_root=$ROOT_DIR"
echo "shared_only=$SHARED_ONLY"
echo "runtime_home=$N8N_RUNTIME_HOME"
echo "n8n_env_file=$N8N_ENV_FILE"
echo "n8n_business_env_file=$N8N_BUSINESS_ENV_FILE"
echo "evolution_env_file=$EVOLUTION_ENV_FILE"
echo "evolution_instances_dir=$EVOLUTION_INSTANCES_DIR"
echo "evolution_store_dir=$EVOLUTION_STORE_DIR"
echo "n8n_binary_data_dir=$N8N_BINARY_DATA_DIR"
echo "n8n_state_home=$N8N_STATE_HOME"
echo "n8n_db_path=$N8N_DB_PATH"
echo "n8n_config_path=$N8N_CONFIG_PATH"
echo "n8n_nodes_dir=$N8N_NODES_DIR"
echo "cloudflared_home=$CLOUDFLARED_HOME"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This preflight must run inside Linux/WSL."
  exit 1
fi

require_dir "$ROOT_DIR" "shared clone root"
require_dir "$N8N_RUNTIME_HOME" "machine runtime root"
require_dir "$CLOUDFLARED_HOME" "cloudflared runtime dir"
require_dir "$N8N_DATA_HOME" "n8n data dir"
require_dir "$N8N_STATE_HOME" "n8n state dir"
require_dir "$N8N_NODES_DIR" "n8n nodes dir"
require_dir "$N8N_BINARY_DATA_DIR" "n8n binary-data dir"
require_dir "$N8N_TMP_DIR" "n8n tmp dir"
require_dir "$EVOLUTION_INSTANCES_DIR" "Evolution instances dir"
require_dir "$EVOLUTION_STORE_DIR" "Evolution store dir"

require_file "$N8N_ENV_FILE" "n8n runtime env"
require_file "$N8N_BUSINESS_ENV_FILE" "n8n business env"
require_file "$EVOLUTION_ENV_FILE" "Evolution env"
require_file "$N8N_CONFIG_PATH" "n8n config"
require_file "$N8N_NODES_DIR/package.json" "n8n nodes package"
require_file "$CLOUDFLARED_HOME/orb-config.yml" "Cloudflare orb config"
require_file "$CLOUDFLARED_HOME/1fc962f3-41d2-4140-8a03-d10b6f4dc76c.json" "Cloudflare orb credentials"

if [[ -f "$ROOT_DIR/.env" ]]; then
  echo "Shared clone still contains .env: $ROOT_DIR/.env"
  exit 1
fi

if [[ "$N8N_ENV_FILE" == "$ROOT_DIR"* || "$N8N_BUSINESS_ENV_FILE" == "$ROOT_DIR"* || "$EVOLUTION_ENV_FILE" == "$ROOT_DIR"* ]]; then
  echo "Runtime env files cannot live inside the shared clone."
  exit 1
fi

if [[ "$N8N_DATA_HOME" == "$ROOT_DIR"* || "$CLOUDFLARED_HOME" == "$ROOT_DIR"* ]]; then
  echo "Runtime state cannot live inside the shared clone."
  exit 1
fi

if [[ -f "$N8N_LEGACY_CONFIG_PATH" ]] && ! cmp -s "$N8N_LEGACY_CONFIG_PATH" "$N8N_CONFIG_PATH"; then
  echo "Split runtime config detected between:"
  echo "  legacy=$N8N_LEGACY_CONFIG_PATH"
  echo "  active=$N8N_CONFIG_PATH"
  exit 1
fi

if [[ -f "$N8N_LEGACY_NODES_DIR/package.json" ]] && ! cmp -s "$N8N_LEGACY_NODES_DIR/package.json" "$N8N_NODES_DIR/package.json"; then
  echo "Split runtime nodes package detected between:"
  echo "  legacy=$N8N_LEGACY_NODES_DIR/package.json"
  echo "  active=$N8N_NODES_DIR/package.json"
  exit 1
fi

echo "== git =="
git -C "$ROOT_DIR" status --short --branch
git -C "$ROOT_DIR" remote -v

echo "== rendered systemd system units =="
tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

UNIT_DEST="$tmp_dir" \
SYSTEMD_RELOAD=0 \
SYSTEMD_ENABLE=0 \
bash "$ROOT_DIR/scripts/install-mini-pc-system-services.sh" >/dev/null

if grep -R "__N8N_\\|__EVOLUTION_\\|__CLOUDFLARED_" "$tmp_dir" >/dev/null 2>&1; then
  echo "Rendered units still contain unresolved placeholders."
  exit 1
fi

for unit in \
  "$SKINCOS_N8N_SERVICE" \
  "$SKINCOS_ORB_PROXY_SERVICE" \
  "$SKINCOS_CLOUDFLARED_ORB_SERVICE" \
  "$SKINCOS_EVOLUTION_SERVICE" \
  "$SKINCOS_WATCHDOG_SERVICE"; do
  echo "-- $unit --"
  sed -n '1,24p' "$tmp_dir/$unit"
done

echo "== legacy path audit =="
check_no_legacy_patterns "runtime env files" \
  "$N8N_ENV_FILE" \
  "$N8N_BUSINESS_ENV_FILE" \
  "$EVOLUTION_ENV_FILE"
check_no_legacy_patterns "rendered system units" "$tmp_dir"
check_no_legacy_patterns "installed orb system units" \
  "/etc/systemd/system/$SKINCOS_N8N_SERVICE" \
  "/etc/systemd/system/$SKINCOS_ORB_PROXY_SERVICE" \
  "/etc/systemd/system/$SKINCOS_CLOUDFLARED_ORB_SERVICE" \
  "/etc/systemd/system/$SKINCOS_EVOLUTION_SERVICE" \
  "/etc/systemd/system/$SKINCOS_WATCHDOG_SERVICE" \
  "/etc/systemd/system/$SKINCOS_WATCHDOG_TIMER"

echo "== permissions =="
sudo -n -u skincos test -r "$N8N_ENV_FILE"
sudo -n -u skincos test -r "$N8N_BUSINESS_ENV_FILE"
sudo -n -u skincos test -r "$EVOLUTION_ENV_FILE"
sudo -n -u skincos test -w "$N8N_LOG_DIR"
sudo -n -u skincos test -w "$N8N_BINARY_DATA_DIR"
sudo -n -u skincos test -w "$N8N_TMP_DIR"

echo "== service status =="
sudo -n systemctl --no-pager --plain status \
  "$SKINCOS_N8N_SERVICE" \
  "$SKINCOS_ORB_PROXY_SERVICE" \
  "$SKINCOS_CLOUDFLARED_ORB_SERVICE" \
  "$SKINCOS_EVOLUTION_SERVICE" \
  "$SKINCOS_WATCHDOG_TIMER" 2>/dev/null || true

echo "== legacy user services =="
if systemctl --user is-active --quiet n8n.service orb-proxy.service cloudflared-orb.service evolution-api.service mini-pc-watchdog.timer; then
  echo "Legacy systemctl --user services are still active."
  if [[ "$SHARED_ONLY" == "1" ]]; then
    exit 1
  fi
else
  echo "legacy_user_services_inactive"
fi

echo "== live checks =="
check_live "n8n_local" "http://127.0.0.1:5678/healthz"
check_live "orb_proxy_local" "http://127.0.0.1:8788/meta-review/healthz"
check_live "orb_public" "https://orb.skincos.com.br/healthz"

echo "Preflight OK."
