#!/usr/bin/env bash
set -euo pipefail
# Delegate to unified E2E entry-point
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT_DIR/scripts/e2e.sh" ci-smoke "$@"
