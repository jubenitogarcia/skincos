#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${SOURCE_ROOT:-}"
UNIT_SRC="${UNIT_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../ops/runtime/units" && pwd)}"
UNIT_DEST="${UNIT_DEST:-/etc/systemd/system}"
STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
LOG_ROOT="${LOG_ROOT:-/var/log/skincos}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos/clientes}"
APPLY=0

usage() { echo "Usage: $0 --source-root /opt/skincos/releases/<sha>/source [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root) shift; SOURCE_ROOT="${1:-}" ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

[[ "$SOURCE_ROOT" == /opt/skincos/releases/*/source ]] || { echo "SOURCE_ROOT must be an immutable native release path." >&2; exit 1; }
sudo -n test -d "$SOURCE_ROOT" && sudo -n test -x "$SOURCE_ROOT/scripts/crm/run-api-linux.sh" || { echo "Native source release is unavailable: $SOURCE_ROOT" >&2; exit 1; }
command -v sed >/dev/null 2>&1 || { echo "Missing sed" >&2; exit 1; }
command -v systemd-analyze >/dev/null 2>&1 || { echo "Missing systemd-analyze" >&2; exit 1; }
sudo -n true

sed_escape() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
render_dir="$(mktemp -d)"
trap 'rm -rf "$render_dir"' EXIT
source_escaped="$(sed_escape "$SOURCE_ROOT")"
state_escaped="$(sed_escape "$STATE_ROOT")"
config_escaped="$(sed_escape "$CONFIG_ROOT")"
log_escaped="$(sed_escape "$LOG_ROOT")"
rendered="$render_dir/crm-atendimento-staging.service"
sed \
  -e "s|__REPO_ROOT__|$source_escaped|g" \
  -e "s|__STATE_ROOT__|$state_escaped|g" \
  -e "s|__CONFIG_ROOT__|$config_escaped|g" \
  -e "s|__LOG_ROOT__|$log_escaped|g" \
  "$UNIT_SRC/crm-atendimento-staging.service" >"$rendered"
chmod 0644 "$rendered"
sudo -n systemd-analyze verify "$rendered"

if [[ "$APPLY" == "1" ]]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  sudo -n install -d -m 0700 -o root -g root "$BACKUP_ROOT"
  if sudo -n test -f "$UNIT_DEST/crm-atendimento-staging.service"; then
    sudo -n cp -p "$UNIT_DEST/crm-atendimento-staging.service" "$BACKUP_ROOT/${stamp}-crm-atendimento-staging.service"
  fi
  sudo -n install -m 0644 "$rendered" "$UNIT_DEST/crm-atendimento-staging.service"
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable --now crm-atendimento-staging.service >/dev/null
  sudo -n systemctl is-active --quiet crm-atendimento-staging.service
fi

if [[ "$APPLY" == "1" ]]; then
  echo "crm-atendimento-staging.service verified and applied source=$SOURCE_ROOT"
else
  echo "crm-atendimento-staging.service verified source=$SOURCE_ROOT"
fi
