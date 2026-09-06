#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -f "$root/.codex/hooks/invoke-codex-lifecycle.sh" ] && "$root/.codex/hooks/invoke-codex-lifecycle.sh" || true
[ -f "$root/.codex/hooks/invoke-codex-thread-routing.sh" ] && "$root/.codex/hooks/invoke-codex-thread-routing.sh" || true
