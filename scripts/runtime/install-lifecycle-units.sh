#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_SRC="$ROOT_DIR/ops/runtime/units"
UNIT_DEST="${UNIT_DEST:-/etc/systemd/system}"
RUNTIME_ROOT="${RUNTIME_ROOT:-/mnt/c/CodexRuntime}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-lifecycle-units.sh [--apply]

Renders and verifies the final lifecycle units. Without --apply it only writes
temporary rendered units and runs systemd-analyze verify. With --apply it
installs, enables and daemon-reloads the final units; it deliberately does not
stop or disable the old units. The coordinated cutover script owns that step.
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

units=(
  orb.service
  orb-proxy.service
  messaging-whatsapp.service
  crm.service
  booking.service
  cloudflare-orb.service
  cloudflare-runtime.service
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
    "$source_file" >"$output"
  chmod 0644 "$output"
  rendered+=("$output")
done

systemd-analyze verify "${rendered[@]}"
echo "Lifecycle unit templates verify successfully."
printf '  %s\n' "${units[@]}"

if [[ "$APPLY" == "1" ]]; then
  sudo -n mkdir -p "$UNIT_DEST"
  for index in "${!units[@]}"; do
    sudo -n install -m 0644 "${rendered[$index]}" "$UNIT_DEST/${units[$index]}"
  done
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable "${units[@]}" >/dev/null
  echo "Lifecycle units installed and enabled. Old units remain untouched until cutover."
fi
