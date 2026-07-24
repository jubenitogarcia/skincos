#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_SRC="$ROOT_DIR/ops/runtime/units"
UNIT_DEST="${UNIT_DEST:-/etc/systemd/system}"
# Code and durable recovery artifacts may remain on the Windows volume, but
# active state, private configuration, logs, caches and temporary files must
# never depend on DrvFS. These roots intentionally mirror the final runtime
# lifecycle contract.
SOURCE_ROOT="${SOURCE_ROOT:-}"
STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
LOG_ROOT="${LOG_ROOT:-/var/log/skincos}"
TMP_ROOT="${TMP_ROOT:-/var/tmp/skincos}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$STATE_ROOT/artifacts}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-lifecycle-units.sh [--apply]

Renders and verifies the final lifecycle units. Without --apply it only writes
temporary rendered units and runs systemd-analyze verify. With --apply it
installs, enables and daemon-reloads the final units.

Default native roots are /var/lib/skincos-runtime, /etc/skincos,
/var/log/skincos, /var/tmp/skincos and /var/backups/skincos. Runtime source is
read from /opt/skincos/current/source. A Windows Scheduled Task publishes each
verified native backup to C:\CodexRuntime; the WSL service never traverses C:.
The Windows task is the only backup scheduler; no WSL backup timer is installed.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

# Validation renders executables from the checkout without claiming that this
# is a runtime path. Applying units always uses the promoted native source.
if [[ -z "$SOURCE_ROOT" ]]; then
  if [[ "$APPLY" == "1" ]]; then
    SOURCE_ROOT="/opt/skincos/current/source"
  else
    SOURCE_ROOT="$ROOT_DIR"
  fi
fi

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

require_cmd sed
require_cmd systemd-analyze
VERIFY_WITH_SUDO=0
if [[ "$APPLY" == "1" || "$SOURCE_ROOT" == /opt/skincos/* ]]; then
  require_cmd sudo
  sudo -n true
  VERIFY_WITH_SUDO=1
fi

sed_escape() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
source_escaped="$(sed_escape "$SOURCE_ROOT")"
state_escaped="$(sed_escape "$STATE_ROOT")"
config_escaped="$(sed_escape "$CONFIG_ROOT")"
log_escaped="$(sed_escape "$LOG_ROOT")"
tmp_escaped="$(sed_escape "$TMP_ROOT")"
artifact_escaped="$(sed_escape "$ARTIFACT_ROOT")"
backup_escaped="$(sed_escape "$BACKUP_ROOT")"

units=(
  orb.service
  orb-proxy.service
  messaging-whatsapp.service
  crm.service
  crm-jobs.service
  booking.service
  cloudflare-orb.service
  cloudflare-runtime.service
  orb-backup.service
)

# crm-jobs is rendered and installed with the native release, but it remains
# disabled until a reviewed staging run explicitly enables it. This prevents a
# general lifecycle install or host reboot from activating a new worker path.
enabled_units=(
  orb.service
  orb-proxy.service
  messaging-whatsapp.service
  crm.service
  booking.service
  cloudflare-orb.service
  cloudflare-runtime.service
  orb-backup.service
)

render_dir="$(mktemp -d)"
trap 'rm -rf "$render_dir"' EXIT
rendered=()
for unit in "${units[@]}"; do
  source_file="$UNIT_SRC/$unit"
  [[ -f "$source_file" ]] || { echo "Missing unit template: $source_file" >&2; exit 1; }
  output="$render_dir/$unit"
  sed \
    -e "s|__REPO_ROOT__|$source_escaped|g" \
    -e "s|__STATE_ROOT__|$state_escaped|g" \
    -e "s|__CONFIG_ROOT__|$config_escaped|g" \
    -e "s|__LOG_ROOT__|$log_escaped|g" \
    -e "s|__TMP_ROOT__|$tmp_escaped|g" \
    -e "s|__ARTIFACT_ROOT__|$artifact_escaped|g" \
    -e "s|__BACKUP_ROOT__|$backup_escaped|g" \
    "$source_file" >"$output"
  chmod 0644 "$output"
  rendered+=("$output")
done

if [[ "$VERIFY_WITH_SUDO" == "1" ]]; then
  sudo -n systemd-analyze verify "${rendered[@]}"
else
  systemd-analyze verify "${rendered[@]}"
fi
echo "Lifecycle unit templates verify successfully."
printf '  %s\n' "${units[@]}"

if [[ "$APPLY" == "1" ]]; then
  [[ -d "$SOURCE_ROOT" ]] || { echo "Native source release is unavailable: $SOURCE_ROOT" >&2; exit 1; }
  sudo -n mkdir -p "$UNIT_DEST"
  for index in "${!units[@]}"; do
    sudo -n install -m 0644 "${rendered[$index]}" "$UNIT_DEST/${units[$index]}"
  done
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable "${enabled_units[@]}" >/dev/null
  echo "Lifecycle units installed. crm-jobs.service remains disabled until the reviewed staging runbook enables it. Windows Task Scheduler exclusively owns the Orb backup schedule."
fi
