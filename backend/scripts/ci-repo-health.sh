#!/usr/bin/env bash
set -euo pipefail

# Backwards-compatible alias. Prefer: ./backend/scripts/e2e.sh health
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec bash "$ROOT_DIR/backend/scripts/e2e.sh" health
