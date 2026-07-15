#!/usr/bin/env bash
set -euo pipefail

# The runtime move has one deliberately short write window. A successful
# pre-copy is not enough: this script performs the final delta only after the
# old services stop, then either validates the new stack or restores the old
# unit files against a retained rollback worktree.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_ROOT="${RUNTIME_ROOT:-/mnt/c/CodexRuntime}"
STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
SOURCE_ROOT="${SOURCE_ROOT:-/opt/skincos/current/source}"
MESSAGING_RELEASE_ROOT="${MESSAGING_RELEASE_ROOT:-/opt/skincos/current/messaging-whatsapp}"
LEGACY_REPO_ROOT="${LEGACY_REPO_ROOT:-/mnt/c/CodexShared/Projetos/skincos}"
APPLY=0
BACKUP_DIR=""
ROLLBACK_ROOT=""
ROLLBACK_ARTIFACT_ROOT=""
ORB_STATE_HOME=""
WINDOWS_TRANSFER_SCRIPT=""
WINDOWS_ORB_EXPORT_SCRIPT=""
WINDOWS_ORB_TRANSFER_SCRIPT=""
WINDOWS_POWERSHELL="${WINDOWS_POWERSHELL:-}"
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
LEGACY_WATCHDOG_TIMER="skincos-mini-pc-watchdog.timer"
LEGACY_WATCHDOG_SERVICE="skincos-mini-pc-watchdog.service"
LEGACY_WATCHDOG_WAS_ENABLED=0

usage() {
  cat <<'EOF'
Usage:
  scripts/runtime/cutover-lifecycle-runtime.sh --backup-dir <verified-backup> --rollback-root <legacy-worktree> --rollback-artifact-root <runtime-artifacts> --orb-state-home <native-staging-home> --windows-transfer-script <windows-ps1> --windows-orb-export-script <windows-ps1> --windows-orb-transfer-script <windows-ps1>
  scripts/runtime/cutover-lifecycle-runtime.sh --apply --backup-dir <verified-backup> --rollback-root <legacy-worktree> --rollback-artifact-root <runtime-artifacts> --orb-state-home <native-staging-home> --windows-transfer-script <windows-ps1> --windows-orb-export-script <windows-ps1> --windows-orb-transfer-script <windows-ps1>

Without --apply, prints and validates the cutover prerequisites. --apply
stops only the listed legacy services, obtains the final non-Orb state delta
through a Windows PowerShell process into native Linux storage, promotes
checksum-verified native Orb state, starts the lifecycle services
and runs health checks. If a post-stop step
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
    --orb-state-home) ORB_STATE_HOME="${2:-}"; shift ;;
    --windows-transfer-script) WINDOWS_TRANSFER_SCRIPT="${2:-}"; shift ;;
    --windows-orb-export-script) WINDOWS_ORB_EXPORT_SCRIPT="${2:-}"; shift ;;
    --windows-orb-transfer-script) WINDOWS_ORB_TRANSFER_SCRIPT="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

resolve_windows_powershell() {
  if [[ -n "$WINDOWS_POWERSHELL" ]]; then
    [[ -x "$WINDOWS_POWERSHELL" ]] || { echo "WINDOWS_POWERSHELL is not executable: $WINDOWS_POWERSHELL" >&2; exit 1; }
    return
  fi

  if command -v powershell.exe >/dev/null 2>&1; then
    WINDOWS_POWERSHELL="$(command -v powershell.exe)"
    return
  fi

  # WSL interop does not guarantee that Windows' System32 is in PATH. The
  # final delta must still be initiated by Windows, so use its canonical path
  # rather than falling back to a recursive DrvFS read.
  local mounted_path="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
  [[ -x "$mounted_path" ]] || { echo "Windows PowerShell is required for the Windows-native final transfer." >&2; exit 1; }
  WINDOWS_POWERSHELL="$mounted_path"
}

