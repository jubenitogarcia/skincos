#!/usr/bin/env bash
set -euo pipefail

STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
LOG_ROOT="${LOG_ROOT:-/var/log/skincos}"
TMP_ROOT="${TMP_ROOT:-/var/tmp/skincos}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$STATE_ROOT/artifacts}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-lifecycle-layout.sh [--apply]

Creates the final native Linux runtime layout with least-privilege ownership.
It never reads or copies legacy Windows/DrvFS state. State recovery must use a
validated native backup and the Windows-owned transfer procedure in the runbook.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

directories=(
  "$STATE_ROOT/orb"
  "$STATE_ROOT/messaging-whatsapp/instances"
  "$STATE_ROOT/messaging-whatsapp/store"
  "$STATE_ROOT/crm/var"
  "$STATE_ROOT/booking"
  "$STATE_ROOT/artifacts/booking/report"
  "$STATE_ROOT/artifacts/booking/debug"
  "$STATE_ROOT/cache/npm"
  "$STATE_ROOT/cache/crm-api"
  "$CONFIG_ROOT/cloudflare/orb"
  "$CONFIG_ROOT/cloudflare/runtime"
  "$LOG_ROOT/orb"
  "$LOG_ROOT/messaging-whatsapp"
  "$LOG_ROOT/crm"
  "$LOG_ROOT/booking"
  "$LOG_ROOT/cloudflare-orb"
  "$LOG_ROOT/cloudflare-runtime"
  "$TMP_ROOT/orb"
  "$TMP_ROOT/messaging-whatsapp"
  "$TMP_ROOT/crm"
  "$TMP_ROOT/booking"
  "$ARTIFACT_ROOT/booking"
  "$BACKUP_ROOT/orb/daily"
)

printf 'Native lifecycle directories:\n'
printf '  %s\n' "${directories[@]}"
if [[ "$APPLY" != "1" ]]; then
  exit 0
fi

sudo -n true
for directory in "${directories[@]}"; do
  sudo -n install -d -o skincos -g skincos -m 0750 "$directory"
done
sudo -n chown root:skincos "$CONFIG_ROOT" "$CONFIG_ROOT/cloudflare" "$BACKUP_ROOT" "$BACKUP_ROOT/orb"
sudo -n chmod 0750 "$CONFIG_ROOT" "$CONFIG_ROOT/cloudflare" "$BACKUP_ROOT" "$BACKUP_ROOT/orb"

overlay="$(mktemp)"
trap 'rm -f "$overlay"' EXIT
cat >"$overlay" <<EOF
N8N_RESTRICT_FILE_ACCESS_TO=/tmp
META_REVIEW_STORE_PATH=$STATE_ROOT/orb/meta-review-store.json
N8N_USER_FOLDER=$STATE_ROOT/orb/n8n-home
N8N_STORAGE_PATH=$STATE_ROOT/orb/n8n-home/.n8n/storage
N8N_LOG_FILE_LOCATION=$LOG_ROOT/orb/n8n.log
EOF
sudo -n install -o root -g skincos -m 0640 "$overlay" "$CONFIG_ROOT/orb-runtime-paths.env"
echo 'Native lifecycle layout prepared.'
