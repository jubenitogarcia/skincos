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
)

for pattern in "${required[@]}"; do
  grep -F -- "$pattern" "$SCRIPT" >/dev/null || {
    echo "Missing Windows PowerShell resolution guard: $pattern" >&2
    exit 1
  }
done

echo "PASS: cutover resolves Windows PowerShell without relying on the WSL PATH."
