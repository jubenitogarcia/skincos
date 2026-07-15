#!/usr/bin/env bash
set -euo pipefail

# Promotion is intentionally a native filesystem rename. Legacy services read
# C:\CodexRuntime, so a failed lifecycle cutover can restart them without
# consuming or deleting this staged state.

STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
STAGED_HOME=""
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/promote-orb-state-staging.sh --staged-home <native-path> [--apply]

Moves a checksum-verified staged n8n-home into the final native Orb state
location. Any pre-existing native destination is renamed to a timestamped
checkpoint; it is never deleted by this helper.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --staged-home) STAGED_HOME="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

[[ -n "$STAGED_HOME" ]] && sudo -n test -d "$STAGED_HOME" || { echo "--staged-home must name an existing directory." >&2; exit 1; }
sudo -n test -f "$STAGED_HOME/.n8n/config" && sudo -n test -f "$STAGED_HOME/database.sqlite" && sudo -n test -f "$STAGED_HOME/state-archive.manifest" || {
  echo "Staged Orb state is incomplete or was not produced by the archive helper." >&2; exit 1;
}
native_staging="$(sudo -n realpath "$STATE_ROOT/staging")"
native_home="$(sudo -n realpath "$STAGED_HOME")"
[[ "$native_home" == "$native_staging"/* ]] || { echo "Staged Orb state must remain under $native_staging." >&2; exit 1; }

destination="$STATE_ROOT/orb/n8n-home"
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
checkpoint="$STATE_ROOT/orb/n8n-home.pre-cutover-$timestamp"
echo "Would promote $native_home -> $destination"
if [[ "$APPLY" != "1" ]]; then
  exit 0
fi

command -v sudo >/dev/null 2>&1 || { echo "Missing sudo." >&2; exit 1; }
sudo -n true
sudo -n install -d -o skincos -g skincos -m 0750 "$STATE_ROOT/orb"
if sudo -n test -e "$destination"; then
  sudo -n mv "$destination" "$checkpoint"
  echo "Preserved previous native Orb state at $checkpoint"
fi
sudo -n mv "$native_home" "$destination"
echo "PROMOTED_ORB_STATE_HOME=$destination"
