#!/usr/bin/env bash
set -euo pipefail
# Deprecated: use scripts/dev-all-watch.sh instead. Keeping a thin wrapper for backward compatibility.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT_DIR/scripts/dev-all-watch.sh" "$@"
