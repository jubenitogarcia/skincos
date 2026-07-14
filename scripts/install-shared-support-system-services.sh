#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SRC="$ROOT_DIR/ops/runtime/units"
UNIT_DEST="${UNIT_DEST:-/etc/systemd/system}"
REPO_ROOT="${REPO_ROOT:-$ROOT_DIR}"
CRM_RUNTIME_HOME="${CRM_RUNTIME_HOME:-/mnt/c/CodexRuntime/crm-api}"
BOOKING_RUNTIME_HOME="${BOOKING_RUNTIME_HOME:-/mnt/c/CodexRuntime/booking-api}"
CS_CLOUDFLARED_HOME="${CS_CLOUDFLARED_HOME:-/mnt/c/CodexRuntime/cloudflared/cs}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/install-shared-support-system-services.sh [--apply]

Installs shared systemd units for:
- skincos-crm-api.service
- skincos-booking-api.service
- skincos-cloudflared-cs.service
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd sudo
require_cmd sed

mkdir -p \
  "$CRM_RUNTIME_HOME/env" \
  "$CRM_RUNTIME_HOME/var" \
  "$CRM_RUNTIME_HOME/var/core" \
  "$BOOKING_RUNTIME_HOME/env" \
  "$BOOKING_RUNTIME_HOME/debug" \
  "$BOOKING_RUNTIME_HOME/logs" \
  "$BOOKING_RUNTIME_HOME/report" \
  "$BOOKING_RUNTIME_HOME/chrome-profile" \
  "$CS_CLOUDFLARED_HOME"

if [[ ! -f "$CRM_RUNTIME_HOME/var/core/conversations_store.json" ]]; then
  cat >"$CRM_RUNTIME_HOME/var/core/conversations_store.json" <<'EOF'
{"conversations":[]}
EOF
fi

if [[ -f /etc/skincos/crm-api.env && ! -f "$CRM_RUNTIME_HOME/env/crm-api.env" ]]; then
  sudo -n cp /etc/skincos/crm-api.env "$CRM_RUNTIME_HOME/env/crm-api.env"
fi

if [[ -f /etc/skincos/booking-api.env && ! -f "$BOOKING_RUNTIME_HOME/env/booking-api.env" ]]; then
  sudo -n cp /etc/skincos/booking-api.env "$BOOKING_RUNTIME_HOME/env/booking-api.env"
fi

if [[ -f /etc/skincos/cloudflared/cs-skincos.yml && ! -f "$CS_CLOUDFLARED_HOME/cs-skincos.yml" ]]; then
  sudo -n cp /etc/skincos/cloudflared/cs-skincos.yml "$CS_CLOUDFLARED_HOME/cs-skincos.yml"
fi

if [[ -f "$CS_CLOUDFLARED_HOME/cs-skincos.yml" ]]; then
  cred_src="$(sudo -n awk '/credentials-file:/ {print $2}' "$CS_CLOUDFLARED_HOME/cs-skincos.yml" 2>/dev/null || true)"
  if [[ -n "$cred_src" && -f "$cred_src" && ! -f "$CS_CLOUDFLARED_HOME/$(basename "$cred_src")" ]]; then
    sudo -n cp "$cred_src" "$CS_CLOUDFLARED_HOME/"
  fi
fi

if [[ ! -f "$CS_CLOUDFLARED_HOME/cloudflared-cs.env" ]]; then
  cat >"$CS_CLOUDFLARED_HOME/cloudflared-cs.env" <<EOF
CLOUDFLARED_CONFIG_PATH=$CS_CLOUDFLARED_HOME/cs-skincos.yml
EOF
fi

sed_escape() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

repo_root_escaped="$(sed_escape "$REPO_ROOT")"
crm_runtime_home_escaped="$(sed_escape "$CRM_RUNTIME_HOME")"
booking_runtime_home_escaped="$(sed_escape "$BOOKING_RUNTIME_HOME")"
cs_cloudflared_home_escaped="$(sed_escape "$CS_CLOUDFLARED_HOME")"

units=(
  skincos-crm-api.service
  skincos-booking-api.service
  skincos-cloudflared-cs.service
)

if [[ "$APPLY" != "1" ]]; then
  echo "Dry run only. Use --apply to install/update shared support system services."
  printf '  %s\n' "${units[@]}"
  exit 0
fi

sudo -n mkdir -p "$UNIT_DEST"

for unit in "${units[@]}"; do
  src_path="$UNIT_SRC/$unit"
  dest_path="$UNIT_DEST/$unit"
  sed \
    -e "s|__REPO_ROOT__|$repo_root_escaped|g" \
    -e "s|__CRM_RUNTIME_HOME__|$crm_runtime_home_escaped|g" \
    -e "s|__BOOKING_RUNTIME_HOME__|$booking_runtime_home_escaped|g" \
    -e "s|__CS_CLOUDFLARED_HOME__|$cs_cloudflared_home_escaped|g" \
    "$src_path" | sudo -n tee "$dest_path" >/dev/null
  sudo -n chmod 0644 "$dest_path"
done

sudo -n systemctl daemon-reload
sudo -n systemctl enable \
  skincos-crm-api.service \
  skincos-booking-api.service \
  skincos-cloudflared-cs.service >/dev/null

echo "Shared support systemd units installed."
printf '  %s\n' "${units[@]}"
