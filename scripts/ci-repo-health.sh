#!/usr/bin/env bash
set -euo pipefail

# Lightweight, non-blocking repo health checks. Exit 0 always; echo findings.
# 1) Detect large files accidentally committed
findings=0
LARGE=$(git ls-files -z | xargs -0 -I{} sh -c 'test -f "{}" && du -k "{}" | awk "$1>5120{print $2 \" (\" $1/1024 \" MB)\"}"' || true)
if [ -n "$LARGE" ]; then
  echo "[health] Large files detected (>5MB):"
  echo "$LARGE"
  findings=1
fi

# 2) Check for unresolved merge markers
MM=$(git grep -nE '<<<<<<< |=======|>>>>>>> ' -- ':!package-lock.json' ':!pnpm-lock.yaml' || true)
if [ -n "$MM" ]; then
  echo "[health] Merge markers present in files:"
  echo "$MM"
  findings=1
fi

# 3) Check .gitmodules legitimacy
if [ -f .gitmodules ]; then
  URLS=$(git config --file=.gitmodules --list | grep url || true)
  if [ -z "$URLS" ]; then
    echo "[health] .gitmodules exists but has no URLs"
    findings=1
  fi
fi

# Always succeed; this is informational only
exit 0
