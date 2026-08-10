#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/runtime/global-coordination-native.sh"
UNIT_SRC="$ROOT_DIR/ops/runtime/units/crm-jobs.service"
UNIT_DEST="/etc/systemd/system"
SOURCE_ROOT="$ROOT_DIR"
STATE_ROOT="/var/lib/skincos-runtime"
CONFIG_ROOT="/etc/skincos"
LOG_ROOT="/var/log/skincos"
BACKUP_ROOT="/var/backups/skincos"
APPLY=0
ENABLE=0
coordination_acquired=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-continuous-worker-service.sh [--apply] [--enable] [--source-root <immutable-release>]

Without --apply, renders the CRM continuous-worker unit in a temporary
directory and verifies it with systemd-analyze. --apply installs only the
unit and reloads systemd. --enable additionally enables it; it never starts
the service. Runtime execution remains disabled until the private
crm-jobs.env explicitly sets CRM_CONTINUOUS_WORKERS_ENABLED=1 and, for the
Clientes job set, CRM_CONTINUOUS_JOBS_ENABLED=1.

`--apply` accepts only /opt/skincos/releases/<40-hex-sha>/source. Runtime
paths and unit destination are fixed; environment variables cannot render
arbitrary systemd directives or choose a command path.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --enable) ENABLE=1 ;;
    --source-root)
      [[ "$#" -ge 2 ]] || { echo "--source-root requires a value" >&2; exit 64; }
      SOURCE_ROOT="$2"
      shift 2
      continue
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

if [[ "$ENABLE" == "1" && "$APPLY" != "1" ]]; then
  echo "--enable requires --apply" >&2
  exit 64
fi

if [[ "$APPLY" == "1" ]]; then
  [[ "$SOURCE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || {
    echo "--apply requires an immutable /opt/skincos/releases/<40-hex-sha>/source path" >&2
    exit 64
  }
  [[ -d "$SOURCE_ROOT" && -x "$SOURCE_ROOT/scripts/crm/run-continuous-workers-linux.sh" ]] || {
    echo "Immutable source release is unavailable: $SOURCE_ROOT" >&2
    exit 1
  }
  coordination_source_sha="$(basename "$(dirname "$SOURCE_ROOT")")"
  [[ "$coordination_source_sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Immutable source release SHA is invalid.' >&2
    exit 78
  }
  COORDINATION_CLOSURE="${SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE:-$SOURCE_ROOT/.skincos-global-coordination-orb.json}"
  [[ -f "$COORDINATION_CLOSURE" ]] || {
    echo "Immutable Orb coordination closure is unavailable: $COORDINATION_CLOSURE" >&2
    exit 78
  }
elif [[ "$SOURCE_ROOT" != "$ROOT_DIR" && ! "$SOURCE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]]; then
  echo "--source-root must be an immutable release path" >&2
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
cleanup() {
  rm -rf "$render_dir"
  if [[ "$coordination_acquired" == '1' ]]; then
    native_coordination_cleanup || true
    coordination_acquired=0
  fi
}
trap cleanup EXIT INT TERM
rendered="$render_dir/crm-jobs.service"
sed \
  -e "s|__REPO_ROOT__|$(escape "$SOURCE_ROOT")|g" \
  -e "s|__STATE_ROOT__|$(escape "$STATE_ROOT")|g" \
  -e "s|__CONFIG_ROOT__|$(escape "$CONFIG_ROOT")|g" \
  -e "s|__LOG_ROOT__|$(escape "$LOG_ROOT")|g" \
  "$UNIT_SRC" >"$rendered"

systemd-analyze verify "$rendered"

if [[ "$APPLY" == "1" ]]; then
  native_coordination_init release:orb orb "$coordination_source_sha" "$COORDINATION_CLOSURE" mutation
  native_coordination_acquire "mini-pc:release:orb:continuous-worker:$coordination_source_sha:$$" >/dev/null
  coordination_acquired=1
  native_coordination_check
  if sudo -n test -f "$UNIT_DEST/crm-jobs.service"; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    native_coordination_check
    sudo -n install -d -m 0750 "$BACKUP_ROOT"
    native_coordination_check
    sudo -n cp -p "$UNIT_DEST/crm-jobs.service" "$BACKUP_ROOT/crm-jobs.service.$stamp"
  fi
  native_coordination_check
  sudo -n install -m 0644 "$rendered" "$UNIT_DEST/crm-jobs.service"
  native_coordination_check
  sudo -n systemctl daemon-reload
  if [[ "$ENABLE" == "1" ]]; then
    native_coordination_check
    sudo -n systemctl enable crm-jobs.service >/dev/null
  fi
  echo "CRM continuous-worker unit installed; no service start was requested."
else
  echo "CRM continuous-worker unit template verifies successfully."
fi
