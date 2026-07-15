#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/runtime/cutover-lifecycle-runtime.sh"

bash -n "$SCRIPT"

required=(
  'WINDOWS_POWERSHELL="${WINDOWS_POWERSHELL:-}"'
  'resolve_windows_powershell()'
  '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
  'to_windows_path()'
  'wslpath -w "$path"'
  '"$WINDOWS_POWERSHELL" -NoProfile -ExecutionPolicy Bypass -File "$WINDOWS_TRANSFER_SCRIPT" -FinalSync'
  '"$expected" == "inactive" && "$state" == "failed"'
  'Legacy services did not reach a stopped state; restoring the retained stack before exit.'
  'if ! stop_units_bounded "${legacy_units[@]}"; then'
)

for pattern in "${required[@]}"; do
  grep -F -- "$pattern" "$SCRIPT" >/dev/null || {
    echo "Missing Windows PowerShell resolution guard: $pattern" >&2
    exit 1
  }
done

function_file="$(mktemp)"
trap 'rm -f "$function_file"' EXIT
sed -n '/^wait_for_units_state()/,/^}$/p' "$SCRIPT" > "$function_file"
# shellcheck source=/dev/null
source "$function_file"

sudo() {
  [[ "$1" == "-n" ]] && shift
  [[ "$1" == "systemctl" && "$2" == "is-active" ]] || return 1
  printf 'failed\n'
}

# A failed unit has no running process after systemctl stop, and must not hold
# the cutover in the legacy-stop phase. Startup is separately checked for active.
wait_for_units_state inactive 1 stopped-unit.service
unset -f sudo

echo "PASS: cutover resolves Windows PowerShell and accepts failed as stopped."
