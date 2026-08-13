#!/usr/bin/env bash
set -euo pipefail

# This root-owned entrypoint has a fixed implementation path and a bounded
# command vocabulary. The self-hosted runners receive no path or shell choice.
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/root \
  /usr/bin/node /usr/local/lib/skincos/ponto-jit-custody.mjs "${1:-}"
