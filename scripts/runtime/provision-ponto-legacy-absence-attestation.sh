#!/usr/bin/env bash
set -euo pipefail

# Fixed root entrypoint for the point-in-time legacy Ponto absence attestation.
# It accepts neither paths, service names, nor modes from the runner account.

if [[ "$#" -ne 1 ]]; then
  echo 'usage: skincos-attest-ponto-legacy-absence bootstrap-absence|attest-absence' >&2
  exit 64
fi

case "$1" in
  bootstrap-absence|attest-absence) ;;
  *)
    echo 'usage: skincos-attest-ponto-legacy-absence bootstrap-absence|attest-absence' >&2
    exit 64
    ;;
esac

exec /usr/bin/timeout --signal=KILL 120s /usr/bin/env -i PATH=/usr/bin:/bin HOME=/root \
  /usr/bin/node /usr/local/lib/skincos/ponto-legacy-snapshot-custody.mjs "$1"
