#!/usr/bin/env bash
set -euo pipefail

# Pre-copy only. This script never restarts, enables, disables or deletes a
# unit. The short cutover script is intentionally a separate, reviewed step.

RUNTIME_ROOT="${RUNTIME_ROOT:-/mnt/c/CodexRuntime}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-lifecycle-layout.sh [--apply]

Creates the lifecycle layout under C:\CodexRuntime and pre-copies mutable
runtime state from the legacy layout. Without --apply it reports the planned
copies only. It never deletes legacy data or changes an installed service.
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

require_cmd rsync

legacy_orb="$RUNTIME_ROOT/n8n"
legacy_crm="$RUNTIME_ROOT/crm-api"
legacy_booking="$RUNTIME_ROOT/booking-api"

declare -a directories=(
  "$RUNTIME_ROOT/state/orb"
  "$RUNTIME_ROOT/state/messaging-whatsapp"
  "$RUNTIME_ROOT/state/crm"
  "$RUNTIME_ROOT/state/booking"
  "$RUNTIME_ROOT/config/cloudflare/orb"
  "$RUNTIME_ROOT/config/cloudflare/runtime"
  "$RUNTIME_ROOT/logs/orb"
  "$RUNTIME_ROOT/logs/messaging-whatsapp"
  "$RUNTIME_ROOT/logs/crm"
  "$RUNTIME_ROOT/logs/booking"
  "$RUNTIME_ROOT/backups/orb"
  "$RUNTIME_ROOT/backups/messaging-whatsapp"
  "$RUNTIME_ROOT/backups/crm"
  "$RUNTIME_ROOT/backups/booking"
  "$RUNTIME_ROOT/artifacts/booking"
  "$RUNTIME_ROOT/cache/orb"
  "$RUNTIME_ROOT/cache/messaging-whatsapp"
  "$RUNTIME_ROOT/cache/crm"
  "$RUNTIME_ROOT/cache/booking"
  "$RUNTIME_ROOT/tmp/orb"
  "$RUNTIME_ROOT/tmp/messaging-whatsapp"
  "$RUNTIME_ROOT/tmp/crm"
  "$RUNTIME_ROOT/tmp/booking"
  "$RUNTIME_ROOT/secrets"
)

copy_if_exists() {
  local source="$1"
  local destination="$2"
  if [[ ! -e "$source" ]]; then
    echo "SKIP missing: $source"
    return
  fi
  echo "COPY $source -> $destination"
  if [[ "$APPLY" == "1" ]]; then
    mkdir -p "$destination"
    rsync -a --ignore-existing "$source" "$destination/"
  fi
}

copy_secret_if_missing() {
  local source="$1"
  local destination="$2"
  if [[ ! -f "$source" ]]; then
    echo "SKIP missing secret: $source"
    return
  fi
  echo "SECRET $source -> $destination"
  if [[ "$APPLY" == "1" && ! -e "$destination" ]]; then
    install -m 0600 "$source" "$destination"
  fi
}

echo "Runtime root: $RUNTIME_ROOT"
echo "Mode: $([[ "$APPLY" == "1" ]] && echo pre-copy || echo dry-run)"
for directory in "${directories[@]}"; do
  echo "DIR $directory"
  [[ "$APPLY" == "1" ]] && mkdir -p "$directory"
done

copy_if_exists "$legacy_orb/n8n-home" "$RUNTIME_ROOT/state/orb"
copy_if_exists "$legacy_orb/evolution-api/instances" "$RUNTIME_ROOT/state/messaging-whatsapp"
copy_if_exists "$legacy_orb/evolution-api/store" "$RUNTIME_ROOT/state/messaging-whatsapp"
copy_if_exists "$legacy_orb/logs/." "$RUNTIME_ROOT/logs/orb"
copy_if_exists "$legacy_crm/var" "$RUNTIME_ROOT/state/crm"
copy_if_exists "$legacy_booking/report" "$RUNTIME_ROOT/artifacts/booking"
copy_if_exists "$legacy_booking/debug" "$RUNTIME_ROOT/artifacts/booking"
copy_if_exists "$legacy_booking/chrome-profile" "$RUNTIME_ROOT/state/booking"
copy_if_exists "$legacy_booking/venv" "$RUNTIME_ROOT/state/booking"

copy_secret_if_missing "$legacy_orb/env/n8n.env" "$RUNTIME_ROOT/secrets/orb.env"
copy_secret_if_missing "$legacy_orb/env/n8n-business.env" "$RUNTIME_ROOT/secrets/orb-business.env"
copy_secret_if_missing "$legacy_orb/env/evolution-api.env" "$RUNTIME_ROOT/secrets/messaging-whatsapp.env"
copy_secret_if_missing "$legacy_crm/env/crm-api.env" "$RUNTIME_ROOT/secrets/crm.env"
copy_secret_if_missing "$legacy_booking/env/booking-api.env" "$RUNTIME_ROOT/secrets/booking.env"

if [[ "$APPLY" == "1" ]]; then
  chmod 0700 "$RUNTIME_ROOT/secrets"
  echo "Pre-copy complete. Legacy runtime was preserved; run the separate cutover checklist only after a fresh validated backup."
else
  echo "Dry run complete. Use --apply only after the source PR, backup checkpoint and service cutover plan are approved."
fi
