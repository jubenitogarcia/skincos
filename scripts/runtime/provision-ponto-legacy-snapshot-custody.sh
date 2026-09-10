#!/usr/bin/env bash
set -euo pipefail

# Fixed root entrypoint for the bounded legacy Ponto capture. It deliberately
# exposes neither source nor destination path arguments to the caller.

if [[ "$#" -ne 1 ]]; then
  echo 'usage: skincos-capture-ponto-legacy-snapshot bootstrap|capture' >&2
  exit 64
fi

case "$1" in
  bootstrap|capture) ;;
  *)
    echo 'usage: skincos-capture-ponto-legacy-snapshot bootstrap|capture' >&2
    exit 64
    ;;
esac

exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/root \
  /usr/bin/node /usr/local/lib/skincos/ponto-legacy-snapshot-custody.mjs "$1"
