#!/usr/bin/env bash
set -euo pipefail

echo "== Sales Chart Messenger Dev Setup (monorepo) =="
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required" >&2; exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "• Ensuring local config and env from examples"
make -s -C "${BACKEND_DIR}" sales-chart-messenger-setup-local || true

echo "• Installing dev dependencies"
make -s -C "${BACKEND_DIR}" sales-chart-messenger-install-dev

echo "• Quick checks"
make -s -C "${BACKEND_DIR}" sales-chart-messenger-validate || true

echo "✅ Dev setup complete"
