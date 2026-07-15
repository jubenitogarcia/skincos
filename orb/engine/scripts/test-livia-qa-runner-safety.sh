#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$ROOT_DIR/scripts/livia/qa-runner.js"

node --check "$RUNNER"

if grep -Eq "systemctl[[:space:]]+restart|setVariableValue|LIVIA_CODEX_DRY_RUN" "$RUNNER"; then
  echo "Livia QA runner must not mutate runtime variables or restart Orb." >&2
  exit 1
fi

if ! grep -Fq "Livia retry is disabled" "$RUNNER"; then
  echo "Livia retry must fail closed until a separately reviewed controlled flow exists." >&2
  exit 1
fi

echo "Livia QA runner safety checks passed"