to_windows_path() {
  local path="$1"
  if [[ "$path" == /mnt/* ]]; then
    wslpath -w "$path"
    return
  fi

  [[ "$path" =~ ^[A-Za-z]:\\ ]] || {
    echo "Expected a Windows path or a mounted /mnt path, got: $path" >&2
    exit 1
  }
  printf '%s\n' "$path"
}

for command in curl readlink sha256sum python3 systemctl wslpath awk; do require_cmd "$command"; done
require_cmd sudo
sudo -n true
[[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]] || { echo "--backup-dir must name an existing backup directory." >&2; exit 1; }
[[ -n "$ROLLBACK_ROOT" && -e "$ROLLBACK_ROOT/.git" ]] || { echo "--rollback-root must be a retained Git worktree." >&2; exit 1; }
[[ -n "$ROLLBACK_ARTIFACT_ROOT" && -d "$ROLLBACK_ARTIFACT_ROOT" ]] || { echo "--rollback-artifact-root must name staged runtime artifacts outside Git." >&2; exit 1; }
[[ -n "$ORB_STATE_HOME" ]] && sudo -n test -d "$ORB_STATE_HOME" || { echo "--orb-state-home must name checksum-verified native staging state." >&2; exit 1; }
sudo -n test -f "$ORB_STATE_HOME/state-archive.manifest" && sudo -n test -f "$ORB_STATE_HOME/.n8n/config" || { echo "--orb-state-home is incomplete." >&2; exit 1; }
[[ -f "$BACKUP_DIR/manifest.json" && -f "$BACKUP_DIR/n8n_runtime.dump" ]] || { echo "Backup is missing manifest.json or n8n_runtime.dump." >&2; exit 1; }
[[ "$STOP_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo "CUTOVER_STOP_TIMEOUT_SECONDS must be a positive integer." >&2; exit 1; }
[[ "$START_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo "CUTOVER_START_TIMEOUT_SECONDS must be a positive integer." >&2; exit 1; }
[[ -n "$WINDOWS_TRANSFER_SCRIPT" ]] || { echo "--windows-transfer-script is required: final state must be copied by Windows, not read recursively through /mnt/c." >&2; exit 1; }
[[ -n "$WINDOWS_ORB_EXPORT_SCRIPT" && -n "$WINDOWS_ORB_TRANSFER_SCRIPT" ]] || { echo "Windows Orb export and transfer scripts are required: a stale Orb staging directory cannot be promoted." >&2; exit 1; }
resolve_windows_powershell
WINDOWS_TRANSFER_SCRIPT="$(to_windows_path "$WINDOWS_TRANSFER_SCRIPT")"
WINDOWS_ORB_EXPORT_SCRIPT="$(to_windows_path "$WINDOWS_ORB_EXPORT_SCRIPT")"
WINDOWS_ORB_TRANSFER_SCRIPT="$(to_windows_path "$WINDOWS_ORB_TRANSFER_SCRIPT")"

expected_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["databaseSha256"])' "$BACKUP_DIR/manifest.json")"
actual_sha="$(sha256sum "$BACKUP_DIR/n8n_runtime.dump" | awk '{print $1}')"
[[ "$expected_sha" == "$actual_sha" ]] || { echo "Backup database checksum mismatch." >&2; exit 1; }
restore_verified="$(python3 -c 'import json,sys; print(str(json.load(open(sys.argv[1])).get("restoreVerified", False)).lower())' "$BACKUP_DIR/manifest.json")"
[[ "$restore_verified" == "true" ]] || { echo "Backup has no verified restore proof." >&2; exit 1; }
sudo -n test -f "$SOURCE_ROOT/orb/engine/orb-proxy/server.js" || { echo "Native Orb source is unavailable: $SOURCE_ROOT" >&2; exit 1; }
sudo -n test -f "$SOURCE_ROOT/scripts/booking/bootstrap-venv.sh" || { echo "Native Booking launcher is unavailable: $SOURCE_ROOT" >&2; exit 1; }
sudo -n test -f "$SOURCE_ROOT/crm/api/scripts/run.sh" || { echo "Native CRM source is unavailable: $SOURCE_ROOT" >&2; exit 1; }
sudo -n test -d "$SOURCE_ROOT/crm/api/node_modules/express" || { echo "Native CRM dependencies are unavailable: $SOURCE_ROOT" >&2; exit 1; }
sudo -n test -f "$MESSAGING_RELEASE_ROOT/dist/main.js" && sudo -n test -d "$MESSAGING_RELEASE_ROOT/node_modules" || {
  echo "Native WhatsApp release is unavailable: $MESSAGING_RELEASE_ROOT" >&2
  exit 1
}

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
      # `systemctl stop` can leave a unit in failed when its process exits
      # during shutdown. It is still stopped, so accept that terminal state
      # only while waiting for a stop; startup still requires active.
      if [[ "$state" == "$expected" ]] || [[ "$expected" == "inactive" && "$state" == "failed" ]]; then
        continue
      fi
      pending=1
      printf 'unit=%s state=%s expected=%s\n' "$unit" "${state:-unknown}" "$expected" >&2
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
  local rollback_workflows_dir rollback_crm_dir rollback_workflow rollback_dependencies

  rollback_workflows_dir="$(resolve_workflows_dir "$ROLLBACK_ROOT")"
  rollback_crm_dir="$(resolve_crm_dir "$ROLLBACK_ROOT")"
  rollback_workflow="$rollback_workflows_dir/livia.active.json"
  rollback_dependencies="$rollback_crm_dir/node_modules"

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

resolve_workflows_dir() {
  local root="$1"
  local candidate
  for candidate in "$root/orb/engine/workflows" "$root/modules/automations/n8n/workflows"; do
    [[ -d "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

resolve_crm_dir() {
  local root="$1"
  local candidate
  for candidate in "$root/crm/api" "$root/modules/crm/api"; do
    [[ -d "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
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

suspend_legacy_watchdog() {
  if ! sudo -n systemctl cat "$LEGACY_WATCHDOG_TIMER" >/dev/null 2>&1; then
    return
  fi

  if sudo -n systemctl is-enabled --quiet "$LEGACY_WATCHDOG_TIMER"; then
    LEGACY_WATCHDOG_WAS_ENABLED=1
  fi

  # The legacy watchdog starts n8n and the proxy whenever it observes them
  # down. It must be quiesced before the bounded stop window begins.
  sudo -n systemctl stop "$LEGACY_WATCHDOG_TIMER" "$LEGACY_WATCHDOG_SERVICE" || true
}

restore_legacy_watchdog() {
  if [[ "$LEGACY_WATCHDOG_WAS_ENABLED" == "1" ]]; then
    sudo -n systemctl enable --now "$LEGACY_WATCHDOG_TIMER"
  fi
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
  restore_legacy_watchdog
}

run_final_windows_transfer() {
  local output transfer_root
  echo "Capturing final non-Orb delta through Windows into native Linux storage."
  output="$("$WINDOWS_POWERSHELL" -NoProfile -ExecutionPolicy Bypass -File "$WINDOWS_TRANSFER_SCRIPT" -FinalSync)" || {
    echo "Windows final transfer failed; legacy services will be restored." >&2
    return 1
  }
  printf '%s\n' "$output"
  transfer_root="$(printf '%s\n' "$output" | awk -F= '/^LIFECYCLE_TRANSFER_ROOT=/{print $2; exit}' | tr -d '\r')"
  [[ -n "$transfer_root" ]] || { echo "Windows transfer did not report LIFECYCLE_TRANSFER_ROOT." >&2; return 1; }
  [[ "$transfer_root" != /mnt/c/* ]] || { echo "Windows transfer incorrectly returned a DrvFS path." >&2; return 1; }
  "$ROOT_DIR/scripts/runtime/apply-lifecycle-state-transfer.sh" --transfer-root "$transfer_root" --apply --final-sync
}

run_final_orb_transfer() {
  local export_output archive archive_sha transfer_output extracted_home staged_output staged_home windows_artifact_root
  windows_artifact_root="$(wslpath -w "$RUNTIME_ROOT/artifacts/runtime-cutover/$timestamp")"
  echo "Creating authoritative Orb state archive through Windows after legacy services stopped."
  export_output="$("$WINDOWS_POWERSHELL" -NoProfile -ExecutionPolicy Bypass -File "$WINDOWS_ORB_EXPORT_SCRIPT" -ArtifactRoot "$windows_artifact_root" -RequireLegacyOrbStopped)" || return 1
  printf '%s\n' "$export_output"
  archive="$(printf '%s\n' "$export_output" | awk -F= '/^ORB_STATE_ARCHIVE=/{print $2; exit}' | tr -d '\r')"
  archive_sha="$(printf '%s\n' "$export_output" | awk -F= '/^ORB_STATE_SHA256=/{print $2; exit}' | tr -d '\r')"
  [[ -n "$archive" && "$archive_sha" =~ ^[A-Fa-f0-9]{64}$ ]] || { echo "Windows Orb export did not return an archive and SHA-256." >&2; return 1; }
  transfer_output="$("$WINDOWS_POWERSHELL" -NoProfile -ExecutionPolicy Bypass -File "$WINDOWS_ORB_TRANSFER_SCRIPT" -Archive "$archive" -Sha256 "$archive_sha")" || return 1
  printf '%s\n' "$transfer_output"
  extracted_home="$(printf '%s\n' "$transfer_output" | awk -F= '/^EXTRACTED_ORB_STATE_HOME=/{print $2; exit}' | tr -d '\r')"
  [[ -n "$extracted_home" && "$extracted_home" != /mnt/* ]] || { echo "Windows Orb transfer did not return native extracted state." >&2; return 1; }
  staged_output="$("$ROOT_DIR/scripts/runtime/stage-orb-state-archive.sh" --extracted-home "$extracted_home" --sha256 "$archive_sha" --apply)" || return 1
  printf '%s\n' "$staged_output"
  staged_home="$(printf '%s\n' "$staged_output" | awk -F= '/^STAGED_ORB_STATE_HOME=/{print $2; exit}')"
  [[ -n "$staged_home" ]] || { echo "Native Orb stage did not return STAGED_ORB_STATE_HOME." >&2; return 1; }
  ORB_STATE_HOME="$staged_home"
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
echo "Native source release: $SOURCE_ROOT"
echo "Native WhatsApp release: $MESSAGING_RELEASE_ROOT"
echo "Native Orb state staging: $ORB_STATE_HOME"
echo "Windows final-transfer script: $WINDOWS_TRANSFER_SCRIPT"
echo "Windows Orb export script: $WINDOWS_ORB_EXPORT_SCRIPT"
echo "Windows Orb transfer script: $WINDOWS_ORB_TRANSFER_SCRIPT"
echo "Lifecycle source: $ROOT_DIR"
printf 'Legacy services: %s\n' "${legacy_units[*]}"
printf 'Lifecycle services: %s\n' "${new_units[*]}"

if [[ "$APPLY" != "1" ]]; then
  validate_rollback_artifacts
  "$ROOT_DIR/scripts/runtime/promote-orb-state-staging.sh" --staged-home "$ORB_STATE_HOME"
  "$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh" --skip-legacy-transfer
  SOURCE_ROOT="$SOURCE_ROOT" "$ROOT_DIR/scripts/runtime/install-lifecycle-units.sh"
  echo "Preflight passed. Use --apply only in the scheduled cut window."
  exit 0
fi

validate_rollback_artifacts
save_legacy_units
CUTOVER_STARTED=1

echo "Quiescing the legacy watchdog."
suspend_legacy_watchdog
echo "Stopping legacy ingress and runtimes."
if ! stop_units_bounded "${legacy_units[@]}"; then
  echo "Legacy services did not reach a stopped state; restoring the retained stack before exit." >&2
  restore_legacy_services
  CUTOVER_STARTED=0
  exit 1
fi
run_final_windows_transfer
run_final_orb_transfer
"$ROOT_DIR/scripts/runtime/promote-orb-state-staging.sh" --apply --staged-home "$ORB_STATE_HOME"
"$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh" --apply --final-sync --skip-legacy-transfer
BOOKING_API_RUNTIME_HOME="$STATE_ROOT/booking" EF_SCRAPER_VENV_DIR="$STATE_ROOT/booking/venv" "$SOURCE_ROOT/scripts/booking/bootstrap-venv.sh"
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
sudo -n systemctl disable --now "$LEGACY_WATCHDOG_TIMER" >/dev/null 2>&1 || true
CUTOVER_COMPLETE=1
echo "Lifecycle cutover passed. Retain $CHECKPOINT_DIR and $ROLLBACK_ROOT until the post-cut backup and public smoke are complete."
