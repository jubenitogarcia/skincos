#!/usr/bin/env bash
set -euo pipefail

# The runtime move has one deliberately short write window. A successful
# pre-copy is not enough: this script performs the final delta only after the
# old services stop, then either validates the new stack or restores the old
# unit files against a retained rollback worktree.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_ROOT="${RUNTIME_ROOT:-/mnt/c/CodexRuntime}"
LEGACY_REPO_ROOT="${LEGACY_REPO_ROOT:-/mnt/c/CodexShared/Projetos/skincos}"
APPLY=0
BACKUP_DIR=""
ROLLBACK_ROOT=""
ROLLBACK_ARTIFACT_ROOT=""
CHECKPOINT_DIR=""
CUTOVER_STARTED=0
CUTOVER_COMPLETE=0
STOP_TIMEOUT_SECONDS="${CUTOVER_STOP_TIMEOUT_SECONDS:-90}"
START_TIMEOUT_SECONDS="${CUTOVER_START_TIMEOUT_SECONDS:-180}"

legacy_units=(
  skincos-cloudflared-orb.service
  skincos-cloudflared-cs.service
  skincos-booking-api.service
  skincos-crm-api.service
  skincos-evolution.service
  skincos-orb-proxy.service
  skincos-n8n.service
)
new_units=(
  orb.service
  orb-proxy.service
  messaging-whatsapp.service
  crm.service
  booking.service
  cloudflare-orb.service
  cloudflare-runtime.service
)

usage() {
  cat <<'EOF'
Usage:
  scripts/runtime/cutover-lifecycle-runtime.sh --backup-dir <verified-backup> --rollback-root <legacy-worktree> --rollback-artifact-root <runtime-artifacts>
  scripts/runtime/cutover-lifecycle-runtime.sh --apply --backup-dir <verified-backup> --rollback-root <legacy-worktree> --rollback-artifact-root <runtime-artifacts>

Without --apply, prints and validates the cutover prerequisites. --apply
stops only the listed legacy services, performs the non-destructive final
sync, starts the lifecycle services and runs health checks. If a post-stop step
fails it restores the captured legacy units against --rollback-root and starts
them again. The rollback artifacts must first be staged outside Git with
scripts/runtime/stage-rollback-artifacts.sh. It never deletes legacy runtime
data, backups or the rollback worktree.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --backup-dir) BACKUP_DIR="${2:-}"; shift ;;
    --rollback-root) ROLLBACK_ROOT="${2:-}"; shift ;;
    --rollback-artifact-root) ROLLBACK_ARTIFACT_ROOT="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

