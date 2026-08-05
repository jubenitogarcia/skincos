#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_SRC="$ROOT_DIR/ops/runtime/units/crm-clientes-source-refresh.service"
TIMER_SRC="$ROOT_DIR/ops/runtime/units/crm-clientes-source-refresh.timer"
UNIT_DEST="${UNIT_DEST:-/etc/systemd/system}"
SOURCE_ROOT="${SOURCE_ROOT:-$ROOT_DIR}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos/clientes}"
LOG_ROOT="${LOG_ROOT:-/var/log/skincos}"
APPLY=0
ENABLE=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-clientes-source-refresh-service.sh [--apply] [--enable]

Without --apply, renders and verifies the Clientes source refresh service and
timer. --apply installs both units and reloads systemd. --enable enables only
the timer; it never starts a refresh immediately. The private
crm-clientes-source-refresh.env keeps the action at --dry-run unless an
operator explicitly supplies --apply and CRM_CLIENTES_SOURCE_REFRESH_APPLY_CONFIRMED=1.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --enable) ENABLE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

if [[ "$ENABLE" == "1" && "$APPLY" != "1" ]]; then
  echo '--enable requires --apply' >&2
  exit 64
fi
command -v sed >/dev/null 2>&1 || { echo 'Missing required command: sed' >&2; exit 1; }
command -v systemd-analyze >/dev/null 2>&1 || { echo 'Missing required command: systemd-analyze' >&2; exit 1; }
if [[ "$APPLY" == "1" ]]; then
  command -v sudo >/dev/null 2>&1 || { echo 'Missing required command: sudo' >&2; exit 1; }
  sudo -n true
fi

escape() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
render_dir="$(mktemp -d)"
trap 'rm -rf "$render_dir"' EXIT
rendered_service="$render_dir/crm-clientes-source-refresh.service"
rendered_timer="$render_dir/crm-clientes-source-refresh.timer"
for pair in \
  "$UNIT_SRC:$rendered_service" \
  "$TIMER_SRC:$rendered_timer"; do
  src="${pair%%:*}"
  dest="${pair#*:}"
  [[ -f "$src" ]] || { echo "Missing unit template: $src" >&2; exit 1; }
  sed \
    -e "s|__REPO_ROOT__|$(escape "$SOURCE_ROOT")|g" \
    -e "s|__CONFIG_ROOT__|$(escape "$CONFIG_ROOT")|g" \
    -e "s|__BACKUP_ROOT__|$(escape "$BACKUP_ROOT")|g" \
    -e "s|__LOG_ROOT__|$(escape "$LOG_ROOT")|g" \
    "$src" >"$dest"
done

systemd-analyze verify "$rendered_service" "$rendered_timer"

if [[ "$APPLY" == "1" ]]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  sudo -n install -d -m 0750 "$BACKUP_ROOT"
  for unit in crm-clientes-source-refresh.service crm-clientes-source-refresh.timer; do
    if sudo -n test -f "$UNIT_DEST/$unit"; then
      sudo -n cp -p "$UNIT_DEST/$unit" "$BACKUP_ROOT/$unit.$stamp"
    fi
  done
  sudo -n install -m 0644 "$rendered_service" "$UNIT_DEST/crm-clientes-source-refresh.service"
  sudo -n install -m 0644 "$rendered_timer" "$UNIT_DEST/crm-clientes-source-refresh.timer"
  sudo -n systemctl daemon-reload
  if [[ "$ENABLE" == "1" ]]; then
    sudo -n systemctl enable crm-clientes-source-refresh.timer >/dev/null
  fi
  echo 'Clientes source refresh units installed; no refresh start was requested.'
else
  echo 'Clientes source refresh service and timer templates verify successfully.'
fi
