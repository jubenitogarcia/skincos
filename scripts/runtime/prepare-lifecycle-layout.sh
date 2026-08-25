#!/usr/bin/env bash
set -euo pipefail

STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
LOG_ROOT="${LOG_ROOT:-/var/log/skincos}"
TMP_ROOT="${TMP_ROOT:-/var/tmp/skincos}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$STATE_ROOT/artifacts}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos}"
APPLY=0
SOURCE_SHA="${SKINCOS_GLOBAL_COORDINATION_SOURCE_SHA:-}"
COORDINATION_CLOSURE="${SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE:-}"
SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-lifecycle-layout.sh [--source-sha <full-sha>] [--coordination-closure <json>] [--apply]

Creates the final native Linux runtime layout with least-privilege ownership.
It never reads or copies legacy Windows/DrvFS state. State recovery must use a
validated native backup and the Windows-owned transfer procedure in the runbook.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --source-sha) [[ "$#" -ge 2 ]] || { echo '--source-sha requires a value' >&2; exit 64; }; SOURCE_SHA="$2"; shift ;;
    --coordination-closure) [[ "$#" -ge 2 ]] || { echo '--coordination-closure requires a value' >&2; exit 64; }; COORDINATION_CLOSURE="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

directories=(
  "$STATE_ROOT/messaging-whatsapp/instances"
  "$STATE_ROOT/messaging-whatsapp/store"
  "$STATE_ROOT/crm/var"
  "$STATE_ROOT/booking"
  "$STATE_ROOT/artifacts/booking/report"
  "$STATE_ROOT/artifacts/booking/debug"
  "$STATE_ROOT/cache/npm"
  "$STATE_ROOT/cache/crm-api"
  "$CONFIG_ROOT/cloudflare/runtime"
  "$LOG_ROOT/messaging-whatsapp"
  "$LOG_ROOT/crm"
  "$LOG_ROOT/booking"
  "$LOG_ROOT/cloudflare-runtime"
  "$TMP_ROOT/messaging-whatsapp"
  "$TMP_ROOT/crm"
  "$TMP_ROOT/booking"
  "$ARTIFACT_ROOT/booking"
)

printf 'Native lifecycle directories:\n'
printf '  %s\n' "${directories[@]}"
if [[ "$APPLY" != "1" ]]; then
  exit 0
fi

source "$SCRIPT_ROOT/scripts/runtime/global-coordination-native.sh"
resolved_source_root="$(readlink -f /opt/skincos/current/source)"
[[ "$resolved_source_root" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || {
  echo "Native runtime source is not an immutable release: $resolved_source_root" >&2
  exit 78
}
derived_source_sha="$(basename "$(dirname "$resolved_source_root")")"
if [[ -z "$SOURCE_SHA" ]]; then
  SOURCE_SHA="$derived_source_sha"
fi
[[ "$SOURCE_SHA" == "$derived_source_sha" && "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Lifecycle layout source SHA does not match the current immutable source.' >&2
  exit 78
}
if [[ -z "$COORDINATION_CLOSURE" ]]; then
  COORDINATION_CLOSURE="$resolved_source_root/.skincos-global-coordination-native-runtime.json"
fi
[[ -f "$COORDINATION_CLOSURE" ]] || {
  echo "Native-runtime coordination closure is unavailable: $COORDINATION_CLOSURE" >&2
  exit 78
}
native_coordination_init global:native-runtime native-runtime "$SOURCE_SHA" "$COORDINATION_CLOSURE" mutation
coordination_acquired=0
cleanup() {
  if [[ "$coordination_acquired" == '1' ]]; then
    native_coordination_cleanup || true
    coordination_acquired=0
  fi
}
trap cleanup EXIT INT TERM
native_coordination_acquire "mini-pc:global:native-runtime:layout:$SOURCE_SHA:$$" >/dev/null
coordination_acquired=1
native_coordination_check
sudo -n true
for directory in "${directories[@]}"; do
  native_coordination_check
  sudo -n install -d -o skincos -g skincos -m 0750 "$directory"
done
native_coordination_check
sudo -n chown root:skincos "$CONFIG_ROOT" "$CONFIG_ROOT/cloudflare" "$BACKUP_ROOT"
native_coordination_check
sudo -n chmod 0750 "$CONFIG_ROOT" "$CONFIG_ROOT/cloudflare" "$BACKUP_ROOT"
echo 'Native lifecycle layout prepared.'
