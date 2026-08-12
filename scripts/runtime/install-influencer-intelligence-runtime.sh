#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_SRC="$ROOT_DIR/ops/runtime/units"
UNIT_DEST="${UNIT_DEST:-/etc/systemd/system}"
SOURCE_ROOT="${SOURCE_ROOT:-}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
LOG_ROOT="${LOG_ROOT:-/var/log/skincos}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-influencer-intelligence-runtime.sh [--apply]

Registers the Influencer Intelligence internal service and read-only MCP unit
files, validates them, and leaves both units disabled. Without --apply it only
renders temporary units and runs systemd-analyze verify. Applying requires an
immutable /opt/skincos/releases/<sha>/source source. The installer creates a
private configuration file only when it does not already exist; its defaults
are flag=false, empty service credentials, loopback-only listeners, and no
Orb import or workflow activation.
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

if [[ -z "$SOURCE_ROOT" ]]; then
  if [[ "$APPLY" == '1' ]]; then SOURCE_ROOT='/opt/skincos/current/source'; else SOURCE_ROOT="$ROOT_DIR"; fi
fi

command -v sed >/dev/null 2>&1 || { echo 'Missing required command: sed' >&2; exit 1; }
command -v systemd-analyze >/dev/null 2>&1 || { echo 'Missing required command: systemd-analyze' >&2; exit 1; }
command -v readlink >/dev/null 2>&1 || { echo 'Missing required command: readlink' >&2; exit 1; }

if [[ "$APPLY" == '1' ]]; then
  command -v sudo >/dev/null 2>&1 || { echo 'Missing required command: sudo' >&2; exit 1; }
  sudo -n true
  resolved_source_root="$(readlink -f "$SOURCE_ROOT")"
  [[ "$resolved_source_root" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || {
    echo "Applied registration requires an immutable /opt/skincos/releases/<sha>/source target: $resolved_source_root" >&2
    exit 78
  }
  SOURCE_ROOT="$resolved_source_root"
fi

sed_escape() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
source_escaped="$(sed_escape "$SOURCE_ROOT")"
state_escaped="$(sed_escape "$STATE_ROOT")"
config_escaped="$(sed_escape "$CONFIG_ROOT")"
log_escaped="$(sed_escape "$LOG_ROOT")"

units=(influencer-intelligence.service influencer-intelligence-mcp.service)
render_dir="$(mktemp -d)"
cleanup() { rm -rf "$render_dir"; }
trap cleanup EXIT INT TERM
rendered=()
for unit in "${units[@]}"; do
  source_file="$UNIT_SRC/$unit"
  [[ -f "$source_file" ]] || { echo "Missing unit template: $source_file" >&2; exit 1; }
  output="$render_dir/$unit"
  sed -e "s|__REPO_ROOT__|$source_escaped|g" \
      -e "s|__STATE_ROOT__|$state_escaped|g" \
      -e "s|__CONFIG_ROOT__|$config_escaped|g" \
      -e "s|__LOG_ROOT__|$log_escaped|g" \
      "$source_file" >"$output"
  chmod 0644 "$output"
  rendered+=("$output")
done

systemd-analyze verify "${rendered[@]}"
echo 'Influencer Intelligence runtime registration units verify successfully.'
printf '  %s\n' "${units[@]}"

if [[ "$APPLY" == '1' ]]; then
  for unit in "${units[@]}"; do
    if sudo -n systemctl is-active --quiet "$unit"; then
      echo "Refusing registration while existing unit is active: $unit" >&2
      exit 78
    fi
  done
  sudo -n install -d -m 0750 "$UNIT_DEST" "$CONFIG_ROOT" "$STATE_ROOT/influencer-intelligence" "$LOG_ROOT/influencer-intelligence"
  for index in "${!units[@]}"; do
    sudo -n install -m 0644 "${rendered[$index]}" "$UNIT_DEST/${units[$index]}"
  done
  config_file="$CONFIG_ROOT/influencer-intelligence.env"
  if ! sudo -n test -e "$config_file"; then
    config_tmp="$(mktemp)"
    trap 'rm -rf "$render_dir" "$config_tmp"' EXIT INT TERM
    printf '%s\n' \
      'INFLUENCER_INTELLIGENCE_ENABLED=false' \
      'INFLUENCER_INTELLIGENCE_SERVICE_HOST=127.0.0.1' \
      'INFLUENCER_INTELLIGENCE_SERVICE_PORT=8899' \
      'INFLUENCER_INTELLIGENCE_MCP_HOST=127.0.0.1' \
      'INFLUENCER_INTELLIGENCE_MCP_PORT=8767' \
      'INFLUENCER_INTELLIGENCE_SERVICE_URL=http://127.0.0.1:8899' \
      'INFLUENCER_INTELLIGENCE_SERVICE_TOKEN=' \
      'INFLUENCER_INTELLIGENCE_MCP_BEARER_TOKEN=' \
      'INFLUENCER_INTELLIGENCE_ACTOR_HMAC_KEY=' \
      'INFLUENCER_INTELLIGENCE_DATABASE_URL=' \
      'INFLUENCER_INTELLIGENCE_GRANT=module.influencer-intelligence.access' \
      >"$config_tmp"
    chmod 0640 "$config_tmp"
    sudo -n install -m 0640 "$config_tmp" "$config_file"
    rm -f "$config_tmp"
  fi
  sudo -n systemctl daemon-reload
  sudo -n systemctl disable influencer-intelligence.service influencer-intelligence-mcp.service >/dev/null 2>&1 || true
  echo 'Influencer Intelligence runtime registered; units remain disabled and the feature flag remains false.'
fi
