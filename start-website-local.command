#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

export OPEN_BROWSER="${OPEN_BROWSER:-1}"

exec ./scripts/run-local-website.sh "${1:-/}"
