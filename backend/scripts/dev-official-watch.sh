#!/usr/bin/env bash
set -euo pipefail

# Backwards-compatible alias. Prefer: ./backend/scripts/dev.sh official --instance N

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$ROOT_DIR/backend/scripts/dev.sh" official "$@"
