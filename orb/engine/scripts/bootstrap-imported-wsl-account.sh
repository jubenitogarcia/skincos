#!/usr/bin/env bash
set -euo pipefail

ENGINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ENGINE_ROOT/../.." && pwd)"
CANONICAL_ROOT="/mnt/c/CodexShared/Projetos/skincos"

command -v git >/dev/null 2>&1 || { echo 'Missing required command: git' >&2; exit 1; }

register_safe_directory() {
  local path="$1"
  if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq "$path"; then
    git config --global --add safe.directory "$path"
  fi
}

register_safe_directory "$CANONICAL_ROOT"
register_safe_directory "$REPO_ROOT"

echo 'WSL operator bootstrap completed.'
if command -v gh >/dev/null 2>&1; then
  gh auth status --hostname github.com >/dev/null 2>&1 || \
    echo 'GitHub authentication is pending: gh auth login --hostname github.com --git-protocol https --web'
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl --quiet is-active orb.service && echo 'Native Orb runtime: active' || \
    echo 'Native Orb runtime is not active; use scripts/runtime/manage-native-runtime.sh status.'
fi
