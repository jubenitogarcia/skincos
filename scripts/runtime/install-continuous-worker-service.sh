#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_SRC="$ROOT_DIR/ops/runtime/units/crm-jobs.service"
UNIT_DEST="${UNIT_DEST:-/etc/systemd/system}"
SOURCE_ROOT="${SOURCE_ROOT:-$ROOT_DIR}"
STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
LOG_ROOT="${LOG_ROOT:-/var/log/skincos}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos}"
APPLY=0
ENABLE=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-continuous-worker-service.sh [--apply] [--enable]

Without --apply, renders the CRM continuous-worker unit in a temporary
directory and verifies it with systemd-analyze. --apply installs only the
unit and reloads systemd. --enable additionally enables it; it never starts
the service. Runtime execution remains disabled until the private
crm-jobs.env explicitly sets CRM_CONTINUOUS_WORKERS_ENABLED=1 and, for the
Clientes job set, CRM_CONTINUOUS_JOBS_ENABLED=1.
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
  echo "--enable requires --apply" >&2
  exit 64
fi

[[ -f "$UNIT_SRC" ]] || { echo "Missing unit template: $UNIT_SRC" >&2; exit 1; }
command -v sed >/dev/null 2>&1 || { echo "Missing required command: sed" >&2; exit 1; }
command -v systemd-analyze >/dev/null 2>&1 || { echo "Missing required command: systemd-analyze" >&2; exit 1; }
if [[ "$APPLY" == "1" ]]; then
  command -v sudo >/dev/null 2>&1 || { echo "Missing required command: sudo" >&2; exit 1; }
  sudo -n true
fi

escape() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
render_dir="$(mktemp -d)"
trap 'rm -rf "$render_dir"' EXIT
rendered="$render_dir/crm-jobs.service"
sed \
  -e "s|__REPO_ROOT__|$(escape "$SOURCE_ROOT")|g" \
  -e "s|__STATE_ROOT__|$(escape "$STATE_ROOT")|g" \
  -e "s|__CONFIG_ROOT__|$(escape "$CONFIG_ROOT")|g" \
  -e "s|__LOG_ROOT__|$(escape "$LOG_ROOT")|g" \
  "$UNIT_SRC" >"$rendered"

systemd-analyze verify "$rendered"

if [[ "$APPLY" == "1" ]]; then
  if sudo -n test -f "$UNIT_DEST/crm-jobs.service"; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    sudo -n install -d -m 0750 "$BACKUP_ROOT"
    sudo -n cp -p "$UNIT_DEST/crm-jobs.service" "$BACKUP_ROOT/crm-jobs.service.$stamp"
  fi
  sudo -n install -m 0644 "$rendered" "$UNIT_DEST/crm-jobs.service"
  sudo -n systemctl daemon-reload
  if [[ "$ENABLE" == "1" ]]; then
    sudo -n systemctl enable crm-jobs.service >/dev/null
  fi
  echo "CRM continuous-worker unit installed; no service start was requested."
else
  echo "CRM continuous-worker unit template verifies successfully."
fi