for command in curl readlink sha256sum python3 systemctl; do require_cmd "$command"; done
[[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]] || { echo "--backup-dir must name an existing backup directory." >&2; exit 1; }
[[ -n "$ROLLBACK_ROOT" && -e "$ROLLBACK_ROOT/.git" ]] || { echo "--rollback-root must be a retained Git worktree." >&2; exit 1; }
[[ -n "$ROLLBACK_ARTIFACT_ROOT" && -d "$ROLLBACK_ARTIFACT_ROOT" ]] || { echo "--rollback-artifact-root must name staged runtime artifacts outside Git." >&2; exit 1; }
[[ -f "$BACKUP_DIR/manifest.json" && -f "$BACKUP_DIR/n8n_runtime.dump" ]] || { echo "Backup is missing manifest.json or n8n_runtime.dump." >&2; exit 1; }
[[ "$STOP_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo "CUTOVER_STOP_TIMEOUT_SECONDS must be a positive integer." >&2; exit 1; }
[[ "$START_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo "CUTOVER_START_TIMEOUT_SECONDS must be a positive integer." >&2; exit 1; }

expected_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["databaseSha256"])' "$BACKUP_DIR/manifest.json")"
actual_sha="$(sha256sum "$BACKUP_DIR/n8n_runtime.dump" | awk '{print $1}')"
[[ "$expected_sha" == "$actual_sha" ]] || { echo "Backup database checksum mismatch." >&2; exit 1; }
restore_verified="$(python3 -c 'import json,sys; print(str(json.load(open(sys.argv[1])).get("restoreVerified", False)).lower())' "$BACKUP_DIR/manifest.json")"
[[ "$restore_verified" == "true" ]] || { echo "Backup has no verified restore proof." >&2; exit 1; }

if [[ "$APPLY" == "1" ]]; then
  require_cmd sudo
  sudo -n true
fi

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
CHECKPOINT_DIR="$RUNTIME_ROOT/backups/runtime-cutover/$timestamp"

legacy_unit_path() {
  sudo -n systemctl show --property=FragmentPath --value "$1"
}

wait_for_units_state() {
  local expected="$1"
  local timeout="$2"
  shift 2
  local deadline=$((SECONDS + timeout))
  local unit state pending

  while :; do
    pending=0
    for unit in "$@"; do
      state="$(sudo -n systemctl is-active "$unit" 2>/dev/null || true)"
      if [[ "$state" != "$expected" ]]; then
        pending=1
        printf 'unit=%s state=%s expected=%s\n' "$unit" "${state:-unknown}" "$expected" >&2
      fi
    done
    [[ "$pending" == "0" ]] && return 0
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting ${timeout}s for units to become ${expected}." >&2
      return 1
    fi
    sleep 2
  done
}

stop_units_bounded() {
  sudo -n systemctl stop --no-block "$@"
  wait_for_units_state inactive "$STOP_TIMEOUT_SECONDS" "$@"
}

start_units_bounded() {
  sudo -n systemctl start --no-block "$@"
  wait_for_units_state active "$START_TIMEOUT_SECONDS" "$@"
}

validate_rollback_artifacts() {
  local workflow="$ROLLBACK_ARTIFACT_ROOT/orb/workflows/livia.active.json"
  local crm_dependencies="$ROLLBACK_ARTIFACT_ROOT/crm/node_modules"
  local rollback_workflow="$ROLLBACK_ROOT/modules/automations/n8n/workflows/livia.active.json"
  local rollback_dependencies="$ROLLBACK_ROOT/modules/crm/api/node_modules"

  [[ -f "$workflow" ]] || { echo "Missing staged Livia workflow: $workflow" >&2; return 1; }
  [[ -d "$crm_dependencies/express" ]] || { echo "Missing staged CRM production dependencies: $crm_dependencies/express" >&2; return 1; }
  [[ -L "$rollback_workflow" && "$(readlink -f "$rollback_workflow")" == "$(readlink -f "$workflow")" ]] || {
    echo "Rollback worktree Livia workflow is not the verified runtime artifact." >&2
    return 1
  }
  [[ -L "$rollback_dependencies" && "$(readlink -f "$rollback_dependencies")" == "$(readlink -f "$crm_dependencies")" ]] || {
    echo "Rollback worktree CRM dependencies are not the verified runtime artifact." >&2
    return 1
  }
}

save_legacy_units() {
  echo "Capturing installed legacy unit files in $CHECKPOINT_DIR/units"
  sudo -n mkdir -p "$CHECKPOINT_DIR/units"
  local unit path
  for unit in "${legacy_units[@]}"; do
    path="$(legacy_unit_path "$unit")"
    [[ -n "$path" && -f "$path" ]] || { echo "Legacy unit is not installed: $unit" >&2; exit 1; }
    sudo -n install -m 0644 "$path" "$CHECKPOINT_DIR/units/$unit"
  done
}

restore_legacy_services() {
  echo "Rolling back to retained worktree: $ROLLBACK_ROOT" >&2
  local unit source destination escaped_legacy escaped_rollback
  escaped_legacy="$(printf '%s' "$LEGACY_REPO_ROOT" | sed 's/[&|]/\\&/g')"
  escaped_rollback="$(printf '%s' "$ROLLBACK_ROOT" | sed 's/[&|]/\\&/g')"
  for unit in "${legacy_units[@]}"; do
    source="$CHECKPOINT_DIR/units/$unit"
    destination="/etc/systemd/system/$unit"
    [[ -f "$source" ]] || continue
    sed "s|$escaped_legacy|$escaped_rollback|g" "$source" | sudo -n install -m 0644 /dev/stdin "$destination"
  done
  sudo -n systemctl daemon-reload
  sudo -n systemctl disable "${new_units[@]}" orb-backup.timer >/dev/null 2>&1 || true
  sudo -n systemctl stop --no-block "${new_units[@]}" >/dev/null 2>&1 || true
  wait_for_units_state inactive "$STOP_TIMEOUT_SECONDS" "${new_units[@]}" || true
  sudo -n systemctl enable "${legacy_units[@]}" >/dev/null
  start_units_bounded "${legacy_units[@]}"
}

on_exit() {
  local status=$?
  if [[ "$APPLY" == "1" && "$CUTOVER_STARTED" == "1" && "$CUTOVER_COMPLETE" != "1" ]]; then
    restore_legacy_services || echo "Automatic rollback failed; retain $CHECKPOINT_DIR and restore the captured units manually." >&2
  fi
  exit "$status"
}
trap on_exit EXIT INT TERM

echo "Verified backup: $BACKUP_DIR"
echo "Rollback worktree: $ROLLBACK_ROOT"
echo "Rollback runtime artifacts: $ROLLBACK_ARTIFACT_ROOT"
echo "Lifecycle source: $ROOT_DIR"
printf 'Legacy services: %s\n' "${legacy_units[*]}"
printf 'Lifecycle services: %s\n' "${new_units[*]}"

if [[ "$APPLY" != "1" ]]; then
  validate_rollback_artifacts
  "$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh"
  "$ROOT_DIR/scripts/runtime/install-lifecycle-units.sh"
  echo "Preflight passed. Use --apply only in the scheduled cut window."
  exit 0
fi

validate_rollback_artifacts
save_legacy_units
CUTOVER_STARTED=1

echo "Stopping legacy ingress and runtimes."
stop_units_bounded "${legacy_units[@]}"
"$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh" --apply --final-sync
BOOKING_API_RUNTIME_HOME="$RUNTIME_ROOT/state/booking" EF_SCRAPER_VENV_DIR="$RUNTIME_ROOT/state/booking/venv" "$ROOT_DIR/scripts/booking/bootstrap-venv.sh"
"$ROOT_DIR/scripts/runtime/install-lifecycle-units.sh" --apply

echo "Starting lifecycle runtimes and ingress."
start_units_bounded "${new_units[@]}"

for attempt in {1..12}; do
  if curl -fsS --connect-timeout 5 http://127.0.0.1:5678/healthz >/dev/null \
    && curl -fsS --connect-timeout 10 https://orb.skincos.com.br/healthz >/dev/null \
    && curl -fsS --connect-timeout 10 https://crm.skincos.com.br >/dev/null; then
    break
  fi
  [[ "$attempt" == "12" ]] && { echo "Lifecycle health checks did not become ready." >&2; exit 1; }
  sleep 5
done

sudo -n systemctl disable "${legacy_units[@]}" >/dev/null
sudo -n systemctl reset-failed "${legacy_units[@]}" || true
CUTOVER_COMPLETE=1
echo "Lifecycle cutover passed. Retain $CHECKPOINT_DIR and $ROLLBACK_ROOT until the post-cut backup and public smoke are complete."
