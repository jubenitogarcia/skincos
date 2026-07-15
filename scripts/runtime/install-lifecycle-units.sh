#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_SRC="$ROOT_DIR/ops/runtime/units"
UNIT_DEST="${UNIT_DEST:-/etc/systemd/system}"
# Code and durable recovery artifacts may remain on the Windows volume, but
# active state, private configuration, logs, caches and temporary files must
# never depend on DrvFS. These roots intentionally mirror the final runtime
# lifecycle contract.
RUNTIME_ROOT="${RUNTIME_ROOT:-/mnt/c/CodexRuntime}"
STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
LOG_ROOT="${LOG_ROOT:-/var/log/skincos}"
TMP_ROOT="${TMP_ROOT:-/var/tmp/skincos}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$RUNTIME_ROOT/artifacts}"
BACKUP_ROOT="${BACKUP_ROOT:-$RUNTIME_ROOT/backups}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-lifecycle-units.sh [--apply]

Renders and verifies the final lifecycle units. Without --apply it only writes
temporary rendered units and runs systemd-analyze verify. With --apply it
installs, enables and daemon-reloads the final units; it deliberately does not
stop or disable the old units. The coordinated cutover script owns that step.

Default native roots are /var/lib/skincos-runtime, /etc/skincos,
/var/log/skincos and /var/tmp/skincos. C:\CodexRuntime is retained only for
durable backups and artifacts unless explicit root overrides are supplied.
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

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

require_cmd sed
require_cmd systemd-analyze
if [[ "$APPLY" == "1" ]]; then require_cmd sudo; fi

sed_escape() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
repo_escaped="$(sed_escape "$ROOT_DIR")"
runtime_escaped="$(sed_escape "$RUNTIME_ROOT")"
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
    -e "s|__REPO_ROOT__|$repo_escaped|g" \
    -e "s|__RUNTIME_ROOT__|$runtime_escaped|g" \
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

rendered_timer="$render_dir/orb-backup.timer"
sed \
  -e "s|__REPO_ROOT__|$repo_escaped|g" \
  -e "s|__RUNTIME_ROOT__|$runtime_escaped|g" \
  -e "s|__STATE_ROOT__|$state_escaped|g" \
  -e "s|__CONFIG_ROOT__|$config_escaped|g" \
  -e "s|__LOG_ROOT__|$log_escaped|g" \
  -e "s|__TMP_ROOT__|$tmp_escaped|g" \
  -e "s|__ARTIFACT_ROOT__|$artifact_escaped|g" \
  -e "s|__BACKUP_ROOT__|$backup_escaped|g" \
  "$UNIT_SRC/orb-backup.timer" >"$rendered_timer"
chmod 0644 "$rendered_timer"
systemd-analyze verify "${rendered[@]}" "$rendered_timer"
echo "Lifecycle unit templates verify successfully."
printf '  %s\n' "${units[@]}"

if [[ "$APPLY" == "1" ]]; then
  sudo -n mkdir -p "$UNIT_DEST"
  for index in "${!units[@]}"; do
    sudo -n install -m 0644 "${rendered[$index]}" "$UNIT_DEST/${units[$index]}"
  done
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable "${units[@]}" >/dev/null
  sudo -n install -m 0644 "$rendered_timer" "$UNIT_DEST/orb-backup.timer"
  sudo -n systemctl enable orb-backup.timer >/dev/null
  echo "Lifecycle units installed and enabled. Old units remain untouched until cutover."
fi
