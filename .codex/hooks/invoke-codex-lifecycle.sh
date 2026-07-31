#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -f "$root/.codex/hooks/codex-lifecycle-hook.py" ] || exit 0
exec python3 "$root/.codex/hooks/codex-lifecycle-hook.py" --repo-root "$root"
