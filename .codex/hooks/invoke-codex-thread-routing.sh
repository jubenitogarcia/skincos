#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
runner="$root/.codex/hooks/invoke-codex-thread-routing.ps1"
[ -f "$runner" ] || exit 0
command -v powershell.exe >/dev/null 2>&1 || exit 0

if command -v wslpath >/dev/null 2>&1; then
  runner_windows="$(wslpath -w "$runner")"
else
  runner_windows="$runner"
fi

exec powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$runner_windows"
