#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_SRC="$ROOT_DIR/ops/runtime/units/crm-clientes-source-operations.service"
UNIT_DEST="${UNIT_DEST:-/etc/systemd/system}"
SOURCE_ROOT="${SOURCE_ROOT:-$ROOT_DIR}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos/clientes/source-operations}"
LOG_ROOT="${LOG_ROOT:-/var/log/skincos}"
APPLY=0
ENABLE=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-clientes-source-operations-service.sh [--apply] [--enable]

Without --apply, renders and verifies the unit. --apply installs and reloads
systemd, but never starts the worker. --enable only enables the unit after
installation; the environment remains disabled/dry-run until explicitly changed.
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
[[ "$ENABLE" == "0" || "$APPLY" == "1" ]] || { echo '--enable requires --apply' >&2; exit 64; }
command -v sed >/dev/null 2>&1 || { echo 'Missing required command: sed' >&2; exit 1; }
command -v systemd-analyze >/dev/null 2>&1 || { echo 'Missing required command: systemd-analyze' >&2; exit 1; }
if [[ "$APPLY" == "1" ]]; then command -v sudo >/dev/null 2>&1 || { echo 'Missing required command: sudo' >&2; exit 1; }; sudo -n true; fi

escape() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
render_dir="$(mktemp -d)"
trap 'rm -rf "$render_dir"' EXIT
rendered="$render_dir/crm-clientes-source-operations.service"
sed \
  -e "s|__REPO_ROOT__|$(escape "$SOURCE_ROOT")|g" \
  -e "s|__CONFIG_ROOT__|$(escape "$CONFIG_ROOT")|g" \
  -e "s|__BACKUP_ROOT__|$(escape "$BACKUP_ROOT")|g" \
  -e "s|__LOG_ROOT__|$(escape "$LOG_ROOT")|g" \
  "$UNIT_SRC" >"$rendered"
systemd-analyze verify "$rendered"

if [[ "$APPLY" == "1" ]]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  sudo -n install -d -o root -g skincos -m 0770 "$BACKUP_ROOT"
  sudo -n install -d -o skincos -g skincos -m 0750 "$LOG_ROOT/crm-clientes-source-operations"
  if sudo -n test -f "$UNIT_DEST/crm-clientes-source-operations.service"; then sudo -n cp -p "$UNIT_DEST/crm-clientes-source-operations.service" "$BACKUP_ROOT/crm-clientes-source-operations.service.$stamp"; fi
  sudo -n install -m 0644 "$rendered" "$UNIT_DEST/crm-clientes-source-operations.service"
  sudo -n systemctl daemon-reload
  if [[ "$ENABLE" == "1" ]]; then sudo -n systemctl enable crm-clientes-source-operations.service >/dev/null; fi
  echo 'Clientes source operations unit installed; no worker start was requested.'
else
  echo 'Clientes source operations unit verifies successfully.'
fi
