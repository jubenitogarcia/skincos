#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"; cd "$root"; git fetch --prune origin
printf '{"head":"'; git rev-parse HEAD|tr -d '\n'; printf '","main":"'; git rev-parse origin/main|tr -d '\n'; printf '","dirty":'; test -n "$(git status --porcelain)" && printf true || printf false; printf '}\n'
command -v gh >/dev/null && gh pr list --state open --limit 20 --json number,headRefName,mergeStateStatus,url || true
