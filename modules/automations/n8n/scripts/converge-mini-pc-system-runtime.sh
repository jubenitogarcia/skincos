#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

APPLY=0
SKIP_VALIDATION=0
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="$N8N_RUNTIME_HOME/exports/system-runtime-cutover-$backup_stamp"

usage() {
  cat <<'EOF'
Usage: scripts/converge-mini-pc-system-runtime.sh [--apply] [--skip-validation]

Converges the live mini-PC runtime to a single machine-scoped model:
- code in C:\CodexShared\Projetos\skincos
- runtime in C:\CodexRuntime\n8n
- Linux system services under User=skincos
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --skip-validation) SKIP_VALIDATION=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
  shift
done

ensure_dir() {
  mkdir -p "$1"
}

append_if_missing() {
  local file="$1"
  local key="$2"
  local value="$3"
  if ! grep -q "^${key}=" "$file" 2>/dev/null; then
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
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

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1"
    exit 1
  }
}

require_cmd sudo
require_cmd systemctl

echo "== target model =="
echo "shared_root=$ROOT_DIR"
echo "runtime_home=$N8N_RUNTIME_HOME"
echo "n8n_env_file=$N8N_ENV_FILE"
echo "n8n_business_env_file=$N8N_BUSINESS_ENV_FILE"
echo "evolution_env_file=$EVOLUTION_ENV_FILE"
echo "cloudflared_home=$CLOUDFLARED_HOME"

if [[ "$APPLY" != "1" ]]; then
  echo "Dry run only. Use --apply to execute."
  exit 0
fi

ensure_dir "$backup_root/systemd-user"
ensure_dir "$backup_root/systemd-system"
ensure_dir "$backup_root/etc-skincos"
ensure_dir "$backup_root/runtime-env"

cp -p "$N8N_ENV_FILE" "$backup_root/runtime-env/" 2>/dev/null || true
cp -p "$N8N_BUSINESS_ENV_FILE" "$backup_root/runtime-env/" 2>/dev/null || true
cp -p "$EVOLUTION_ENV_FILE" "$backup_root/runtime-env/" 2>/dev/null || true
cp -p "$HOME/.config/systemd/user/"{n8n.service,orb-proxy.service,cloudflared-orb.service,evolution-api.service,mini-pc-watchdog.service,mini-pc-watchdog.timer} "$backup_root/systemd-user/" 2>/dev/null || true
sudo -n cp -p /etc/systemd/system/skincos-*.service /etc/systemd/system/skincos-*.timer "$backup_root/systemd-system/" 2>/dev/null || true
sudo -n cp -pr /etc/skincos/. "$backup_root/etc-skincos/" 2>/dev/null || true

ensure_dir "$N8N_RUNTIME_HOME/env"
ensure_dir "$CLOUDFLARED_HOME"
ensure_dir "$N8N_LOG_DIR"
ensure_dir "$N8N_HEALTH_DIR"
ensure_dir "$N8N_TMP_DIR"
ensure_dir "$N8N_BINARY_DATA_DIR"
ensure_dir "$N8N_DATA_HOME"
ensure_dir "$EVOLUTION_INSTANCES_DIR"
ensure_dir "$EVOLUTION_STORE_DIR"

if [[ ! -f "$N8N_BUSINESS_ENV_FILE" ]]; then
  cat >"$N8N_BUSINESS_ENV_FILE" <<'EOF'
# Shared n8n business env contract
N8N_PUBLIC_BASE_URL=https://orb.skincos.com.br
EVOLUTION_BASE_URL=https://wa.skincos.com.br
EVOLUTION_INSTANCE_NAME=skincos
EVOLUTION_API_KEY=
DATABASE_URL=
N8N_DEFAULT_UNIT_SLUG=
N8N_DEFAULT_UNIT_NAME=
N8N_UNIT_NAME_MAP=
N8N_HANDOFF_NOTIFY_NUMBER=
GOOGLE_CALENDAR_ID=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://orb.skincos.com.br/rest/oauth2-credential/callback
N8N_DEFAULT_TEST_PHONE=
EOF
fi

if [[ -f "$EVOLUTION_ENV_FILE" ]]; then
  evolution_key="$(/usr/bin/grep -E '^AUTHENTICATION_API_KEY=' "$EVOLUTION_ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '\r' || true)"
  if [[ -n "$evolution_key" ]]; then
    if grep -q '^EVOLUTION_API_KEY=$' "$N8N_BUSINESS_ENV_FILE" 2>/dev/null; then
      sed -i "s|^EVOLUTION_API_KEY=$|EVOLUTION_API_KEY=$evolution_key|" "$N8N_BUSINESS_ENV_FILE"
    else
      append_if_missing "$N8N_BUSINESS_ENV_FILE" "EVOLUTION_API_KEY" "$evolution_key"
    fi
  fi
fi

append_if_missing "$N8N_BUSINESS_ENV_FILE" "N8N_PUBLIC_BASE_URL" "https://orb.skincos.com.br"
append_if_missing "$N8N_BUSINESS_ENV_FILE" "EVOLUTION_BASE_URL" "https://wa.skincos.com.br"
append_if_missing "$N8N_BUSINESS_ENV_FILE" "EVOLUTION_INSTANCE_NAME" "skincos"
append_if_missing "$N8N_BUSINESS_ENV_FILE" "GOOGLE_REDIRECT_URI" "https://orb.skincos.com.br/rest/oauth2-credential/callback"
upsert_env_line "$N8N_ENV_FILE" "META_REVIEW_STORE_PATH" "$N8N_TMP_DIR/meta-review-store.json"
upsert_env_line "$N8N_ENV_FILE" "N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS" "false"

if [[ -d /etc/skincos/cloudflared ]]; then
  cp -pn /etc/skincos/cloudflared/orb-config.yml "$CLOUDFLARED_HOME/" 2>/dev/null || true
  cp -pn /etc/skincos/cloudflared/1fc962f3-41d2-4140-8a03-d10b6f4dc76c.json "$CLOUDFLARED_HOME/" 2>/dev/null || true
fi

bash "$ROOT_DIR/scripts/install-mini-pc-system-services.sh"
sudo -n N8N_RUNTIME_HOME="$N8N_RUNTIME_HOME" node "$ROOT_DIR/scripts/patch-cloudinary-node-output.js" --apply

systemctl --user stop mini-pc-watchdog.timer cloudflared-orb.service orb-proxy.service n8n.service evolution-api.service >/dev/null 2>&1 || true
systemctl --user disable mini-pc-watchdog.timer cloudflared-orb.service orb-proxy.service n8n.service evolution-api.service >/dev/null 2>&1 || true

sudo -n systemctl restart \
  "$SKINCOS_N8N_SERVICE" \
  "$SKINCOS_ORB_PROXY_SERVICE" \
  "$SKINCOS_CLOUDFLARED_ORB_SERVICE" \
  "$SKINCOS_EVOLUTION_SERVICE"
sudo -n systemctl restart "$SKINCOS_WATCHDOG_TIMER"

if [[ "$SKIP_VALIDATION" != "1" ]]; then
  bash "$ROOT_DIR/scripts/validate-mini-pc-system-runtime.sh"
fi

echo "Converged to system services under User=skincos."
echo "Rollback backup: $backup_root"
