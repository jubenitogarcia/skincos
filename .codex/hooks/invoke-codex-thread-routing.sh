#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
resolver="$root/scripts/resolve-codex-thread-worktree.ps1"
[ -f "$resolver" ] || exit 0
command -v powershell.exe >/dev/null 2>&1 || exit 0

if command -v wslpath >/dev/null 2>&1; then
  root_windows="$(wslpath -w "$root")"
  resolver_windows="$(wslpath -w "$resolver")"
else
  root_windows="$root"
  resolver_windows="$resolver"
fi

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass \
  -File "$resolver_windows" \
  -ProjectRoot "$root_windows" -Intent qualify -SkipGitHub -SkipProcessScan >/dev/stdout 2>/dev/null || true
