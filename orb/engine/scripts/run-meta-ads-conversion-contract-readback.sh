#!/usr/bin/env bash
set -euo pipefail

# The bearer remains in the private Orb environment. This utility never reads
# it from argv, writes it to disk, or prints it; it only passes the value to the
# versioned Node readback process below.
ENV_FILE="/etc/skincos/orb-business.env"
if [[ ! -r "$ENV_FILE" ]]; then
  echo '{"ok":false,"error":"orb_business_environment_unavailable"}' >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/read-meta-ads-conversion-contract.js" --live
