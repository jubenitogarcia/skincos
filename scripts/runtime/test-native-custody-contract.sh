#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
HELPER="$ROOT_DIR/scripts/runtime/provision-global-coordination-custody.sh"

valid_output="$(printf 'https://coordination.example.workers.dev\n%s\n' "$(printf 's%.0s' {1..40})" | bash "$HELPER" validate)"
[[ "$valid_output" == 'custody_input=valid' ]] || { echo 'valid custody input was rejected' >&2; exit 1; }

if printf 'http://coordination.example.workers.dev\n%s\n' "$(printf 's%.0s' {1..40})" | bash "$HELPER" validate >/dev/null 2>&1; then
  echo 'insecure coordinator URL was accepted' >&2
  exit 1
fi

if printf 'https://coordination.example.workers.dev\nshort\n' | bash "$HELPER" validate >/dev/null 2>&1; then
  echo 'short coordination secret was accepted' >&2
  exit 1
fi

echo 'native custody contract checks passed'
